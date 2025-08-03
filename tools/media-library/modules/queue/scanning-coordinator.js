/**
 * Scanning Coordinator - Coordinates scanning operations and worker management
 */
import createEventEmitter from '../../shared/event-emitter.js';

export default function createScanningCoordinator() {
  const eventEmitter = createEventEmitter('Scanning Coordinator');
  const state = {
    workerManager: null,
    sessionManager: null,
    documentProcessor: null,
    discoveryHandler: null,
    processingStateManager: null,
  };

  /**
   * Initialize scanning coordinator
   * @param {Object} workerManager - Worker manager instance
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} documentProcessor - Document processor instance
   * @param {Object} discoveryHandler - Discovery handler instance
   * @param {Object} processingStateManager - Processing state manager instance
   */
  async function init(workerManager, sessionManager, documentProcessor, discoveryHandler, processingStateManager = null) {
    state.workerManager = workerManager;
    state.sessionManager = sessionManager;
    state.documentProcessor = documentProcessor;
    state.discoveryHandler = discoveryHandler;
    state.processingStateManager = processingStateManager;
  }

  /**
   * Start scanning phase
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Promise<Object>} Scanning result
   */
  async function startScanningPhase(forceRescan = false) {
    try {
      const discoveryFiles = await state.discoveryHandler.loadDiscoveryFiles();
      const documentsToScan = state.documentProcessor.getDocumentsToScan(
        discoveryFiles,
        forceRescan,
      );

      if (documentsToScan.length > 0) {
        // Initialize scanning checkpoint
        if (state.processingStateManager) {
          const initialCheckpoint = {
            totalPages: documentsToScan.length,
            scannedPages: 0,
            pendingPages: documentsToScan.length,
            failedPages: 0,
            totalMedia: 0,
            status: 'running',
            lastUpdated: Date.now(),
          };
          await state.processingStateManager.saveScanningCheckpointFile(initialCheckpoint);
          
          console.log('[Scanning Coordinator] 📊 Initialized scanning checkpoint:', {
            totalPages: documentsToScan.length,
            status: 'running',
          });
        }

        const worker = await state.workerManager.getDefaultWorker();
        if (worker) {
          const session = state.sessionManager.getCurrentSession();

          worker.postMessage({
            type: 'startQueueProcessing',
            data: {
              sessionId: session?.sessionId,
              userId: session?.userId,
              browserId: session?.browserId,
              documentsToScan,
              batchSize: 10,
            },
          });

          return new Promise((resolve, reject) => {
            const handleWorkerMessage = (event) => {
              const { type, data } = event.data;

              if (type === 'queueProcessingStopped') {
                worker.removeEventListener('message', handleWorkerMessage);
                if (data.reason === 'completed') {
                  resolve({ success: true, documentsScanned: data.processedCount });
                } else {
                  reject(new Error(data.error || 'Worker processing failed'));
                }
              } else if (type === 'error') {
                worker.removeEventListener('message', handleWorkerMessage);
                reject(new Error(data.error || 'Worker error'));
              }
            };
            worker.addEventListener('message', handleWorkerMessage);
          });
        }
        eventEmitter.emit('scanningStopped', {
          status: 'failed',
          error: 'No worker available for processing',
        });
        return { success: false, error: 'No worker available for processing' };
      }
      const totalDocuments = discoveryFiles.reduce(
        (total, file) => total + (file.documents ? file.documents.length : 0),
        0,
      );
      eventEmitter.emit('scanningStopped', {
        status: 'completed',
        reason: 'no_documents',
        totalDocuments,
      });
      return { success: true, documentsScanned: 0 };
    } catch (error) {
      eventEmitter.emit('batchProcessingFailed', { error: error.message });
      eventEmitter.emit('scanningStopped', { status: 'failed', error: error.message });
      return { success: false, error: error.message };
    }
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
    startScanningPhase,
    on,
    off,
    emit,
  };
}