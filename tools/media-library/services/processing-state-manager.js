/* eslint-disable no-use-before-define */
/**
 * Processing State Manager - Handles persistent state for discovery and scanning
 * Provides checkpoint and progress tracking for long-running operations
 */

import {
  LOCALSTORAGE_KEYS,
  DA_PATHS,
  CONTENT_DA_LIVE_BASE,
} from '../constants.js';
import { loadData, buildSingleSheet, saveSheetFile } from '../modules/sheet-utils.js';
import createCheckpointQueueManager from './checkpoint-queue-manager.js';

const CHECKPOINTS = {
  DISCOVERY: 'discovery',
  SCANNING: 'scanning',
  UPLOAD: 'upload',
};

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
      state.config = config;
      state.daApi = config.daApi;
      state.queueManager = createCheckpointQueueManager();
    } catch (error) {
      console.error('[Processing State Manager] ❌ Initialization failed:', error);
      throw error;
    }
  }

  function getCheckpointPath(checkpointType) {
    const daConfig = state.daApi.getConfig();
    switch (checkpointType) {
      case CHECKPOINTS.DISCOVERY:
        return DA_PATHS.getDiscoveryCheckpointFile(daConfig.org, daConfig.repo);
      case CHECKPOINTS.SCANNING:
        return DA_PATHS.getScanningCheckpointFile(daConfig.org, daConfig.repo);
      default:
        throw new Error(`Unknown checkpoint type: ${checkpointType}`);
    }
  }

  function getDefaultCheckpoint(checkpointType) {
    switch (checkpointType) {
      case CHECKPOINTS.DISCOVERY:
        return {
          org: null,
          repo: null,
          status: 'idle',
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: 0,
          folderStatus: {},
          excludedPatterns: [],
          rootFiles: [],
          lastUpdated: null,
        };
      case CHECKPOINTS.SCANNING:
        return {
          totalPages: 0,
          scannedPages: 0,
          pendingPages: 0,
          failedPages: 0,
          totalMedia: 0,
          status: 'idle',
          lastUpdated: null,
        };
      default:
        throw new Error(`Unknown checkpoint type: ${checkpointType}`);
    }
  }

  async function loadCheckpoint(checkpointType) {
    try {
      const daConfig = state.daApi.getConfig();
      if (!daConfig || !daConfig.token) {
        throw new Error('Invalid configuration: token is missing from DA API');
      }
      const checkpointPath = getCheckpointPath(checkpointType);
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${checkpointPath}`;
      const parsedData = await loadData(contentUrl, daConfig.token);
      if (parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
        return parsedData.data[0];
      }
      return getDefaultCheckpoint(checkpointType);
    } catch (error) {
      return getDefaultCheckpoint(checkpointType);
    }
  }

  async function saveCheckpointFile(checkpointType, checkpoint) {
    try {
      const daConfig = state.daApi.getConfig();
      const checkpointPath = getCheckpointPath(checkpointType);
      const data = {
        ...checkpoint,
        lastUpdated: Date.now(),
      };
      const sheetData = buildSingleSheet(data);
      const url = `${daConfig.baseUrl}/source${checkpointPath}`;
      await saveSheetFile(url, sheetData, daConfig.token);
      return true;
    } catch (error) {
      console.error(`[Processing State Manager] ❌ Failed to save ${checkpointType} checkpoint:`, error);
      return false;
    }
  }

  async function clearCheckpoint(checkpointType) {
    try {
      const checkpointPath = getCheckpointPath(checkpointType);
      await state.daApi.deleteFile(checkpointPath);
      state.cache.delete(`${checkpointType}Checkpoint`);
      return true;
    } catch (error) {
      console.error(`[Processing State Manager] ❌ Failed to clear ${checkpointType} checkpoint:`, error);
      return false;
    }
  }

  async function loadDiscoveryCheckpoint() {
    return loadCheckpoint(CHECKPOINTS.DISCOVERY);
  }

  async function loadScanningCheckpoint() {
    return loadCheckpoint(CHECKPOINTS.SCANNING);
  }

  async function saveDiscoveryCheckpointFile(checkpoint) {
    return saveCheckpointFile(CHECKPOINTS.DISCOVERY, checkpoint);
  }

  async function saveScanningCheckpointFile(checkpoint) {
    if (checkpoint.totalPages && checkpoint.scannedPages) {
      if (checkpoint.scannedPages > checkpoint.totalPages) {
        checkpoint.scannedPages = checkpoint.totalPages;
      }
      if (checkpoint.pendingPages && checkpoint.pendingPages < 0) {
        checkpoint.pendingPages = 0;
      }
    }

    // Debug: Log checkpoint data size and structure
    const checkpointStr = JSON.stringify(checkpoint);
    console.log(`[Processing State Manager] 📊 Saving scanning checkpoint: ${checkpointStr.length} bytes`);
    console.log('[Processing State Manager] 📋 Checkpoint structure:', {
      totalPages: checkpoint.totalPages,
      scannedPages: checkpoint.scannedPages,
      totalMedia: checkpoint.totalMedia,
      filesCount: checkpoint.files?.length || 0,
      status: checkpoint.status,
    });

    return saveCheckpointFile(CHECKPOINTS.SCANNING, checkpoint);
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
    if (updatedProgress.totalPages && updatedProgress.scannedPages) {
      if (updatedProgress.scannedPages > updatedProgress.totalPages) {
        updatedProgress.scannedPages = updatedProgress.totalPages;
      }
      if (updatedProgress.pendingPages && updatedProgress.pendingPages < 0) {
        updatedProgress.pendingPages = 0;
      }
    }
    await saveScanningCheckpointFile(updatedProgress);
    return updatedProgress;
  }

  async function isDiscoveryComplete() {
    const progress = await loadDiscoveryCheckpoint();
    return progress.status === 'completed';
  }

  async function clearCheckpoints() {
    try {
      await clearCheckpoint(CHECKPOINTS.DISCOVERY);
      await clearCheckpoint(CHECKPOINTS.SCANNING);
      await clearCheckpoint(CHECKPOINTS.UPLOAD);
      state.cache.clear();
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to clear checkpoints:', error);
      return false;
    }
  }
  async function clearDiscoveryCheckpoint() {
    return clearCheckpoint(CHECKPOINTS.DISCOVERY);
  }
  async function clearScanningCheckpoint() {
    try {
      await clearCheckpoint(CHECKPOINTS.SCANNING);
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to clear scanning checkpoint:', error);
      return false;
    }
  }
  async function saveSiteStructureFile(siteStructure) {
    try {
      const daConfig = state.daApi.getConfig();
      const filePath = DA_PATHS.getSiteStructureFile(daConfig.org, daConfig.repo);
      const data = {
        ...siteStructure,
        lastUpdated: Date.now(),
      };
      const sheetData = buildSingleSheet(data);
      const url = `${daConfig.baseUrl}/source${filePath}`;
      await saveSheetFile(url, sheetData, daConfig.token);
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to save site structure:', error);
      return false;
    }
  }
  async function loadSiteStructureFile() {
    try {
      const daConfig = state.daApi.getConfig();
      if (!daConfig || !daConfig.token) {
        throw new Error('Invalid configuration: token is missing from DA API');
      }
      const filePath = DA_PATHS.getSiteStructureFile(daConfig.org, daConfig.repo);
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${filePath}`;
      const parsedData = await loadData(contentUrl, daConfig.token);
      if (parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
        return parsedData.data[0];
      }
      return null;
    } catch (error) {
      return null;
    }
  }
  async function clearSiteStructureFile() {
    try {
      const daConfig = state.daApi.getConfig();
      const filePath = DA_PATHS.getSiteStructureFile(daConfig.org, daConfig.repo);
      const url = `${daConfig.baseUrl}/source${filePath}`;
      await state.daApi.deleteFile(url);
      return true;
    } catch (error) {
      console.error('[Processing State Manager] ❌ Failed to clear site structure:', error);
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
          totalItems: 0,
          uploadedItems: 0,
          totalBatches: 0,
          completedBatches: 0,
          failedBatches: 0,
          status: 'idle',
          progress: 0,
          lastUpdated: null,
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
    saveDiscoveryCheckpointFile,
    saveScanningCheckpointFile,
    updateDiscoveryProgress,
    updateScanningProgress,
    isDiscoveryComplete,
    clearCheckpoints,
    clearDiscoveryCheckpoint,
    clearScanningCheckpoint,
    saveSiteStructureFile,
    loadSiteStructureFile,
    clearSiteStructureFile,
    getProcessingStats,
    clearCache,
    on,
    off,
    emit,
    markFolderComplete,
    queueFolderDiscoveryUpdate,
    getPendingUpdates,
    clearPendingUpdates,
    getDiscoveryCheckpointPath,
    confirmSaveWithListAPI,
  };
}