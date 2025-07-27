/* eslint-disable no-use-before-define, no-console */

/**
 * UI Manager - Provides real-time status updates and session management
 * Integrates with core services for better user experience
 */

import { showToast, showError } from './toast.js';
import { PROCESSING_CONFIG } from '../constants.js';

function createUIManager() {
  const state = {
    sessionManager: null,
    processingStateManager: null,
    scanStatusManager: null,
    currentSessionId: null,
    currentUserId: null,
    currentBrowserId: null,
    statusUpdateInterval: null,
    sessionHeartbeatInterval: null,
    uiElements: {
      statusContainer: null,
      sessionInfo: null,
      progressBar: null,
      statusText: null,
      sessionControls: null,
    },
    isActive: false,
  };

  /**
   * Initialize UI manager
   */
  async function init(
    sessionManagerInstance,
    processingStateManagerInstance,
    scanStatusManagerInstance,
  ) {
    state.sessionManager = sessionManagerInstance;
    state.processingStateManager = processingStateManagerInstance;
    state.scanStatusManager = scanStatusManagerInstance;

    // Create UI elements
    createUIElements();

    // eslint-disable-next-line no-console
    console.log('[UI Manager] ✅ Initialized:', {
      hasSessionManager: !!sessionManagerInstance,
      hasProcessingStateManager: !!processingStateManagerInstance,
      hasScanStatusManager: !!scanStatusManagerInstance,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Create UI elements
   */
  function createUIElements() {
    // UI overlay disabled - no elements created
    state.uiElements = {
      statusContainer: null,
      sessionInfo: null,
      progressBar: null,
      statusText: null,
      sessionControls: null,
    };
  }

  /**
   * Set current session
   */
  function setCurrentSession(sessionId, userId, browserId) {
    state.currentSessionId = sessionId;
    state.currentUserId = userId;
    state.currentBrowserId = browserId;

    updateSessionDisplay();
    startStatusUpdates();

    // eslint-disable-next-line no-console
    console.log('[UI Manager] 🔄 Session set:', {
      sessionId,
      userId,
      browserId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Update session display
   */
  function updateSessionDisplay() {
    // UI overlay disabled - no display updates
  }

  /**
   * Start status updates
   */
  function startStatusUpdates() {
    if (state.statusUpdateInterval) {
      clearInterval(state.statusUpdateInterval);
    }

    state.statusUpdateInterval = setInterval(async () => {
      await updateStatus();
    }, PROCESSING_CONFIG.PROGRESS_UPDATE_INTERVAL);

    state.isActive = true;
    showStatusContainer();
  }

  /**
   * Stop status updates
   */
  function stopStatusUpdates() {
    if (state.statusUpdateInterval) {
      clearInterval(state.statusUpdateInterval);
      state.statusUpdateInterval = null;
    }

    if (state.sessionHeartbeatInterval) {
      clearInterval(state.sessionHeartbeatInterval);
      state.sessionHeartbeatInterval = null;
    }

    state.isActive = false;
    hideStatusContainer();
  }

  /**
   * Update status display
   */
  async function updateStatus() {
    if (!state.currentSessionId || !state.sessionManager || !state.processingStateManager) {
      return;
    }

    try {
      // Get session info
      const sessionInfo = await state.sessionManager.getCurrentSession();

      // Get processing progress - handle 404 errors gracefully
      let discoveryProgress = null;
      let scanningProgress = null;

      try {
        discoveryProgress = await state.processingStateManager
          .loadDiscoveryCheckpoint();
      } catch (error) {
        if (error.message.includes('404') || error.message.includes('Not Found')) {
          console.log('[UI Manager] Discovery progress file not found yet (normal during initialization)');
        } else {
          console.warn('[UI Manager] Failed to load discovery progress:', error);
        }
      }

      try {
        scanningProgress = await state.processingStateManager
          .loadScanningCheckpoint();
      } catch (error) {
        if (error.message.includes('404') || error.message.includes('Not Found')) {
          console.log('[UI Manager] Scanning progress file not found yet (normal during initialization)');
        } else {
          console.warn('[UI Manager] Failed to load scanning progress:', error);
        }
      }

      updateProgressDisplay(sessionInfo, discoveryProgress, scanningProgress);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[UI Manager] Failed to update status:', error);
    }
  }

  /**
   * Update progress display
   */
  function updateProgressDisplay() {
    // UI overlay disabled - no progress display updates
  }

  /**
   * Show status container
   */
  function showStatusContainer() {
    // UI overlay disabled - no container display
  }

  /**
   * Hide status container
   */
  function hideStatusContainer() {
    // UI overlay disabled - no container display
  }

  /**
   * Pause session
   */
  async function pauseSession() {
    if (!state.currentSessionId || !state.sessionManager) {
      showToast('No active session to pause', 'warning');
      return;
    }

    try {
      await state.sessionManager.pauseSession(state.currentSessionId, state.currentUserId);
      showToast('Session paused', 'info');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[UI Manager] Failed to pause session:', error);
      showError('Failed to pause session', error);
    }
  }

  /**
   * Resume session
   */
  async function resumeSession() {
    if (!state.currentSessionId || !state.sessionManager) {
      showToast('No active session to resume', 'warning');
      return;
    }

    try {
      await state.sessionManager.resumeSession(state.currentSessionId, state.currentUserId);
      showToast('Session resumed', 'info');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[UI Manager] Failed to resume session:', error);
      showError('Failed to resume session', error);
    }
  }

  /**
   * Stop session
   */
  async function stopSession() {
    if (!state.currentSessionId || !state.sessionManager) {
      showToast('No active session to stop', 'warning');
      return;
    }

    try {
      await state.sessionManager.updateSessionHeartbeat(state.currentSessionId, {
        currentStage: 'stopped',
      });
      stopStatusUpdates();
      showToast('Session stopped', 'info');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[UI Manager] Failed to stop session:', error);
      showError('Failed to stop session', error);
    }
  }

  /**
   * Cleanup
   */
  function cleanup() {
    stopStatusUpdates();
    // UI overlay disabled - no DOM cleanup needed
  }

  return {
    init,
    setCurrentSession,
    startStatusUpdates,
    stopStatusUpdates,
    updateStatus,
    pauseSession,
    resumeSession,
    stopSession,
    cleanup,
  };
}

export default createUIManager;