/**
 * Worker Handler - Handles worker event coordination and message processing
 */
import createEventEmitter from '../../shared/event-emitter.js';

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
    processingStateManager: null,
  };

  /**
   * Initialize worker handler
   * @param {Object} workerManager - Worker manager instance
   * @param {Object} discoveryCoordinator - Discovery coordinator instance
   * @param {Object} documentProcessor - Document processor instance
   * @param {Object} mediaProcessor - Media processor instance
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} processingStateManager - Processing state manager instance
   */
  async function init(
    workerManager,
    discoveryCoordinator,
    documentProcessor,
    mediaProcessor,
    sessionManager,
    processingStateManager,
    persistenceManager,
    scanCompletionHandler,
  ) {
    state.workerManager = workerManager;
    state.discoveryCoordinator = discoveryCoordinator;
    state.documentProcessor = documentProcessor;
    state.mediaProcessor = mediaProcessor;
    state.sessionManager = sessionManager;
    state.processingStateManager = processingStateManager;
    state.persistenceManager = persistenceManager;
    state.scanCompletionHandler = scanCompletionHandler;
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
        console.warn('[Worker Handler] ⚠️ No media processor available');
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
      console.error('[Worker Handler] ❌ Error in processMediaImmediately:', error);
      eventEmitter.emit('error', { error: error.message });
    }
  }

  /**
   * Handle scanning completion
   * @param {number} processedCount - Number of processed documents
   * @returns {Promise<void>}
   */
  async function handleScanningCompletion(processedCount = 0) {
    try {
      console.log('[Worker Handler] 🔄 Worker scanning completed with processedCount:', processedCount);
      // Worker completion is now handled by Queue Orchestrator
      // Scan completion methods are called by Queue Orchestrator after discovery phase
      return true;
    } catch (error) {
      console.error('[Worker Handler] ❌ Error in handleScanningCompletion:', error);
      return false;
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
        const discoveryFiles = await state.discoveryCoordinator.loadDiscoveryFiles();
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
          // Clean up existing media for this updated document first
          if (state.mediaProcessor) {
            await state.mediaProcessor.cleanupMediaForUpdatedDocuments([data.page]);
          }

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

          // Save to IndexedDB for sync process
          if (state.persistenceManager) {
            await state.persistenceManager.savePageScanStatus({
              pagePath: data.page,
              sourceFile: data.sourceFile,
              status: 'completed',
              mediaCount: data?.mediaCount || 0,
              sessionId: state.sessionManager?.getCurrentSession()?.sessionId,
            });
          }
        }
      },
      onBatchComplete: async (data) => {
        eventEmitter.emit('batchComplete', data);
        if (state.processingStateManager && data?.processedCount) {
          const currentProgress = await state.processingStateManager.loadScanningCheckpoint();
          const newScannedPages = (currentProgress.scannedPages || 0) + data.processedCount;
          const totalPages = currentProgress.totalPages || 0;
          const isScanningComplete = newScannedPages >= totalPages;
          const updatedProgress = {
            ...currentProgress,
            scannedPages: newScannedPages,
            pendingPages: Math.max(0, totalPages - newScannedPages),
            totalMedia: (currentProgress.totalMedia || 0) + (data?.totalMedia || 0),
            status: isScanningComplete ? 'completed' : 'running',
            scanningStartTime: currentProgress.scanningStartTime || Date.now(),
            discoveryType: currentProgress.discoveryType || 'full',
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
        console.log('[Worker Handler] 📡 Received queueProcessingStopped:', data);
        if (data.reason === 'completed') {
          console.log('[Worker Handler] 🔄 Calling handleScanningCompletion with processedCount:', data.processedCount);
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