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
    scanResultsManager: null,
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
      saveInterval: 5000,
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
   * @param {Object} persistenceManager - Persistence manager instance
   * @param {Object} scanCompletionHandler - Scan completion handler instance
   * @param {Object} scanResultsManager - Scan results manager instance
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
    scanResultsManager,
  ) {
    state.workerManager = workerManager;
    state.discoveryCoordinator = discoveryCoordinator;
    state.documentProcessor = documentProcessor;
    state.mediaProcessor = mediaProcessor;
    state.sessionManager = sessionManager;
    state.processingStateManager = processingStateManager;
    state.persistenceManager = persistenceManager;
    state.scanCompletionHandler = scanCompletionHandler;
    state.scanResultsManager = scanResultsManager;
    if (mediaProcessor && typeof mediaProcessor.on === 'function') {
      mediaProcessor.on('mediaProcessingCompleted', async (_data) => {
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
    return (
      state.currentScanningSession.scannedDocuments.size
       >= state.currentScanningSession.totalDocuments
    );
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
    } catch (error) {
      eventEmitter.emit('error', { error: error.message });
    } finally {
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
        return;
      }
      if (sessionId && state.sessionManager) {
        const sessionIdFromManager = state.sessionManager.getCurrentSession();
        if (sessionIdFromManager) {
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
            state.mediaProcessor.setCurrentSession(sessionId, null, null);
          }
        } else {
          state.mediaProcessor.setCurrentSession(sessionId, null, null);
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
   * @returns {Promise<boolean>} Success status
   */
  async function handleScanningCompletion(_processedCount = 0) {
    return true;
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
        if (data?.documentsToScan && data?.sessionId && !state.currentScanningSession.isActive) {
          initializeScanningSession(data.documentsToScan, data.sessionId);
        }
      },
      onRequestBatch: async () => {
        if (!state.currentScanningSession.isActive) {
          return;
        }
        const batch = getNextBatch(10);
        const progress = getScanningSessionProgress();
        if (batch.length > 0) {
          worker.postMessage({
            type: 'processBatch',
            data: { batch },
          });
        } else {
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
        if (data?.page) {
          markDocumentAsScanned(data.page);
        }
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
        if (data?.page && data?.sourceFile && state.scanResultsManager) {
          await state.scanResultsManager.saveScanResult({
            pagePath: data.page,
            sourceFile: data.sourceFile,
            status: 'completed',
            mediaCount: data?.mediaCount || 0,
            scanAttempts: 1,
            entryStatus: 'completed',
            needsRescan: false,
            lastScannedAt: new Date().toISOString(),
            scanErrors: [],
            sessionId: state.sessionManager?.getCurrentSession(),
          });
        }
      },
      onBatchComplete: async (data) => {
        eventEmitter.emit('batchComplete', data);
        if (data?.processedCount) {
          const progress = getScanningSessionProgress();
          eventEmitter.emit('scanningProgress', {
            scannedPages: progress.scanned,
            totalPages: progress.total,
            isComplete: progress.isComplete,
            processedCount: data.processedCount,
            totalMedia: data?.totalMedia || 0,
            timestamp: Date.now(),
          });
          queueCheckpointUpdate({
            scannedPages: data.processedCount,
            totalMedia: data?.totalMedia || 0,
            processedCount: data.processedCount,
          });
        }
      },
      onPageScanError: async (data) => {
        eventEmitter.emit('pageScanError', data);
        if (data?.page) {
          markDocumentAsScanned(data.page);
        }
        if (data?.page && data?.sourceFile && state.scanResultsManager) {
          await state.scanResultsManager.saveScanResult({
            pagePath: data.page,
            sourceFile: data.sourceFile,
            status: 'failed',
            mediaCount: 0,
            scanAttempts: 1,
            entryStatus: 'failed',
            needsRescan: true,
            lastScannedAt: new Date().toISOString(),
            scanErrors: [data?.error || 'Unknown error'],
            sessionId: state.sessionManager?.getCurrentSession(),
          });
        }
      },
      onQueueProcessingStopped: async (data) => {
        if (data.reason === 'completed' || data.reason === 'media_processing_completed') {
          await handleScanningCompletion(data.processedCount || 0);
        }
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
    worker.addEventListener('message', (event) => {
      const { type, data } = event.data;
      const handler = handlers[`on${type.charAt(0).toUpperCase() + type.slice(1)}`];
      if (handler) {
        handler(data);
      }
    });
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
    initializeScanningSession,
    getScanningSessionProgress,
    resetScanningSession,
  };
}