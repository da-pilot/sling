/* eslint-disable no-use-before-define */
/**
 * Session Manager - Handles session lifecycle and coordination
 * Provides comprehensive session management for multi-user operations
 */

import { DA_PATHS, CONTENT_DA_LIVE_BASE } from '../constants.js';
import {
  buildSingleSheet,
  saveSheetFile,
  loadData,
} from '../modules/sheet-utils.js';

export default function createSessionManager() {
  const state = {
    daApi: null,
    config: null,
    activeSessions: new Map(),
    currentSession: null,
    listeners: new Map(),
  };

  async function init(docAuthoringService) {
    try {
      state.daApi = docAuthoringService;
      state.config = docAuthoringService.getConfig();
    } catch (error) {
      console.error('[Session Manager] ❌ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Normalize session ID for filename (replace underscores with hyphens)
   */
  function normalizeSessionId(sessionId) {
    return sessionId.replace(/_/g, '-');
  }

  async function loadSessionState(sessionId) {
    try {
      const normalizedSessionId = normalizeSessionId(sessionId);
      const sessionPath = DA_PATHS.getSessionFile(
        state.config.org,
        state.config.repo,
        normalizedSessionId,
      );
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${sessionPath}`;
      const parsedData = await loadData(contentUrl, state.config.token);
      if (parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
        return parsedData.data[0];
      }
      return {
        sessionId,
        userId: null,
        browserId: null,
        status: 'idle',
        currentStage: null,
        currentProgress: {},
        lastHeartbeat: Date.now(),
        createdAt: Date.now(),
      };
    } catch (error) {
      console.warn('[Session Manager] ℹ️ No existing session state found');
      return {
        sessionId,
        userId: null,
        browserId: null,
        status: 'idle',
        currentStage: null,
        currentProgress: {},
        lastHeartbeat: Date.now(),
        createdAt: Date.now(),
      };
    }
  }

  async function saveSessionState(sessionId, sessionData) {
    try {
      const normalizedSessionId = normalizeSessionId(sessionId);
      const sessionPath = DA_PATHS.getSessionFile(
        state.config.org,
        state.config.repo,
        normalizedSessionId,
      );
      const data = {
        ...sessionData,
        lastUpdated: Date.now(),
      };
      const sheetData = buildSingleSheet(data); // Assuming parseSheet is still needed for saving
      const url = `${state.config.baseUrl}/source${sessionPath}`;
      await saveSheetFile(url, sheetData, state.config.token);
      return true;
    } catch (error) {
      console.error('[Session Manager] ❌ Failed to save session state:', error);
      return false;
    }
  }

  /**
   * Add session to active sessions
   */
  function addToActiveSessions(sessionId, sessionData) {
    state.activeSessions.set(sessionId, {
      ...sessionData,
      lastHeartbeat: Date.now(),
    });
  }

  /**
   * Update active session
   */
  function updateActiveSession(sessionId, updates) {
    const existingSession = state.activeSessions.get(sessionId);
    if (existingSession) {
      state.activeSessions.set(sessionId, {
        ...existingSession,
        ...updates,
        lastHeartbeat: Date.now(),
      });
    }
  }

  /**
   * Remove session from active sessions
   */
  function removeFromActiveSessions(sessionId) {
    state.activeSessions.delete(sessionId);
  }

  /**
   * Create a new session
   */
  async function createSession(userId, browserId) {
    try {
      const sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const sessionData = {
        sessionId,
        userId,
        browserId,
        status: 'active',
        currentStage: 'idle',
        currentProgress: {},
        lastHeartbeat: Date.now(),
        createdAt: Date.now(),
      };

      const success = await saveSessionState(sessionId, sessionData);
      if (success) {
        addToActiveSessions(sessionId, sessionData);
        state.currentSession = sessionId;
      }
      return success ? sessionId : null;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to create session:', error);
      return null;
    }
  }

  /**
   * Acquire session lock
   */
  async function acquireSessionLock(sessionId, lockType = 'incremental') {
    try {
      const sessionData = await loadSessionState(sessionId);

      sessionData.status = 'active';
      sessionData.lockType = lockType;
      sessionData.lockAcquiredAt = Date.now();
      sessionData.lastHeartbeat = Date.now();

      const success = await saveSessionState(sessionId, sessionData);
      if (success) {
        addToActiveSessions(sessionId, sessionData);
        state.currentSession = sessionId;
      }
      return success;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to acquire session lock:', error);
      return false;
    }
  }

  /**
   * Update session heartbeat
   */
  async function updateSessionHeartbeat(sessionId, progress = {}) {
    try {
      const sessionData = await loadSessionState(sessionId);

      sessionData.lastHeartbeat = Date.now();
      // Replace currentProgress entirely to avoid nesting
      sessionData.currentProgress = progress;

      const success = await saveSessionState(sessionId, sessionData);
      if (success) {
        updateActiveSession(sessionId, sessionData);
      }
      return success;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to update session heartbeat:', error);
      return false;
    }
  }

  /**
   * Pause session
   */
  async function pauseSession(sessionId) {
    try {
      const sessionData = await loadSessionState(sessionId);
      sessionData.status = 'paused';
      sessionData.lastHeartbeat = Date.now();

      const success = await saveSessionState(sessionId, sessionData);
      if (success) {
        updateActiveSession(sessionId, sessionData);
      }
      return success;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to pause session:', error);
      return false;
    }
  }

  /**
   * Resume session
   */
  async function resumeSession(sessionId) {
    try {
      const sessionData = await loadSessionState(sessionId);
      sessionData.status = 'active';
      sessionData.lastHeartbeat = Date.now();

      const success = await saveSessionState(sessionId, sessionData);
      if (success) {
        updateActiveSession(sessionId, sessionData);
      }
      return success;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to resume session:', error);
      return false;
    }
  }

  /**
   * Cleanup stale sessions
   */
  async function cleanupStaleSessions() {
    try {
      const activeSessions = Array.from(state.activeSessions.entries());
      const now = Date.now();
      const staleSessions = activeSessions.filter(
        ([, session]) => now - session.lastHeartbeat > state.sessionTimeout,
      );

      if (staleSessions.length === 0) {
        return;
      }

      const pausePromises = staleSessions.map(async ([sessionId]) => {
        await pauseSession(sessionId);
      });

      await Promise.all(pausePromises);

      const coordinatePromises = staleSessions.map(async ([sessionId]) => {
        await coordinateSessions(state.currentSession, sessionId);
      });

      await Promise.all(coordinatePromises);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to cleanup stale sessions:', error);
    }
  }
  async function cleanupOldSessionFiles() {
    try {
      const sessionsDir = DA_PATHS.getSessionsDir(state.config.org, state.config.repo);
      const items = await state.daApi.listPath(
        sessionsDir.replace(`/${state.config.org}/${state.config.repo}/`, ''),
      );
      const now = Date.now();
      const cleanupPromises = [];
      items.forEach((item) => {
        if (item.name && item.ext === 'json' && item.name.startsWith('session-')) {
          const sessionId = item.name.replace('.json', '').replace(/^session-/, '');
          const sessionPath = DA_PATHS.getSessionFile(
            state.config.org,
            state.config.repo,
            sessionId,
          );
          const contentUrl = `${CONTENT_DA_LIVE_BASE}${sessionPath}`;
          loadData(contentUrl, state.config.token).then((parsedData) => {
            if (parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
              const sessionData = parsedData.data[0];
              const sessionAge = now - (sessionData.lastUpdated || sessionData.createdAt || now);
              const shouldCleanup = sessionData.status === 'completed'
                || sessionData.status === 'failed'
                || sessionData.status === 'interrupted'
                || sessionAge > 24 * 60 * 60 * 1000;
              if (shouldCleanup) {
                state.daApi.deleteFile(sessionPath).then(() => {
                  console.log(`[Session Manager] Deleted old session file: ${sessionPath}`);
                }).catch((deleteError) => {
                  console.error(`[Session Manager] Failed to delete old session file ${sessionPath}:`, deleteError);
                });
              }
            }
          }).catch((loadError) => {
            console.error(`[Session Manager] Failed to load old session file ${sessionPath}:`, loadError);
            state.daApi.deleteFile(sessionPath).then(() => {
              console.log(`[Session Manager] Deleted old session file (failed to load): ${sessionPath}`);
            }).catch((deleteError) => {
              console.error(`[Session Manager] Failed to delete old session file (failed to load) ${sessionPath}:`, deleteError);
            });
          });
        }
      });
      if (cleanupPromises.length > 0) {
        await Promise.all(cleanupPromises);
      }
    } catch (error) {
      console.error('[Session Manager] ❌ Failed to cleanup old session files:', error);
    }
  }

  /**
   * Get active sessions
   */
  async function getActiveSessions() {
    try {
      const activeSessions = Array.from(state.activeSessions.values());
      const now = Date.now();

      // Filter out stale sessions
      const validSessions = activeSessions.filter(
        (session) => now - session.lastHeartbeat <= state.sessionTimeout,
      );

      return validSessions;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to get active sessions:', error);
      return [];
    }
  }

  /**
   * Check for conflicting sessions
   */
  async function checkForConflictingSessions(sessionId) {
    try {
      const activeSessions = await getActiveSessions();
      const currentSession = activeSessions.find((s) => s.sessionId === sessionId);

      if (!currentSession) {
        return [];
      }

      const conflictingSessions = activeSessions.filter((session) => {
        if (session.sessionId === sessionId) {
          return false;
        }

        // Check if sessions are running at the same time
        const isConflicting = session.status === 'active'
          && (session.currentStage === 'discovery' || session.currentStage === 'scanning');

        return isConflicting;
      });

      return conflictingSessions;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to check for conflicting sessions:', error);
      return [];
    }
  }

  /**
   * Coordinate sessions
   */
  async function coordinateSessions(primarySessionId, secondarySessionId) {
    try {
      const primarySession = await loadSessionState(primarySessionId);
      const secondarySession = await loadSessionState(secondarySessionId);

      // Merge progress from secondary session
      primarySession.currentProgress = {
        ...primarySession.currentProgress,
        ...secondarySession.currentProgress,
      };

      // Pause secondary session
      secondarySession.status = 'paused';
      secondarySession.coordinatedWith = primarySessionId;

      await saveSessionState(primarySessionId, primarySession);
      await saveSessionState(secondarySessionId, secondarySession);

      updateActiveSession(primarySessionId, primarySession);
      updateActiveSession(secondarySessionId, secondarySession);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to coordinate sessions:', error);
    }
  }

  /**
   * Merge session progress
   */
  async function mergeSessionProgress(targetSessionId, sourceSessionId) {
    try {
      const targetSession = await loadSessionState(targetSessionId);
      const sourceSession = await loadSessionState(sourceSessionId);

      targetSession.currentProgress = {
        ...targetSession.currentProgress,
        ...sourceSession.currentProgress,
      };

      const success = await saveSessionState(targetSessionId, targetSession);
      if (success) {
        updateActiveSession(targetSessionId, targetSession);
      }
      return success;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to merge session progress:', error);
      return false;
    }
  }

  /**
   * Get current session
   */
  function getCurrentSession() {
    return state.currentSession;
  }

  /**
   * Set current session
   */
  function setCurrentSession(sessionId) {
    state.currentSession = sessionId;
  }

  /**
   * Release session lock
   */
  async function releaseSessionLock(sessionId, status = 'completed') {
    try {
      const sessionData = await loadSessionState(sessionId);
      sessionData.status = status;
      sessionData.lockReleasedAt = Date.now();
      sessionData.lastHeartbeat = Date.now();

      const success = await saveSessionState(sessionId, sessionData);
      if (success) {
        removeFromActiveSessions(sessionId);
        if (state.currentSession === sessionId) {
          state.currentSession = null;
        }
      }
      return success;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Session Manager] ❌ Failed to release session lock:', error);
      return false;
    }
  }

  /**
   * Clear cache
   */
  function clearCache() {
    if (state.cache) {
      state.cache.clear();
    }
  }

  /**
   * Add event listener
   */
  function on(event, callback) {
    if (!state.listeners) {
      state.listeners = new Map();
    }
    if (!state.listeners.has(event)) {
      state.listeners.set(event, []);
    }
    state.listeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   */
  function off(event, callback) {
    if (!state.listeners || !state.listeners.has(event)) {
      return;
    }
    const callbacks = state.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Emit event to listeners
   */
  function emit(event, data) {
    if (!state.listeners || !state.listeners.has(event)) {
      return;
    }
    const callbacks = state.listeners.get(event);
    callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[Session Manager] Error in event listener:', error);
      }
    });
  }

  return {
    init,
    createSession,
    acquireSessionLock,
    updateSessionHeartbeat,
    pauseSession,
    resumeSession,
    cleanupStaleSessions,
    cleanupOldSessionFiles,
    getActiveSessions,
    checkForConflictingSessions,
    coordinateSessions,
    mergeSessionProgress,
    getCurrentSession,
    setCurrentSession,
    releaseSessionLock,
    clearCache,
    on,
    off,
    emit,
  };
}