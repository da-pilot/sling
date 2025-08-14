import createScanStatusUpdater from './queue/scan-status-updater.js';
import createSiteAggregator from './discovery/site-aggregator.js';
import createPersistenceManager from '../services/persistence-manager.js';
import createDiscoveryFileManager from './queue/discovery-file-manager.js';
import createEventEmitter from '../shared/event-emitter.js';
import createAuditLogManager from '../services/audit-log-manager.js';

export default function createScanCompletionHandler() {
  const eventEmitter = createEventEmitter('Scan Completion Handler');
  const state = {
    scanStatusUpdater: null,
    siteAggregator: null,
    persistenceManager: null,
    config: null,
    daApi: null,
    processingStateManager: null,
    auditLogManager: null,
  };

  async function init(config, daApi, processingStateManager, discoveryCoordinator, sessionManager) {
    state.config = config;
    state.daApi = daApi;
    state.processingStateManager = processingStateManager;
    state.discoveryCoordinator = discoveryCoordinator;
    state.sessionManager = sessionManager;
    state.scanStatusUpdater = createScanStatusUpdater();
    state.siteAggregator = createSiteAggregator();
    state.persistenceManager = createPersistenceManager();
    state.auditLogManager = createAuditLogManager();
    await state.persistenceManager.init();
    state.auditLogManager.init(config, daApi);
    state.siteAggregator.init(config);
    state.siteAggregator.setDaApi(daApi);
  }

  async function updateAllDiscoveryFiles(discoveryFiles) {
    let files = discoveryFiles;
    if (!files || files.length === 0) {
      const discoveryFileManager = createDiscoveryFileManager();
      files = await discoveryFileManager.loadDiscoveryFilesWithChangeDetection(
        state.config,
        state.daApi,
        () => [],
      );
    }
    if (state.discoveryCoordinator) {
      const updatedCache = state.discoveryCoordinator.getUpdatedDiscoveryFilesFromCache();
      if (updatedCache && updatedCache.length > 0) {
        files = updatedCache;
      }
    }
    const result = await state.scanStatusUpdater.updateDiscoveryFilesInParallel(
      state.config,
      state.daApi,
      state.processingStateManager,
      files,
    );
    eventEmitter.emit('discoveryFilesUpdated', {
      fileCount: files.length,
      fileNames: files.map((f) => f.fileName),
      timestamp: new Date().toISOString(),
      success: result.success,
      totalMediaCount: result.totalMediaCount,
      totalCompletedDocuments: result.totalCompletedDocuments,
    });
    return result;
  }

  /**
   * Update scanning checkpoint with completed status and total media count
   * @param {number} totalPages - Total number of pages
   * @param {number} totalMedia - Total media count
   * @returns {Promise<Object>} Updated checkpoint data
   */
  async function updateScanningCheckpointAsCompleted(totalPages, totalMedia) {
    try {
      if (!state.processingStateManager) {
        return null;
      }
      const currentCheckpoint = await state.processingStateManager.loadScanningCheckpoint();
      const currentTotalPages = totalPages || currentCheckpoint?.totalPages || 0;
      const currentScannedPages = totalPages || currentCheckpoint?.scannedPages || 0;
      const currentTotalMedia = totalMedia || currentCheckpoint?.totalMedia || 0;
      const updatedCheckpoint = {
        totalPages: currentTotalPages,
        scannedPages: currentScannedPages,
        pendingPages: 0,
        failedPages: 0,
        totalMedia: currentTotalMedia,
        status: 'completed',
        scanningStartTime: currentCheckpoint?.scanningStartTime || Date.now(),
        scanningEndTime: Date.now(),
        discoveryType: currentCheckpoint?.discoveryType || 'full',
        lastUpdated: Date.now(),
      };
      await state.processingStateManager.saveScanningCheckpointFile(updatedCheckpoint);
      const discoveryCheckpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
      if (discoveryCheckpoint && state.auditLogManager) {
        const sessionId = state.sessionManager?.getCurrentSession() || 'unknown';
        await state.auditLogManager.createAuditEntry(
          discoveryCheckpoint,
          updatedCheckpoint,
          sessionId,
        );
      }
      eventEmitter.emit('scanningCheckpointCompleted', {
        totalPages: updatedCheckpoint.totalPages,
        scannedPages: updatedCheckpoint.scannedPages,
        totalMedia: updatedCheckpoint.totalMedia,
        timestamp: new Date().toISOString(),
      });
      return updatedCheckpoint;
    } catch (error) {
      throw new Error(`Failed to update scanning checkpoint as completed: ${error.message}`);
    }
  }

  async function updateSelectiveDiscoveryFiles(affectedFileNames, scannedDocuments) {
    try {
      if (!affectedFileNames || affectedFileNames.length === 0) {
        return { success: true, updatedFiles: 0 };
      }
      const discoveryFileManager = createDiscoveryFileManager();
      const allDiscoveryFiles = await discoveryFileManager.loadDiscoveryFilesWithChangeDetection(
        state.config,
        state.daApi,
        () => [],
      );
      const filesToUpdate = allDiscoveryFiles.filter(
        (file) => affectedFileNames.includes(file.fileName),
      );
      if (filesToUpdate.length === 0) {
        return { success: true, updatedFiles: 0 };
      }
      const scannedPaths = new Set(scannedDocuments.map((doc) => doc.path));
      const updatedFiles = filesToUpdate.map((file) => {
        const updatedDocuments = file.documents.map((doc) => {
          if (scannedPaths.has(doc.path)) {
            return {
              ...doc,
              scanStatus: 'completed',
              scanComplete: true,
              needsRescan: false,
              lastScannedAt: new Date().toISOString(),
              entryStatus: 'completed',
            };
          }
          return doc;
        });
        return { ...file, documents: updatedDocuments };
      });
      const result = await state.scanStatusUpdater.updateDiscoveryFilesInParallel(
        state.config,
        state.daApi,
        state.processingStateManager,
        updatedFiles,
      );
      eventEmitter.emit('selectiveDiscoveryFilesUpdated', {
        fileCount: updatedFiles.length,
        fileNames: updatedFiles.map((f) => f.fileName),
        timestamp: new Date().toISOString(),
        success: result.success,
      });
      return result;
    } catch (error) {
      throw new Error(`Failed to update selective discovery files: ${error.message}`);
    }
  }

  async function updateSiteStructureWithMediaCounts(discoveryFilesData) {
    try {
      const siteStructure = await state.siteAggregator
        .createSiteStructureFromCache(discoveryFilesData);
      if (siteStructure) {
        await state.processingStateManager.saveSiteStructureFile(siteStructure);
        const eventData = {
          totalFolders: siteStructure.stats.totalFolders,
          totalFiles: siteStructure.stats.totalFiles,
          totalMediaItems: siteStructure.stats.totalMediaItems,
          timestamp: new Date().toISOString(),
        };
        eventEmitter.emit('siteStructureUpdated', eventData);
      }
    } catch (error) {
      throw new Error(`Error updating site structure: ${error.message}`);
    }
  }

  async function updateDiscoveryFileScanStatus(
    fileName,
    pagePath,
    status,
    mediaCount = 0,
    error = null,
  ) {
    return state.scanStatusUpdater.updateDiscoveryFileScanStatus(
      state.config,
      state.daApi,
      state.processingStateManager,
      fileName,
      pagePath,
      status,
      mediaCount,
      error,
    );
  }

  async function updateSiteStructureMediaCount(pagePath, mediaCount) {
    return state.scanStatusUpdater.updateSiteStructureMediaCount(
      state.processingStateManager,
      pagePath,
      mediaCount,
    );
  }

  function updateFolderMediaCount(folder, pagePath, mediaCount) {
    return state.scanStatusUpdater.updateFolderMediaCount(folder, pagePath, mediaCount);
  }

  async function saveScanningCheckpoint(checkpointData) {
    if (state.processingStateManager) {
      await state.processingStateManager.saveScanningCheckpointFile(checkpointData);
    }
  }

  async function processRemainingMedia(sessionId) {
    try {
      const queueItems = await state.persistenceManager.getProcessingQueue(sessionId);
      const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);
      return { totalQueuedItems, queueItems };
    } catch (error) {
      return { totalQueuedItems: 0, queueItems: [] };
    }
  }

  function on(event, callback) {
    eventEmitter.on(event, callback);
  }

  function off(event, callback) {
    eventEmitter.off(event, callback);
  }

  function emit(event, data) {
    eventEmitter.emit(event, data);
  }

  return {
    init,
    updateAllDiscoveryFiles,
    updateSelectiveDiscoveryFiles,
    updateSiteStructureWithMediaCounts,
    updateDiscoveryFileScanStatus,
    updateSiteStructureMediaCount,
    updateFolderMediaCount,
    saveScanningCheckpoint,
    processRemainingMedia,
    updateScanningCheckpointAsCompleted,
    loadAuditLog: state.auditLogManager?.loadAuditLog.bind(state.auditLogManager),
    cleanupOldEntries: state.auditLogManager?.cleanupOldEntries.bind(state.auditLogManager),
    on,
    off,
    emit,
  };
}