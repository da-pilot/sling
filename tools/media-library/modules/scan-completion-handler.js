import createScanStatusUpdater from './queue/scan-status-updater.js';
import createSiteAggregator from './discovery/site-aggregator.js';
import createPersistenceManager from '../services/persistence-manager.js';
import createDiscoveryFileManager from './queue/discovery-file-manager.js';
import createEventEmitter from '../shared/event-emitter.js';

export default function createScanCompletionHandler() {
  const eventEmitter = createEventEmitter('Scan Completion Handler');
  const state = {
    scanStatusUpdater: null,
    siteAggregator: null,
    persistenceManager: null,
    config: null,
    daApi: null,
    processingStateManager: null,
  };

  async function init(config, daApi, processingStateManager) {
    state.config = config;
    state.daApi = daApi;
    state.processingStateManager = processingStateManager;
    state.scanStatusUpdater = createScanStatusUpdater();
    state.siteAggregator = createSiteAggregator();
    state.persistenceManager = createPersistenceManager();
    await state.persistenceManager.init();
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

      const updatedCheckpoint = {
        totalPages,
        scannedPages: totalPages,
        pendingPages: 0,
        failedPages: 0,
        totalMedia,
        status: 'completed',
        lastUpdated: Date.now(),
      };

      await state.processingStateManager.saveScanningCheckpointFile(updatedCheckpoint);

      eventEmitter.emit('scanningCheckpointCompleted', {
        totalPages,
        scannedPages: totalPages,
        totalMedia,
        timestamp: new Date().toISOString(),
      });

      return updatedCheckpoint;
    } catch (error) {
      return null;
    }
  }

  /**
   * Sync discovery files cache with IndexedDB scan results
   * @param {Object} discoveryCoordinator - Discovery coordinator instance
   * @returns {Promise<Array>} Updated discovery files
   */
  async function syncDiscoveryFilesCacheWithIndexedDB(discoveryCoordinator) {
    try {
      if (!discoveryCoordinator || !state.persistenceManager) {
        return null;
      }

      let discoveryFiles = discoveryCoordinator.getDiscoveryFilesCache();

      if (!discoveryFiles || discoveryFiles.length === 0) {
        try {
          const loadedFiles = await discoveryCoordinator.loadDiscoveryFiles();
          if (loadedFiles && loadedFiles.length > 0) {
            discoveryCoordinator.setDiscoveryFilesCache(loadedFiles);
            discoveryFiles = loadedFiles;
          }
        } catch (loadError) {
          // Silent error handling
        }

        if (!discoveryFiles || discoveryFiles.length === 0) {
          return null;
        }
      }

      const updates = [];

      const filePromises = discoveryFiles.map(async (file) => {
        if (file.fileName && file.documents) {
          const completedPages = await state.persistenceManager.getCompletedPagesByFile(
            file.fileName,
          );

          completedPages.forEach((page) => {
            const document = file.documents.find((doc) => doc.path === page.pageUrl);
            if (document) {
              updates.push({
                fileName: file.fileName,
                pagePath: page.pageUrl,
                status: page.scanStatus || 'completed',
                mediaCount: page.mediaCount || 0,
                error: page.scanErrors?.length > 0 ? page.scanErrors[0] : null,
              });
            }
          });
        }
      });

      await Promise.all(filePromises);

      if (updates.length > 0) {
        discoveryCoordinator.updateDiscoveryFilesInCache(updates);
      }

      const updatedCache = discoveryCoordinator.getUpdatedDiscoveryFilesFromCache();
      const totalMediaItems = updatedCache?.reduce((sum, file) => {
        const fileSum = file.documents?.reduce(
          (docSum, doc) => docSum + (doc.mediaCount || 0),
          0,
        ) || 0;
        return sum + fileSum;
      }, 0) || 0;

      const allPagesCompleted = updatedCache?.every((file) => file.documents?.every((doc) => doc.scanStatus === 'completed'));

      if (allPagesCompleted && updatedCache && updatedCache.length > 0) {
        const totalPages = updatedCache.reduce(
          (sum, file) => sum + (file.documents?.length || 0),
          0,
        );

        await updateScanningCheckpointAsCompleted(totalPages, totalMediaItems);
      }

      return updatedCache;
    } catch (error) {
      return null;
    }
  }

  async function updateSiteStructureWithMediaCounts(discoveryFilesData = null) {
    try {
      let newSiteStructure;

      if (discoveryFilesData && Array.isArray(discoveryFilesData)) {
        newSiteStructure = await state.siteAggregator.createSiteStructureFromCache(
          discoveryFilesData,
        );
      } else {
        newSiteStructure = await state.siteAggregator.createSiteStructure();
      }

      if (newSiteStructure) {
        await state.processingStateManager.saveSiteStructureFile(newSiteStructure);

        eventEmitter.emit('siteStructureUpdated', {
          totalFolders: newSiteStructure?.stats?.totalFolders || 0,
          totalFiles: newSiteStructure?.stats?.totalFiles || 0,
          totalMediaItems: newSiteStructure?.stats?.totalMediaItems || 0,
          timestamp: new Date().toISOString(),
        });
      }
      try {
        await state.persistenceManager.clearMediaStore();
      } catch (error) {
        throw new Error(`Failed to clear media store: ${error.message}`);
      }
    } catch (error) {
      throw new Error(`Failed to reconstruct site structure: ${error.message}`);
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
    updateSiteStructureWithMediaCounts,
    updateDiscoveryFileScanStatus,
    updateSiteStructureMediaCount,
    updateFolderMediaCount,
    saveScanningCheckpoint,
    processRemainingMedia,
    syncDiscoveryFilesCacheWithIndexedDB,
    updateScanningCheckpointAsCompleted,
    on,
    off,
    emit,
  };
}