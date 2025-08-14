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
    currentScanningSession: {
      sessionId: null,
      documentsToScan: [],
      scannedDocuments: new Set(),
      totalDocuments: 0,
      isActive: false,
    },
    checkpointThrottling: {
      lastSaveTime: 0,
      pendingUpdates: {
        scannedPages: 0,
        totalMedia: 0,
        processedCount: 0,
      },
      saveInterval: 5000, // Save checkpoint every 5 seconds
      saveTimer: null,
    },
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

    // Listen for media processor completion to stop scanning
    if (mediaProcessor && typeof mediaProcessor.on === 'function') {
      mediaProcessor.on('mediaProcessingCompleted', async (data) => {
        console.log('[Worker Handler] 📡 Media processor completed, stopping scanning:', data);
        // Stop the scanning session when media processing is complete
        if (state.currentScanningSession.isActive) {
          const worker = await state.workerManager.getDefaultWorker();
          if (worker) {
            worker.postMessage({
              type: 'queueProcessingStopped',
              data: {
                reason: 'media_processing_completed',
                processedCount: state.currentScanningSession.scannedDocuments.size,
                totalCount: state.currentScanningSession.totalDocuments,
              },
            });
          }
        }
      });
    }
  }

  /**
   * Initialize scanning session
   * @param {Array} documentsToScan - Documents to scan in this session
   * @param {string} sessionId - Session ID
   */
  function initializeScanningSession(documentsToScan, sessionId) {
    state.currentScanningSession = {
      sessionId,
      documentsToScan: [...documentsToScan],
      scannedDocuments: new Set(),
      totalDocuments: documentsToScan.length,
      isActive: true,
    };
    console.log('[Worker Handler] 🔄 Initialized scanning session:', {
      sessionId,
      totalDocuments: documentsToScan.length,
    });
  }

  /**
   * Get next batch of documents to scan
   * @param {number} batchSize - Size of batch to return
   * @returns {Array} Array of documents to scan
   */
  function getNextBatch(batchSize = 10) {
    if (!state.currentScanningSession.isActive) {
      return [];
    }
    const unscannedDocuments = state.currentScanningSession.documentsToScan.filter(
      (doc) => !state.currentScanningSession.scannedDocuments.has(doc.path),
    );
    return unscannedDocuments.slice(0, batchSize);
  }

  /**
   * Mark document as scanned
   * @param {string} documentPath - Document path
   */
  function markDocumentAsScanned(documentPath) {
    if (state.currentScanningSession.isActive) {
      state.currentScanningSession.scannedDocuments.add(documentPath);
    }
  }

  /**
   * Check if scanning session is complete
   * @returns {boolean} True if all documents have been scanned
   */
  function isScanningSessionComplete() {
    if (!state.currentScanningSession.isActive) {
      return true;
    }
    return state.currentScanningSession.scannedDocuments.size
      >= state.currentScanningSession.totalDocuments;
  }

  /**
   * Get scanning session progress
   * @returns {Object} Progress information
   */
  function getScanningSessionProgress() {
    if (!state.currentScanningSession.isActive) {
      return { scanned: 0, total: 0, isComplete: true };
    }
    return {
      scanned: state.currentScanningSession.scannedDocuments.size,
      total: state.currentScanningSession.totalDocuments,
      isComplete: isScanningSessionComplete(),
    };
  }

  /**
   * Reset scanning session
   */
  function resetScanningSession() {
    state.currentScanningSession = {
      sessionId: null,
      documentsToScan: [],
      scannedDocuments: new Set(),
      totalDocuments: 0,
      isActive: false,
    };
  }

  /**
   * Save pending checkpoint updates
   * @returns {Promise<void>}
   */
  async function savePendingCheckpointUpdates() {
    if (!state.processingStateManager) {
      return;
    }

    const { pendingUpdates } = state.checkpointThrottling;
    if (pendingUpdates.processedCount === 0) {
      return;
    }

    try {
      const currentProgress = await state.processingStateManager.loadScanningCheckpoint();
      const newScannedPages = (currentProgress.scannedPages || 0) + pendingUpdates.scannedPages;
      const totalPages = currentProgress.totalPages || 0;
      const isScanningComplete = newScannedPages >= totalPages;
      const updatedProgress = {
        ...currentProgress,
        scannedPages: newScannedPages,
        pendingPages: Math.max(0, totalPages - newScannedPages),
        totalMedia: (currentProgress.totalMedia || 0) + pendingUpdates.totalMedia,
        status: isScanningComplete ? 'completed' : 'running',
        scanningStartTime: currentProgress.scanningStartTime || Date.now(),
        discoveryType: currentProgress.discoveryType || 'full',
        lastUpdated: Date.now(),
      };

      await state.processingStateManager.saveScanningCheckpointFile(updatedProgress);
      state.checkpointThrottling.lastSaveTime = Date.now();

      console.log('[Worker Handler] 💾 Checkpoint saved:', {
        scannedPages: newScannedPages,
        totalPages,
        totalMedia: updatedProgress.totalMedia,
        status: updatedProgress.status,
      });
    } catch (error) {
      console.error('[Worker Handler] ❌ Failed to save checkpoint:', error);
    } finally {
      // Reset pending updates
      state.checkpointThrottling.pendingUpdates = {
        scannedPages: 0,
        totalMedia: 0,
        processedCount: 0,
      };
      state.checkpointThrottling.saveTimer = null;
    }
  }

  /**
   * Force save checkpoint immediately (for completion)
   * @returns {Promise<void>}
   */
  async function forceSaveCheckpoint() {
    if (state.checkpointThrottling.saveTimer) {
      clearTimeout(state.checkpointThrottling.saveTimer);
      state.checkpointThrottling.saveTimer = null;
    }
    await savePendingCheckpointUpdates();
  }

  /**
   * Queue checkpoint update for throttled saving
   * @param {Object} updates - Updates to apply to checkpoint
   */
  function queueCheckpointUpdate(updates) {
    const { pendingUpdates } = state.checkpointThrottling;
    pendingUpdates.scannedPages += updates.scannedPages || 0;
    pendingUpdates.totalMedia += updates.totalMedia || 0;
    pendingUpdates.processedCount += updates.processedCount || 0;

    // Schedule a save if not already scheduled
    if (!state.checkpointThrottling.saveTimer) {
      state.checkpointThrottling.saveTimer = setTimeout(async () => {
        await savePendingCheckpointUpdates();
      }, state.checkpointThrottling.saveInterval);
    }
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
        const sessionIdFromManager = state.sessionManager.getCurrentSession();
        if (sessionIdFromManager) {
          // Get session data from active sessions
          const activeSessions = await state.sessionManager.getActiveSessions();
          const sessionData = activeSessions.find(
            (session) => session.sessionId === sessionIdFromManager,
          );
          if (sessionData) {
            state.mediaProcessor.setCurrentSession(
              sessionIdFromManager,
              sessionData.userId,
              sessionData.browserId,
            );
          } else {
            // Fallback: use the sessionId passed from the worker
            state.mediaProcessor.setCurrentSession(
              sessionId,
              null,
              null,
            );
          }
        } else {
          // Fallback: use the sessionId passed from the worker
          state.mediaProcessor.setCurrentSession(
            sessionId,
            null,
            null,
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
        // Initialize scanning session when queue processing starts
        if (data?.sessionId && !state.currentScanningSession.isActive) {
          console.log('[Worker Handler] 🔄 Queue processing started, will initialize session when first batch is requested');
        }
      },
      onRequestBatch: async () => {
        // If no scanning session is active, initialize one
        if (!state.currentScanningSession.isActive) {
          const discoveryFiles = await state.discoveryCoordinator.loadDiscoveryFiles();
          const documentsToScan = state.documentProcessor.getDocumentsToScan(discoveryFiles, false);
          const sessionId = state.sessionManager?.getCurrentSession();
          initializeScanningSession(documentsToScan, sessionId);
        }

        const batch = getNextBatch(10);
        const progress = getScanningSessionProgress();

        console.log('[Worker Handler] 📦 Requesting batch:', {
          batchSize: batch.length,
          progress: `${progress.scanned}/${progress.total}`,
          isComplete: progress.isComplete,
        });

        if (batch.length > 0) {
          console.log('[Worker Handler] 📤 Sending batch to worker:', batch.length, 'documents');
          worker.postMessage({
            type: 'processBatch',
            data: { batch },
          });
        } else {
          console.log('[Worker Handler] ✅ No more documents to scan, stopping queue processing');
          // Force save final checkpoint before stopping
          await forceSaveCheckpoint();
          worker.postMessage({
            type: 'queueProcessingStopped',
            data: {
              reason: 'completed',
              processedCount: progress.scanned,
              totalCount: progress.total,
            },
          });
          resetScanningSession();
        }
      },
      onPageScanned: async (data) => {
        eventEmitter.emit('pageScanned', data);

        // Mark document as scanned in current session
        if (data?.page) {
          markDocumentAsScanned(data.page);
        }

        // Emit progress event for UI updates
        const progress = getScanningSessionProgress();
        eventEmitter.emit('pageProgress', {
          pagePath: data?.page,
          sourceFile: data?.sourceFile,
          mediaCount: data?.mediaCount || 0,
          scannedPages: progress.scanned,
          totalPages: progress.total,
          isComplete: progress.isComplete,
          timestamp: Date.now(),
        });

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
          if (state.persistenceManager) {
            await state.persistenceManager.savePageScanStatus({
              pagePath: data.page,
              sourceFile: data.sourceFile,
              status: 'completed',
              mediaCount: data?.mediaCount || 0,
              sessionId: state.sessionManager?.getCurrentSession(),
            });
          }
        }
      },
      onBatchComplete: async (data) => {
        eventEmitter.emit('batchComplete', data);
        if (data?.processedCount) {
          // Emit progress event for UI updates
          const progress = getScanningSessionProgress();
          eventEmitter.emit('scanningProgress', {
            scannedPages: progress.scanned,
            totalPages: progress.total,
            isComplete: progress.isComplete,
            processedCount: data.processedCount,
            totalMedia: data?.totalMedia || 0,
            timestamp: Date.now(),
          });

          // Queue checkpoint update for throttled persistence (less frequent)
          queueCheckpointUpdate({
            scannedPages: data.processedCount,
            totalMedia: data?.totalMedia || 0,
            processedCount: data.processedCount,
          });
        }
      },
      onPageScanError: async (data) => {
        eventEmitter.emit('pageScanError', data);

        // Mark document as scanned even if it failed (to avoid infinite retries)
        if (data?.page) {
          markDocumentAsScanned(data.page);
        }

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
        if (data.reason === 'completed' || data.reason === 'media_processing_completed') {
          console.log('[Worker Handler] 🔄 Calling handleScanningCompletion with processedCount:', data.processedCount);
          await handleScanningCompletion(data.processedCount || 0);
        }
        // Force save any pending checkpoint updates
        await forceSaveCheckpoint();
        resetScanningSession();
        eventEmitter.emit('queueProcessingStopped', data);
      },
      onWorkerError: async (data) => {
        eventEmitter.emit('workerError', data);
      },
      onMediaDiscovered: async (data) => {
        await processMediaImmediately(data.media, data.sessionId);
      },
    };

    // Set up message forwarding for the worker
    worker.addEventListener('message', (event) => {
      const { type, data } = event.data;
      const handler = handlers[`on${type.charAt(0).toUpperCase() + type.slice(1)}`];
      if (handler) {
        handler(data);
      }
    });

    // Store handlers for potential reuse
    state.currentHandlers = handlers;
  }

  /**
   * Get event emitter
   * @returns {Object} Event emitter
   */
  function getEventEmitter() {
    return eventEmitter;
  }

  /**
   * Cleanup worker handler
   */
  function cleanup() {
    resetScanningSession();
    if (state.checkpointThrottling.saveTimer) {
      clearTimeout(state.checkpointThrottling.saveTimer);
      state.checkpointThrottling.saveTimer = null;
    }
    if (state.currentHandlers) {
      state.currentHandlers = null;
    }
  }

  return {
    init,
    setupWorkerHandlers,
    processMediaImmediately,
    handleScanningCompletion,
    getEventEmitter,
    cleanup,
    // Expose session management methods for testing/debugging
    initializeScanningSession,
    getScanningSessionProgress,
    resetScanningSession,
  };
}