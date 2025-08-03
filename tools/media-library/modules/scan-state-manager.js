

export default function createScanStateManager() {
  const state = {
    isActive: false,
    isStopping: false,
    completionProcessed: false,
    discoveryComplete: false,
    currentSessionId: null,
    currentUserId: null,
    currentBrowserId: null,
    stats: {
      totalPages: 0,
      queuedPages: 0,
      scannedPages: 0,
      totalMedia: 0,
      errors: 0,
      startTime: null,
    },
    processingStateManager: null,
    sessionManager: null,
  };

  async function init(processingStateManagerInstance, sessionManagerInstance) {
    state.processingStateManager = processingStateManagerInstance;
    state.sessionManager = sessionManagerInstance;
  }

  function resetStats() {
    state.stats = {
      totalPages: 0,
      queuedPages: 0,
      scannedPages: 0,
      totalMedia: 0,
      errors: 0,
      startTime: null,
    };
    state.completionProcessed = false;
  }

  function getStats() {
    return { ...state.stats };
  }

  async function getPersistentStats() {
    if (!state.processingStateManager || !state.currentSessionId) {
      return getStats();
    }
    try {
      const discoveryProgress = await state.processingStateManager.getDiscoveryProgress(state.currentSessionId);
      const scanningProgress = await state.processingStateManager.getScanningProgress(state.currentSessionId);
      return {
        ...state.stats,
        totalFolders: discoveryProgress?.totalFolders || 0,
        completedFolders: discoveryProgress?.completedFolders || 0,
        totalDocuments: discoveryProgress?.totalDocuments || 0,
        isActive: scanningProgress?.status === 'running',
        currentSession: true,
        lastScanTime: scanningProgress?.lastUpdated || discoveryProgress?.lastUpdated,
      };
    } catch (error) {
      return getStats();
    }
  }

  async function isScanActive() {
    if (!state.sessionManager) {
      return state.isActive;
    }
    try {
      const activeSessions = await state.sessionManager.getActiveSessions();
      return activeSessions.some((session) => session.currentStage === 'discovery' || session.currentStage === 'scanning');
    } catch (error) {
      return state.isActive;
    }
  }

  async function startScanning(sessionId, userId, browserId) {
    if (state.isActive) {
      console.warn('[Scan State Manager] Scanning already active');
      return false;
    }
    state.currentSessionId = sessionId;
    state.currentUserId = userId;
    state.currentBrowserId = browserId;
    state.isActive = true;
    state.isStopping = false;
    state.discoveryComplete = false;
    state.stats.startTime = Date.now();
    if (state.sessionManager && sessionId) {
      await state.sessionManager.updateSessionHeartbeat(sessionId, {
        currentStage: 'discovery',
        currentProgress: {
          totalPages: 0,
          scannedPages: 0,
          totalMedia: 0,
        },
      });
    }
    return true;
  }

  async function stopScanning(saveState = true, status = 'completed') {
    if (!state.isActive || state.isStopping) {
      console.log('[Scan State Manager] Scanning already stopped or stopping, skipping');
      return;
    }
    console.log('[Scan State Manager] Stopping scanning:', { saveState, status });
    state.isStopping = true;
    state.isActive = false;
    if (state.processingStateManager && state.currentSessionId && saveState) {
      await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
        totalPages: state.stats.totalPages,
        scannedPages: state.stats.scannedPages,
        totalMedia: state.stats.totalMedia,
        status,
        endTime: Date.now(),
      });
    }
    if (state.sessionManager && state.currentSessionId) {
      await state.sessionManager.releaseSessionLock(state.currentSessionId, status);
    }
    state.isStopping = false;
  }

  async function updateScanningProgress(progress) {
    if (state.processingStateManager && state.currentSessionId) {
      await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
        ...progress,
        lastUpdated: Date.now(),
      });
    }
  }

  async function updateDiscoveryProgress(progress) {
    if (state.processingStateManager && state.currentSessionId) {
      await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
        ...progress,
        lastUpdated: Date.now(),
      });
    }
  }

  function incrementScannedPages(count = 1) {
    state.stats.scannedPages += count;
  }

  function incrementTotalMedia(count = 1) {
    state.stats.totalMedia += count;
  }

  function incrementErrors(count = 1) {
    state.stats.errors += count;
  }

  function setTotalPages(count) {
    state.stats.totalPages = count;
  }

  function setQueuedPages(count) {
    state.stats.queuedPages = count;
  }

  function setDiscoveryComplete(complete) {
    state.discoveryComplete = complete;
  }

  function setCompletionProcessed(processed) {
    state.completionProcessed = processed;
  }

  function getCurrentSession() {
    return {
      sessionId: state.currentSessionId,
      userId: state.currentUserId,
      browserId: state.currentBrowserId,
    };
  }

  function isCompletionProcessed() {
    return state.completionProcessed;
  }

  function isDiscoveryComplete() {
    return state.discoveryComplete;
  }

  function isStopping() {
    return state.isStopping;
  }

  function isActive() {
    return state.isActive;
  }

  return {
    init,
    resetStats,
    getStats,
    getPersistentStats,
    isScanActive,
    startScanning,
    stopScanning,
    updateScanningProgress,
    updateDiscoveryProgress,
    incrementScannedPages,
    incrementTotalMedia,
    incrementErrors,
    setTotalPages,
    setQueuedPages,
    setDiscoveryComplete,
    setCompletionProcessed,
    getCurrentSession,
    isCompletionProcessed,
    isDiscoveryComplete,
    isStopping,
    isActive,
  };
} 