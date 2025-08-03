/**
 * Worker Handler - Handles worker event coordination and message processing
 */
import createEventEmitter from '../../shared/event-emitter.js';
import createScanCompletionHandler from '../scan-completion-handler.js';

export default function createWorkerHandler() {
  const eventEmitter = createEventEmitter('Worker Handler');
  const state = {
    workerManager: null,
    discoveryHandler: null,
    discoveryCoordinator: null,
    documentProcessor: null,
    mediaProcessor: null,
    sessionManager: null,
    scanCompletionHandler: null,
  };

  /**
   * Initialize worker handler
   * @param {Object} workerManager - Worker manager instance
   * @param {Object} discoveryHandler - Discovery handler instance
   * @param {Object} discoveryCoordinator - Discovery coordinator instance
   * @param {Object} documentProcessor - Document processor instance
   * @param {Object} mediaProcessor - Media processor instance
   * @param {Object} sessionManager - Session manager instance
   */
  async function init(
    workerManager,
    discoveryHandler,
    discoveryCoordinator,
    documentProcessor,
    mediaProcessor,
    sessionManager,
  ) {
    state.workerManager = workerManager;
    state.discoveryHandler = discoveryHandler;
    state.discoveryCoordinator = discoveryCoordinator;
    state.documentProcessor = documentProcessor;
    state.mediaProcessor = mediaProcessor;
    state.sessionManager = sessionManager;
    state.scanCompletionHandler = createScanCompletionHandler();
    await state.scanCompletionHandler.init(
      discoveryHandler.getConfig(),
      discoveryHandler.getDaApi(),
      discoveryHandler.getProcessingStateManager(),
    );
  }

  /**
   * Process media immediately
   * @param {Array} media - Media items to process
   * @param {string} sessionId - Session ID
   * @returns {Promise<void>}
   */
  async function processMediaImmediately(media, sessionId) {
    try {
      if (!state.mediaProcessor) {
        return;
      }
      if (sessionId && state.sessionManager) {
        const session = state.sessionManager.getCurrentSession();
        if (session) {
          state.mediaProcessor.setCurrentSession(
            sessionId,
            session.userId,
            session.browserId,
          );
        }
      }
      await state.mediaProcessor.queueMediaForBatchProcessing(media);
    } catch (error) {
      eventEmitter.emit('error', { error: error.message });
    }
  }

  /**
   * Handle scanning completion
   * @param {number} processedCount - Number of processed documents
   * @returns {Promise<void>}
   */
  async function handleScanningCompletion(processedCount) {
    try {
      console.log('[Worker Handler] 🎯 Handling scanning completion...');

      const session = state.sessionManager.getCurrentSession();

      await state.scanCompletionHandler.saveScanningCheckpoint({
        status: 'completed',
        totalPages: processedCount,
        scannedPages: processedCount,
        totalMedia: 0,
        sessionId: session?.sessionId,
      });

      // Sync cache with IndexedDB scan results FIRST
      let updatedDiscoveryFiles = null;
      if (state.discoveryCoordinator) {
        console.log('[Worker Handler] 🔄 Calling syncDiscoveryFilesCacheWithIndexedDB...');
        updatedDiscoveryFiles = await state.scanCompletionHandler.syncDiscoveryFilesCacheWithIndexedDB(
          state.discoveryCoordinator,
        );
        console.log('[Worker Handler] 📊 Sync result:', {
          hasUpdatedFiles: !!updatedDiscoveryFiles,
          fileCount: updatedDiscoveryFiles?.length || 0,
        });
      } else {
        console.log('[Worker Handler] ⚠️ No discovery coordinator available for sync');
      }

      // If cache sync failed, load discovery files as fallback
      if (!updatedDiscoveryFiles || updatedDiscoveryFiles.length === 0) {
        console.log('[Worker Handler] 🔄 Using original discovery files as fallback');
        const discoveryFiles = await state.discoveryHandler.loadDiscoveryFiles();
        updatedDiscoveryFiles = discoveryFiles;
      }

      // Update DA files with the updated cache data
      await state.scanCompletionHandler.updateAllDiscoveryFiles(updatedDiscoveryFiles);

      // Create site structure with the updated cache data
      await state.scanCompletionHandler.updateSiteStructureWithMediaCounts(updatedDiscoveryFiles);

      console.log('[Worker Handler] ✅ Scanning completion handled successfully');

      eventEmitter.emit('scanningCompletionHandled', {
        processedCount,
        sessionId: session?.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Worker Handler] ❌ Error handling scanning completion:', error);
      eventEmitter.emit('error', { error: error.message });
    }
  }

  /**
   * Setup worker event handlers
   * @returns {Promise<void>}
   */
  async function setupWorkerHandlers() {
    const worker = await state.workerManager.getDefaultWorker();
    if (!worker) {
      return;
    }

    const handlers = {
      onQueueProcessingStarted: (data) => {
        eventEmitter.emit('queueProcessingStarted', data);
      },
      onRequestBatch: async () => {
        const discoveryFiles = await state.discoveryHandler.loadDiscoveryFiles();
        const documentsToScan = state.documentProcessor.getDocumentsToScan(discoveryFiles, false);
        if (documentsToScan.length > 0) {
          const batch = documentsToScan.slice(0, 10);
          worker.postMessage({
            type: 'processBatch',
            data: { batch },
          });
        } else {
          worker.postMessage({
            type: 'queueProcessingStopped',
            data: { reason: 'no_documents' },
          });
        }
      },
      onPageScanned: async (data) => {
        eventEmitter.emit('pageScanned', data);
        
        // Update discovery files cache with scan results
        if (data?.page && data?.sourceFile && state.discoveryCoordinator) {
          const updateData = {
            fileName: data.sourceFile,
            pagePath: data.page,
            status: 'completed',
            mediaCount: data?.mediaCount || 0,
            error: null,
          };
          
          state.discoveryCoordinator.updateDiscoveryFileInCache(
            updateData.fileName,
            updateData.pagePath,
            updateData.status,
            updateData.mediaCount,
            updateData.error,
          );
          
          console.log('[Worker Handler] 📋 Updated discovery files cache:', {
            page: data.page,
            sourceFile: data.sourceFile,
            mediaCount: data?.mediaCount || 0,
          });
        }
      },
      onBatchComplete: async (data) => {
        eventEmitter.emit('batchComplete', data);
        
        // Update scanning checkpoint with batch progress
        if (state.processingStateManager && data?.processedCount) {
          const currentProgress = await state.processingStateManager.loadScanningCheckpoint();
          const updatedProgress = {
            ...currentProgress,
            scannedPages: (currentProgress.scannedPages || 0) + data.processedCount,
            totalMedia: (currentProgress.totalMedia || 0) + (data?.totalMedia || 0),
            status: 'running',
            lastUpdated: Date.now(),
          };
          await state.processingStateManager.saveScanningCheckpointFile(updatedProgress);
          
          console.log('[Worker Handler] 📊 Updated scanning checkpoint after batch:', {
            processedCount: data.processedCount,
            totalScanned: updatedProgress.scannedPages,
            totalMedia: updatedProgress.totalMedia,
          });
        }
      },
      onPageScanError: async (data) => {
        eventEmitter.emit('pageScanError', data);
        
        // Update discovery files cache with error status
        if (data?.page && data?.sourceFile && state.discoveryCoordinator) {
          const updateData = {
            fileName: data.sourceFile,
            pagePath: data.page,
            status: 'failed',
            mediaCount: 0,
            error: data?.error || 'Unknown error',
          };
          
          state.discoveryCoordinator.updateDiscoveryFileInCache(
            updateData.fileName,
            updateData.pagePath,
            updateData.status,
            updateData.mediaCount,
            updateData.error,
          );
          
          console.log('[Worker Handler] ❌ Updated discovery files cache with error:', {
            page: data.page,
            sourceFile: data.sourceFile,
            error: data?.error,
          });
        }
      },
      onQueueProcessingStopped: async (data) => {
        if (data.reason === 'completed') {
          await handleScanningCompletion(data.processedCount || 0);
        }
        eventEmitter.emit('queueProcessingStopped', data);
      },
      onWorkerError: async (data) => {
        eventEmitter.emit('workerError', data);
      },
      onMediaDiscovered: async (data) => {
        await processMediaImmediately(data.media, data.sessionId);
      },
    };

    worker.addEventListener('message', (event) => {
      const { type, data } = event.data;
      const handler = handlers[`on${type.charAt(0).toUpperCase() + type.slice(1)}`];
      if (handler) {
        handler(data);
      }
    });

    state.workerManager.setupWorkerHandlers(handlers);
  }

  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function on(event, callback) {
    eventEmitter.on(event, callback);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function off(event, callback) {
    eventEmitter.off(event, callback);
  }

  /**
   * Emit event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  function emit(event, data) {
    eventEmitter.emit(event, data);
  }

  return {
    init,
    setupWorkerHandlers,
    processMediaImmediately,
    on,
    off,
    emit,
  };
}