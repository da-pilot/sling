/**
 * Queue Orchestrator - Coordinates all queue modules and provides main queue API
 */
import createEventEmitter from '../../shared/event-emitter.js';
import createQueueWorkerCoordinator from './worker-coordinator.js';
import createDiscoveryCoordinator from '../discovery-coordinator.js';
import createQueueBatchHandler from './batch-handler.js';
import createQueueDocumentHandler from './document-handler.js';
import createQueueDeltaHandler from './delta-handler.js';
import createScanCompletionHandler from '../scan-completion-handler.js';
import createScanningCoordinator from './scanning-coordinator.js';
import createWorkerHandler from './worker-handler.js';
import { DISCOVERY_TYPE, PROCESSING_STATUS } from '../../constants.js';

export default function createQueueOrchestrator() {
  const eventEmitter = createEventEmitter('Queue Orchestrator');
  const state = {
    workerManager: createQueueWorkerCoordinator(),
    batchProcessor: createQueueBatchHandler(),
    documentProcessor: createQueueDocumentHandler(),
    deltaProcessor: createQueueDeltaHandler(),
    scanningCoordinator: createScanningCoordinator(),
    workerHandler: createWorkerHandler(),
    config: null,
    daApi: null,
    sessionManager: null,
    processingStateManager: null,
    mediaProcessor: null,
    scanStateManager: null,
    discoveryCoordinator: null,
    scanCompletionHandler: null,
  };

  /**
   * Initialize queue orchestrator
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} processingStateManager - Processing state manager instance
   * @param {Object} mediaProcessor - Media processor instance
   * @param {Object} scanStateManager - Scan state manager instance
   * @param {Object} discoveryCoordinator - Discovery coordinator instance
   * @param {Object} scanCompletionHandler - Scan completion handler instance
   */
  async function init(
    config,
    daApi,
    sessionManager,
    processingStateManager,
    mediaProcessor,
    scanStateManager,
    discoveryCoordinator,
    scanCompletionHandler,
  ) {
    state.config = config;
    state.daApi = daApi;
    state.sessionManager = sessionManager;
    state.processingStateManager = processingStateManager;
    state.mediaProcessor = mediaProcessor;
    state.scanStateManager = scanStateManager;
    if (!discoveryCoordinator) {
      state.discoveryCoordinator = createDiscoveryCoordinator();
      await state.discoveryCoordinator.init(config, daApi, sessionManager, processingStateManager);
    } else {
      state.discoveryCoordinator = discoveryCoordinator;
    }
    if (!scanCompletionHandler) {
      state.scanCompletionHandler = createScanCompletionHandler();
      await state.scanCompletionHandler.init(config, daApi, processingStateManager);
    } else {
      state.scanCompletionHandler = scanCompletionHandler;
    }
    await state.workerManager.init(config);
    await state.batchProcessor.init(mediaProcessor);
    await state.documentProcessor.init(config, daApi);
    await state.deltaProcessor.init(config, daApi);
    await state.scanningCoordinator.init(
      state.workerManager,
      state.sessionManager,
      state.documentProcessor,
      state.discoveryCoordinator,
      state.processingStateManager,
    );
    await state.workerHandler.init(
      state.workerManager,
      state.discoveryCoordinator,
      state.documentProcessor,
      state.mediaProcessor,
      state.sessionManager,
      state.processingStateManager,
    );
    await state.workerHandler.setupWorkerHandlers();
  }

  /**
   * Start scanning phase
   * @param {Object} discoveryFile - Discovery file
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Promise<Object>} Scanning result
   */
  async function startScanningPhase(discoveryFile = null, forceRescan = false) {
    console.log('[Queue Orchestrator] 🔍 Starting scanning phase:', {
      hasDiscoveryFile: !!discoveryFile,
      forceRescan,
    });

    try {
      const result = await state.scanningCoordinator.startScanningPhase(discoveryFile, forceRescan);
      console.log('[Queue Orchestrator] ✅ Scanning phase completed:', {
        success: result.success,
        documentsScanned: result.documentsScanned || 0,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      console.error('[Queue Orchestrator] ❌ Scanning phase failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Determine discovery type based on checkpoint status
   * @returns {Promise<string>} Discovery type ('full' or 'incremental')
   */
  async function determineDiscoveryType() {
    try {
      const checkpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
      return checkpoint.status === PROCESSING_STATUS.COMPLETED
        ? DISCOVERY_TYPE.INCREMENTAL
        : DISCOVERY_TYPE.FULL;
    } catch (error) {
      return DISCOVERY_TYPE.FULL;
    }
  }

  /**
   * Start queue scanning process
   * @param {boolean} forceRescan - Whether to force rescan
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Scanning result
   */
  async function startQueueScanning(forceRescan = false, sessionId = null) {
    if (sessionId && state.batchProcessor) {
      state.batchProcessor.setCurrentSession(sessionId);
    }
    try {
      const discoveryType = forceRescan ? DISCOVERY_TYPE.FULL : await determineDiscoveryType();
      console.log('[Queue Orchestrator] 🔍 Discovery type determined:', discoveryType);
      if (forceRescan) {
        await state.discoveryCoordinator.startDiscoveryWithSession(sessionId, discoveryType);
        await startScanningPhase(null, forceRescan);
        try {
          await state.mediaProcessor.processAndUploadQueuedMedia();
        } catch (uploadError) {
          return { success: false, error: uploadError.message };
        }
        return { success: true };
      }
      const discoveryStatus = await state.discoveryCoordinator.checkDiscoveryFilesExist();
      console.log('[Queue Orchestrator] 📁 Discovery files check:', {
        shouldRunDiscovery: discoveryStatus.shouldRunDiscovery,
        filesExist: discoveryStatus.filesExist,
        fileCount: discoveryStatus.fileCount,
        discoveryType,
      });
      if (discoveryType === DISCOVERY_TYPE.INCREMENTAL && discoveryStatus.filesExist) {
        console.log('[Queue Orchestrator] 🔍 [INCREMENTAL] Running discovery to detect changes');
        await state.discoveryCoordinator.startDiscoveryWithSession(sessionId, discoveryType);
      } else if (discoveryStatus.shouldRunDiscovery) {
        await state.discoveryCoordinator.startDiscoveryWithSession(sessionId, discoveryType);
      } else {
        console.log('[Queue Orchestrator] ⏭️ Skipping discovery process - files already exist');
      }
      const scanningStatus = await state.discoveryCoordinator.checkDiscoveryFilesExist();
      if (scanningStatus.filesExist) {
        await startScanningPhase(null, forceRescan);
        try {
          await state.mediaProcessor.processAndUploadQueuedMedia();
        } catch (uploadError) {
          return { success: false, error: uploadError.message };
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop queue scanning process
   * @param {boolean} saveState - Whether to save state
   * @param {string} status - Status to save
   * @returns {Promise<Object>} Stop result
   */
  async function stopQueueScanning(saveState = true, status = 'completed') {
    console.log('[Queue Orchestrator] 🛑 Stopping queue scanning process:', {
      saveState,
      status,
    });

    try {
      await state.discoveryCoordinator.stopDiscovery();
      console.log('[Queue Orchestrator] ✅ Queue scanning stopped successfully');
      return { success: true };
    } catch (error) {
      console.error('[Queue Orchestrator] ❌ Error stopping queue scanning:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process batch
   * @param {Array} batch - Batch to process
   * @returns {Promise<Object>}
   */
  async function processBatch(batch) {
    if (!batch || batch.length === 0) {
      return { success: true, processedCount: 0 };
    }
    try {
      const result = await state.batchProcessor.processAndUploadBatches([batch]);
      return { success: true, processedCount: batch.length, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Resume from checkpoint
   * @param {Object} discoveryCheckpoint - Discovery checkpoint
   * @param {Object} scanCheckpoint - Scan checkpoint
   * @returns {Promise<Object>}
   */
  async function resumeFromCheckpoint(discoveryCheckpoint, scanCheckpoint) {
    try {
      const discoveryResult = await state.discoveryCoordinator
        .resumeDiscoveryFromCheckpoint(discoveryCheckpoint);
      const scanResult = await state.processingStateManager
        .resumeScanningFromCheckpoint(scanCheckpoint);
      return { discoveryResult, scanResult };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Check for structural changes
   * @param {Object} baselineStructure - Baseline structure
   * @param {Object} currentStructure - Current structure
   * @returns {Promise<Object>}
   */
  async function checkForStructuralChanges(baselineStructure, currentStructure) {
    return state.deltaProcessor.checkForStructuralChanges(baselineStructure, currentStructure);
  }

  /**
   * Update status
   * @param {string} type - Status type
   * @param {Object} data - Status data
   * @returns {Promise<void>}
   */
  async function updateStatus(type, data) {
    switch (type) {
      case 'scan':
        if (state.processingStateManager) {
          await state.processingStateManager.updateScanProgress(data);
        }
        break;
      case 'discovery':
        if (state.processingStateManager) {
          await state.processingStateManager.updateDiscoveryProgress(data);
        }
        break;
      case 'processing':
        if (state.processingStateManager) {
          await state.processingStateManager.updateStatus(data.status, data);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Check if scanning is active
   * @returns {boolean}
   */
  function isScanActive() {
    return state.workerManager.hasActiveWorkers();
  }

  /**
   * Force complete scan
   * @returns {Promise<void>}
   */
  async function forceCompleteScan() {
    try {
      await state.discoveryCoordinator.stopDiscovery();
      await state.workerManager.cleanup();
    } catch (error) {
      eventEmitter.emit('error', { error: error.message });
    }
  }

  /**
   * Trigger completion phase
   * @returns {Promise<void>}
   */
  async function triggerCompletionPhase() {
    try {
      // Sync cache with IndexedDB scan results FIRST
      const updatedDiscoveryFiles = await state.scanCompletionHandler
        .syncDiscoveryFilesCacheWithIndexedDB(state.discoveryCoordinator);

      // Update DA files with the updated cache data
      await state.scanCompletionHandler.updateAllDiscoveryFiles(updatedDiscoveryFiles);

      // Create site structure with the updated cache data
      await state.scanCompletionHandler.updateSiteStructureWithMediaCounts(updatedDiscoveryFiles);

      // Cleanup old session files after scanning is complete
      if (state.sessionManager && typeof state.sessionManager.cleanupOldSessionFiles === 'function') {
        await state.sessionManager.cleanupOldSessionFiles();
      }

      eventEmitter.emit('scanningStopped', {
        status: 'completed',
        timestamp: Date.now(),
      });
    } catch (error) {
      eventEmitter.emit('error', { error: error.message });
    }
  }

  /**
   * Get current statistics
   * @returns {Object}
   */
  function getStats() {
    return {
      isActive: isScanActive(),
      workers: state.workerManager.getAllWorkers().size,
      hasActiveWorkers: state.workerManager.hasActiveWorkers(),
    };
  }

  /**
   * Get persistent statistics
   * @returns {Promise<Object>}
   */
  async function getPersistentStats() {
    return state.processingStateManager?.getPersistentStats() || getStats();
  }

  /**
   * Cleanup resources
   * @returns {Promise<void>}
   */
  async function cleanup() {
    try {
      await state.workerManager.cleanup();
      await state.discoveryCoordinator.stopDiscovery();
    } catch (error) {
      eventEmitter.emit('error', { error: error.message });
    }
  }

  /**
   * Add documents for scanning
   * @param {Object} discoveryFile - Discovery file
   * @param {Array} documents - Documents to add
   * @returns {Promise<void>}
   */
  async function addDocumentsForScanning(discoveryFile, documents) {
    console.log('[Queue Orchestrator] 📄 Adding documents for scanning:', {
      hasDiscoveryFile: !!discoveryFile,
      documentCount: documents ? documents.length : 0,
    });

    try {
      await state.documentProcessor.addDocumentsForScanning(discoveryFile, documents);
      console.log('[Queue Orchestrator] ✅ Documents added for scanning');
    } catch (error) {
      console.error('[Queue Orchestrator] ❌ Error adding documents for scanning:', error);
    }
  }

  /**
   * Process discovery delta
   * @param {Object} delta - Delta to process
   * @param {Object} baselineStructure - Baseline structure
   * @param {Object} currentStructure - Current structure
   * @returns {Promise<Object>}
   */
  async function processDiscoveryDelta(delta, baselineStructure, currentStructure) {
    return state.deltaProcessor.processDiscoveryDelta(delta, baselineStructure, currentStructure);
  }

  /**
   * Start batch processing phase
   * @returns {Promise<void>}
   */
  async function startBatchProcessingPhase() {
    return state.batchProcessor.startBatchProcessingPhase();
  }

  /**
   * Process and upload batches
   * @returns {Promise<Object>}
   */
  async function processAndUploadBatches() {
    return state.batchProcessor.processAndUploadBatches();
  }

  /**
   * Upload batch sequentially
   * @param {Array} batch - Batch to upload
   * @returns {Promise<Object>}
   */
  async function uploadBatchSequentially(batch) {
    return state.batchProcessor.uploadBatchSequentially(batch);
  }

  /**
   * Configure batch processing
   * @param {Object} batchConfig - Batch configuration
   * @returns {Promise<void>}
   */
  async function configureBatchProcessing(batchConfig) {
    return state.batchProcessor.configureBatchProcessing(batchConfig);
  }

  /**
   * Get batch processing config
   * @returns {Object}
   */
  function getBatchProcessingConfig() {
    return state.batchProcessor.getBatchProcessingConfig();
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
    startQueueScanning,
    stopQueueScanning,
    processBatch,
    resumeFromCheckpoint,
    checkForStructuralChanges,
    updateStatus,
    isScanActive,
    forceCompleteScan,
    triggerCompletionPhase,
    getStats,
    getPersistentStats,
    cleanup,
    startScanningPhase,
    addDocumentsForScanning,
    processDiscoveryDelta,
    startBatchProcessingPhase,
    processAndUploadBatches,
    uploadBatchSequentially,
    configureBatchProcessing,
    getBatchProcessingConfig,
    on,
    off,
    emit,
  };
}