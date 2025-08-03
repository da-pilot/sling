/**
 * Queue Manager - Orchestrates between multi-threaded discovery and media scanning workers
 * Uses QueueOrchestrator for coordination
 */

import createQueueOrchestrator from './queue/queue-orchestrator.js';

export default function createQueueManager() {
  console.log('[Queue Manager] 🚀 Creating queue manager instance');
  const orchestrator = createQueueOrchestrator();

  /**
   * Initialize queue manager with persistent state and multi-threaded discovery
   */
  async function init(
    docAuthoringService,
    sessionManagerInstance,
    processingStateManagerInstance,
    mediaProcessorInstance,
    persistenceManagerInstance,
  ) {
    const serviceStatus = {
      hasDocAuthoringService: !!docAuthoringService,
      hasSessionManager: !!sessionManagerInstance,
      hasProcessingStateManager: !!processingStateManagerInstance,
      hasMediaProcessor: !!mediaProcessorInstance,
      hasPersistenceManager: !!persistenceManagerInstance,
    };
    console.log('[Queue Manager] 🔧 Starting initialization with services:', serviceStatus);

    const config = docAuthoringService.getConfig();
    const daApi = docAuthoringService;

    // Initialize orchestrator with all required services
    await orchestrator.init(
      config,
      daApi,
      sessionManagerInstance,
      processingStateManagerInstance,
      mediaProcessorInstance,
      null, // scanStateManager - will be initialized by orchestrator
      null, // discoveryCoordinator - will be initialized by orchestrator
      null, // scanCompletionHandler - will be initialized by orchestrator
    );

    console.log('[Queue Manager] ✅ Initialization completed');
  }

  /**
   * Start queue scanning process
   */
  async function startQueueScanning(
    forceRescan = false,
    sessionId = null,
    userId = null,
    browserId = null,
  ) {
    console.log('[Queue Manager] 🚀 Starting queue scanning process:', {
      forceRescan,
      sessionId,
      userId,
      browserId,
      timestamp: new Date().toISOString(),
    });

    // Handle both parameter styles for backward compatibility
    let options = {};
    if (typeof forceRescan === 'object') {
      options = forceRescan;
    } else {
      options = {
        forceRescan,
        sessionId,
        userId,
        browserId,
      };
    }

    console.log('[Queue Manager] 📋 Queue scanning options:', options);
    const result = await orchestrator.startQueueScanning(options.forceRescan, options.sessionId);

    console.log('[Queue Manager] ✅ Queue scanning process completed:', result);
    return result;
  }

  /**
   * Stop queue scanning process
   */
  async function stopQueueScanning(saveState = true, status = 'completed') {
    console.log('[Queue Manager] 🛑 Stopping queue scanning process:', {
      saveState,
      status,
    });
    const result = await orchestrator.stopQueueScanning(saveState, status);
    console.log('[Queue Manager] ✅ Queue scanning stopped:', result);
    return result;
  }

  /**
   * Get current statistics
   */
  function getStats() {
    return orchestrator.getStats();
  }

  /**
   * Get persistent statistics
   */
  async function getPersistentStats() {
    return orchestrator.getPersistentStats();
  }

  /**
   * Check if scanning is active
   */
  async function isScanActive() {
    return orchestrator.isScanActive();
  }

  /**
   * Force complete scan
   */
  async function forceCompleteScan() {
    return orchestrator.forceCompleteScan();
  }

  /**
   * Start scanning phase
   */
  async function startScanningPhase(discoveryFile = null, forceRescan = false) {
    console.log('[Queue Manager] 🔍 Starting scanning phase:', {
      hasDiscoveryFile: !!discoveryFile,
      forceRescan,
      discoveryFileDocuments: discoveryFile ? discoveryFile.documents?.length : 0,
    });
    const result = await orchestrator.startScanningPhase(discoveryFile, forceRescan);
    console.log('[Queue Manager] ✅ Scanning phase completed:', result);
    return result;
  }

  /**
   * Add documents for scanning
   */
  async function addDocumentsForScanning(discoveryFile, documents) {
    console.log('[Queue Manager] 📄 Adding documents for scanning:', {
      hasDiscoveryFile: !!discoveryFile,
      documentCount: documents ? documents.length : 0,
      documents: documents ? documents.map((d) => ({ path: d.path, name: d.name })) : [],
    });
    const result = await orchestrator.addDocumentsForScanning(discoveryFile, documents);
    console.log('[Queue Manager] ✅ Documents added for scanning');
    return result;
  }

  /**
   * Process media immediately
   */
  async function processMediaImmediately(media, sessionId) {
    console.log('[Queue Manager] ⚡ Processing media immediately:', {
      mediaCount: media ? media.length : 0,
      sessionId,
    });
    const result = await orchestrator.processMediaImmediately(media, sessionId);
    console.log('[Queue Manager] ✅ Media processed immediately');
    return result;
  }

  /**
   * Check threshold trigger
   */
  async function checkThresholdTrigger() {
    console.log('[Queue Manager] 🔍 Checking threshold trigger...');
    const result = await orchestrator.checkThresholdTrigger();
    console.log('[Queue Manager] ✅ Threshold trigger check completed:', result);
    return result;
  }

  /**
   * Process remaining media
   */
  async function processRemainingMedia() {
    console.log('[Queue Manager] 🔄 Processing remaining media...');
    const result = await orchestrator.processRemainingMedia();
    console.log('[Queue Manager] ✅ Remaining media processing completed');
    return result;
  }

  /**
   * Setup worker handlers
   */
  function setupWorkerHandlers() {
    return orchestrator.setupWorkerHandlers();
  }

  /**
   * Setup discovery handlers
   */
  function setupDiscoveryHandlers() {
    return orchestrator.setupDiscoveryHandlers();
  }

  /**
   * Initialize worker
   */
  async function initializeWorker(worker, workerType, apiConfig) {
    return orchestrator.initializeWorker(worker, workerType, apiConfig);
  }

  /**
   * Reset statistics
   */
  function resetStats() {
    return orchestrator.resetStats();
  }

  /**
   * Add event listener
   */
  function on(event, callback) {
    return orchestrator.on(event, callback);
  }

  /**
   * Remove event listener
   */
  function off(event, callback) {
    return orchestrator.off(event, callback);
  }

  /**
   * Emit event
   */
  function emit(event, data) {
    return orchestrator.emit(event, data);
  }

  /**
   * Get queue size
   */
  async function getQueueSize() {
    return orchestrator.getQueueSize();
  }

  /**
   * Cleanup resources
   */
  function cleanup() {
    return orchestrator.cleanup();
  }

  /**
   * Load discovery files
   */
  async function loadDiscoveryFiles() {
    console.log('[Queue Manager] 📋 Loading discovery files...');
    const files = await orchestrator.loadDiscoveryFiles();
    console.log('[Queue Manager] ✅ Discovery files loaded:', {
      fileCount: files.length,
      totalDocuments: files.reduce(
        (total, file) => total + (file.documents ? file.documents.length : 0),
        0,
      ),
    });
    return files;
  }

  /**
   * Clear discovery files
   */
  async function clearDiscoveryFiles() {
    return orchestrator.clearDiscoveryFiles();
  }

  /**
   * Get documents to scan
   */
  function getDocumentsToScan(discoveryFiles, forceRescan = false) {
    console.log('[Queue Manager] 🔍 Getting documents to scan:', {
      fileCount: discoveryFiles.length,
      forceRescan,
    });
    const documents = orchestrator.getDocumentsToScan(discoveryFiles, forceRescan);
    console.log('[Queue Manager] ✅ Documents to scan retrieved:', {
      documentCount: documents.length,
    });
    return documents;
  }

  /**
   * Detect changed documents
   */
  async function detectChangedDocuments(discoveryFiles) {
    console.log('[Queue Manager] 🔍 Detecting changed documents...');
    const changes = await orchestrator.detectChangedDocuments(discoveryFiles);
    console.log('[Queue Manager] ✅ Changed documents detected:', {
      changedCount: changes.length,
    });
    return changes;
  }

  /**
   * Load discovery files with change detection
   */
  async function loadDiscoveryFilesWithChangeDetection() {
    console.log('[Queue Manager] 🔍 Loading discovery files with change detection...');
    const files = await orchestrator.loadDiscoveryFilesWithChangeDetection();
    console.log('[Queue Manager] ✅ Discovery files with change detection loaded:', {
      fileCount: files.length,
    });
    return files;
  }

  /**
   * Request batch
   */
  async function requestBatch() {
    return orchestrator.requestBatch();
  }

  /**
   * Resume discovery from checkpoint
   */
  async function resumeDiscoveryFromCheckpoint(discoveryCheckpoint) {
    console.log('[Queue Manager] 🔄 Resuming discovery from checkpoint:', {
      checkpoint: discoveryCheckpoint,
    });
    const result = await orchestrator.resumeDiscoveryFromCheckpoint(discoveryCheckpoint);
    console.log('[Queue Manager] ✅ Discovery resumed from checkpoint');
    return result;
  }

  /**
   * Resume scanning from checkpoint
   */
  async function resumeScanningFromCheckpoint(scanCheckpoint) {
    console.log('[Queue Manager] 🔄 Resuming scanning from checkpoint:', {
      checkpoint: scanCheckpoint,
    });
    const result = await orchestrator.resumeScanningFromCheckpoint(scanCheckpoint);
    console.log('[Queue Manager] ✅ Scanning resumed from checkpoint');
    return result;
  }

  /**
   * Check discovery files exist
   */
  async function checkDiscoveryFilesExist() {
    console.log('[Queue Manager] 🔍 Checking if discovery files exist...');
    const result = await orchestrator.checkDiscoveryFilesExist();
    console.log('[Queue Manager] ✅ Discovery files check completed:', result);
    return result;
  }

  /**
   * Check media available
   */
  async function checkMediaAvailable() {
    console.log('[Queue Manager] 🔍 Checking if media is available...');
    const result = await orchestrator.checkMediaAvailable();
    console.log('[Queue Manager] ✅ Media availability check completed:', result);
    return result;
  }

  /**
   * Trigger upload phase
   */
  async function triggerUploadPhase() {
    console.log('[Queue Manager] 🚀 Triggering upload phase...');
    const result = await orchestrator.triggerUploadPhase();
    console.log('[Queue Manager] ✅ Upload phase triggered');
    return result;
  }

  /**
   * Check for structural changes
   */
  async function checkForStructuralChanges() {
    console.log('[Queue Manager] 🔍 Checking for structural changes...');
    const result = await orchestrator.checkForStructuralChanges();
    console.log('[Queue Manager] ✅ Structural changes check completed');
    return result;
  }

  /**
   * Perform incremental discovery
   */
  async function performIncrementalDiscovery(changes) {
    console.log('[Queue Manager] 🔄 Performing incremental discovery:', {
      changesCount: changes ? changes.length : 0,
    });
    const result = await orchestrator.performIncrementalDiscovery(changes);
    console.log('[Queue Manager] ✅ Incremental discovery completed');
    return result;
  }

  /**
   * Load site structure for comparison
   */
  async function loadSiteStructureForComparison() {
    console.log('[Queue Manager] 📋 Loading site structure for comparison...');
    const result = await orchestrator.loadSiteStructureForComparison();
    console.log('[Queue Manager] ✅ Site structure loaded for comparison');
    return result;
  }

  /**
   * Calculate discovery delta
   */
  async function calculateDiscoveryDelta(baselineStructure, currentStructure) {
    console.log('[Queue Manager] 📊 Calculating discovery delta...');
    const result = await orchestrator.calculateDiscoveryDelta(baselineStructure, currentStructure);
    console.log('[Queue Manager] ✅ Discovery delta calculated');
    return result;
  }

  /**
   * Calculate file changes
   */
  function calculateFileChanges(baselineFiles, currentFiles) {
    console.log('[Queue Manager] 📊 Calculating file changes...');
    const result = orchestrator.calculateFileChanges(baselineFiles, currentFiles);
    console.log('[Queue Manager] ✅ File changes calculated');
    return result;
  }

  /**
   * Generate discovery file for folder
   */
  async function generateDiscoveryFileForFolder(folderPath, folderData) {
    console.log('[Queue Manager] 📄 Generating discovery file for folder:', {
      folderPath,
      documentCount: folderData ? folderData.length : 0,
    });
    const result = await orchestrator.generateDiscoveryFileForFolder(folderPath, folderData);
    console.log('[Queue Manager] ✅ Discovery file generated for folder');
    return result;
  }

  /**
   * Update discovery file for file changes
   */
  async function updateDiscoveryFileForFileChanges(folderPath, fileChanges) {
    console.log('[Queue Manager] 🔄 Updating discovery file for file changes:', {
      folderPath,
      changesCount: fileChanges ? fileChanges.length : 0,
    });
    const result = await orchestrator.updateDiscoveryFileForFileChanges(folderPath, fileChanges);
    console.log('[Queue Manager] ✅ Discovery file updated for file changes');
    return result;
  }

  /**
   * Process discovery delta
   */
  async function processDiscoveryDelta(delta, baselineStructure, currentStructure) {
    console.log('[Queue Manager] 🔄 Processing discovery delta...');
    const result = await orchestrator.processDiscoveryDelta(
      delta,
      baselineStructure,
      currentStructure,
    );
    console.log('[Queue Manager] ✅ Discovery delta processed');
    return result;
  }

  /**
   * Start batch processing phase
   */
  async function startBatchProcessingPhase() {
    console.log('[Queue Manager] 🚀 Starting batch processing phase...');
    const result = await orchestrator.startBatchProcessingPhase();
    console.log('[Queue Manager] ✅ Batch processing phase started');
    return result;
  }

  /**
   * Process and upload batches
   */
  async function processAndUploadBatches() {
    console.log('[Queue Manager] 🔄 Processing and uploading batches...');
    const result = await orchestrator.processAndUploadBatches();
    console.log('[Queue Manager] ✅ Batches processed and uploaded');
    return result;
  }

  /**
   * Upload batch sequentially
   */
  async function uploadBatchSequentially(batch) {
    console.log('[Queue Manager] 📤 Uploading batch sequentially:', {
      batchNumber: batch.batchNumber,
      mediaCount: batch.media ? batch.media.length : 0,
    });
    const result = await orchestrator.uploadBatchSequentially(batch);
    console.log('[Queue Manager] ✅ Batch uploaded sequentially');
    return result;
  }

  /**
   * Configure batch processing
   */
  function configureBatchProcessing(batchConfig) {
    console.log('[Queue Manager] ⚙️ Configuring batch processing:', batchConfig);
    const result = orchestrator.configureBatchProcessing(batchConfig);
    console.log('[Queue Manager] ✅ Batch processing configured');
    return result;
  }

  /**
   * Get batch processing config
   */
  function getBatchProcessingConfig() {
    console.log('[Queue Manager] 📋 Getting batch processing config...');
    const result = orchestrator.getBatchProcessingConfig();
    console.log('[Queue Manager] ✅ Batch processing config retrieved');
    return result;
  }

  return {
    init,
    startQueueScanning,
    stopQueueScanning,
    getStats,
    getPersistentStats,
    isScanActive,
    forceCompleteScan,
    startScanningPhase,
    addDocumentsForScanning,
    processMediaImmediately,
    checkThresholdTrigger,
    processRemainingMedia,
    setupWorkerHandlers,
    setupDiscoveryHandlers,
    initializeWorker,
    resetStats,
    on,
    off,
    emit,
    getQueueSize,
    cleanup,
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
    checkForStructuralChanges,
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
  };
}
