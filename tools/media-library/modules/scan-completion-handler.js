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

    // If we have a discovery coordinator, use the updated cache data
    if (state.discoveryCoordinator) {
      const updatedCache = state.discoveryCoordinator.getUpdatedDiscoveryFilesFromCache();
      if (updatedCache && updatedCache.length > 0) {
        files = updatedCache;
      }
    }

    // Use parallel update for better performance and reliability
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
        console.error('[Scan Completion Handler] ❌ Processing state manager not available');
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

      console.log('[Scan Completion Handler] ✅ Updated scanning checkpoint as completed:', {
        totalPages,
        scannedPages: totalPages,
        totalMedia,
        status: 'completed',
      });

      eventEmitter.emit('scanningCheckpointCompleted', {
        totalPages,
        scannedPages: totalPages,
        totalMedia,
        timestamp: new Date().toISOString(),
      });

      return updatedCheckpoint;
    } catch (error) {
      console.error('[Scan Completion Handler] ❌ Failed to update scanning checkpoint as completed:', error);
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
        console.log('[Scan Completion Handler] ⚠️ No discovery files in cache to sync - attempting to load discovery files first');

        // Try to load discovery files and populate cache
        try {
          const loadedFiles = await discoveryCoordinator.loadDiscoveryFiles();
          if (loadedFiles && loadedFiles.length > 0) {
            discoveryCoordinator.setDiscoveryFilesCache(loadedFiles);
            // Continue with the sync process using the loaded files
            discoveryFiles = loadedFiles;
          }
        } catch (loadError) {
          console.error('[Scan Completion Handler] ❌ Failed to load discovery files:', loadError);
        }

        if (!discoveryFiles || discoveryFiles.length === 0) {
          return null;
        }
      }

      // Always update cache with IndexedDB data to ensure mediaCount is current
      const updates = [];

      // Get scan results from IndexedDB for each discovery file
      const filePromises = discoveryFiles.map(async (file) => {
        if (file.fileName && file.documents) {
          // Try to get completed pages by the discovery file name (without .json extension)
          console.log('[Scan Completion Handler] 🔍 Looking for IndexedDB entries with sourceFile:', file.fileName);
          const completedPages = await state.persistenceManager.getCompletedPagesByFile(
            file.fileName,
          );

          console.log('[Scan Completion Handler] 📋 IndexedDB data for', file.fileName, ':', {
            completedPagesCount: completedPages.length,
            pages: completedPages.map((p) => ({ page: p.pageUrl, mediaCount: p.mediaCount })),
          });

          // Always update documents with IndexedDB data to ensure mediaCount is current
          completedPages.forEach((page) => {
            const document = file.documents.find((doc) => doc.path === page.pageUrl);
            console.log('[Scan Completion Handler] 🔍 Matching attempt:', {
              discoveryFileName: file.fileName,
              pageSourceFile: page.sourceFile,
              pageUrl: page.pageUrl,
              documentPath: document?.path,
              isMatch: !!document,
              mediaCount: page.mediaCount,
            });
            if (document) {
              // Always update mediaCount and other properties regardless of scan status
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

      // Update cache with IndexedDB data for all entries
      if (updates.length > 0) {
        const successCount = discoveryCoordinator.updateDiscoveryFilesInCache(updates);
        console.log('[Scan Completion Handler] 🔄 Synced discovery files cache with IndexedDB:', {
          updateCount: successCount,
          totalUpdates: updates.length,
          updates: updates.map((u) => ({ page: u.pagePath, mediaCount: u.mediaCount, status: u.status })),
        });
      } else {
        console.log('[Scan Completion Handler] ⚠️ No IndexedDB updates found - this may indicate a mismatch between discovery file names and sourceFile values');

        // Log all available IndexedDB data for debugging
        try {
          const allPageScanStatus = await state.persistenceManager.getAllPageScanStatus();
          console.log('[Scan Completion Handler] 🔍 All IndexedDB page scan status:', {
            totalPages: allPageScanStatus.length,
            sourceFiles: [...new Set(allPageScanStatus.map((p) => p.sourceFile))],
            pages: allPageScanStatus.map((p) => ({
              page: p.pageUrl,
              sourceFile: p.sourceFile,
              mediaCount: p.mediaCount,
              scanStatus: p.scanStatus,
            })),
          });
        } catch (error) {
          console.error('[Scan Completion Handler] ❌ Failed to get all page scan status:', error);
        }
      }

      const updatedCache = discoveryCoordinator.getUpdatedDiscoveryFilesFromCache();
      const totalMediaItems = updatedCache?.reduce((sum, file) => {
        const fileSum = file.documents?.reduce((docSum, doc) => docSum + (doc.mediaCount || 0), 0) || 0;
        return sum + fileSum;
      }, 0) || 0;

      console.log('[Scan Completion Handler] 📊 Final cache state:', {
        fileCount: updatedCache?.length || 0,
        totalMediaItems,
      });

      // Check if all pages are completed and update scanning checkpoint
      const allPagesCompleted = updatedCache?.every((file) =>
        file.documents?.every((doc) => doc.scanStatus === 'completed'),
      );

      if (allPagesCompleted && updatedCache && updatedCache.length > 0) {
        const totalPages = updatedCache.reduce((sum, file) => sum + (file.documents?.length || 0), 0);

        console.log('[Scan Completion Handler] 🎯 All pages completed, updating scanning checkpoint:', {
          totalPages,
          totalMediaItems,
        });

        await updateScanningCheckpointAsCompleted(totalPages, totalMediaItems);
      }

      // Return the updated cache even if no updates were made
      return updatedCache;
    } catch (error) {
      console.error('[Scan Completion Handler] ❌ Failed to sync discovery files cache:', error);
      return null;
    }
  }

  async function updateSiteStructureWithMediaCounts(discoveryFilesData = null) {
    try {
      let newSiteStructure;

      if (discoveryFilesData && Array.isArray(discoveryFilesData)) {
        // Use cache-based approach with provided discovery files data
        newSiteStructure = await state.siteAggregator.createSiteStructureFromCache(
          discoveryFilesData,
        );
        console.log('[Scan Completion Handler] 🔄 Creating site structure from cached discovery files data');
      } else {
        // Fallback to original approach (reading from disk)
        newSiteStructure = await state.siteAggregator.createSiteStructure();
        console.log('[Scan Completion Handler] 🔄 Creating site structure from disk (fallback)');
      }

      if (newSiteStructure) {
        await state.processingStateManager.saveSiteStructureFile(newSiteStructure);

        console.log('[Scan Completion Handler] ✅ Site structure updated with media counts:', {
          totalFolders: newSiteStructure?.stats?.totalFolders || 0,
          totalFiles: newSiteStructure?.stats?.totalFiles || 0,
          totalMediaItems: newSiteStructure?.stats?.totalMediaItems || 0,
        });

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
    if (state.processingStateManager && checkpointData.sessionId) {
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