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
    discoveryCoordinator: null,
    processingStateManager: null,
  };

  /**
   * Initialize scanning coordinator
   * @param {Object} workerManager - Worker manager instance
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} documentProcessor - Document processor instance
   * @param {Object} discoveryCoordinator - Discovery coordinator instance
   * @param {Object} processingStateManager - Processing state manager instance
   */
  async function init(workerManager, sessionManager, documentProcessor, discoveryCoordinator, processingStateManager = null) {
    state.workerManager = workerManager;
    state.sessionManager = sessionManager;
    state.documentProcessor = documentProcessor;
    state.discoveryCoordinator = discoveryCoordinator;
    state.processingStateManager = processingStateManager;
  }

  /**
   * Start scanning phase
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Promise<Object>} Scanning result
   */
  async function startScanningPhase(forceRescan = false) {
    try {
      const discoveryFiles = await state.discoveryCoordinator.loadDiscoveryFiles();
      const documentsToScan = state.documentProcessor.getDocumentsToScan(
        discoveryFiles,
        forceRescan,
      );
      if (state.processingStateManager) {
        let discoveryType = 'full';
        try {
          const discoveryCheckpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
          discoveryType = discoveryCheckpoint.discoveryType || 'full';
        } catch (error) {
          console.warn('[Scanning Coordinator] Could not load discovery checkpoint for type:', error.message);
        }
        const initialCheckpoint = {
          totalPages: documentsToScan.length,
          scannedPages: 0,
          pendingPages: documentsToScan.length,
          failedPages: 0,
          totalMedia: 0,
          status: documentsToScan.length > 0 ? 'running' : 'completed',
          scanningStartTime: Date.now(),
          discoveryType,
          lastUpdated: Date.now(),
        };
        await state.processingStateManager.saveScanningCheckpointFile(initialCheckpoint);
      }
      if (documentsToScan.length > 0) {
        const worker = await state.workerManager.getDefaultWorker();
        if (worker) {
          console.log('[Scanning Coordinator] ✅ Worker created, starting processing with', documentsToScan.length, 'documents');
          worker.postMessage({
            type: 'startQueueProcessing',
            data: {
              documentsToScan,
              sessionId: state.sessionManager?.getCurrentSession()?.sessionId,
            },
          });
          return { success: true, documentsScanned: documentsToScan.length };
        }
        console.error('[Scanning Coordinator] ❌ No worker available');
        return { success: false, error: 'No worker available' };
      }
      return { success: true, documentsScanned: 0 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop scanning phase
   * @returns {Promise<void>}
   */
  async function stopScanningPhase() {
    try {
      if (state.workerManager) {
        await state.workerManager.cleanup();
      }
    } catch (error) {
      console.error('[Scanning Coordinator] ❌ Failed to stop scanning phase:', error);
    }
  }

  /**
   * Get scanning progress
   * @returns {Promise<Object>} Scanning progress
   */
  async function getScanningProgress() {
    try {
      if (state.processingStateManager) {
        return await state.processingStateManager.loadScanningCheckpoint();
      }
      return null;
    } catch (error) {
      console.error('[Scanning Coordinator] ❌ Failed to get scanning progress:', error);
      return null;
    }
  }

  /**
   * Update scanning checkpoint for audit purposes when there are no changes
   * @param {Object} processingStateManager - Processing state manager
   * @param {Object} sessionManager - Session manager
   * @param {Object} discoveryCoordinator - Discovery coordinator
   * @param {Object} mediaProcessor - Media processor
   * @param {Object} documentProcessor - Document processor
   * @param {Object} deltaProcessor - Delta processor
   * @param {Object} persistenceManager - Persistence manager
   * @returns {Promise<void>}
   */
  async function updateScanningCheckpoint(
    processingStateManager,
    sessionManager,
    discoveryCoordinator,
    mediaProcessor,
    documentProcessor,
    deltaProcessor,
    persistenceManager,
  ) {
    try {
      if (!processingStateManager) {
        return;
      }
      let discoveryType = 'full';
      try {
        const discoveryCheckpoint = await processingStateManager.loadDiscoveryCheckpoint();
        discoveryType = discoveryCheckpoint.discoveryType || 'full';
      } catch (error) {
        console.warn('[Scanning Coordinator] Could not load discovery checkpoint for type:', error.message);
      }
      const currentTime = Date.now();
      const auditCheckpoint = {
        totalPages: 0,
        scannedPages: 0,
        pendingPages: 0,
        failedPages: 0,
        totalMedia: 0,
        status: 'completed',
        scanningStartTime: currentTime,
        scanningEndTime: currentTime,
        discoveryType,
        lastUpdated: currentTime,
      };
      await processingStateManager.saveScanningCheckpointFile(auditCheckpoint);
    } catch (error) {
      console.error('[Scanning Coordinator] ❌ Failed to update scanning checkpoint for audit:', error);
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
    stopScanningPhase,
    getScanningProgress,
    updateScanningCheckpoint,
    on,
    off,
    emit,
  };
}