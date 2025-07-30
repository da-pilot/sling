/* eslint-disable no-use-before-define */
/**
 * Processing State Manager - Handles persistent state for discovery and scanning
 * Provides checkpoint and progress tracking for long-running operations
 */

import {
  DA_STORAGE,
  LOCALSTORAGE_KEYS,
  DA_PATHS,
  CONTENT_DA_LIVE_BASE,
} from '../constants.js';
import { loadData, buildSingleSheet, saveSheetFile } from '../modules/sheet-utils.js';
import createCheckpointQueueManager from './checkpoint-queue-manager.js';

const localStorageManager = {
  updateCheckpoint: (updater, key = LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT) => {
    try {
      const current = JSON.parse(localStorage.getItem(key) || '{}');
      const updated = updater(current);
      localStorage.setItem(key, JSON.stringify(updated));
      return true;
    } catch (e) {
      return false;
    }
  },
  getCheckpoint: (key = LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (e) {
      return {};
    }
  },
  clearCheckpoint: (key = LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT) => {
    localStorage.removeItem(key);
  },
  hasPendingUpdates: (key) => {
    const storageKey = key || LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT;
    try {
      const data = localStorage.getItem(storageKey);
      const checkpoint = data ? JSON.parse(data) : {};
      return checkpoint?.pendingUpdates?.length > 0;
    } catch (error) {
      return false;
    }
  },
  getUpdateCount: (key) => {
    const storageKey = key || LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT;
    try {
      const data = localStorage.getItem(storageKey);
      const checkpoint = data ? JSON.parse(data) : {};
      return checkpoint?.pendingUpdates?.length || 0;
    } catch (error) {
      return 0;
    }
  },
  batchUpdates: (key, updates) => {
    const storageKey = key || LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT;
    try {
      const data = localStorage.getItem(storageKey);
      const checkpoint = data ? JSON.parse(data) : {};
      const updatedCheckpoint = {
        ...checkpoint,
        pendingUpdates: [...(checkpoint.pendingUpdates || []), ...updates],
        lastUpdated: Date.now(),
      };
      localStorage.setItem(storageKey, JSON.stringify(updatedCheckpoint));
    } catch (error) {
      console.error('[localStorageManager] Failed to batch updates:', error);
    }
  },
};

export default function createProcessingStateManager(docAuthoringService) {
  const state = {
    config: null,
    daApi: docAuthoringService,
    cache: new Map(),
    listeners: new Map(),
    batchProcessingPhase: null,
    queueManager: null,
  };

  async function init(config) {
    try {
      console.log('[Processing State Manager] 🔍 Initializing with config:', {
        hasConfig: !!config,
        configType: typeof config,
      });
      state.config = config;
      state.daApi = config.daApi;
      await ensureProcessingFolder();
      console.log('[Processing State Manager] ✅ Initialized successfully');
      state.queueManager = createCheckpointQueueManager();
    } catch (error) {
      console.error('[Processing State Manager] ❌ Initialization failed:', error);
      throw error;
    }
  }

  async function loadDiscoveryCheckpoint() {
    try {
      const daConfig = state.daApi.getConfig();
      if (!daConfig || !daConfig.token) {
        throw new Error('Invalid configuration: token is missing from DA API');
      }
      const checkpointPath = DA_PATHS.getDiscoveryCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${checkpointPath}`;
      const parsedData = await loadData(contentUrl, daConfig.token);
      if (parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
        return parsedData.data[0];
      }
      return {
        totalFolders: 0,
        completedFolders: 0,
        totalDocuments: 0,
        status: 'idle',
        folderStatus: {},
        lastUpdated: null,
      };
    } catch (error) {
      return {
        totalFolders: 0,
        completedFolders: 0,
        totalDocuments: 0,
        status: 'idle',
        folderStatus: {},
        lastUpdated: null,
      };
    }
  }

  async function loadScanningCheckpoint() {
    try {
      await ensureProcessingFolder();
      const daConfig = state.daApi.getConfig();
      if (!daConfig || !daConfig.token) {
        throw new Error('Invalid configuration: token is missing from DA API');
      }
      const checkpointPath = DA_PATHS.getScanningCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${checkpointPath}`;
      const parsedData = await loadData(contentUrl, daConfig.token);
      if (parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
        return parsedData.data[0];
      }
      return {
        totalPages: 0,
        scannedPages: 0,
        pendingPages: 0,
        failedPages: 0,
        totalMedia: 0,
        status: 'idle',
        lastUpdated: null,
      };
    } catch (error) {
      return {
        totalPages: 0,
        scannedPages: 0,
        pendingPages: 0,
        failedPages: 0,
        totalMedia: 0,
        status: 'idle',
        lastUpdated: null,
      };
    }
  }

  async function loadUploadCheckpoint() {
    try {
      await ensureProcessingFolder();
      const daConfig = state.daApi.getConfig();
      if (!daConfig || !daConfig.token) {
        throw new Error('Invalid configuration: token is missing from DA API');
      }
      const checkpointPath = DA_PATHS.getUploadCheckpointFile(daConfig.org, daConfig.repo);
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${checkpointPath}`;
      const parsedData = await loadData(contentUrl, daConfig.token);
      if (parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
        return parsedData.data[0];
      }
      return {
        totalItems: 0,
        uploadedItems: 0,
        totalBatches: 0,
        completedBatches: 0,
        failedBatches: 0,
        status: 'idle',
        progress: 0,
        batchStatus: {},
        retryAttempts: {},
        lastUpdated: null,
      };
    } catch (error) {
      return {
        totalItems: 0,
        uploadedItems: 0,
        totalBatches: 0,
        completedBatches: 0,
        failedBatches: 0,
        status: 'idle',
        progress: 0,
        batchStatus: {},
        retryAttempts: {},
        lastUpdated: null,
      };
    }
  }

  async function ensureProcessingFolder() {
    try {
      const daConfig = state.daApi.getConfig();
      const processingDir = `/${daConfig.org}/${daConfig.repo}/${DA_STORAGE.PROCESSING_DIR}`;
      await state.daApi.ensureFolder(processingDir);
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to ensure processing folder:', error);
      const daConfig = state.daApi.getConfig();
      console.error('[Processing State Manager] ❌ Processing folder path:', `/${daConfig.org}/${daConfig.repo}/${DA_STORAGE.PROCESSING_DIR}`);
      throw error;
    }
  }

  async function saveDiscoveryCheckpointFile(checkpoint) {
    try {
      await ensureProcessingFolder();
      const daConfig = state.daApi.getConfig();
      const checkpointPath = DA_PATHS.getDiscoveryCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      const data = {
        ...checkpoint,
        lastUpdated: Date.now(),
      };
      const sheetData = buildSingleSheet(data);
      const url = `${daConfig.baseUrl}/source${checkpointPath}`;
      await saveSheetFile(url, sheetData, daConfig.token);
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to save discovery checkpoint:', error);
      return false;
    }
  }

  async function saveScanningCheckpointFile(checkpoint) {
    try {
      await ensureProcessingFolder();
      const daConfig = state.daApi.getConfig();
      const checkpointPath = DA_PATHS.getScanningCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      const data = {
        ...checkpoint,
        lastUpdated: Date.now(),
      };
      const sheetData = buildSingleSheet(data);
      const url = `${daConfig.baseUrl}/source${checkpointPath}`;
      await saveSheetFile(url, sheetData, daConfig.token);
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to save scanning checkpoint:', error);
      return false;
    }
  }

  async function saveUploadCheckpointFile(checkpoint) {
    try {
      await ensureProcessingFolder();
      const daConfig = state.daApi.getConfig();
      const checkpointPath = DA_PATHS.getUploadCheckpointFile(daConfig.org, daConfig.repo);
      const data = {
        ...checkpoint,
        lastUpdated: Date.now(),
      };
      const sheetData = buildSingleSheet(data);
      const url = `${daConfig.baseUrl}/source${checkpointPath}`;
      await saveSheetFile(url, sheetData, daConfig.token);
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to save upload checkpoint:', error);
      return false;
    }
  }

  /**
   * Update discovery progress
   */
  async function updateDiscoveryProgress(sessionId, updates) {
    await queueFolderDiscoveryUpdate({
      type: 'updateDiscoveryProgress',
      sessionId,
      updates,
      timestamp: Date.now(),
    });
  }

  /**
   * Update scanning progress
   */
  async function updateScanningProgress(sessionId, updates) {
    const currentProgress = await loadScanningCheckpoint();
    const updatedProgress = {
      ...currentProgress,
      ...updates,
      lastUpdated: Date.now(),
    };
    await saveScanningCheckpointFile(updatedProgress);
    return updatedProgress;
  }

  async function isDiscoveryComplete() {
    const progress = await loadDiscoveryCheckpoint();
    return progress.status === 'completed';
  }

  async function clearCheckpoints() {
    try {
      const daConfig = state.daApi.getConfig();
      const discoveryCheckpointPath = DA_PATHS.getDiscoveryCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      const scanningCheckpointPath = DA_PATHS.getScanningCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      const uploadCheckpointPath = DA_PATHS.getUploadCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      await state.daApi.deleteFile(discoveryCheckpointPath);
      await state.daApi.deleteFile(scanningCheckpointPath);
      await state.daApi.deleteFile(uploadCheckpointPath);
      state.cache.clear();
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to clear checkpoints:', error);
      return false;
    }
  }
  async function clearDiscoveryCheckpoint() {
    try {
      const daConfig = state.daApi.getConfig();
      const discoveryCheckpointPath = DA_PATHS.getDiscoveryCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      await state.daApi.deleteFile(discoveryCheckpointPath);
      state.cache.delete('discoveryCheckpoint');
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to clear discovery checkpoint:', error);
      return false;
    }
  }
  async function clearScanningCheckpoint() {
    try {
      const daConfig = state.daApi.getConfig();
      const scanningCheckpointPath = DA_PATHS.getScanningCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      await state.daApi.deleteFile(scanningCheckpointPath);
      state.cache.delete('scanningCheckpoint');
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to clear scanning checkpoint:', error);
      return false;
    }
  }
  async function clearUploadCheckpoint() {
    try {
      const daConfig = state.daApi.getConfig();
      const uploadCheckpointPath = DA_PATHS.getUploadCheckpointFile(
        daConfig.org,
        daConfig.repo,
      );
      await state.daApi.deleteFile(uploadCheckpointPath);
      state.cache.delete('uploadCheckpoint');
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to clear upload checkpoint:', error);
      return false;
    }
  }

  /**
   * Get processing statistics
   */
  async function getProcessingStats() {
    try {
      const discoveryProgress = await loadDiscoveryCheckpoint();
      const scanningProgress = await loadScanningCheckpoint();
      const uploadProgress = await loadUploadCheckpoint();
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
    return saveUploadCheckpointFile(checkpoint);
  }

  async function getUploadCheckpoint() {
    return loadUploadCheckpoint();
  }

  async function updateUploadProgress(sessionId, updates) {
    const existingProgress = await loadUploadCheckpoint();
    const updatedProgress = {
      ...existingProgress,
      ...updates,
      lastUpdated: Date.now(),
    };
    return saveUploadCheckpointFile(updatedProgress);
  }

  async function isUploadComplete() {
    const progress = await getUploadCheckpoint();
    return progress?.status === 'completed';
  }

  async function saveBatchStatus(sessionId, batchId, status) {
    const checkpoint = await loadUploadCheckpoint();
    if (!checkpoint.batchStatus) {
      checkpoint.batchStatus = {};
    }
    checkpoint.batchStatus[batchId] = {
      status,
      lastUpdated: Date.now(),
    };
    return saveUploadCheckpointFile(checkpoint);
  }

  async function getFailedBatches() {
    const checkpoint = await loadUploadCheckpoint();
    if (!checkpoint?.batchStatus) {
      return [];
    }
    return Object.entries(checkpoint.batchStatus)
      .filter(([, batch]) => batch.status === 'failed')
      .map(([batchId]) => batchId);
  }

  async function updateRetryAttempts(sessionId, batchId, attempts) {
    const checkpoint = await loadUploadCheckpoint();
    if (!checkpoint.retryAttempts) {
      checkpoint.retryAttempts = {};
    }
    checkpoint.retryAttempts[batchId] = attempts;
    return saveUploadCheckpointFile(checkpoint);
  }

  function isBatchProcessingComplete() {
    return state.batchProcessingPhase && state.batchProcessingPhase.status === 'completed';
  }

  function getBatchProcessingStats() {
    return state.batchProcessingPhase || null;
  }

  async function markFolderComplete(folderName, documentCount, discoveryFile) {
    await queueFolderDiscoveryUpdate({
      type: 'markFolderComplete',
      folderName,
      documentCount,
      discoveryFile,
      timestamp: Date.now(),
    });
  }
  async function queueFolderDiscoveryUpdate(update) {
    localStorageManager.updateCheckpoint((current) => ({
      ...current,
      pendingUpdates: [...(current.pendingUpdates || []), update],
      lastUpdated: Date.now(),
    }), LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT);
    const localStorageContent = localStorage.getItem(LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT);
    console.log('[DEBUG] localStorage content after queueing update:', JSON.parse(localStorageContent));
  }
  async function getPendingUpdates(key) {
    const checkpoint = localStorageManager.getCheckpoint(key);
    return checkpoint?.pendingUpdates || [];
  }
  async function clearPendingUpdates(key) {
    localStorageManager.updateCheckpoint((current) => ({
      ...current,
      pendingUpdates: [],
      lastUpdated: Date.now(),
    }), key);
  }
  function getDiscoveryCheckpointPath() {
    const daConfig = state.daApi.getConfig();
    const path = DA_PATHS.getDiscoveryCheckpointFile(daConfig.org, daConfig.repo);
    console.log('[Processing State Manager] 📁 Discovery checkpoint path:', {
      org: daConfig.org,
      repo: daConfig.repo,
      path,
    });
    return path;
  }
  async function confirmSaveWithListAPI(checkpointPath, expectedTimestamp) {
    try {
      console.log('[Processing State Manager] 🔍 Checking daApi availability:', {
        hasDaApi: !!state.daApi,
        daApiType: typeof state.daApi,
        hasListPath: !!state.daApi?.listPath,
      });
      console.log('[Processing State Manager] 🔍 Checking save confirmation:', {
        checkpointPath,
        expectedTimestamp,
      });
      if (!state.daApi) {
        console.error('[Processing State Manager] ❌ daApi is not available');
        return {
          success: false,
          reason: 'daApi is not available',
          checkpointPath,
          expectedTimestamp,
        };
      }
      if (!state.daApi.listPath) {
        console.error('[Processing State Manager] ❌ listPath method is not available in daApi');
        return {
          success: false,
          reason: 'listPath method is not available in daApi',
          checkpointPath,
          expectedTimestamp,
        };
      }
      console.log('[Processing State Manager] 📡 Calling listPath API with path:', checkpointPath);
      const items = await state.daApi.listPath(checkpointPath);
      console.log('[Processing State Manager] 📋 Raw API response:', {
        checkpointPath,
        responseType: typeof items,
        isArray: Array.isArray(items),
        itemCount: items.length,
        fullResponse: JSON.stringify(items, null, 2),
      });
      if (items.length === 0) {
        console.log('[Processing State Manager] ❌ No items returned from API for path:', checkpointPath);
        return {
          success: false,
          reason: 'File not found on server',
          checkpointPath,
        };
      }
      const checkpointFile = items[0];
      console.log('[Processing State Manager] 📄 Found checkpoint file:', {
        checkpointPath,
        fileDetails: checkpointFile,
        lastModified: checkpointFile.lastModified,
        name: checkpointFile.name,
        path: checkpointFile.path,
        size: checkpointFile.size,
      });
      const fileLastModified = new Date(checkpointFile.lastModified).getTime();
      const expectedTime = new Date(expectedTimestamp).getTime();
      const timeDifference = Math.abs(fileLastModified - expectedTime);
      const toleranceMs = 5000;
      console.log('[Processing State Manager] ⏰ Timestamp comparison:', {
        fileLastModified,
        expectedTime,
        timeDifference,
        toleranceMs,
        isWithinTolerance: timeDifference <= toleranceMs,
      });
      if (timeDifference <= toleranceMs) {
        return {
          success: true,
          reason: 'File exists and timestamp matches within tolerance',
          checkpointPath,
          fileLastModified,
          expectedTime,
          timeDifference,
        };
      }
      return {
        success: false,
        reason: 'File exists but timestamp is too old',
        checkpointPath,
        fileLastModified,
        expectedTime,
        timeDifference,
        toleranceMs,
      };
    } catch (error) {
      console.error('[Processing State Manager] ❌ Error in confirmSaveWithListAPI:', {
        error: error.message,
        stack: error.stack,
        checkpointPath,
        expectedTimestamp,
      });
      return {
        success: false,
        reason: `Error: ${error.message}`,
        checkpointPath,
        expectedTimestamp,
      };
    }
  }
  return {
    init,
    loadDiscoveryCheckpoint,
    loadScanningCheckpoint,
    loadUploadCheckpoint,
    saveDiscoveryCheckpointFile,
    saveScanningCheckpointFile,
    saveUploadCheckpointFile,
    updateDiscoveryProgress,
    updateScanningProgress,
    isDiscoveryComplete,
    clearCheckpoints,
    clearDiscoveryCheckpoint,
    clearScanningCheckpoint,
    clearUploadCheckpoint,
    getProcessingStats,
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
    markFolderComplete,
    queueFolderDiscoveryUpdate,
    getPendingUpdates,
    clearPendingUpdates,
    getDiscoveryCheckpointPath,
    confirmSaveWithListAPI,
  };
}