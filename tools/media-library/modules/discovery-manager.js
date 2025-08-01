/* eslint-disable no-use-before-define, no-console */
/**
 * Discovery Manager
 * Coordinates parallel folder discovery workers for optimal document discovery performance
 */

import {
  loadData,
  buildSingleSheet,
  saveSheetFile,
} from './sheet-utils.js';
import { CONTENT_DA_LIVE_BASE } from '../constants.js';
import createPersistenceManager from '../services/persistence-manager.js';

function createDiscoveryManager() {
  const state = {
    apiConfig: null,
    daApi: null,
    sessionManager: null,
    processingStateManager: null,
    scanStatusManager: null,
    currentSessionId: null,
    currentUserId: null,
    currentBrowserId: null,
    isActive: false,
    isStopping: false,
    isRunning: false,
    maxWorkers: 4,
    progressUpdateInterval: 2000,
    lastProgressUpdate: 0,
    expectedWorkers: 0,
    completedWorkers: 0,
    discoveryCompleteEmitted: false,
    discoveryStartTime: 0,
    scanningStarted: false,
    folderWorkers: new Map(),
    excludedFolders: [],
    stats: {
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      errors: 0,
    },
    listeners: new Map(),
    activeWorkers: new Map(),
    isDiscoveryActive: false,
    discoveryCheckpointStartTime: null,
    pendingCheckpointUpdates: [],
  };
  async function init(
    docAuthoringService,
    sessionManagerInstance,
    processingStateManagerInstance,
  ) {
    try {
      state.daApi = docAuthoringService;
      state.apiConfig = docAuthoringService.getConfig();
      state.processingStateManager = processingStateManagerInstance;
      state.isInitialized = true;
    } catch (error) {
      console.error('[Discovery Manager] ❌ Initialization failed:', error);
      throw error;
    }
  }
  async function loadDiscoveryCheckpoint(forceRescan = false) {
    try {
      const checkpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
      let discoveryType = 'full';
      if (!forceRescan && checkpoint.status === 'completed') {
        discoveryType = 'incremental';
      }
      console.log('[Discovery Manager] 🔍 Checkpoint analysis:', {
        forceRescan,
        checkpointStatus: checkpoint.status,
        discoveryType,
        timestamp: new Date().toISOString(),
      });
      return {
        discoveryType,
        checkpoint,
      };
    } catch (error) {
      return {
        discoveryType: 'full',
        checkpoint: {
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: 0,
          status: 'idle',
          folderStatus: {},
          excludedFoldersCount: 0,
          excludedPatterns: [],
          lastUpdated: null,
          discoveryStats: {
            totalFoldersInSystem: 0,
            totalFoldersForDiscovery: 0,
            excludedFoldersCount: 0,
            totalDocuments: 0,
            rootFilesCount: 0,
          },
          folderStructure: {},
          excludedFolders: [],
          rootFiles: [],
        },
      };
    }
  }
  async function saveDiscoveryCheckpointFile(checkpoint) {
    try {
      const checkpointData = checkpoint.checkpoint || checkpoint;
      await state.processingStateManager.saveDiscoveryCheckpointFile(checkpointData);
    } catch (error) {
      console.error('[Discovery Manager] ❌ Failed to save discovery checkpoint:', error);
      throw error;
    }
  }
  async function loadExistingDiscoveryFile(folderPath) {
    try {
      const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
      const fileName = `${folderName}.json`;
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
      const fileUrl = `${CONTENT_DA_LIVE_BASE}${filePath}`;
      const parsedData = await loadData(fileUrl, state.apiConfig.token);
      return parsedData.data || [];
    } catch (error) {
      return [];
    }
  }
  function mergeDiscoveryData(existingEntries, currentEntries) {
    const existingMap = new Map();
    const merged = [];
    const changes = {
      created: [],
      updated: [],
      deleted: [],
      unchanged: [],
    };
    existingEntries.forEach((entry) => {
      existingMap.set(entry.path, entry);
    });
    currentEntries.forEach((currentEntry) => {
      const currentPath = `${currentEntry.folderPath || ''}/${currentEntry.name}.${currentEntry.ext}`;
      const existingEntry = existingMap.get(currentPath);
      if (existingEntry) {
        if (currentEntry.lastModified > existingEntry.lastModified) {
          const updatedEntry = {
            ...existingEntry,
            lastModified: currentEntry.lastModified,
            discoveredAt: new Date().toISOString(),
            scanComplete: false,
            needsRescan: true,
            lastScanned: '',
            mediaCount: 0,
            scanStatus: 'pending',
            lastScannedAt: '',
            scanAttempts: 0,
            scanErrors: [],
            entryStatus: 'updated',
          };
          merged.push(updatedEntry);
          changes.updated.push(currentPath);
        } else {
          merged.push({
            ...existingEntry,
            entryStatus: 'unchanged',
          });
          changes.unchanged.push(currentPath);
        }
        existingMap.delete(currentPath);
      } else {
        const newEntry = {
          path: currentPath,
          name: currentEntry.name,
          ext: currentEntry.ext,
          lastModified: currentEntry.lastModified,
          discoveredAt: new Date().toISOString(),
          discoveryComplete: true,
          scanComplete: false,
          needsRescan: true,
          lastScanned: '',
          mediaCount: 0,
          scanStatus: 'pending',
          lastScannedAt: '',
          scanAttempts: 0,
          scanErrors: [],
          entryStatus: 'new',
        };
        merged.push(newEntry);
        changes.created.push(currentPath);
      }
    });
    existingMap.forEach((existingEntry) => {
      const deletedEntry = {
        ...existingEntry,
        entryStatus: 'deleted',
        deletedAt: new Date().toISOString(),
      };
      merged.push(deletedEntry);
      changes.deleted.push(existingEntry.path);
    });
    return { merged, changes };
  }

  function applyFolderDiscoveryUpdate(checkpoint, update) {
    if (update.type === 'markFolderComplete') {
      const folderStatus = checkpoint.folderStatus || {};
      const updatedFolderStatus = {
        ...folderStatus,
        [update.folderName]: {
          status: 'completed',
          completedAt: update.timestamp,
          documentCount: update.documentCount,
          discoveryFile: update.discoveryFile,
        },
      };
      const completedFolders = Object.values(updatedFolderStatus).filter(
        (folder) => folder.status === 'completed',
      ).length;
      const { totalFolders } = checkpoint;
      const totalDocuments = Object.values(updatedFolderStatus).reduce(
        (sum, folder) => sum + (folder.documentCount || 0),
        0,
      );
      return {
        ...checkpoint,
        status: checkpoint.status || 'running',
        folderStatus: updatedFolderStatus,
        totalFolders,
        completedFolders,
        totalDocuments,
        lastUpdated: update.timestamp,
      };
    }
    if (update.type === 'updateDiscoveryProgress') {
      const mergedUpdates = { ...update.updates };
      return {
        ...checkpoint,
        status: checkpoint.status || 'running',
        ...mergedUpdates,
        lastUpdated: update.timestamp,
      };
    }
    if (update.type === 'discoveryComplete') {
      return {
        ...checkpoint,
        status: 'completed',
        totalFolders: update.stats.totalFolders,
        completedFolders: update.stats.completedFolders,
        totalDocuments: update.stats.totalDocuments,
        excludedFolders: update.stats.excludedFolders,
        excludedPatterns: update.stats.excludedPatterns,
        completedAt: update.timestamp,
        lastUpdated: update.timestamp,
        folderStatus: checkpoint.folderStatus || {},
      };
    }
    return checkpoint;
  }

  async function updateDiscoveryCheckpoint(update) {
    if (state.isDiscoveryActive) {
      state.pendingCheckpointUpdates.push(update);
      const timeDiff = state.discoveryCheckpointStartTime
        ? Date.now() - state.discoveryCheckpointStartTime
        : 0;
      const shouldProcessFallback = state.pendingCheckpointUpdates.length >= 20
          || timeDiff > 5 * 60 * 1000;
      if (shouldProcessFallback) {
        await processAllPendingCheckpointUpdates();
      }
      return;
    }

    const checkpoint = await loadDiscoveryCheckpoint();
    const updatedCheckpoint = applyFolderDiscoveryUpdate(checkpoint, update);
    await saveDiscoveryCheckpointFile(updatedCheckpoint);
  }

  async function processAllPendingCheckpointUpdates() {
    if (state.pendingCheckpointUpdates.length === 0) {
      return;
    }
    const initialCheckpoint = await loadDiscoveryCheckpoint();
    const updatedCheckpoint = state.pendingCheckpointUpdates.reduce(
      (checkpoint, update) => applyFolderDiscoveryUpdate(checkpoint, update),
      initialCheckpoint,
    );
    await saveDiscoveryCheckpointFile(updatedCheckpoint);
    state.pendingCheckpointUpdates = [];
  }

  function setDiscoveryActive(active) {
    state.isDiscoveryActive = active;
    if (active) {
      state.discoveryCheckpointStartTime = Date.now();
    } else {
      state.discoveryCheckpointStartTime = null;
    }
  }

  /**
     * Add event listener
     */
  function on(event, callback) {
    if (!state.listeners.has(event)) {
      state.listeners.set(event, []);
    }
    state.listeners.get(event).push(callback);
  }

  /**
     * Remove event listener
     */
  function off(event, callback) {
    const callbacks = state.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
     * Emit event to listeners
     */
  function emit(event, data) {
    const callbacks = state.listeners.get(event);

    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[Discovery Manager] ❌ Error in event listener:', error);
        }
      });
    } else {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] ⚠️ No listeners for event:', event);
    }
  }

  /**
     * Reset statistics
     */
  function resetStats() {
    state.stats = {
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      errors: 0,
    };
  }

  /**
     * Get current statistics
     */
  function getStats() {
    return { ...state.stats };
  }

  /**
     * Cleanup worker resources
     */
  function cleanup(workerId) {
    const workerInfo = state.folderWorkers.get(workerId);
    if (workerInfo) {
      workerInfo.worker.terminate();
      state.folderWorkers.delete(workerId);
    }
  }

  function cleanupDiscovery() {
    if (state.discoveryTimeout) {
      clearTimeout(state.discoveryTimeout);
      state.discoveryTimeout = null;
    }
    state.isRunning = false;
    state.discoveryCompleteEmitted = false;
  }

  /**
     * Reset discovery state for new scan
     */
  async function resetDiscoveryState() {
    state.isActive = false;
    state.isStopping = false;
    state.isRunning = false;
    state.discoveryCompleteEmitted = false;
    state.scanningStarted = false;
    state.folderWorkers.clear();
    state.excludedFolders = [];
    resetStats();
    localStorage.removeItem('discovery-folder-status');
    localStorage.removeItem('discovery-excluded-data');
    localStorage.removeItem('media-discovery-checkpoint');
    localStorage.removeItem('media-discovery-progress');
    localStorage.removeItem('media-scanning-checkpoint');
    console.log('[Discovery Manager] 🧹 Cleared all localStorage discovery data');
    try {
      const persistenceManager = createPersistenceManager();
      await persistenceManager.init();
      await persistenceManager.clearAll();
      console.log('[Discovery Manager] 🗄️ Cleared all IndexedDB data');
    } catch (error) {
      console.warn('[Discovery Manager] ⚠️ Failed to clear IndexedDB:', error.message);
    }
  }

  /**
     * Utility functions
     */
  function createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
     * Throttled progress update to reduce excessive state saves
     */
  async function updateProgressThrottled() {
    const now = Date.now();
    if (now - state.lastProgressUpdate < state.progressUpdateInterval) {
      return;
    }

    state.lastProgressUpdate = now;

    // Don't update progress if discovery is already complete
    if (state.discoveryCompleteEmitted) {
      return;
    }

    // Update processing state manager
    if (state.processingStateManager && state.currentSessionId) {
      await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
        totalFolders: state.stats.totalFolders,
        completedFolders: state.stats.completedFolders,
        totalDocuments: state.stats.totalDocuments,
        status: state.isRunning ? 'running' : 'completed',
      });
    }
  }

  async function validateDiscoveryFilesComplete() {
    try {
      const folderStatus = JSON.parse(localStorage.getItem('discovery-folder-status') || '{}');
      const expectedFiles = [];
      const actualFiles = [];
      const missingFiles = [];
      const extraFiles = [];
      const pagesFolderPath = '.media/.pages';
      console.log('[Discovery Manager] 🔍 Validation - Checking path:', pagesFolderPath);
      const files = await state.daApi.listPath(pagesFolderPath);
      console.log('[Discovery Manager] 🔍 Validation - ListPath result:', {
        hasFiles: !!files,
        hasData: !!(files && files.data),
        dataLength: files?.data?.length || 0,
        allFiles: files?.data?.map((f) => ({ name: f.name, ext: f.ext })) || [],
      });
      if (files && files.data) {
        files.data.forEach((file) => {
          if (file.ext === 'json' && file.name !== 'discovery-checkpoint' && file.name !== 'site-structure') {
            actualFiles.push(file.name);
          }
        });
      }
      console.log('[Discovery Manager] 🔍 Validation - Folder status:', folderStatus);
      Object.entries(folderStatus).forEach(([, status]) => {
        if (status.discoveryFile) {
          const expectedFileName = status.discoveryFile.replace('.json', '');
          expectedFiles.push(expectedFileName);
        }
      });
      console.log('[Discovery Manager] 🔍 Validation - Expected files:', expectedFiles);
      console.log('[Discovery Manager] 🔍 Validation - Actual files found:', actualFiles);
      if (actualFiles.length === 0 && expectedFiles.length > 0) {
        console.log('[Discovery Manager] 🔍 Validation - Trying fallback: checking files directly...');
        const fallbackChecks = await Promise.all(
          expectedFiles.map(async (fileName) => {
            try {
              const fileUrl = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}.json`;
              const fileData = await loadData(fileUrl, state.apiConfig.token);
              return {
                fileName,
                exists: !!fileData,
                hasData: !!(fileData && fileData.data),
              };
            } catch (error) {
              return { fileName, exists: false, error: error.message };
            }
          }),
        );
        console.log('[Discovery Manager] 🔍 Validation - Fallback results:', fallbackChecks);
        const existingFiles = fallbackChecks
          .filter((check) => check.exists)
          .map((check) => check.fileName);
        actualFiles.push(...existingFiles);
        console.log('[Discovery Manager] 🔍 Validation - Updated actual files:', actualFiles);
      }
      expectedFiles.forEach((expectedFile) => {
        if (!actualFiles.includes(expectedFile)) {
          missingFiles.push(expectedFile);
        }
      });
      actualFiles.forEach((actualFile) => {
        if (!expectedFiles.includes(actualFile)) {
          extraFiles.push(actualFile);
        }
      });
      const validationResult = {
        isValid: missingFiles.length === 0,
        expectedCount: expectedFiles.length,
        actualCount: actualFiles.length,
        missingFiles,
        extraFiles,
        expectedFiles,
        actualFiles,
      };
      if (!validationResult.isValid) {
        console.warn('[Discovery Manager] ⚠️ Discovery files validation failed:', validationResult);
      } else {
        console.log('[Discovery Manager] ✅ All discovery files present:', {
          expectedCount: validationResult.expectedCount,
          actualCount: validationResult.actualCount,
        });
      }
      return validationResult;
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error validating discovery files:', error);
      return {
        isValid: false,
        error: error.message,
      };
    }
  }

  async function triggerDiscoveryComplete() {
    try {
      if (state.discoveryCompleteEmitted) {
        return;
      }
      state.discoveryCompleteEmitted = true;
      const folderStatus = JSON.parse(localStorage.getItem('discovery-folder-status') || '{}');
      const excludedData = JSON.parse(localStorage.getItem('discovery-excluded-data') || '{"excludedFolders": 0, "excludedPatterns": []}');
      const rootFiles = await getExistingRootFiles();
      const actualExcludedFolders = (state.excludedFolders || []).map((f) => (typeof f === 'string' ? { path: f, exclusionReason: '' } : f));
      const finalCheckpoint = {
        org: state.apiConfig.org,
        repo: state.apiConfig.repo,
        status: 'completed',
        totalFolders: state.stats.totalFolders,
        completedFolders: state.stats.completedFolders,
        totalDocuments: state.stats.totalDocuments,
        folderStatus: Object.keys(folderStatus).reduce((acc, key) => {
          if (key.startsWith('/')) {
            acc[key] = {
              status: folderStatus[key].status || 'completed',
              completedAt: folderStatus[key].completedAt || Date.now(),
              documentCount: folderStatus[key].documentCount || 0,
              discoveryFile: folderStatus[key].discoveryFile || `${key.split('/').pop() || 'root'}.json`,
            };
          }
          return acc;
        }, {}),
        excludedPatterns: excludedData.excludedPatterns,
        rootFiles: rootFiles.map((file) => ({
          name: file.name,
          ext: file.ext,
          lastModified: file.lastModified,
          path: file.path,
        })),
        lastUpdated: Date.now(),
      };
      await saveDiscoveryCheckpointFile(finalCheckpoint);
      if (state.processingStateManager && state.currentSessionId) {
        await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
          totalFolders: state.stats.totalFolders,
          completedFolders: state.stats.completedFolders,
          totalDocuments: state.stats.totalDocuments,
          status: 'completed',
          completedAt: Date.now(),
        });
      }
      if (state.discoveryType === 'full') {
        console.log('[Discovery Manager] 🔍 Starting site structure creation process...');
        const validationResult = await validateDiscoveryFilesComplete();
        console.log('[Discovery Manager] 📊 Validation result:', validationResult);
        if (validationResult.isValid) {
          console.log('[Discovery Manager] ⏳ Waiting for discovery files to be fully available...');
          await new Promise((resolvePromise) => {
            setTimeout(() => resolvePromise(), 3000);
          });
          const retryValidation = await validateDiscoveryFilesComplete();
          console.log('[Discovery Manager] 📊 Retry validation result:', retryValidation);
          if (retryValidation.isValid) {
            console.log('[Discovery Manager] 🚀 Creating site structure...');
            await createSiteStructure();
            console.log('[Discovery Manager] ✅ Site structure creation completed');
          } else {
            console.warn('[Discovery Manager] ⚠️ Discovery files still not available after retry');
          }
        } else {
          console.warn('[Discovery Manager] ⚠️ Skipping site structure creation due to missing discovery files');
        }
      } else {
        console.log('[Discovery Manager] ℹ️ Skipping site structure creation - not full discovery type');
      }
      emit('discoveryComplete', {
        stats: state.stats,
        sessionId: state.currentSessionId,
        discoveryType: state.discoveryType,
        checkpoint: finalCheckpoint,
      });
      const discoveryEndTime = Date.now();
      const discoveryDuration = discoveryEndTime - state.discoveryStartTime;
      const discoveryDurationSeconds = Math.round(discoveryDuration / 1000);
      console.log('[Discovery Manager] ✅ Discovery completed:', {
        totalFolders: state.stats.totalFolders,
        completedFolders: state.stats.completedFolders,
        totalDocuments: state.stats.totalDocuments,
        totalFoldersInSystem: state.stats.totalFolders + actualExcludedFolders.length,
        excludedFoldersCount: actualExcludedFolders.length,
        discoveryType: state.discoveryType,
        durationMs: discoveryDuration,
        durationSeconds: discoveryDurationSeconds,
      });
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error triggering discovery complete:', error);
    }
  }

  /**
     * Get top-level folders and HTML files for processing
     */
  async function getTopLevelItems() {
    try {
      if (!state.daApi) {
        throw new Error('DA API service not initialized');
      }
      const items = await state.daApi.listPath('/');
      const excludePatterns = [];
      try {
        const configUrl = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/.media/config.json`;
        const parsedConfig = await loadData(configUrl, state.apiConfig.token);
        if (parsedConfig && parsedConfig.data && Array.isArray(parsedConfig.data)) {
          parsedConfig.data.forEach((row) => {
            if (row.key === 'excludes' && typeof row.value === 'string') {
              const patterns = row.value.split(',').map((s) => s.trim()).filter(Boolean);
              excludePatterns.push(...patterns);
            }
          });
        }
        localStorage.setItem('discovery-excluded-data', JSON.stringify({
          excludedFolders: excludePatterns.length,
          excludedPatterns: excludePatterns,
        }));
      } catch (e) {
        console.error('[Discovery Manager] Failed to load exclusion patterns:', e);
      }
      const matchesExcludePatterns = (path, patterns) => {
        const result = patterns.some((pattern) => {
          const pathParts = path.split('/');
          if (pathParts.length >= 3) {
            const org = pathParts[1];
            const repo = pathParts[2];
            const orgRepoPrefix = `/${org}/${repo}`;
            if (pattern.endsWith('/*')) {
              const patternWithoutWildcard = pattern.slice(0, -1);
              const fullPattern = `${orgRepoPrefix}${patternWithoutWildcard}`;
              const matches = path.startsWith(fullPattern) || path === fullPattern.slice(0, -1);
              return matches;
            }
            const matches = path === `${orgRepoPrefix}${pattern}`;
            return matches;
          }
          return false;
        });
        return result;
      };
      const excludedFolders = items
        .filter((item) => (item.ext === undefined || item.ext === null || item.ext === '') && matchesExcludePatterns(item.path, excludePatterns))
        .map((item) => ({
          path: item.path.replace(`/${state.apiConfig.org}/${state.apiConfig.repo}`, ''),
          lastModified: item.lastModified,
          excludedBy: excludePatterns.find((pattern) => {
            const orgRepoPrefix = `/${state.apiConfig.org}/${state.apiConfig.repo}`;
            const fullPattern = `${orgRepoPrefix}${pattern}`;
            return (
              item.path.startsWith(fullPattern.slice(0, -1))
              || item.path === fullPattern.slice(0, -1)
            );
          }),
          fileCount: 0,
          subfolderCount: 0,
        }));
      state.excludedFolders.push(...excludedFolders);
      console.log('[Discovery Manager] 📁 Collected excluded folders:', excludedFolders.length);
      const folders = items
        .filter((item) => (item.ext === undefined || item.ext === null || item.ext === '') && !matchesExcludePatterns(item.path, excludePatterns))
        .map((item) => ({
          path: item.path,
        }));
      const files = items
        .filter((item) => item.ext && item.ext === 'html' && !matchesExcludePatterns(item.path, excludePatterns))
        .map((item) => ({
          name: item.name,
          ext: item.ext,
          path: item.path,
          lastModified: item.lastModified,
        }));
      return { folders, files };
    } catch (error) {
      console.error('[Discovery Manager] Failed to get top-level items:', error);
      if (error.message.includes('DA API not available') || error.message.includes('DA API service not initialized')) {
        return { folders: [], files: [] };
      }
      return { folders: [], files: [] };
    }
  }

  /**
     * Get existing root files from .pages directory
     */
  async function getExistingRootFiles() {
    try {
      if (!state.daApi) {
        throw new Error('DA API service not initialized');
      }
      const items = await state.daApi.listPath('/');
      const rootFiles = items.filter((item) => item.name && item.ext === 'html');
      return rootFiles.map((file) => ({
        name: file.name,
        ext: file.ext,
        lastModified: file.lastModified || Date.now(),
        path: file.path,
      }));
    } catch (error) {
      console.error('[Discovery Manager] Failed to get existing root files:', error);
      return [];
    }
  }

  /**
     * Process HTML files in the root directory
     */
  async function processRootFiles(files) {
    try {
      if (files && files.length > 0) {
        state.stats.totalFolders += 1;
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
            totalFolders: state.stats.totalFolders,
            completedFolders: state.stats.completedFolders,
            status: 'running',
          });
        }
        const documentsToSave = files.map((file) => ({
          name: file.name,
          ext: file.ext,
          path: file.path,
          lastModified: file.lastModified || Date.now(),
          scanStatus: 'pending',
          scanComplete: false,
          needsRescan: false,
          lastScannedAt: null,
          scanAttempts: 0,
          scanErrors: [],
          mediaCount: 0,
        }));
        const jsonToWrite = buildSingleSheet(documentsToSave);
        const fileName = 'root.json';
        const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
        const url = `${state.apiConfig.baseUrl}/source${filePath}`;
        await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
        const folderStatus = JSON.parse(localStorage.getItem('discovery-folder-status') || '{}');
        folderStatus['/'] = {
          status: 'completed',
          completedAt: Date.now(),
          documentCount: documentsToSave.length,
          discoveryFile: fileName,
          folderStructure: {
            '/': {
              path: '/',
              lastModified: Date.now(),
              files,
              subfolders: {},
            },
          },
        };
        localStorage.setItem('discovery-folder-status', JSON.stringify(folderStatus));
        await updateDiscoveryCheckpoint({
          type: 'markFolderComplete',
          folderName: 'root',
          documentCount: documentsToSave.length,
          discoveryFile: fileName,
          folderStructure: {
            '/': {
              path: '/',
              lastModified: Date.now(),
              files,
              subfolders: {},
            },
          },
          timestamp: Date.now(),
        });
        emit('documentsDiscovered', {
          documents: documentsToSave,
          folder: '/',
        });
        emit('folderComplete', {
          documentCount: documentsToSave.length,
          documents: documentsToSave,
          folderPath: '/',
          workerId: 'root',
          stats: state.stats,
        });
        state.stats.completedFolders += 1;
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
            totalFolders: state.stats.totalFolders,
            completedFolders: state.stats.completedFolders,
            totalDocuments: state.stats.totalDocuments,
          });
        }
        if (state.currentSessionId && !state.scanningStarted) {
          state.scanningStarted = true;
          const rootFilePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
          emit('firstDiscoveryFileReady', {
            discoveryFile: rootFilePath,
            sessionId: state.currentSessionId,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error processing root files:', error);
    }
  }

  /**
     * Process folders in parallel with immediate scanning
     */
  async function processFoldersInParallel(folders) {
    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] 🚀 Starting parallel folder processing:', {
      totalFolders: folders.length,
      maxWorkers: state.maxWorkers,
      discoveryWorkers: Math.min(folders.length, state.maxWorkers * 2),
      folderPaths: folders.map((f) => f.path),
    });

    const discoveryWorkers = Math.min(folders.length, state.maxWorkers * 2);
    const folderBatches = createBatches(folders, discoveryWorkers);

    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] 📦 Created folder batches:', {
      totalBatches: folderBatches.length,
      batchSizes: folderBatches.map((batch) => batch.length),
      batches: folderBatches.map((batch, index) => ({
        batchIndex: index,
        folders: batch.map((f) => f.path),
      })),
    });

    const batchPromises = folderBatches.map(async (batch, batchIndex) => {
      // eslint-disable-next-line no-console
      console.log(`[Discovery Manager] 🔄 Processing batch ${batchIndex + 1}/${folderBatches.length}:`, {
        batchSize: batch.length,
        folders: batch.map((f) => f.path),
      });

      const workerPromises = batch.map((folder) => {
        state.stats.totalFolders += 1;
        if (state.processingStateManager && state.currentSessionId) {
          state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
            totalFolders: state.stats.totalFolders,
            completedFolders: state.stats.completedFolders,
            status: 'running',
          });
        }
        return processFolder(folder);
      });
      return Promise.all(workerPromises);
    });

    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] ⏳ Waiting for all batch promises to complete...');
    await Promise.all(batchPromises);
    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] ✅ All batch promises completed');

    // Fallback: If all batch promises completed but discovery completion wasn't triggered,
    // check if we should trigger it now
    if (!state.discoveryCompleteEmitted && state.completedWorkers > 0) {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🔄 Fallback: All batches completed, checking discovery completion:', {
        completedWorkers: state.completedWorkers,
        expectedWorkers: state.expectedWorkers,
        totalFolders: state.stats.totalFolders,
        completedFolders: state.stats.completedFolders,
      });

      // If we have completed workers but discovery wasn't triggered, trigger it now
      if (state.completedWorkers > 0) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🎯 Fallback: Triggering discovery complete after batch completion');
        triggerDiscoveryComplete();
      }
    }
  }

  /**
     * Process a single folder with dedicated worker
     */
  async function processFolder(folder) {
    return new Promise((resolve, reject) => {
      const workerId = `worker_${folder.path.replace(/[/\\]/g, '_')}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const folderStartTime = Date.now();
      let worker;
      try {
        worker = new Worker('./workers/folder-discovery-worker.js', { type: 'module' });
      } catch (workerError) {
        reject(workerError);
        return;
      }
      state.folderWorkers.set(workerId, {
        worker,
        folder,
        startTime: folderStartTime,
      });
      worker.onmessage = async (event) => {
        const { type, data } = event.data;
        switch (type) {
          case 'initialized':
            worker.postMessage({
              type: 'discoverFolder',
              data: {
                folderPath: folder.path,
                workerId,
                discoveryType: state.discoveryType,
              },
            });
            break;
          case 'folderProgress':
            emit('folderProgress', {
              ...data,
              workerId,
              totalFolders: state.stats.totalFolders,
              completedFolders: state.stats.completedFolders,
            });
            break;
          case 'folderDiscoveryComplete': {
            state.stats.completedFolders += 1;
            state.stats.totalDocuments += data.documentCount;
            state.completedWorkers += 1;
            await updateProgressThrottled();
            let changeSummary = null;
            if (data.documents && data.documents.length > 0) {
              const folderName = folder.path === '/' ? 'root' : folder.path.split('/').pop() || 'root';
              const fileName = `${folderName}.json`;
              let documentsToSave = data.documents;
              if (state.discoveryType === 'incremental') {
                const existingEntries = await loadExistingDiscoveryFile(folder.path);
                const currentEntriesWithPath = data.documents.map((doc) => ({
                  ...doc,
                  folderPath: folder.path,
                }));
                const { merged, changes } = mergeDiscoveryData(
                  existingEntries,
                  currentEntriesWithPath,
                );
                documentsToSave = merged;
                changeSummary = changes;
                const changeSummaryText = `Created: ${changes.created.length}, Updated: ${changes.updated.length}, Deleted: ${changes.deleted.length}, Unchanged: ${changes.unchanged.length}`;
                console.log(`[Discovery Manager] 📊 Changes found in ${folder.path}: ${changeSummaryText}`);
                if (changes.deleted.length > 0) {
                  emit('pageDeleted', {
                    folderPath: folder.path,
                    deletedPaths: changes.deleted,
                  });
                }
              } else {
                documentsToSave = data.documents.map((doc) => ({
                  ...doc,
                  scanStatus: 'pending',
                  scanComplete: false,
                  needsRescan: false,
                  lastScannedAt: null,
                  scanAttempts: 0,
                  scanErrors: [],
                  mediaCount: 0,
                }));
              }
              const jsonToWrite = buildSingleSheet(documentsToSave);
              const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
              const url = `${state.apiConfig.baseUrl}/source${filePath}`;
              await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
              const folderStatus = JSON.parse(localStorage.getItem('discovery-folder-status') || '{}');
              folderStatus[folder.path] = {
                status: 'completed',
                completedAt: Date.now(),
                documentCount: documentsToSave.length,
                discoveryFile: fileName,
                folderStructure: data.folderStructure,
              };
              localStorage.setItem('discovery-folder-status', JSON.stringify(folderStatus));
              await updateDiscoveryCheckpoint({
                type: 'markFolderComplete',
                folderName,
                documentCount: documentsToSave.length,
                discoveryFile: fileName,
                timestamp: Date.now(),
              });
              emit('documentsDiscovered', {
                documents: documentsToSave,
                folder: folder.path,
              });
            }
            if (data.excludedFolders && Array.isArray(data.excludedFolders)) {
              state.excludedFolders.push(...data.excludedFolders);
            }
            emit('folderComplete', {
              ...data,
              folderPath: folder.path,
              workerId,
              stats: state.stats,
              changeSummary: changeSummary || null,
            });
            if (data.documents.length > 0) {
              if (changeSummary) {
                const changedDocuments = data.documents.filter((doc) => {
                  const isCreated = changeSummary.created.includes(doc.path);
                  const isUpdated = changeSummary.updated.includes(doc.path);
                  return isCreated || isUpdated;
                });
                if (changedDocuments.length > 0) {
                  emit('documentsChanged', {
                    documents: changedDocuments,
                    folder: folder.path,
                    changes: changeSummary,
                  });
                }
              }
            }
            cleanup(workerId);
            if (state.completedWorkers >= state.expectedWorkers
                && !state.discoveryCompleteEmitted
                && state.stats.completedFolders >= state.stats.totalFolders
            ) {
              await new Promise((resolvePromise) => {
                setTimeout(() => resolvePromise(), 2000);
              });
              const folderStatus = JSON.parse(localStorage.getItem('discovery-folder-status') || '{}');
              const excludedData = JSON.parse(localStorage.getItem('discovery-excluded-data') || '{"excludedFolders": 0, "excludedPatterns": []}');
              const folderStructure = {};
              Object.entries(folderStatus).forEach(([folderPath, status]) => {
                if (status.folderStructure) {
                  const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
                  folderStructure[folderName] = status.folderStructure;
                }
              });
              const rootFiles = await getExistingRootFiles();
              const actualExcludedFolders = (state.excludedFolders || []).map((f) => (typeof f === 'string' ? { path: f, exclusionReason: '' } : f));
              const finalCheckpoint = {
                org: state.apiConfig.org,
                repo: state.apiConfig.repo,
                totalFolders: state.stats.totalFolders,
                completedFolders: state.stats.completedFolders,
                totalDocuments: state.stats.totalDocuments,
                status: 'completed',
                excludedFolders: actualExcludedFolders,
                excludedPatterns: excludedData.excludedPatterns,
                folderStatus: Object.keys(folderStatus).reduce((acc, key) => {
                  if (key.startsWith('/')) {
                    acc[key] = folderStatus[key];
                  }
                  return acc;
                }, {}),
                discoveryStats: {
                  totalFoldersInSystem: state.stats.totalFolders + actualExcludedFolders.length,
                  totalFoldersForDiscovery: state.stats.totalFolders,
                  excludedFoldersCount: actualExcludedFolders.length,
                  totalDocuments: state.stats.totalDocuments,
                  rootFilesCount: rootFiles.length,
                },
                folderStructure,
                rootFiles,
                completedAt: Date.now(),
                lastUpdated: Date.now(),
              };
              await saveDiscoveryCheckpointFile(finalCheckpoint);
              triggerDiscoveryComplete();
            }
            resolve();
            break;
          }
          case 'folderDiscoveryError':
            state.stats.completedFolders += 1;
            state.completedWorkers += 1;
            await updateProgressThrottled();
            cleanup(workerId);
            if (state.completedWorkers >= state.expectedWorkers
                && !state.discoveryCompleteEmitted
                && state.stats.completedFolders >= state.stats.totalFolders
            ) {
              if (state.stats.completedFolders >= state.stats.totalFolders) {
                triggerDiscoveryComplete();
              }
            }
            reject(new Error(data.error));
            break;
          case 'error':
            state.stats.completedFolders += 1;
            state.completedWorkers += 1;
            await updateProgressThrottled();
            cleanup(workerId);
            if (state.completedWorkers >= state.expectedWorkers
                && !state.discoveryCompleteEmitted
                && state.stats.completedFolders >= state.stats.totalFolders
            ) {
              triggerDiscoveryComplete();
            }
            reject(new Error(data.error));
            break;
          default:
            break;
        }
      };
      worker.onerror = async (error) => {
        state.stats.completedFolders += 1;
        state.completedWorkers += 1;
        await updateProgressThrottled();
        cleanup(workerId);
        if (state.completedWorkers >= state.expectedWorkers && !state.discoveryCompleteEmitted) {
          if (state.stats.completedFolders >= state.stats.totalFolders) {
            triggerDiscoveryComplete();
          }
        }
        reject(error);
      };
      worker.postMessage({
        type: 'init',
        data: {
          apiConfig: state.apiConfig,
        },
      });
    });
  }

  /**
     * Start multi-threaded document discovery with session management
     */
  async function ensureRequiredFolders() {
    try {
      console.log('[Discovery Manager] 🔧 Ensuring required folders exist...');
      const requiredFolders = [
        '.media',
        '.media/.pages',
        '.media/.processing',
        '.media/.sessions',
      ];
      await Promise.all(requiredFolders.map((folder) => state.daApi.ensureFolder(folder)));
      console.log('[Discovery Manager] ✅ Required folders ensured');
    } catch (error) {
      console.warn('[Discovery Manager] ⚠️ Error ensuring folders:', error.message);
    }
  }

  async function startDiscoveryWithSession(sessionId, forceRescan = false) {
    await resetDiscoveryState();
    await ensureRequiredFolders();
    state.isRunning = true;
    resetStats();
    state.expectedWorkers = 0;
    state.completedWorkers = 0;
    state.discoveryCompleteEmitted = false;
    setDiscoveryActive(true);
    const discoveryStartTime = Date.now();
    state.discoveryStartTime = discoveryStartTime;
    try {
      const { discoveryType } = await loadDiscoveryCheckpoint(forceRescan);
      state.discoveryType = discoveryType;
      console.log('[Discovery Manager] 🔍 Discovery type determined:', {
        forceRescan,
        discoveryType,
        timestamp: new Date().toISOString(),
      });
      const { folders, files } = await getTopLevelItems();
      state.stats.totalFolders = 0;
      if (state.processingStateManager && sessionId) {
        await state.processingStateManager.updateDiscoveryProgress(sessionId, {
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: files.length,
          status: 'running',
          startTime: discoveryStartTime,
        });
      }
      state.lastProgressUpdate = 0;
      emit('discoveryStarted', {
        totalFolders: 0,
        maxWorkers: state.maxWorkers,
        sessionId,
        discoveryType,
        forceRescan,
      });
      const initialExcludedData = JSON.parse(localStorage.getItem('discovery-excluded-data') || '{"excludedFolders": 0, "excludedPatterns": []}');
      const actualExcludedFoldersCount = state.excludedFolders.length;
      const initialCheckpoint = {
        totalFolders: 0,
        completedFolders: 0,
        totalDocuments: files.length,
        status: 'running',
        excludedFolders: actualExcludedFoldersCount,
        excludedPatterns: initialExcludedData.excludedPatterns,
        folderStatus: {},
        startedAt: Date.now(),
        lastUpdated: Date.now(),
        discoveryStats: {
          totalFoldersInSystem: 0 + actualExcludedFoldersCount,
          totalFoldersForDiscovery: 0,
          excludedFoldersCount: actualExcludedFoldersCount,
          totalDocuments: files.length,
          rootFilesCount: files.length,
        },
        folderStructure: {},
        rootFiles: files.map((file) => ({
          name: file.name,
          ext: file.ext,
          lastModified: file.lastModified,
        })),
      };
      await saveDiscoveryCheckpointFile(initialCheckpoint);
      state.expectedWorkers = (files.length > 0 ? 1 : 0) + folders.length;
      if (files.length > 0) {
        await processRootFiles(files);
      }
      if (folders.length > 0) {
        await processFoldersInParallel(folders);
      }
    } catch (error) {
      state.isRunning = false;
      emit('discoveryError', { error: error.message, sessionId });
    }
  }

  /**
     * Stop all discovery workers
     */
  async function stopDiscovery() {
    if (!state.isRunning) {
      return;
    }

    cleanupDiscovery();

    state.folderWorkers.forEach((workerInfo, workerId) => {
      workerInfo.worker.postMessage({ type: 'stopDiscovery' });
      cleanup(workerId);
    });

    emit('discoveryStopped', { stats: state.stats });
  }

  /**
     * Pause discovery
     */
  async function pauseDiscovery(sessionId, userId) {
    if (!state.isRunning) {
      return;
    }
    state.isRunning = false;

    // Save checkpoint
    if (state.processingStateManager && sessionId) {
      await state.processingStateManager.saveDiscoveryCheckpointFile({
        currentStage: 'discovery',
        currentProgress: {
          totalFolders: state.stats.totalFolders,
          completedFolders: state.stats.completedFolders,
          totalDocuments: state.stats.totalDocuments,
        },
        status: 'paused',
      });
    }

    // Pause session
    if (state.sessionManager && sessionId) {
      await state.sessionManager.pauseSession(sessionId, userId);
    }

    emit('discoveryPaused', { sessionId, userId });
  }

  /**
     * Resume discovery
     */
  async function resumeDiscovery(sessionId, userId, pendingFolders) {
    state.currentSessionId = sessionId;
    state.currentUserId = userId;

    // Resume session
    if (state.sessionManager && sessionId) {
      await state.sessionManager.resumeSession(sessionId, userId);
    }

    // Load checkpoint
    if (state.processingStateManager && sessionId) {
      const checkpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
      if (checkpoint) {
        state.stats.totalFolders = checkpoint.currentProgress?.totalFolders || 0;
        state.stats.completedFolders = checkpoint.currentProgress?.completedFolders || 0;
        state.stats.totalDocuments = checkpoint.currentProgress?.totalDocuments || 0;
      }
    }

    // Continue with pending folders
    if (pendingFolders && pendingFolders.length > 0) {
      state.expectedWorkers = pendingFolders.length;
      await processFoldersInParallel(pendingFolders);
    } else {
      triggerDiscoveryComplete();
    }

    emit('discoveryResumed', { sessionId, userId });
  }

  /**
     * Calculate total page count from all discovery files
     */
  async function calculateTotalPageCount() {
    try {
      const items = await state.daApi.listPath('.media/.pages');
      const jsonFiles = items.filter((item) => item.name && item.ext === 'json');

      let totalCount = 0;

      // Use Promise.all to avoid await in loop
      const filePromises = jsonFiles.map(async (file) => {
        try {
          const fileUrl = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${file.name}.json`;

          const parsedData = await loadData(fileUrl, state.apiConfig.token);

          if (parsedData.data && parsedData.data.data) {
            return parsedData.data.data.length;
          } if (parsedData.data) {
            return parsedData.data.length;
          }
          return 0;
        } catch (fileError) {
          // eslint-disable-next-line no-console
          console.log('[Discovery Manager] ⚠️ Error reading file for count:', {
            fileName: file.name,
            error: fileError.message,
          });
          return 0;
        }
      });

      const fileCounts = await Promise.all(filePromises);
      totalCount = fileCounts.reduce((sum, count) => sum + count, 0);
      return totalCount;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] ⚠️ Could not calculate total page count, using fallback count:', state.stats.totalDocuments);
      return state.stats.totalDocuments;
    }
  }

  /**
     * Clear discovery queue and cleanup resources
     */
  async function clearQueue() {
    try {
      console.log('[Discovery Manager] 🧹 Clearing discovery queue...');

      if (state.folderWorkers.size > 0) {
        state.folderWorkers.forEach((workerInfo, workerId) => {
          workerInfo.worker.postMessage({ type: 'stopDiscovery' });
          cleanup(workerId);
        });
      }
      cleanupDiscovery();
      resetStats();
      console.log('[Discovery Manager] ✅ Discovery queue cleared successfully');
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error clearing discovery queue:', error);
    }
  }

  async function createSiteStructure() {
    try {
      const discoveryCheckpoint = await loadDiscoveryCheckpoint();
      if (!discoveryCheckpoint) {
        throw new Error('No discovery checkpoint found');
      }
      const siteStructure = {
        org: state.apiConfig.org,
        repo: state.apiConfig.repo,
        lastUpdated: Date.now(),
        version: '1.0',
        structure: {
          root: {
            path: '/',
            type: 'folder',
            files: [],
            subfolders: {},
          },
        },
        excluded: {
          folders: [],
          patterns: discoveryCheckpoint.excludedPatterns || [],
        },
        stats: {
          totalFolders: 0,
          totalFiles: 0,
          totalExcludedFolders: 0,
          totalMediaItems: 0,
          deepestNesting: 0,
        },
      };
      let totalFiles = 0;
      const excludedFolders = [];
      const pagesFolderPath = '.media/.pages';
      const files = await state.daApi.listPath(pagesFolderPath);
      let discoveryFiles = files?.data?.filter((file) => file.ext === 'json' && file.name !== 'discovery-checkpoint' && file.name !== 'site-structure') || [];
      console.log('[Discovery Manager] 🔍 Validation - Found files:', {
        totalFiles: files?.data?.length || 0,
        jsonFiles: files?.data?.filter((f) => f.ext === 'json').map((f) => f.name) || [],
        discoveryFiles: discoveryFiles.map((f) => f.name),
      });

      // Fallback: If listPath returns empty, try to get files from folderStatus
      if (discoveryFiles.length === 0) {
        console.log('[Discovery Manager] 🔍 Using fallback: getting files from folderStatus');
        const folderStatus = JSON.parse(localStorage.getItem('discovery-folder-status') || '{}');
        const expectedFiles = [];
        Object.entries(folderStatus).forEach(([, status]) => {
          if (status.discoveryFile) {
            const expectedFileName = status.discoveryFile.replace('.json', '');
            expectedFiles.push(expectedFileName);
          }
        });
        // Create discovery file objects from expected files
        discoveryFiles = expectedFiles.map((fileName) => ({
          name: fileName,
          ext: 'json',
          path: `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}.json`,
        }));
        console.log('[Discovery Manager] 🔍 Fallback discovery files:', discoveryFiles.map((f) => f.name));
      }
      const fileDataPromises = discoveryFiles.map(async (discoveryFile) => {
        const fileUrl = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${discoveryFile.name}.json`;
        console.log('[Discovery Manager] 🔗 Loading file:', fileUrl);
        const fileData = await loadData(fileUrl, state.apiConfig.token);
        console.log('[Discovery Manager] 📄 File loaded:', discoveryFile.name, {
          hasData: !!fileData,
          hasDataArray: !!(fileData && fileData.data),
          dataLength: fileData?.data?.length || 0,
          dataSample: fileData?.data?.[0] || null,
        });
        return { discoveryFile, fileData };
      });
      const fileDataResults = await Promise.all(fileDataPromises);
      console.log('[Discovery Manager] 📊 Processing discovery files:', {
        totalFiles: discoveryFiles.length,
        fileNames: discoveryFiles.map((f) => f.name),
      });
      fileDataResults.forEach(({ fileData }) => {
        if (fileData && fileData.data && Array.isArray(fileData.data)) {
          fileData.data.forEach((file) => {
            const fullPath = file.path;
            const pathWithoutOrgRepo = fullPath.replace(`/${state.apiConfig.org}/${state.apiConfig.repo}`, '');
            const pathParts = pathWithoutOrgRepo.split('/').filter((part) => part.length > 0);
            const fileName = pathParts[pathParts.length - 1];
            const isHtmlFile = fileName.endsWith('.html');
            if (isHtmlFile) {
              const fileInfo = {
                name: fileName.replace('.html', ''),
                ext: 'html',
                path: pathWithoutOrgRepo,
                lastModified: file.lastModified || Date.now(),
                mediaCount: file.mediaCount || 0,
              };
              if (pathParts.length === 1) {
                siteStructure.structure.root.files.push(fileInfo);
              } else {
                const folderPath = pathParts.slice(0, -1);
                let currentFolder = siteStructure.structure.root;
                folderPath.forEach((folderName) => {
                  if (!currentFolder.subfolders[folderName]) {
                    currentFolder.subfolders[folderName] = {
                      path: `/${folderPath.slice(0, folderPath.indexOf(folderName) + 1).join('/')}`,
                      type: 'folder',
                      excluded: false,
                      files: [],
                      subfolders: {},
                    };
                  }
                  currentFolder = currentFolder.subfolders[folderName];
                });
                currentFolder.files.push(fileInfo);
              }
              totalFiles += 1;
            }
          });
        }
      });
      const excludedPatterns = discoveryCheckpoint.excludedPatterns || [];
      excludedPatterns.forEach((pattern) => {
        const folderName = pattern.replace('/*', '').replace('/', '');
        const folderData = {
          path: `/${folderName}`,
          type: 'folder',
          excluded: true,
          exclusionReason: pattern,
          files: [],
          subfolders: {},
        };
        siteStructure.structure.root.subfolders[folderName] = folderData;
        excludedFolders.push({
          path: `/${folderName}`,
          exclusionReason: pattern,
        });
      });
      siteStructure.excluded.folders = excludedFolders;
      siteStructure.stats = {
        totalFolders: Object.keys(siteStructure.structure.root.subfolders).length,
        totalFiles,
        totalExcludedFolders: excludedFolders.length,
        totalMediaItems: 0,
        deepestNesting: 3,
      };
      await state.processingStateManager.saveSiteStructureFile(siteStructure);
      console.log('[Discovery Manager] ✅ Created site structure:', {
        totalFolders: siteStructure.stats.totalFolders,
        totalFiles: siteStructure.stats.totalFiles,
        version: siteStructure.version,
      });
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error creating site structure:', error);
      throw error;
    }
  }

  async function prepareIncrementalBaseline() {
    try {
      const currentStructure = await state.processingStateManager.loadSiteStructureFile();
      if (currentStructure) {
        await state.processingStateManager.saveStructureBaseline(currentStructure);
        console.log('[Discovery Manager] ✅ Baseline preserved for incremental comparison');
        return true;
      }
      console.log('[Discovery Manager] ℹ️ No existing site structure found - will perform full discovery');
      return false;
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error preparing incremental baseline:', error);
      return false;
    }
  }

  async function detectIncrementalChanges() {
    try {
      const baseline = await state.processingStateManager.loadStructureBaseline();
      if (!baseline) {
        return { type: 'full', reason: 'No baseline found' };
      }
      const currentStructure = await buildSiteStructureFromDiscoveryFiles();
      const changes = calculateStructuralChanges(baseline, currentStructure);
      if (changes.hasChanges) {
        console.log('[Discovery Manager] 📊 Incremental changes detected:', changes);
        return { type: 'incremental', changes };
      }
      console.log('[Discovery Manager] ℹ️ No structural changes detected');
      return { type: 'none', reason: 'No changes detected' };
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error detecting incremental changes:', error);
      return { type: 'full', reason: 'Error in change detection' };
    }
  }

  async function buildSiteStructureFromDiscoveryFiles() {
    try {
      const discoveryCheckpoint = await loadDiscoveryCheckpoint();
      if (!discoveryCheckpoint) {
        throw new Error('No discovery checkpoint found');
      }
      const siteStructure = {
        org: state.apiConfig.org,
        repo: state.apiConfig.repo,
        lastUpdated: Date.now(),
        version: '1.0',
        structure: {
          root: {
            path: '/',
            type: 'folder',
            files: [],
            subfolders: {},
          },
        },
        excluded: {
          folders: [],
          patterns: discoveryCheckpoint.excludedPatterns || [],
        },
        stats: {
          totalFolders: 0,
          totalFiles: 0,
          totalExcludedFolders: 0,
          totalMediaItems: 0,
          deepestNesting: 0,
        },
      };
      let totalFiles = 0;
      const excludedFolders = [];
      const pagesFolderPath = '.media/.pages';
      const files = await state.daApi.listPath(pagesFolderPath);
      const discoveryFiles = files?.data?.filter((file) => file.ext === 'json' && file.name !== 'discovery-checkpoint' && file.name !== 'site-structure') || [];
      const fileDataPromises = discoveryFiles.map(async (discoveryFile) => {
        const fileUrl = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${discoveryFile.name}.json`;
        const fileData = await loadData(fileUrl, state.apiConfig.token);
        return { discoveryFile, fileData };
      });
      const fileDataResults = await Promise.all(fileDataPromises);
      fileDataResults.forEach(({ discoveryFile, fileData }) => {
        if (fileData && fileData.data && Array.isArray(fileData.data)) {
          const folderName = discoveryFile.name === 'root' ? 'root' : discoveryFile.name;
          const folderPath = discoveryFile.name === 'root' ? '/' : `/${discoveryFile.name}`;
          const folderFiles = fileData.data.map((file) => ({
            name: file.name || file.path.split('/').pop().replace('.html', ''),
            ext: file.ext || 'html',
            path: file.path,
            lastModified: file.lastModified || Date.now(),
            mediaCount: file.mediaCount || 0,
          }));
          if (discoveryFile.name === 'root') {
            siteStructure.structure.root.files = folderFiles;
          } else {
            siteStructure.structure.root.subfolders[folderName] = {
              path: folderPath,
              type: 'folder',
              excluded: false,
              files: folderFiles,
              subfolders: {},
            };
          }
          totalFiles += folderFiles.length;
        }
      });
      const excludedPatterns = discoveryCheckpoint.excludedPatterns || [];
      excludedPatterns.forEach((pattern) => {
        const folderName = pattern.replace('/*', '').replace('/', '');
        const folderData = {
          path: `/${folderName}`,
          type: 'folder',
          excluded: true,
          exclusionReason: pattern,
          files: [],
          subfolders: {},
        };
        siteStructure.structure.root.subfolders[folderName] = folderData;
        excludedFolders.push({
          path: `/${folderName}`,
          exclusionReason: pattern,
        });
      });
      siteStructure.excluded.folders = excludedFolders;
      siteStructure.stats = {
        totalFolders: Object.keys(siteStructure.structure.root.subfolders).length,
        totalFiles,
        totalExcludedFolders: excludedFolders.length,
        totalMediaItems: 0,
        deepestNesting: 3,
      };
      return siteStructure;
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error building site structure from discovery files:', error);
      throw error;
    }
  }

  function calculateStructuralChanges(baseline, current) {
    const changes = {
      hasChanges: false,
      folders: {
        added: [],
        deleted: [],
        modified: [],
      },
      files: {
        added: [],
        deleted: [],
        modified: [],
      },
    };
    const baselineFolders = new Set(Object.keys(baseline.structure.root.subfolders || {}));
    const currentFolders = new Set(Object.keys(current.structure.root.subfolders || {}));
    const baselineFiles = new Map();
    const currentFiles = new Map();
    baseline.structure.root.files.forEach((file) => {
      baselineFiles.set(file.path, file);
    });
    current.structure.root.files.forEach((file) => {
      currentFiles.set(file.path, file);
    });
    baselineFolders.forEach((folder) => {
      if (!currentFolders.has(folder)) {
        changes.folders.deleted.push(folder);
        changes.hasChanges = true;
      }
    });
    currentFolders.forEach((folder) => {
      if (!baselineFolders.has(folder)) {
        changes.folders.added.push(folder);
        changes.hasChanges = true;
      }
    });
    baselineFiles.forEach((file, path) => {
      if (!currentFiles.has(path)) {
        changes.files.deleted.push(path);
        changes.hasChanges = true;
      } else {
        const currentFile = currentFiles.get(path);
        if (file.lastModified !== currentFile.lastModified) {
          changes.files.modified.push(path);
          changes.hasChanges = true;
        }
      }
    });
    currentFiles.forEach((file, path) => {
      if (!baselineFiles.has(path)) {
        changes.files.added.push(path);
        changes.hasChanges = true;
      }
    });
    return changes;
  }

  return {
    init,
    startDiscoveryWithSession,
    stopDiscovery,
    pauseDiscovery,
    resumeDiscovery,
    resetDiscoveryState,
    getStats,
    getTopLevelItems,
    getExistingRootFiles,
    calculateTotalPageCount,
    cleanup,
    cleanupDiscovery,
    clearQueue,
    resetStats,
    on,
    off,
    emit,
    updateDiscoveryCheckpoint,
    processAllPendingCheckpointUpdates,
    setDiscoveryActive,
    loadExistingDiscoveryFile,
    mergeDiscoveryData,
    createSiteStructure,
    validateDiscoveryFilesComplete,
    prepareIncrementalBaseline,
    detectIncrementalChanges,
    buildSiteStructureFromDiscoveryFiles,
    calculateStructuralChanges,
  };
}

export default createDiscoveryManager;
