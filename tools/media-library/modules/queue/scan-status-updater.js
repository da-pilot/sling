/**
 * Scan Status Updater - Handles scan status updates and file status management
 */
import createEventEmitter from '../../shared/event-emitter.js';
import { loadData, saveData } from '../sheet-utils.js';

export default function createScanStatusUpdater() {
  const eventEmitter = createEventEmitter('Scan Status Updater');
  const state = {
    processingStateManager: null,
  };

  async function init(processingStateManager) {
    state.processingStateManager = processingStateManager;
  }

  async function updateDiscoveryFileScanStatus(
    config,
    daApi,
    processingStateManager,
    fileName,
    pagePath,
    status,
    mediaCount = 0,
    error = null,
  ) {
    try {
      if (config && daApi && fileName) {
        const filePath = `/${config.org}/${config.repo}/.media/.pages/${fileName}`;
        const url = `${config.baseUrl}/source${filePath}`;

        const existingData = await loadData(url, config.token);
        let documents = [];

        if (existingData && existingData.data && Array.isArray(existingData.data)
            && existingData.data.length > 0) {
          documents = existingData.data[0].data || [];
        }

        const updatedDocuments = documents.map((doc) => {
          if (doc.path === pagePath) {
            return {
              ...doc,
              scanStatus: status,
              mediaCount,
              lastScannedAt: new Date().toISOString(),
              scanComplete: status === 'completed',
              scanErrors: error ? [error] : [],
            };
          }
          return doc;
        });

        await saveData(url, updatedDocuments, config.token);
      }

      eventEmitter.emit('discoveryFileStatusUpdated', {
        fileName,
        pagePath,
        status,
        mediaCount,
        error,
      });
    } catch (updateError) {
      console.error('[Scan Status Updater] Failed to update discovery file status:', updateError);
    }
  }

  async function updateSiteStructureMediaCount(
    processingStateManager,
    pagePath,
    mediaCount,
  ) {
    try {
      if (processingStateManager) {
        await processingStateManager.updateSiteStructureMediaCount(pagePath, mediaCount);
      }
      eventEmitter.emit('siteStructureMediaCountUpdated', {
        pagePath,
        mediaCount,
      });
    } catch (updateError) {
      console.error('[Scan Status Updater] Failed to update site structure media count:', updateError);
    }
  }

  function updateFolderMediaCount(folder, pagePath, mediaCount) {
    if (!folder || !pagePath) {
      return;
    }
    if (folder.path === pagePath) {
      folder.mediaCount = (folder.mediaCount || 0) + mediaCount;
    }
    if (folder.children) {
      folder.children.forEach((child) => updateFolderMediaCount(child, pagePath, mediaCount));
    }
  }

  async function updateAllDiscoveryFiles(
    config,
    daApi,
    processingStateManager,
    discoveryFiles,
  ) {
    try {
      if (config && daApi && discoveryFiles) {
        await Promise.all(discoveryFiles.map(async (file) => {
          if (file.fileName && file.documents && Array.isArray(file.documents)) {
            const updatedDocuments = file.documents.map((doc) => {
              const isCompleted = doc.scanStatus === 'completed';
              const now = new Date().toISOString();

              return {
                ...doc,
                scanStatus: doc.scanStatus || 'pending',
                mediaCount: doc.mediaCount || 0,
                lastScannedAt: doc.lastScannedAt || now,
                lastScanned: doc.lastScanned || now,
                scanComplete: doc.scanComplete || isCompleted,
                scanErrors: doc.scanErrors || [],
                scanAttempts: doc.scanAttempts || 0,
                needsRescan: doc.needsRescan !== undefined
                  ? doc.needsRescan : !isCompleted,
                entryStatus: doc.entryStatus || (isCompleted ? 'completed' : 'pending'),
              };
            });

            const filePath = `/${config.org}/${config.repo}/.media/.pages/${file.fileName}`;
            const url = `${config.baseUrl}/source${filePath}`;
            await saveData(url, updatedDocuments, config.token);
          }
        }));
      }

      eventEmitter.emit('allDiscoveryFilesUpdated', {
        fileCount: discoveryFiles?.length || 0,
      });
    } catch (updateError) {
      console.error('[Scan Status Updater] Failed to update all discovery files:', updateError);
    }
  }

  /**
   * Update discovery files in cache with scan results
   * @param {Object} discoveryCoordinator - Discovery coordinator instance
   * @param {Array} updates - Array of update objects
   * @returns {number} Number of successful updates
   */
  function updateDiscoveryFilesInCache(discoveryCoordinator, updates) {
    try {
      if (!discoveryCoordinator || !Array.isArray(updates)) {
        return 0;
      }

      const successCount = discoveryCoordinator.updateDiscoveryFilesInCache(updates);

      eventEmitter.emit('discoveryFilesCacheUpdated', {
        updateCount: successCount,
        totalUpdates: updates.length,
      });

      return successCount;
    } catch (updateError) {
      console.error('[Scan Status Updater] Failed to update discovery files in cache:', updateError);
      return 0;
    }
  }

  /**
   * Update discovery files in parallel by file name with proper batching
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API instance
   * @param {Object} processingStateManager - Processing state manager
   * @param {Array} discoveryFiles - Array of discovery files to update
   * @returns {Promise<Object>} Update results
   */
  async function updateDiscoveryFilesInParallel(
    config,
    daApi,
    processingStateManager,
    discoveryFiles,
  ) {
    try {
      if (!config || !daApi || !discoveryFiles || discoveryFiles.length === 0) {
        return { success: false, error: 'Invalid parameters' };
      }

      // Get scanning checkpoint to know which documents were scanned
      let scanningCheckpoint = null;
      if (processingStateManager) {
        try {
          scanningCheckpoint = await processingStateManager.loadScanningCheckpoint();
        } catch (error) {
          console.warn('[Scan Status Updater] Could not load scanning checkpoint:', error.message);
        }
      }

      const updatePromises = discoveryFiles.map(async (file) => {
        if (!file.fileName || !file.documents || !Array.isArray(file.documents)) {
          return { fileName: file.fileName, success: false, error: 'Invalid file data' };
        }

        try {
          const updatedDocuments = file.documents.map((doc) => {
            const now = new Date().toISOString();
            
            // Check if this document was scanned in the current session
            let scanStatus = doc.scanStatus || 'pending';
            let mediaCount = doc.mediaCount || 0;
            let scanComplete = doc.scanComplete || false;
            
            // If scanning checkpoint shows completed status, mark documents as completed
            if (scanningCheckpoint && scanningCheckpoint.status === 'completed') {
              // For now, assume all documents in the discovery file were scanned
              // This is a simplified approach - ideally we'd track individual document paths
              scanStatus = 'completed';
              scanComplete = true;
              // Use the mediaCount from the synced cache data (should be updated by syncDiscoveryFilesCacheWithIndexedDB)
              // Don't override mediaCount if it's already been updated by the sync process
            }



            return {
              ...doc,
              scanStatus,
              mediaCount,
              lastScannedAt: doc.lastScannedAt || now,
              lastScanned: doc.lastScanned || now,
              scanComplete,
              scanErrors: doc.scanErrors || [],
              scanAttempts: doc.scanAttempts || 0,
              needsRescan: doc.needsRescan !== undefined
                ? doc.needsRescan : !scanComplete,
              entryStatus: doc.entryStatus || (scanComplete ? 'completed' : 'pending'),
            };
          });

          const totalMediaCount = updatedDocuments.reduce(
            (sum, doc) => sum + (doc.mediaCount || 0),
            0,
          );
          const completedDocuments = updatedDocuments.filter((doc) => doc.scanComplete).length;

          const filePath = `/${config.org}/${config.repo}/.media/.pages/${file.fileName}.json`;
          const url = `${config.baseUrl}/source${filePath}`;
          try {
            await saveData(url, updatedDocuments, config.token);
          } catch (saveError) {
            console.error('[Scan Status Updater] Failed to save to DA:', {
              fileName: file.fileName,
              url,
              error: saveError.message,
            });
            throw saveError;
          }

          return {
            fileName: file.fileName,
            success: true,
            documentCount: updatedDocuments.length,
            completedDocuments,
            totalMediaCount,
          };
        } catch (error) {
          console.error('[Scan Status Updater] Failed to update file:', file.fileName, error);
          return {
            fileName: file.fileName,
            success: false,
            error: error.message,
          };
        }
      });

      const results = await Promise.all(updatePromises);
      const successfulUpdates = results.filter((r) => r.success);
      const failedUpdates = results.filter((r) => !r.success);

      const totalMediaCount = successfulUpdates.reduce(
        (sum, r) => sum + (r.totalMediaCount || 0),
        0,
      );
      const totalCompletedDocuments = successfulUpdates.reduce(
        (sum, r) => sum + (r.completedDocuments || 0),
        0,
      );

      eventEmitter.emit('discoveryFilesUpdatedInParallel', {
        totalFiles: discoveryFiles.length,
        successfulUpdates: successfulUpdates.length,
        failedUpdates: failedUpdates.length,
        totalMediaCount,
        totalCompletedDocuments,
      });

      return {
        success: failedUpdates.length === 0,
        results,
        totalMediaCount,
        totalCompletedDocuments,
      };
    } catch (error) {
      console.error('[Scan Status Updater] Failed to update discovery files in parallel:', error);
      return { success: false, error: error.message };
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
    updateDiscoveryFileScanStatus,
    updateSiteStructureMediaCount,
    updateFolderMediaCount,
    updateAllDiscoveryFiles,
    updateDiscoveryFilesInCache,
    updateDiscoveryFilesInParallel,
    on,
    off,
    emit,
  };
}