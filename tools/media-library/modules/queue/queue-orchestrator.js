/**
 * Queue Orchestrator - Coordinates all queue modules and provides main queue API
 */
import createEventEmitter from '../../shared/event-emitter.js';
import createQueueWorkerCoordinator from './worker-coordinator.js';
import createQueueDiscoveryCoordinator from './discovery-coordinator.js';
import createDiscoveryCoordinator from '../discovery-coordinator.js';
import createQueueBatchHandler from './batch-handler.js';
import createQueueDocumentHandler from './document-handler.js';
import createQueueCheckpointHandler from './checkpoint-handler.js';
import createQueueDeltaHandler from './delta-handler.js';
import createQueueStatusCoordinator from './status-coordinator.js';
import createScanCompletionHandler from '../scan-completion-handler.js';
import createScanningCoordinator from './scanning-coordinator.js';
import createWorkerHandler from './worker-handler.js';

export default function createQueueOrchestrator() {
  const eventEmitter = createEventEmitter('Queue Orchestrator');
  const state = {
    workerManager: createQueueWorkerCoordinator(),
    discoveryHandler: createQueueDiscoveryCoordinator(),
    batchProcessor: createQueueBatchHandler(),
    documentProcessor: createQueueDocumentHandler(),
    checkpointManager: createQueueCheckpointHandler(),
    deltaProcessor: createQueueDeltaHandler(),
    statusUpdater: createQueueStatusCoordinator(),
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
    await state.discoveryHandler.init(state.discoveryCoordinator, processingStateManager);
    await state.batchProcessor.init(mediaProcessor);
    await state.documentProcessor.init(config, daApi);
    await state.checkpointManager.init(
      state.discoveryCoordinator,
      scanStateManager || null,
      processingStateManager,
    );
    await state.deltaProcessor.init(config, daApi);
    await state.statusUpdater.init(state.scanCompletionHandler, processingStateManager);
    await state.scanningCoordinator.init(
      state.workerManager,
      state.sessionManager,
      state.documentProcessor,
      state.discoveryHandler,
      state.processingStateManager,
    );
    await state.workerHandler.init(
      state.workerManager,
      state.discoveryHandler,
      state.discoveryCoordinator,
      state.documentProcessor,
      state.mediaProcessor,
      state.sessionManager,
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
   * Start queue scanning process
   * @param {boolean} forceRescan - Whether to force rescan
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Scanning result
   */
  async function startQueueScanning(forceRescan = false, sessionId = null) {
    console.log('[Queue Orchestrator] 🚀 Starting queue scanning process:', {
      forceRescan,
      sessionId,
      timestamp: new Date().toISOString(),
    });

    if (sessionId && state.batchProcessor) {
      state.batchProcessor.setCurrentSession(sessionId);
    }

    try {
      const discoveryStatus = await state.discoveryHandler.checkDiscoveryFilesExist();
      console.log('[Queue Orchestrator] 📋 Discovery status check:', discoveryStatus);

      if (discoveryStatus.shouldRunDiscovery) {
        console.log('===== Starting Discovery Process ======');
        await state.discoveryHandler.startDiscoveryWithSession(sessionId, forceRescan);
        console.log('===== Discovery Process Completed ======');
      } else {
        console.log('===== Discovery files exist, skipping discovery ======');
      }

      const scanningStatus = await state.discoveryHandler.checkDiscoveryFilesExist();
      if (scanningStatus.filesExist) {
        console.log('===== Starting Scanning Phase ======');
        await startScanningPhase(null, forceRescan);
        console.log('===== Scanning Phase Completed ======');

        console.log('===== Processing and uploading queued media ======');
        try {
          await state.mediaProcessor.processAndUploadQueuedMedia();
          console.log('===== Queued media processed and uploaded successfully ======');
        } catch (uploadError) {
          console.error('[Queue Orchestrator] ❌ Error processing queued media:', uploadError);
        }
      } else {
        console.log('===== No discovery files found, skipping scanning ======');
      }

      console.log('===== Queue scanning process completed successfully ======');
      return { success: true };
    } catch (error) {
      console.error('[Queue Orchestrator] ❌ Queue scanning process failed:', error);
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
      await state.discoveryHandler.stopDiscovery();
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
      const discoveryResult = await state.checkpointManager.resumeDiscoveryFromCheckpoint(
        discoveryCheckpoint,
      );
      const scanResult = await state.checkpointManager.resumeScanningFromCheckpoint(scanCheckpoint);
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
        await state.statusUpdater.updateScanProgress(data);
        break;
      case 'discovery':
        await state.statusUpdater.updateDiscoveryProgress(data);
        break;
      case 'processing':
        await state.statusUpdater.updateProcessingStatus(data.status, data);
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
      await state.discoveryHandler.stopDiscovery();
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
   * Get queue size
   * @returns {Promise<number>}
   */
  async function getQueueSize() {
    return state.batchProcessor.getQueueSize();
  }

  /**
   * Cleanup resources
   * @returns {Promise<void>}
   */
  async function cleanup() {
    try {
      await state.workerManager.cleanup();
      await state.discoveryHandler.stopDiscovery();
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
   * Process media immediately
   * @param {Array} media - Media to process
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>}
   */
  async function processMediaImmediately(media, sessionId) {
    return state.mediaProcessor.processMediaImmediately(media, sessionId);
  }

  /**
   * Check threshold trigger
   * @returns {Promise<boolean>}
   */
  async function checkThresholdTrigger() {
    return state.batchProcessor.checkThresholdTrigger();
  }

  /**
   * Process remaining media
   * @returns {Promise<Object>}
   */
  async function processRemainingMedia() {
    return state.batchProcessor.processRemainingMedia();
  }

  /**
   * Setup worker handlers
   * @returns {Promise<void>}
   */
  async function setupWorkerHandlers() {
    return state.workerHandler.setupWorkerHandlers();
  }

  /**
   * Setup discovery handlers
   * @returns {Promise<void>}
   */
  async function setupDiscoveryHandlers() {
    return state.discoveryHandler.setupDiscoveryHandlers();
  }

  /**
   * Initialize worker
   * @param {Object} worker - Worker instance
   * @param {string} workerType - Worker type
   * @param {Object} apiConfig - API configuration
   * @returns {Promise<void>}
   */
  async function initializeWorker(worker, workerType, apiConfig) {
    return state.workerManager.initializeWorker(worker, workerType, apiConfig);
  }

  /**
   * Reset statistics
   * @returns {Promise<void>}
   */
  async function resetStats() {
    return state.processingStateManager?.resetStats();
  }

  /**
   * Load discovery files
   * @returns {Promise<Array>}
   */
  async function loadDiscoveryFiles() {
    const files = await state.discoveryCoordinator.loadDiscoveryFiles();
    // Populate cache with loaded discovery files
    if (files && files.length > 0) {
      state.discoveryCoordinator.setDiscoveryFilesCache(files);
      console.log('[Queue Orchestrator] 📋 Populated discovery files cache:', {
        fileCount: files.length,
        fileNames: files.map((f) => f.fileName),
      });
    }
    return files;
  }

  /**
   * Clear discovery files
   * @returns {Promise<void>}
   */
  async function clearDiscoveryFiles() {
    return state.discoveryCoordinator.clearDiscoveryFiles();
  }

  /**
   * Get documents to scan
   * @param {Array} discoveryFiles - Discovery files
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Array}
   */
  function getDocumentsToScan(discoveryFiles, forceRescan = false) {
    return state.discoveryCoordinator.getDocumentsToScan(discoveryFiles, forceRescan);
  }

  /**
   * Detect changed documents
   * @param {Array} discoveryFiles - Discovery files
   * @returns {Promise<Array>}
   */
  async function detectChangedDocuments(discoveryFiles) {
    return state.discoveryCoordinator.detectChangedDocuments(discoveryFiles);
  }

  /**
   * Load discovery files with change detection and populate cache
   * @returns {Promise<Array>}
   */
  async function loadDiscoveryFilesWithChangeDetection() {
    const files = await state.discoveryCoordinator.loadDiscoveryFilesWithChangeDetection();
    // Populate cache with loaded discovery files
    if (files && files.length > 0) {
      state.discoveryCoordinator.setDiscoveryFilesCache(files);
      console.log('[Queue Orchestrator] 📋 Populated discovery files cache with change detection:', {
        fileCount: files.length,
        fileNames: files.map((f) => f.fileName),
      });
    }
    return files;
  }

  /**
   * Request batch
   * @returns {Promise<Object>}
   */
  async function requestBatch() {
    return state.batchProcessor.requestBatch();
  }

  /**
   * Resume discovery from checkpoint
   * @param {Object} discoveryCheckpoint - Discovery checkpoint
   * @returns {Promise<Object>}
   */
  async function resumeDiscoveryFromCheckpoint(discoveryCheckpoint) {
    return state.checkpointManager.resumeDiscoveryFromCheckpoint(discoveryCheckpoint);
  }

  /**
   * Resume scanning from checkpoint
   * @param {Object} scanCheckpoint - Scan checkpoint
   * @returns {Promise<Object>}
   */
  async function resumeScanningFromCheckpoint(scanCheckpoint) {
    return state.checkpointManager.resumeScanningFromCheckpoint(scanCheckpoint);
  }

  /**
   * Check discovery files exist
   * @returns {Promise<Object>}
   */
  async function checkDiscoveryFilesExist() {
    return state.discoveryCoordinator.checkDiscoveryFilesExist();
  }

  /**
   * Check media available
   * @returns {Promise<boolean>}
   */
  async function checkMediaAvailable() {
    return state.mediaProcessor?.checkMediaAvailable() || false;
  }

  /**
   * Trigger upload phase
   * @returns {Promise<void>}
   */
  async function triggerUploadPhase() {
    return state.batchProcessor.triggerUploadPhase();
  }

  /**
   * Perform incremental discovery
   * @param {Object} changes - Changes to process
   * @returns {Promise<Object>}
   */
  async function performIncrementalDiscovery(changes) {
    return state.discoveryCoordinator.performIncrementalDiscovery(changes);
  }

  /**
   * Load site structure for comparison
   * @returns {Promise<Object>}
   */
  async function loadSiteStructureForComparison() {
    return state.discoveryCoordinator.loadSiteStructureForComparison();
  }

  /**
   * Calculate discovery delta
   * @param {Object} baselineStructure - Baseline structure
   * @param {Object} currentStructure - Current structure
   * @returns {Promise<Object>}
   */
  async function calculateDiscoveryDelta(baselineStructure, currentStructure) {
    return state.deltaProcessor.calculateDiscoveryDelta(baselineStructure, currentStructure);
  }

  /**
   * Calculate file changes
   * @param {Array} baselineFiles - Baseline files
   * @param {Array} currentFiles - Current files
   * @returns {Array}
   */
  function calculateFileChanges(baselineFiles, currentFiles) {
    return state.deltaProcessor.calculateFileChanges(baselineFiles, currentFiles);
  }

  /**
   * Generate discovery file for folder
   * @param {string} folderPath - Folder path
   * @param {Object} folderData - Folder data
   * @returns {Promise<Object>}
   */
  async function generateDiscoveryFileForFolder(folderPath, folderData) {
    return state.discoveryCoordinator.generateDiscoveryFileForFolder(folderPath, folderData);
  }

  /**
   * Update discovery file for file changes
   * @param {string} folderPath - Folder path
   * @param {Object} fileChanges - File changes
   * @returns {Promise<Object>}
   */
  async function updateDiscoveryFileForFileChanges(folderPath, fileChanges) {
    return state.discoveryCoordinator.updateDiscoveryFileForFileChanges(folderPath, fileChanges);
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
    getQueueSize,
    cleanup,
    startScanningPhase,
    addDocumentsForScanning,
    processMediaImmediately,
    checkThresholdTrigger,
    processRemainingMedia,
    setupWorkerHandlers,
    setupDiscoveryHandlers,
    initializeWorker,
    resetStats,
    loadDiscoveryFiles,
    clearDiscoveryFiles,
    getDocumentsToScan,
    detectChangedDocuments,
    loadDiscoveryFilesWithChangeDetection,
    requestBatch,
    resumeDiscoveryFromCheckpoint,
    resumeScanningFromCheckpoint,
    checkDiscoveryFilesExist,
    checkMediaAvailable,
    triggerUploadPhase,
    performIncrementalDiscovery,
    loadSiteStructureForComparison,
    calculateDiscoveryDelta,
    calculateFileChanges,
    generateDiscoveryFileForFolder,
    updateDiscoveryFileForFileChanges,
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