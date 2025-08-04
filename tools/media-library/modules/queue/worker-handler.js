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
      const session = state.sessionManager.getCurrentSession();

      await state.scanCompletionHandler.saveScanningCheckpoint({
        status: 'completed',
        totalPages: processedCount,
        scannedPages: processedCount,
        totalMedia: 0,
        sessionId: session?.sessionId,
      });

      let updatedDiscoveryFiles = null;
      if (state.discoveryCoordinator) {
        updatedDiscoveryFiles = await state.scanCompletionHandler
          .syncDiscoveryFilesCacheWithIndexedDB(state.discoveryCoordinator);
      }

      if (!updatedDiscoveryFiles || updatedDiscoveryFiles.length === 0) {
        const discoveryFiles = await state.discoveryHandler.loadDiscoveryFiles();
        updatedDiscoveryFiles = discoveryFiles;
      }

      await state.scanCompletionHandler.updateAllDiscoveryFiles(
        updatedDiscoveryFiles,
      );

      await state.scanCompletionHandler.updateSiteStructureWithMediaCounts(
        updatedDiscoveryFiles,
      );

      eventEmitter.emit('scanningCompletionHandled', {
        processedCount,
        sessionId: session?.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
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
        }
      },
      onBatchComplete: async (data) => {
        eventEmitter.emit('batchComplete', data);

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
        }
      },
      onPageScanError: async (data) => {
        eventEmitter.emit('pageScanError', data);

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