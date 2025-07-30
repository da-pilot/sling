/* eslint-disable no-use-before-define, no-console */
/**
 * Discovery Manager
 * Coordinates parallel folder discovery workers for optimal document discovery performance
 */

import {
  buildSingleSheet,
  saveSheetFile,
  CONTENT_DA_LIVE_BASE,
  loadData,
} from './sheet-utils.js';

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
    maxWorkers: 4, // Default number of workers
    progressUpdateInterval: 2000, // Progress update interval
    lastProgressUpdate: 0,
    expectedWorkers: 0,
    completedWorkers: 0,
    discoveryCompleteEmitted: false,
    discoveryStartTime: 0,
    scanningStarted: false, // Track if scanning has started
    folderWorkers: new Map(),
    stats: {
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      errors: 0,
    },
    listeners: new Map(),
    activeWorkers: new Map(),
    // Checkpoint management
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

  async function loadDiscoveryCheckpoint() {
    try {
      const checkpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
      const discoveryType = checkpoint.status === 'completed' ? 'incremental' : 'full';
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
          excludedFolders: 0,
          excludedPatterns: [],
          lastUpdated: null,
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
      const existingEntry = existingMap.get(currentEntry.path);
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
          changes.updated.push(currentEntry.path);
        } else {
          merged.push({
            ...existingEntry,
            entryStatus: 'unchanged',
          });
          changes.unchanged.push(currentEntry.path);
        }
        existingMap.delete(currentEntry.path);
      } else {
        const newEntry = {
          path: currentEntry.path,
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
        changes.created.push(currentEntry.path);
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
      if (update.updates.totalDocuments !== undefined) {
        mergedUpdates.totalDocuments = update.updates.totalDocuments;
      }
      if (update.updates.completedFolders !== undefined) {
        mergedUpdates.completedFolders = update.updates.completedFolders;
      }
      if (update.updates.totalFolders !== undefined) {
        mergedUpdates.totalFolders = update.updates.totalFolders;
      }
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

  function updateDiscoveryHistory(checkpoint, discoveryType, changes) {
    const historyEntry = {
      discoveryId: `discovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startedAt: Date.now(),
      completedAt: Date.now(),
      type: discoveryType,
      changes,
    };

    const discoveryHistory = checkpoint.discoveryHistory || [];
    discoveryHistory.push(historyEntry);

    if (discoveryHistory.length > 10) {
      discoveryHistory.shift();
    }

    return {
      ...checkpoint,
      discoveryHistory,
      lastDiscoveryType: discoveryType,
      lastDiscoveryAt: Date.now(),
    };
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
  function resetDiscoveryState() {
    cleanupDiscovery();
    resetStats();
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

  /**
   * Trigger discovery complete when all workers finish
   */
  async function triggerDiscoveryComplete() {
    if (state.discoveryCompleteEmitted) {
      return;
    }

    state.discoveryCompleteEmitted = true;
    state.isRunning = false;

    const discoveryEndTime = Date.now();
    const discoveryDuration = discoveryEndTime - state.discoveryStartTime;

    const { totalDocuments } = state.stats;

    if (state.discoveryTimeout) {
      clearTimeout(state.discoveryTimeout);
      state.discoveryTimeout = null;
    }

    const excludedData = JSON.parse(localStorage.getItem('discovery-excluded-data') || '{"excludedFolders": 0, "excludedPatterns": []}');
    const folderStatus = JSON.parse(localStorage.getItem('discovery-folder-status') || '{}');

    const finalCheckpoint = {
      totalFolders: state.stats.totalFolders,
      completedFolders: state.stats.completedFolders,
      totalDocuments: state.stats.totalDocuments,
      status: 'completed',
      excludedFolders: excludedData.excludedFolders,
      excludedPatterns: excludedData.excludedPatterns,
      folderStatus: Object.keys(folderStatus).reduce((acc, key) => {
        if (key.startsWith('/')) {
          acc[key] = folderStatus[key];
        }
        return acc;
      }, {}),
      completedAt: Date.now(),
      lastUpdated: Date.now(),
    };

    console.log('[Discovery Manager] 🎯 Creating final discovery checkpoint in triggerDiscoveryComplete:', finalCheckpoint);
    await saveDiscoveryCheckpointFile(finalCheckpoint);

    if (state.sessionManager && state.currentSessionId) {
      state.sessionManager.updateSessionHeartbeat(state.currentSessionId, {
        currentStage: 'scanning',
        currentProgress: {
          totalFolders: state.stats.totalFolders,
          completedFolders: state.stats.completedFolders,
          totalDocuments,
        },
      }).catch((error) => {
        console.error('[Discovery Manager] ❌ Failed to update session heartbeat on completion:', error);
      });
    }

    emit('discoveryComplete', {
      stats: state.stats,
      totalDocuments,
      discoveryDuration,
      discoveryStartTime: state.discoveryStartTime,
      discoveryEndTime,
      sessionId: state.currentSessionId,
    });
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

      // Check if path matches exclude patterns
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

      const folders = items
        .filter((item) => !item.ext && !matchesExcludePatterns(item.path, excludePatterns))
        .map((item) => ({
          path: item.path,
        }));

      const files = items
        .filter((item) => item.ext === 'html' && !matchesExcludePatterns(item.path, excludePatterns))
        .map((item) => ({
          path: item.path,
          lastModified: item.lastModified,
        }));
      return { folders, files };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Discovery Manager] Failed to get top-level items:', error);

      // Return empty arrays if DA API is not available
      if (error.message.includes('DA API not available') || error.message.includes('DA API service not initialized')) {
        // eslint-disable-next-line no-console
        // console.log('[Discovery Manager] DA API not available, returning empty results');
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

      const items = await state.daApi.listPath('.media/.pages');
      const rootFiles = items.filter((item) => item.name && item.name.startsWith('root-') && item.name.endsWith('.json'));

      // Load the actual document data from the first root file found
      if (rootFiles.length > 0) {
        const rootFile = rootFiles[0];
        try {
          const fileUrl = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${rootFile.name}`;

          const parsedData = await loadData(fileUrl, state.apiConfig.token);

          // Handle both single-sheet and multi-sheet formats
          let documents;
          if (parsedData.data && parsedData.data.data) {
            documents = parsedData.data.data;
          } else if (parsedData.data) {
            documents = parsedData.data;
          } else {
            const sheetNames = Object.keys(parsedData);
            const firstSheet = sheetNames.find((name) => parsedData[name] && parsedData[name].data);
            if (firstSheet) {
              documents = parsedData[firstSheet].data;
            } else {
              documents = [];
            }
          }

          return [{
            name: rootFile.name,
            documents: documents || [],
          }];
        } catch (loadError) {
          console.warn('[Discovery Manager] Failed to load existing root file data:', loadError.message);
          return [];
        }
      }

      return [];
    } catch (error) {
      // eslint-disable-next-line no-console
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
        const existingRootFiles = await getExistingRootFiles();
        if (existingRootFiles.length > 0) {
          const existingFile = existingRootFiles[0];
          const existingDocuments = existingFile.documents || [];
          if (state.processingStateManager && state.currentSessionId) {
            await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
              totalFolders: state.stats.totalFolders,
              completedFolders: state.stats.completedFolders,
              totalDocuments: state.stats.totalDocuments,
            });
          }
          if (state.currentSessionId && !state.scanningStarted) {
            state.scanningStarted = true;
            const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${existingFile.name}`;
            emit('firstDiscoveryFileReady', {
              discoveryFile: filePath,
              sessionId: state.currentSessionId,
              timestamp: new Date().toISOString(),
            });
          }
          emit('documentsDiscovered', {
            documents: existingDocuments,
            folder: '/',
          });
          emit('folderComplete', {
            documentCount: existingDocuments.length,
            documents: existingDocuments,
            folderPath: '/',
            workerId: 'root',
            stats: state.stats,
          });
          state.stats.completedFolders += 1;
          state.stats.totalDocuments += existingDocuments.length;
          state.completedWorkers += 1;
          return;
        }
        const documentsWithMetadata = files.map((file) => ({
          path: file.path,
          lastModified: file.lastModified,
          discoveredAt: new Date().toISOString(),
          discoveryComplete: true,
          scanStatus: 'pending',
          scanComplete: false,
          needsRescan: false,
          lastScannedAt: null,
          scanAttempts: 0,
          scanErrors: [],
          mediaCount: 0,
        }));
        const jsonToWrite = buildSingleSheet(documentsWithMetadata);
        const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/root.json`;
        const url = `${state.apiConfig.baseUrl}/source${filePath}`;
        await state.daApi.ensureFolder(
          `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages`,
        );
        await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
        await updateDiscoveryCheckpoint({
          type: 'markFolderComplete',
          folderName: '/',
          documentCount: files.length,
          discoveryFile: 'root.json',
          timestamp: Date.now(),
        });
        await updateDiscoveryCheckpoint({
          type: 'updateDiscoveryProgress',
          updates: {
            totalFolders: state.stats.totalFolders,
            completedFolders: state.stats.completedFolders,
            totalDocuments: state.stats.totalDocuments,
          },
          timestamp: Date.now(),
        });
      }
      state.stats.completedFolders += 1;
      state.stats.totalDocuments += files?.length || 0;
      state.completedWorkers += 1;
      emit('documentsDiscovered', {
        documents: files || [],
        folder: '/',
      });
      emit('folderComplete', {
        documentCount: files?.length || 0,
        documents: files || [],
        folderPath: '/',
        workerId: 'root',
        stats: state.stats,
      });
    } catch (error) {
      state.stats.errors += 1;
      emit('folderError', {
        folderPath: '/',
        error: error.message,
        workerId: 'root',
      });
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
                const { merged, changes } = mergeDiscoveryData(existingEntries, data.documents);
                documentsToSave = merged;
                changeSummary = changes;
                console.log(`[Discovery Manager] 📊 Changes found in ${folder.path}: Created: ${changes.created.length}, Updated: ${changes.updated.length}, Deleted: ${changes.deleted.length}, Unchanged: ${changes.unchanged.length}`);
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
              await state.daApi.ensureFolder(
                `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages`,
              );
              await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
              const folderStatus = JSON.parse(localStorage.getItem('discovery-folder-status') || '{}');
              folderStatus[folder.path] = {
                status: 'completed',
                completedAt: Date.now(),
                documentCount: documentsToSave.length,
                discoveryFile: fileName,
              };
              localStorage.setItem('discovery-folder-status', JSON.stringify(folderStatus));
              await updateDiscoveryCheckpoint({
                type: 'markFolderComplete',
                folderName: folder.path,
                documentCount: documentsToSave.length,
                discoveryFile: fileName,
                timestamp: Date.now(),
              });
            }
            emit('folderComplete', {
              ...data,
              folderPath: folder.path,
              workerId,
              stats: state.stats,
              changeSummary: changeSummary || null,
            });
            if (data.documents.length > 0) {
              emit('documentsDiscovered', {
                documents: data.documents,
                folder: folder.path,
              });
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
              const finalCheckpoint = {
                totalFolders: state.stats.totalFolders,
                completedFolders: state.stats.completedFolders,
                totalDocuments: state.stats.totalDocuments,
                status: 'completed',
                excludedFolders: excludedData.excludedFolders,
                excludedPatterns: excludedData.excludedPatterns,
                folderStatus: Object.keys(folderStatus).reduce((acc, key) => {
                  if (key.startsWith('/')) {
                    acc[key] = folderStatus[key];
                  }
                  return acc;
                }, {}),
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
  async function startDiscoveryWithSession(sessionId) {
    resetDiscoveryState();
    state.isRunning = true;
    resetStats();
    state.expectedWorkers = 0;
    state.completedWorkers = 0;
    state.discoveryCompleteEmitted = false;
    setDiscoveryActive(true);
    const discoveryStartTime = Date.now();
    state.discoveryStartTime = discoveryStartTime;
    try {
      const { discoveryType } = await loadDiscoveryCheckpoint();
      state.discoveryType = discoveryType;
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
      });
      const initialExcludedData = JSON.parse(localStorage.getItem('discovery-excluded-data') || '{"excludedFolders": 0, "excludedPatterns": []}');
      const initialCheckpoint = {
        totalFolders: 0,
        completedFolders: 0,
        totalDocuments: files.length,
        status: 'running',
        excludedFolders: initialExcludedData.excludedFolders,
        excludedPatterns: initialExcludedData.excludedPatterns,
        folderStatus: {},
        startedAt: Date.now(),
        lastUpdated: Date.now(),
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
  async function getStructuralChanges() {
    try {
      const { folders, files } = await getTopLevelItems();
      const existingDiscoveryFiles = await getExistingRootFiles();
      const changes = {
        newFolders: [],
        deletedFolders: [],
        newFiles: [],
        deletedFiles: [],
        modifiedFiles: [],
      };
      const existingFolderPaths = new Set(existingDiscoveryFiles.map((file) => file.folderPath));
      const currentFolderPaths = new Set(folders.map((folder) => folder.path));
      folders.forEach((folder) => {
        if (!existingFolderPaths.has(folder.path)) {
          changes.newFolders.push(folder.path);
        }
      });
      existingFolderPaths.forEach((existingPath) => {
        if (!currentFolderPaths.has(existingPath)) {
          changes.deletedFolders.push(existingPath);
        }
      });
      if (files.length > 0) {
        const existingFileNames = new Set(existingDiscoveryFiles.map((file) => file.fileName));
        const currentFileNames = new Set(files.map((file) => file.name));
        files.forEach((file) => {
          if (!existingFileNames.has(file.name)) {
            changes.newFiles.push(file.name);
          }
        });
        existingFileNames.forEach((existingFileName) => {
          if (!currentFileNames.has(existingFileName)) {
            changes.deletedFiles.push(existingFileName);
          }
        });
      }
      return changes;
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error getting structural changes:', error);
      return {
        newFolders: [],
        deletedFolders: [],
        newFiles: [],
        deletedFiles: [],
        modifiedFiles: [],
      };
    }
  }
  async function performIncrementalDiscovery(changes) {
    try {
      const { folders, files } = await getTopLevelItems();
      const incrementalResults = [];
      const foldersToProcess = folders.filter((folder) => changes.newFolders.includes(folder.path)
        || changes.deletedFolders.includes(folder.path));
      const filesToProcess = files.filter((file) => changes.newFiles.includes(file.name)
        || changes.deletedFiles.includes(file.name));
      if (foldersToProcess.length > 0) {
        await processFoldersInParallel(foldersToProcess);
      }
      if (filesToProcess.length > 0) {
        await processRootFiles(filesToProcess);
      }
      return incrementalResults;
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error during incremental discovery:', error);
      return [];
    }
  }
  async function mergeIncrementalResults(incrementalResults) {
    try {
      const existingFiles = await getExistingRootFiles();
      const mergedFiles = [];
      existingFiles.forEach((existingFile) => {
        const incrementalFile = incrementalResults.find(
          (result) => result.fileName === existingFile.fileName,
        );
        if (incrementalFile) {
          const mergedData = mergeDiscoveryData(
            existingFile.documents,
            incrementalFile.documents,
          );
          mergedFiles.push({
            fileName: existingFile.fileName,
            documents: mergedData.merged,
          });
        } else {
          mergedFiles.push(existingFile);
        }
      });
      incrementalResults.forEach((incrementalFile) => {
        const existingFile = existingFiles.find(
          (existing) => existing.fileName === incrementalFile.fileName,
        );
        if (!existingFile) {
          mergedFiles.push(incrementalFile);
        }
      });
      return mergedFiles;
    } catch (error) {
      console.error('[Discovery Manager] ❌ Error merging incremental results:', error);
      return [];
    }
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
    updateDiscoveryHistory,
    getStructuralChanges,
    performIncrementalDiscovery,
    mergeIncrementalResults,
  };
}

export default createDiscoveryManager;
