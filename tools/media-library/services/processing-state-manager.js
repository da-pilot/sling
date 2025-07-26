/* eslint-disable no-use-before-define */
/**
 * Processing State Manager - Handles persistent state for discovery and scanning
 * Provides checkpoint and progress tracking for long-running operations
 */

import { DA_STORAGE, CONTENT_DA_LIVE_BASE } from '../constants.js';
import {
  buildSingleSheet,
  saveSheetFile,
  parseSheet,
  loadSheetFile,
} from '../modules/sheet-utils.js';

export default function createProcessingStateManager() {
  const state = {
    daApi: null,
    config: null,
    cache: new Map(),
    cacheTimeout: 5 * 60 * 1000,
    listeners: new Map(),
  };

  async function init(docAuthoringService) {
    try {
      state.daApi = docAuthoringService;
      state.config = docAuthoringService.getConfig();
    } catch (error) {
      console.error('[Processing State Manager] ❌ Initialization failed:', error);
      throw error;
    }
  }

  function isCacheValid(key) {
    const cached = state.cache.get(key);
    if (!cached) {
      return false;
    }
    return Date.now() - cached.timestamp < state.cacheTimeout;
  }

  function updateCache(key, data) {
    state.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  async function loadCheckpoints() {
    try {
      const checkpointPath = `/${state.config.org}/${state.config.repo}/${DA_STORAGE.PROCESSING_DIR}/checkpoint.json`;

      // Use content.da.live for reading
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${checkpointPath}`;
      const rawData = await loadSheetFile(contentUrl, state.config.token);
      const parsedData = parseSheet(rawData);

      // Handle the parsed data correctly - it should be the first item in the data array
      if (parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
        return parsedData.data[0];
      }

      return {
        discovery: null,
        scanning: null,
        upload: null,
        lastUpdated: null,
      };
    } catch (error) {
      console.error('[Processing State Manager] ℹ️ No existing checkpoints found');
      return {
        discovery: null,
        scanning: null,
        upload: null,
        lastUpdated: null,
      };
    }
  }

  async function ensureProcessingFolder() {
    try {
      const processingDir = `/${state.config.org}/${state.config.repo}/${DA_STORAGE.PROCESSING_DIR}`;
      await state.daApi.ensureFolder(processingDir);
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to ensure processing folder:', error);
      console.error('[Processing State Manager] ❌ Processing folder path:', `/${state.config.org}/${state.config.repo}/${DA_STORAGE.PROCESSING_DIR}`);
      throw error;
    }
  }

  async function saveCheckpoints(checkpoints) {
    try {
      await ensureProcessingFolder();
      const checkpointPath = `/${state.config.org}/${state.config.repo}/${DA_STORAGE.PROCESSING_DIR}/checkpoint.json`;
      const data = {
        ...checkpoints,
        lastUpdated: Date.now(),
      };
      const sheetData = buildSingleSheet(data);
      const url = `${state.config.baseUrl}/source${checkpointPath}`;
      await saveSheetFile(url, sheetData, state.config.token);
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to save checkpoints:', error);
      console.error('[Processing State Manager] ❌ Error details:', {
        message: error.message,
        stack: error.stack,
        checkpointPath: `/${state.config.org}/${state.config.repo}/${DA_STORAGE.PROCESSING_DIR}/checkpoint.json`,
      });
      return false;
    }
  }

  /**
   * Load discovery progress from checkpoints
   */
  async function loadDiscoveryProgress(sessionId) {
    const cacheKey = `discovery_${sessionId}`;
    if (isCacheValid(cacheKey)) {
      return state.cache.get(cacheKey).data;
    }

    const checkpoints = await loadCheckpoints();
    const progress = checkpoints.discovery || {
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      status: 'idle',
      lastUpdated: null,
    };

    updateCache(cacheKey, progress);
    return progress;
  }

  /**
   * Save discovery progress to checkpoints
   */
  async function saveDiscoveryProgress(sessionId, progress) {
    const checkpoints = await loadCheckpoints();
    checkpoints.discovery = {
      ...progress,
      lastUpdated: Date.now(),
    };

    const success = await saveCheckpoints(checkpoints);
    if (success) {
      const cacheKey = `discovery_${sessionId}`;
      updateCache(cacheKey, checkpoints.discovery);
      emit('discoveryProgressUpdated', { sessionId, progress: checkpoints.discovery });
    }
  }

  /**
   * Load scanning progress from checkpoints
   */
  async function loadScanningProgress(sessionId) {
    const cacheKey = `scanning_${sessionId}`;
    if (isCacheValid(cacheKey)) {
      return state.cache.get(cacheKey).data;
    }

    const checkpoints = await loadCheckpoints();
    const progress = checkpoints.scanning || {
      totalPages: 0,
      scannedPages: 0,
      pendingPages: 0,
      failedPages: 0,
      totalMedia: 0,
      status: 'idle',
      lastUpdated: null,
    };

    updateCache(cacheKey, progress);
    return progress;
  }

  /**
   * Save scanning progress to checkpoints
   */
  async function saveScanningProgress(sessionId, progress) {
    const checkpoints = await loadCheckpoints();
    checkpoints.scanning = {
      ...progress,
      lastUpdated: Date.now(),
    };

    const success = await saveCheckpoints(checkpoints);
    if (success) {
      const cacheKey = `scanning_${sessionId}`;
      updateCache(cacheKey, checkpoints.scanning);
      emit('scanningProgressUpdated', { sessionId, progress: checkpoints.scanning });
    }
  }

  /**
   * Update discovery progress
   */
  async function updateDiscoveryProgress(sessionId, updates) {
    const currentProgress = await loadDiscoveryProgress(sessionId);
    const updatedProgress = {
      ...currentProgress,
      ...updates,
      lastUpdated: Date.now(),
    };

    await saveDiscoveryProgress(sessionId, updatedProgress);
    return updatedProgress;
  }

  /**
   * Update scanning progress
   */
  async function updateScanningProgress(sessionId, updates) {
    const currentProgress = await loadScanningProgress(sessionId);
    const updatedProgress = {
      ...currentProgress,
      ...updates,
      lastUpdated: Date.now(),
    };

    await saveScanningProgress(sessionId, updatedProgress);
    return updatedProgress;
  }

  /**
   * Save discovery checkpoint
   */
  async function saveDiscoveryCheckpoint(sessionId, checkpoint) {
    const checkpoints = await loadCheckpoints();
    checkpoints.discovery = {
      ...checkpoint,
      lastUpdated: Date.now(),
    };
    const success = await saveCheckpoints(checkpoints);
    if (success) {
      const cacheKey = `discovery_${sessionId}`;
      updateCache(cacheKey, checkpoints.discovery);
    } else {
      console.error('[Processing State Manager] ❌ Failed to save discovery checkpoint');
    }
    return success;
  }

  /**
   * Save scanning checkpoint
   */
  async function saveScanningCheckpoint(sessionId, checkpoint) {
    const checkpoints = await loadCheckpoints();
    checkpoints.scanning = {
      ...checkpoint,
      lastUpdated: Date.now(),
    };

    const success = await saveCheckpoints(checkpoints);
    if (success) {
      const cacheKey = `scanning_${sessionId}`;
      updateCache(cacheKey, checkpoints.scanning);
    }
    return success;
  }

  /**
   * Get discovery checkpoint
   */
  async function getDiscoveryCheckpoint() {
    const checkpoints = await loadCheckpoints();
    return checkpoints.discovery;
  }

  /**
   * Get scanning checkpoint
   */
  async function getScanningCheckpoint() {
    const checkpoints = await loadCheckpoints();
    return checkpoints.scanning;
  }

  /**
   * Check if discovery is complete
   */
  async function isDiscoveryComplete(sessionId) {
    const progress = await loadDiscoveryProgress(sessionId);
    return progress.status === 'completed' || progress.status === 'complete';
  }

  /**
   * Clear checkpoints for a session
   */
  async function clearCheckpoints() {
    try {
      const checkpointPath = `/${state.config.org}/${state.config.repo}/${DA_STORAGE.PROCESSING_DIR}/checkpoint.json`;
      await state.daApi.deleteFile(checkpointPath);

      state.cache.clear();
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to clear checkpoints:', error);
      return false;
    }
  }

  /**
   * Get processing statistics
   */
  async function getProcessingStats(sessionId) {
    try {
      const discoveryProgress = await loadDiscoveryProgress(sessionId);
      const scanningProgress = await loadScanningProgress(sessionId);
      const uploadProgress = await getUploadCheckpoint();

      return {
        discovery: {
          totalFolders: discoveryProgress.totalFolders || 0,
          completedFolders: discoveryProgress.completedFolders || 0,
          totalDocuments: discoveryProgress.totalDocuments || 0,
          status: discoveryProgress.status || 'idle',
          lastUpdated: discoveryProgress.lastUpdated,
        },
        scanning: {
          totalPages: scanningProgress.totalPages || 0,
          scannedPages: scanningProgress.scannedPages || 0,
          pendingPages: scanningProgress.pendingPages || 0,
          failedPages: scanningProgress.failedPages || 0,
          totalMedia: scanningProgress.totalMedia || 0,
          status: scanningProgress.status || 'idle',
          lastUpdated: scanningProgress.lastUpdated,
        },
        overall: {
          isActive: discoveryProgress.status === 'running' || scanningProgress.status === 'running',
          lastUpdated: Math.max(
            discoveryProgress.lastUpdated || 0,
            scanningProgress.lastUpdated || 0,
          ),
        },
        upload: {
          totalItems: uploadProgress?.totalItems || 0,
          uploadedItems: uploadProgress?.uploadedItems || 0,
          totalBatches: uploadProgress?.totalBatches || 0,
          completedBatches: uploadProgress?.completedBatches || 0,
          failedBatches: uploadProgress?.failedBatches || 0,
          status: uploadProgress?.status || 'idle',
          progress: uploadProgress?.progress || 0,
          lastUpdated: uploadProgress?.lastUpdated,
        },
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Processing State Manager] ❌ Failed to get processing stats:', error);
      return {
        discovery: {
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: 0,
          status: 'error',
        },
        scanning: {
          totalPages: 0,
          scannedPages: 0,
          pendingPages: 0,
          failedPages: 0,
          totalMedia: 0,
          status: 'error',
        },
        overall: {
          isDiscoveryComplete: false,
          isScanningComplete: false,
          isActive: false,
        },
      };
    }
  }

  /**
   * Reset processing state for a session
   */
  async function resetProcessingState(sessionId) {
    try {
      await clearCheckpoints(sessionId);

      // Initialize with default state
      const defaultDiscoveryProgress = {
        totalFolders: 0,
        completedFolders: 0,
        totalDocuments: 0,
        status: 'idle',
        lastUpdated: Date.now(),
      };

      const defaultScanningProgress = {
        totalPages: 0,
        scannedPages: 0,
        pendingPages: 0,
        failedPages: 0,
        totalMedia: 0,
        status: 'idle',
        lastUpdated: Date.now(),
      };

      await saveDiscoveryProgress(sessionId, defaultDiscoveryProgress);
      await saveScanningProgress(sessionId, defaultScanningProgress);
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Processing State Manager] ❌ Failed to reset processing state:', error);
      return false;
    }
  }

  /**
   * Clear cache
   */
  function clearCache() {
    state.cache.clear();
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
        console.error('[Processing State Manager] Error in event listener:', error);
      }
    });
  }

  async function saveUploadCheckpoint(sessionId, checkpoint) {
    const checkpoints = await loadCheckpoints();
    checkpoints.upload = {
      ...checkpoint,
      lastUpdated: Date.now(),
    };
    const success = await saveCheckpoints(checkpoints);
    if (success) {
      const cacheKey = `upload_${sessionId}`;
      updateCache(cacheKey, checkpoints.upload);
    }
    return success;
  }

  async function getUploadCheckpoint() {
    const checkpoints = await loadCheckpoints();
    return checkpoints.upload;
  }

  async function updateUploadProgress(sessionId, updates) {
    const existingProgress = await getUploadCheckpoint();
    const updatedProgress = {
      ...existingProgress,
      ...updates,
      lastUpdated: Date.now(),
    };
    return saveUploadCheckpoint(sessionId, updatedProgress);
  }

  async function isUploadComplete() {
    const progress = await getUploadCheckpoint();
    return progress?.status === 'completed' || progress?.status === 'complete';
  }

  async function saveBatchStatus(batchId, status) {
    const checkpoints = await loadCheckpoints();
    if (!checkpoints.upload) {
      checkpoints.upload = {};
    }
    if (!checkpoints.upload.batchStatus) {
      checkpoints.upload.batchStatus = {};
    }
    checkpoints.upload.batchStatus[batchId] = {
      status,
      lastUpdated: Date.now(),
    };
    return saveCheckpoints(checkpoints);
  }

  async function getFailedBatches() {
    const checkpoints = await loadCheckpoints();
    if (!checkpoints.upload?.batchStatus) {
      return [];
    }
    return Object.entries(checkpoints.upload.batchStatus)
      .filter(([, batch]) => batch.status === 'failed')
      .map(([batchId]) => batchId);
  }

  async function updateRetryAttempts(batchId, attempts) {
    const checkpoints = await loadCheckpoints();
    if (!checkpoints.upload) {
      checkpoints.upload = {};
    }
    if (!checkpoints.upload.retryAttempts) {
      checkpoints.upload.retryAttempts = {};
    }
    checkpoints.upload.retryAttempts[batchId] = attempts;
    return saveCheckpoints(checkpoints);
  }

  function isBatchProcessingComplete() {
    return state.batchProcessingPhase && state.batchProcessingPhase.status === 'completed';
  }

  function getBatchProcessingStats() {
    return state.batchProcessingPhase || null;
  }

  return {
    init,
    loadCheckpoints,
    saveCheckpoints,
    loadDiscoveryProgress,
    saveDiscoveryProgress,
    loadScanningProgress,
    saveScanningProgress,
    updateDiscoveryProgress,
    updateScanningProgress,
    saveDiscoveryCheckpoint,
    saveScanningCheckpoint,
    getDiscoveryCheckpoint,
    getScanningCheckpoint,
    isDiscoveryComplete,
    clearCheckpoints,
    getProcessingStats,
    resetProcessingState,
    clearCache,
    on,
    off,
    emit,
    saveUploadCheckpoint,
    getUploadCheckpoint,
    updateUploadProgress,
    isUploadComplete,
    saveBatchStatus,
    getFailedBatches,
    updateRetryAttempts,
    isBatchProcessingComplete,
    getBatchProcessingStats,
  };
}