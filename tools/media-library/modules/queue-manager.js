/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
/**
 * Queue Manager - Orchestrates between multi-threaded discovery and media scanning workers
 * Manages the queue-based scanning system for enterprise-scale sites with parallel folder discovery
 */

import { createDiscoveryManager } from './discovery-manager.js';
import { createStateManager } from '../services/state-manager.js';

function createQueueManager() {
  const state = {
    scanWorker: null,
    discoveryManager: null,
    stateManager: null,
    daApi: null,
    isActive: false,
    isStopping: false,
    discoveryHandlersSetup: false,
    discoveryComplete: false,
    discoveryFilesCache: null,
    documentsToScan: [],
    stats: {
      totalPages: 0,
      queuedPages: 0,
      scannedPages: 0,
      totalAssets: 0,
      errors: 0,
    },
    listeners: new Map(),
    batchSize: 10,
  };

  let config = null;

  /**
   * Initialize queue manager with persistent state and multi-threaded discovery
   */
  async function init(apiConfig) {
    config = apiConfig;
    try {
      // Create and initialize DA API service
      const { createDAApiService } = await import('../services/da-api.js');
      state.daApi = createDAApiService();
      await state.daApi.init(apiConfig);

      state.stateManager = createStateManager();
      await state.stateManager.init(apiConfig);

      state.discoveryManager = createDiscoveryManager();
      await state.discoveryManager.init(apiConfig, state.stateManager);

      state.scanWorker = new Worker('./workers/media-scan-worker.js', { type: 'module' });
      setupScanWorkerHandlers();

      await initializeWorker(state.scanWorker, 'scan', apiConfig);

      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Queue Manager initialization failed:', error.message);
      cleanup();
      throw error;
    }
  }

  /**
   * Start the multi-threaded discovery and scanning system with persistence
   */
  async function startQueueScanning(forceRescan = false) {
    if (state.isActive) {
      // eslint-disable-next-line no-console
      console.warn('[Queue Manager] Queue scanning already active');
      return;
    }

    resetStats();

    const scanAlreadyActive = await state.stateManager.isScanActive();
    if (scanAlreadyActive) {
      throw new Error('Scan already in progress by another user. Please wait for it to complete.');
    }

    try {
      await state.stateManager.acquireScanLock(forceRescan ? 'force' : 'incremental');

      state.isActive = true;
      state.isStopping = false;
      state.discoveryComplete = false;

      if (forceRescan) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 🔄 Force rescan requested, clearing all checkpoints');
        await resetStatsAndCheckpoints();
      }

      if (state.discoveryManager) {
        state.discoveryManager.resetDiscoveryState();
      }

      setupDiscoveryManagerHandlers(forceRescan);

      const isDiscoveryComplete = await state.stateManager.isDiscoveryComplete();

      if (isDiscoveryComplete && !forceRescan) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 🎯 Discovery already complete, skipping discovery phase');

        state.discoveryComplete = true;

        state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
        state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, forceRescan);

        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 📋 Loaded existing discovery data:', {
          discoveryFiles: state.discoveryFilesCache.length,
          documentsToScan: state.documentsToScan.length,
          timestamp: new Date().toISOString(),
        });

        if (state.scanWorker) {
          state.scanWorker.postMessage({
            type: 'startQueueProcessing',
          });
        }

        emit('scanningStarted', { stats: state.stats, forceRescan });
        return;
      }

      const discoveryCheckpoint = await state.stateManager.getDiscoveryCheckpoint();
      const scanCheckpoint = await state.stateManager.getScanCheckpoint();

      if (discoveryCheckpoint && !forceRescan) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 🔄 Found discovery checkpoint, checking for resume:', {
          status: discoveryCheckpoint.status,
          completedFolders: discoveryCheckpoint.completedFolders,
          totalFolders: discoveryCheckpoint.totalFolders,
          currentFile: discoveryCheckpoint.currentFile,
          timestamp: new Date().toISOString(),
        });

        if (discoveryCheckpoint.status === 'complete') {
          // eslint-disable-next-line no-console
          console.log('[Queue Manager] 🎯 Discovery complete, checking scan checkpoint');

          if (scanCheckpoint && scanCheckpoint.status === 'running') {
            // eslint-disable-next-line no-console
            console.log('[Queue Manager] 🔄 Resuming scanning from checkpoint:', {
              scannedDocuments: scanCheckpoint.scannedDocuments,
              totalDocuments: scanCheckpoint.totalDocuments,
              currentFile: scanCheckpoint.currentFile,
              currentPath: scanCheckpoint.currentPath,
              timestamp: new Date().toISOString(),
            });

            await resumeScanningFromCheckpoint(scanCheckpoint);
            return;
          }

          // eslint-disable-next-line no-console
          console.log('[Queue Manager] 🎯 Discovery complete, starting fresh scanning');
          state.discoveryComplete = true;
          state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
          state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, forceRescan);

          if (state.scanWorker) {
            state.scanWorker.postMessage({
              type: 'startQueueProcessing',
            });
          }

          emit('scanningStarted', { stats: state.stats, forceRescan, resumed: false });
          return;
        } if (discoveryCheckpoint.status === 'running') {
          // eslint-disable-next-line no-console
          console.log('[Queue Manager] ⚠️ Discovery was interrupted, implementing delta resume');

          const pendingFiles = await state.stateManager.getPendingDiscoveryFiles();
          if (pendingFiles.length > 0) {
            // eslint-disable-next-line no-console
            console.log('[Queue Manager] 🔄 Found pending discovery files:', {
              pendingCount: pendingFiles.length,
              files: pendingFiles.map((f) => f.fileName),
              timestamp: new Date().toISOString(),
            });

            await resumeDiscoveryFromCheckpoint(discoveryCheckpoint, pendingFiles);
            return;
          }
        }
      }

      if (!forceRescan) {
        const pendingQueue = await state.stateManager.loadDiscoveryQueue();
        if (pendingQueue.length > 0) {
          emit('resumingFromQueue', { queueSize: pendingQueue.length });

          state.scanWorker.postMessage({
            type: 'processBatch',
            data: { pages: pendingQueue },
          });
        }
      }

      await state.discoveryManager.startDiscovery();

      emit('scanningStarted', { stats: state.stats, forceRescan });
    } catch (error) {
      state.isActive = false;

      // eslint-disable-next-line no-console
      console.error('[Queue Manager] Failed to start queue scanning:', {
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Stop the multi-threaded discovery and scanning system with state persistence
   */
  async function stopQueueScanning(saveState = true, status = 'completed') {
    if (!state.isActive || state.isStopping) {
      // eslint-disable-next-line no-console
      console.log('[Queue Manager] ⚠️ Queue scanning already stopped or stopping, skipping');
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[Queue Manager] 🛑 Stopping queue scanning:', { saveState, status });
    state.isStopping = true;
    state.isActive = false;

    if (state.discoveryManager) {
      try {
        const isDiscoveryComplete = await state.stateManager.isDiscoveryComplete();
        if (!isDiscoveryComplete) {
          await state.discoveryManager.stopDiscovery();
        } else {
          // eslint-disable-next-line no-console
          console.log('[Queue Manager] ℹ️ Discovery already complete, skipping stopDiscovery call');
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] ⚠️ Discovery already stopped or error stopping:', error.message);
      }
    }

    if (state.scanWorker) {
      state.scanWorker.postMessage({ type: 'stopQueueProcessing' });
    }

    if (state.stateManager) {
      if (saveState) {
        await state.stateManager.updateScanProgress({
          totalDocuments: state.stats.totalPages,
          scannedDocuments: state.stats.scannedPages,
          totalAssets: state.stats.totalAssets,
        });
      }
      await state.stateManager.clearDiscoveryQueue();

      await state.stateManager.setScanStatus(status);
      await state.stateManager.releaseScanLock(status);
    }

    state.isStopping = false;

    emit('scanningStopped', { stats: state.stats, saveState, status });
  }

  /**
   * Get current queue statistics
   */
  function getStats() {
    return { ...state.stats };
  }

  /**
   * Get persistent scan statistics
   */
  async function getPersistentStats() {
    if (!state.stateManager) {
      return getStats();
    }

    try {
      const persistentStats = await state.stateManager.getScanStatistics();
      const currentState = await state.stateManager.getScanState();

      return {
        ...state.stats,
        ...persistentStats,
        isActive: currentState.isActive,
        currentSession: currentState.sessionId === state.stateManager.sessionId,
        lastScanTime: persistentStats.lastScanTime,
      };
    } catch (error) {
      return getStats();
    }
  }

  /**
   * Check if scan is currently active
   */
  async function isScanActive() {
    if (!state.stateManager) {
      return state.isActive;
    }

    try {
      return await state.stateManager.isScanActive();
    } catch (error) {
      return state.isActive;
    }
  }

  /**
   * Force complete scan (clear all state)
   */
  async function forceCompleteScan() {
    if (!state.stateManager) {
      return;
    }

    try {
      await state.stateManager.clearDiscoveryQueue();
      await state.stateManager.releaseScanLock();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error forcing scan completion:', error);
    }
  }

  /**
   * Setup scan worker message handlers
   */
  function setupScanWorkerHandlers() {
    let remainingQueue;
    state.scanWorker.onmessage = async (event) => {
      const { type, data } = event.data;

      switch (type) {
        case 'initialized':
          break;

        case 'queueProcessingStarted':
          emit('queueProcessingStarted', data);
          break;

        case 'requestBatch':
          await requestBatch();
          break;

        case 'pageScanned':
          state.stats.totalAssets += data?.assetCount || 0;
          state.stats.queuedPages = Math.max(0, state.stats.queuedPages - 1);
          state.stats.scannedPages++;

          if (data?.page && data?.sourceFile) {
            await updateDocumentScanStatus(data);
          }

          state.stateManager.updateScanProgress({
            totalDocuments: state.stats.totalPages,
            scannedDocuments: state.stats.scannedPages,
            totalAssets: state.stats.totalAssets,
          });

          emit('pageScanned', { ...data, stats: state.stats });
          break;

        case 'markPageScanned':
          break;

        case 'batchComplete':
          emit('batchComplete', { ...data, stats: state.stats });
          remainingQueue = await state.stateManager.loadDiscoveryQueue();
          const isDiscoveryComplete = await state.stateManager.isDiscoveryComplete();

          if ((!remainingQueue || remainingQueue.length === 0) && isDiscoveryComplete && !state.isStopping) {
            if (state.scanWorker) {
              state.scanWorker.postMessage({
                type: 'stopQueueProcessing',
                data: {},
              });
            }

            await stopQueueScanning(true, 'completed');
          } else if (!isDiscoveryComplete) {
          }
          break;

        case 'pageScanError':
          state.stats.errors++;
          emit('pageScanError', data);
          break;

        case 'queueProcessingStopped':
          emit('queueProcessingStopped', data);
          break;

        case 'error':
          state.stats.errors++;
          if (state.stateManager) {
            state.stateManager.setScanStatus('error');
          }
          emit('workerError', { worker: 'scan', ...data });
          break;

        default:
      }
    };

    state.scanWorker.onerror = (error) => {
      state.stats.errors++;
      emit('workerError', { worker: 'scan', error: error.message });
    };
  }

  /**
   * Setup discovery manager event handlers
   */
  function setupDiscoveryManagerHandlers(forceRescan = false) {
    if (state.discoveryHandlersSetup) {
      // eslint-disable-next-line no-console
      console.log('[Queue Manager] ⚠️ Discovery handlers already setup, skipping');
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[Queue Manager] 🔧 Setting up discovery manager handlers');
    state.discoveryHandlersSetup = true;

    state.discoveryManager.on('discoveryComplete', async (data) => {
      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 🎯 Received discovery complete event:', {
        totalDocuments: data.totalDocuments,
        currentTotalPages: state.stats.totalPages,
        timestamp: new Date().toISOString(),
      });

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 📁 Discovery complete event data:', {
        stats: data.stats,
        discoveryDuration: data.discoveryDuration,
        discoveryStartTime: data.discoveryStartTime,
        discoveryEndTime: data.discoveryEndTime,
        timestamp: new Date().toISOString(),
      });

      state.stats.totalPages = data.totalDocuments;

      const discoveryComplete = await state.stateManager.setDiscoveryComplete(data.totalDocuments);

      if (discoveryComplete) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] ✅ Discovery complete status saved to global state');

        // Initialize scanning stage separately
        const scanningInitialized = await state.stateManager.initializeScanningStage();
        if (scanningInitialized) {
          // eslint-disable-next-line no-console
          console.log('[Queue Manager] ✅ Scanning stage initialized successfully');
        } else {
          // eslint-disable-next-line no-console
          console.warn('[Queue Manager] ⚠️ Failed to initialize scanning stage');
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[Queue Manager] ⚠️ Failed to save discovery complete status to global state');
      }

      state.discoveryComplete = true;

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 📁 Loading discovery files for scanning...');
      state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
      state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, forceRescan);

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 📋 Cached discovery data:', {
        discoveryFiles: state.discoveryFilesCache.length,
        documentsToScan: state.documentsToScan.length,
        timestamp: new Date().toISOString(),
      });

      await state.stateManager.updateScanProgress({
        totalDocuments: state.stats.totalPages,
        scannedDocuments: state.stats.scannedPages,
        totalAssets: state.stats.totalAssets,
      });

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 🎯 Discovery complete flag set, starting scanning');

      emit('discoveryComplete', { ...data, stats: state.stats });

      if (state.scanWorker) {
        state.scanWorker.postMessage({
          type: 'startQueueProcessing',
        });
      }
    });

    // eslint-disable-next-line no-console
    console.log('[Queue Manager] ✅ Discovery complete handler registered');

    state.discoveryManager.on('discoveryStarted', (data) => {
      emit('discoveryStarted', data);
    });

    state.discoveryManager.on('folderProgress', (data) => {
      emit('folderProgress', data);
    });

    state.discoveryManager.on('folderComplete', (data) => {
      emit('folderComplete', data);
    });

    state.discoveryManager.on('documentsDiscovered', async (data) => {
      if (data.documents && data.documents.length > 0) {
        try {
          const documentsToScan = data.documents.filter((doc) => !doc.scanComplete || doc.needsRescan);

          if (documentsToScan.length > 0) {
            state.stats.queuedPages += documentsToScan.length;

            await state.stateManager.updateScanProgress({
              scannedDocuments: state.stats.scannedPages,
              totalAssets: state.stats.totalAssets,
            });

            emit('documentsDiscovered', {
              ...data,
              documentsToScan: documentsToScan.length,
              documentsSkipped: data.documents.length - documentsToScan.length,
              stats: state.stats,
            });
          } else {
            emit('documentsSkipped', {
              ...data,
              reason: 'already_scanned',
              stats: state.stats,
            });
          }
        } catch (error) {
          emit('documentsError', { ...data, error: error.message });
        }
      }
    });

    state.discoveryManager.on('discoveryError', (data) => {
      state.stats.errors++;
      emit('discoveryError', data);
    });

    state.discoveryManager.on('folderError', (data) => {
      state.stats.errors++;
      emit('folderError', data);
    });
  }

  /**
   * Initialize a worker and wait for confirmation
   */
  async function initializeWorker(worker, workerType, apiConfig) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${workerType} worker initialization timeout`));
      }, 10000);

      const handleMessage = (event) => {
        if (event.data.type === 'initialized') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handleMessage);
          resolve();
        }
      };

      worker.addEventListener('message', handleMessage);
      worker.postMessage({ type: 'init', data: { apiConfig } });
    });
  }

  /**
   * Reset statistics
   */
  function resetStats() {
    state.stats = {
      totalPages: 0,
      queuedPages: 0,
      scannedPages: 0,
      totalAssets: 0,
      errors: 0,
    };
    state.discoveryFilesCache = null;
    state.documentsToScan = [];
  }

  /**
   * Reset statistics and clear checkpoints for fresh start
   */
  async function resetStatsAndCheckpoints() {
    resetStats();

    if (state.stateManager) {
      try {
        await state.stateManager.clearCheckpoints();

        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 🗑️ Cleared all checkpoints for fresh start');
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[Queue Manager] ⚠️ Failed to clear checkpoints:', error.message);
      }
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
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  /**
   * Get queue size (estimated from current stats)
   */
  async function getQueueSize() {
    return state.stats.queuedPages;
  }

  /**
   * Cleanup resources
   */
  function cleanup() {
    if (state.discoveryManager) {
      state.discoveryManager.stopDiscovery();
      state.discoveryManager = null;
    }

    if (state.scanWorker) {
      state.scanWorker.terminate();
      state.scanWorker = null;
    }

    if (state.stateManager) {
      state.stateManager.cleanup();
      state.stateManager = null;
    }

    state.isActive = false;
    state.listeners.clear();
  }

  /**
   * Load all discovery files from .pages folder
   */
  async function loadDiscoveryFiles() {
    try {
      if (!config) {
        // eslint-disable-next-line no-console
        console.error('[Queue Manager] Config not available for loadDiscoveryFiles');
        return [];
      }

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 🔍 Loading discovery files from .da/.pages/');

      if (!state.daApi) {
        // eslint-disable-next-line no-console
        console.error('[Queue Manager] DA API service not initialized');
        return [];
      }

      const items = await state.daApi.listPath('.da/.pages');

      const jsonFiles = items.filter((item) => item.name && item.ext === 'json').map((item) => item.name);

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 📁 Found discovery files:', {
        totalItems: items.length,
        jsonFiles,
        allItems: items.map((item) => ({ name: item.name, type: item.type, ext: item.ext })),
        timestamp: new Date().toISOString(),
      });

      const discoveryFiles = [];
      for (const item of items) {
        const isJsonFile = item.name && item.ext === 'json';

        if (isJsonFile) {
          try {
            const { CONTENT_DA_LIVE_BASE, parseSheet, loadSheetFile } = await import('./sheet-utils.js');
            const fileUrl = `${CONTENT_DA_LIVE_BASE}/${config.org}/${config.repo}/.da/.pages/${item.name}.json`;

            // eslint-disable-next-line no-console
            console.log('[Queue Manager] 📄 Fetching discovery file:', fileUrl);

            const rawFileData = await loadSheetFile(fileUrl, config.token);

            const parsedData = parseSheet(rawFileData);

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

            if (Array.isArray(documents) && documents.length > 0) {
              discoveryFiles.push({
                fileName: item.name,
                documents,
              });

              // eslint-disable-next-line no-console
              console.log('[Queue Manager] ✅ Loaded discovery file:', {
                fileName: item.name,
                documentCount: documents.length,
                sheetType: rawFileData[':type'] || 'unknown',
                timestamp: new Date().toISOString(),
              });
            } else {
              // eslint-disable-next-line no-console
              console.log('[Queue Manager] ⚠️ Invalid discovery file format:', {
                fileName: item.name,
                hasData: !!parsedData.data,
                hasNestedData: !!(parsedData.data && parsedData.data.data),
                isDataArray: parsedData.data && parsedData.data.data ? Array.isArray(parsedData.data.data) : false,
                sheetType: rawFileData[':type'] || 'unknown',
                timestamp: new Date().toISOString(),
              });
            }
          } catch (fileError) {
            // eslint-disable-next-line no-console
            console.log('[Queue Manager] ❌ Error loading discovery file:', {
              fileName: item.name,
              error: fileError.message,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 📊 Discovery files summary:', {
        totalFiles: discoveryFiles.length,
        totalDocuments: discoveryFiles.reduce((sum, file) => sum + file.documents.length, 0),
        files: discoveryFiles.map((file) => ({ name: file.fileName, count: file.documents.length })),
        timestamp: new Date().toISOString(),
      });

      return discoveryFiles;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Queue Manager] Error loading discovery files:', error);
      return [];
    }
  }

  /**
   * Update document scan status in unified discovery file
   */
  async function updateDocumentScanStatus(scanData) {
    try {
      if (!config) {
        // eslint-disable-next-line no-console
        console.error('[Queue Manager] Config not available for updateDocumentScanStatus');
        return;
      }

      const {
        page: path, sourceFile, assetCount, scanTime, lastModified,
      } = scanData;

      const { CONTENT_DA_LIVE_BASE, parseSheet, loadSheetFile } = await import('./sheet-utils.js');
      const fileUrl = `${CONTENT_DA_LIVE_BASE}/${config.org}/${config.repo}/.da/.pages/${sourceFile}.json`;

      const rawFileData = await loadSheetFile(fileUrl, config.token);
      const parsedData = parseSheet(rawFileData);

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
          return;
        }
      }

      if (!Array.isArray(documents)) {
        return;
      }

      const documentIndex = documents.findIndex((doc) => doc.path === path);
      if (documentIndex === -1) {
        return;
      }

      documents[documentIndex] = {
        ...documents[documentIndex],
        lastScanned: Date.now(),
        scanComplete: true,
        assetCount: assetCount || 0,
        scanDuration: scanTime || 0,
        needsRescan: false,
      };

      // Update the raw file data structure
      if (rawFileData[':type'] === 'sheet') {
        rawFileData.data[documentIndex] = documents[documentIndex];
      } else if (rawFileData[':type'] === 'multi-sheet') {
        // For multi-sheet, we need to update the correct sheet
        const sheetNames = rawFileData[':names'] || [];
        for (const sheetName of sheetNames) {
          if (rawFileData[sheetName] && rawFileData[sheetName].data) {
            const sheetDocIndex = rawFileData[sheetName].data.findIndex((doc) => doc.path === path);
            if (sheetDocIndex !== -1) {
              rawFileData[sheetName].data[sheetDocIndex] = documents[documentIndex];
              break;
            }
          }
        }
      }

      const saveUrl = `${config.baseUrl}/source/${config.org}/${config.repo}/.da/.pages/${sourceFile}.json`;
      const { saveSheetFile } = await import('./sheet-utils.js');

      await saveSheetFile(saveUrl, rawFileData, config.token, 'PUT');

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] ✅ Updated document scan status:', {
        path,
        sourceFile,
        assetCount,
        scanTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Queue Manager] Error updating document scan status:', error);
    }
  }

  /**
   * Get documents that need scanning from discovery files with incremental logic
   */
  function getDocumentsToScan(discoveryFiles, forceRescan = false) {
    const documentsToScan = [];
    let totalDocuments = 0;
    let alreadyScanned = 0;
    let needsRescan = 0;
    let missingScanComplete = 0;
    let changedDocuments = 0;
    let newDocuments = 0;

    discoveryFiles.forEach((file) => {
      file.documents.forEach((doc) => {
        totalDocuments++;

        const hasScanComplete = doc.hasOwnProperty('scanComplete');
        const needsScan = forceRescan || !doc.scanComplete || doc.needsRescan;

        if (!hasScanComplete) {
          missingScanComplete++;
        }

        if (needsScan) {
          let scanReason = 'unknown';
          if (forceRescan) {
            scanReason = 'force';
          } else if (!hasScanComplete) {
            scanReason = 'new';
            newDocuments++;
          } else if (doc.needsRescan) {
            scanReason = 'changed';
            changedDocuments++;
          }

          documentsToScan.push({
            ...doc,
            sourceFile: file.fileName,
            scanReason,
          });
        } else {
          alreadyScanned++;
        }

        if (doc.needsRescan) {
          needsRescan++;
        }
      });
    });

    // eslint-disable-next-line no-console
    console.log('[Queue Manager] 📋 Incremental document scanning analysis:', {
      forceRescan,
      totalDocuments,
      documentsToScan: documentsToScan.length,
      alreadyScanned,
      needsRescan,
      missingScanComplete,
      newDocuments,
      changedDocuments,
      scanBreakdown: {
        force: documentsToScan.filter((doc) => doc.scanReason === 'force').length,
        new: documentsToScan.filter((doc) => doc.scanReason === 'new').length,
        changed: documentsToScan.filter((doc) => doc.scanReason === 'changed').length,
        unknown: documentsToScan.filter((doc) => doc.scanReason === 'unknown').length,
      },
      sampleDocument: discoveryFiles.length > 0 && discoveryFiles[0].documents.length > 0
        ? Object.keys(discoveryFiles[0].documents[0]) : [],
      sampleDocumentValues: discoveryFiles.length > 0 && discoveryFiles[0].documents.length > 0
        ? {
          path: discoveryFiles[0].documents[0].path,
          hasScanComplete: discoveryFiles[0].documents[0].hasOwnProperty('scanComplete'),
          scanComplete: discoveryFiles[0].documents[0].scanComplete,
          hasNeedsRescan: discoveryFiles[0].documents[0].hasOwnProperty('needsRescan'),
          needsRescan: discoveryFiles[0].documents[0].needsRescan,
        } : null,
      firstFewDocuments: discoveryFiles.length > 0 && discoveryFiles[0].documents.length > 0
        ? discoveryFiles[0].documents.slice(0, 3).map((doc) => ({
          path: doc.path,
          hasScanComplete: doc.hasOwnProperty('scanComplete'),
          scanComplete: doc.scanComplete,
          hasNeedsRescan: doc.hasOwnProperty('needsRescan'),
          needsRescan: doc.needsRescan,
          lastScanned: doc.lastScanned,
          lastModified: doc.lastModified,
        })) : [],
      timestamp: new Date().toISOString(),
    });

    return documentsToScan;
  }

  /**
   * Detect changed documents by comparing lastModified timestamps
   */
  async function detectChangedDocuments(discoveryFiles) {
    let changedCount = 0;
    let unchangedCount = 0;

    for (const file of discoveryFiles) {
      for (const doc of file.documents) {
        if (doc.lastScanned && doc.lastModified) {
          const lastScannedTime = new Date(doc.lastScanned).getTime();
          const lastModifiedTime = new Date(doc.lastModified).getTime();

          if (lastModifiedTime > lastScannedTime) {
            doc.needsRescan = true;
            changedCount++;
          } else {
            doc.needsRescan = false;
            unchangedCount++;
          }
        } else {
          doc.needsRescan = true;
          changedCount++;
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log('[Queue Manager] 🔍 Document change detection:', {
      totalDocuments: discoveryFiles.reduce((sum, file) => sum + file.documents.length, 0),
      changedDocuments: changedCount,
      unchangedDocuments: unchangedCount,
      timestamp: new Date().toISOString(),
    });

    return { changedCount, unchangedCount };
  }

  /**
   * Load discovery files with change detection
   */
  async function loadDiscoveryFilesWithChangeDetection() {
    const discoveryFiles = await loadDiscoveryFiles();

    await detectChangedDocuments(discoveryFiles);

    return discoveryFiles;
  }

  async function requestBatch() {
    try {
      if (state.isStopping) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] ⏸️ Skipping batch request - stopping in progress');
        return;
      }

      if (!state.discoveryFilesCache || !state.documentsToScan) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 📁 Loading discovery files (not cached)...');
        state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
        state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, false);
      }

      const batch = state.documentsToScan.slice(0, state.batchSize);

      if (batch.length > 0) {
        state.documentsToScan = state.documentsToScan.slice(state.batchSize);
      }

      if (batch.length === 0) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 🔍 No documents in batch, discovery status:', {
          discoveryComplete: state.discoveryComplete,
          documentsRemaining: state.documentsToScan.length,
          timestamp: new Date().toISOString(),
        });

        if (state.discoveryComplete) {
          // eslint-disable-next-line no-console
          console.log('[Queue Manager] ✅ Scanning complete - no more documents to process');

          await state.stateManager.saveScanCheckpoint({
            status: 'complete',
            totalDocuments: state.stats.totalPages,
            scannedDocuments: state.stats.scannedPages,
            totalAssets: state.stats.totalAssets,
            files: state.discoveryFilesCache.map((file) => ({
              fileName: file.fileName,
              status: 'complete',
              totalDocuments: file.documents.length,
              scannedDocuments: file.documents.filter((doc) => doc.scanComplete).length,
            })),
          });

          // Stop the scanning process since there are no documents to scan
          await stopQueueScanning(true, 'completed');
          return;
        }

        // eslint-disable-next-line no-console
        console.log('[Queue Manager] ⏳ Discovery not complete, waiting 2s before retry');
        setTimeout(() => {
          requestBatch();
        }, 2000);
        return;
      }

      if (batch.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 📦 Processing batch:', {
          batchSize: batch.length,
          documentsRemaining: state.documentsToScan.length,
          timestamp: new Date().toISOString(),
        });

        const currentFile = batch[0]?.sourceFile;
        const currentPath = batch[0]?.path;

        await state.stateManager.saveScanCheckpoint({
          status: 'running',
          totalDocuments: state.stats.totalPages,
          scannedDocuments: state.stats.scannedPages,
          totalAssets: state.stats.totalAssets,
          currentFile,
          currentPath,
          lastBatchSize: batch.length,
          lastBatchTime: Date.now(),
          remainingDocuments: state.documentsToScan.length,
          files: state.discoveryFilesCache.map((file) => ({
            fileName: file.fileName,
            status: file.documents.every((doc) => doc.scanComplete) ? 'complete' : 'partial',
            totalDocuments: file.documents.length,
            scannedDocuments: file.documents.filter((doc) => doc.scanComplete).length,
          })),
        });

        state.scanWorker.postMessage({
          type: 'processBatch',
          data: { pages: batch },
        });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Queue Manager] Error requesting batch:', error);
      emit('workerError', { worker: 'queue', error: error.message });
    }
  }

  /**
   * Resume discovery from checkpoint with delta processing
   */
  async function resumeDiscoveryFromCheckpoint(discoveryCheckpoint, pendingFiles) {
    try {
      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 🔄 Starting delta discovery resume:', {
        pendingFiles: pendingFiles.length,
        completedFolders: discoveryCheckpoint.completedFolders,
        totalFolders: discoveryCheckpoint.totalFolders,
      });

      const { folders, files } = await state.discoveryManager.getTopLevelItems();

      const pendingFolders = [];
      const completedFolders = [];

      for (const folder of folders) {
        const folderName = folder.path === '/' ? 'root' : folder.path.split('/').pop() || 'root';
        const isCompleted = discoveryCheckpoint.files.some((file) => file.fileName.startsWith(folderName) && file.status === 'complete');

        if (isCompleted) {
          completedFolders.push(folder);
        } else {
          pendingFolders.push(folder);
        }
      }

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 📁 Delta discovery analysis:', {
        totalFolders: folders.length,
        completedFolders: completedFolders.length,
        pendingFolders: pendingFolders.length,
        pendingFolderPaths: pendingFolders.map((f) => f.path),
      });

      state.stats.totalPages = discoveryCheckpoint.totalDocuments || 0;
      state.stats.completedFolders = completedFolders.length;
      state.stats.totalFolders = folders.length;

      if (pendingFolders.length === 0) {
        // eslint-disable-next-line no-console
        console.log('[Queue Manager] ✅ All folders already discovered, marking discovery complete');
        state.discoveryComplete = true;

        state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
        state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, false);

        if (state.scanWorker) {
          state.scanWorker.postMessage({
            type: 'startQueueProcessing',
          });
        }

        emit('scanningStarted', { stats: state.stats, forceRescan: false, resumed: true });
        return;
      }

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 🔄 Resuming discovery with pending folders only');

      await state.stateManager.updateDiscoveryProgress({
        totalFolders: folders.length,
        completedFolders: completedFolders.length,
        totalDocuments: discoveryCheckpoint.totalDocuments || 0,
      });

      await state.discoveryManager.resumeDiscovery(pendingFolders, completedFolders);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Queue Manager] Failed to resume discovery from checkpoint:', error);
      await state.discoveryManager.startDiscovery();
    }
  }

  /**
   * Resume scanning from checkpoint with delta processing
   */
  async function resumeScanningFromCheckpoint(scanCheckpoint) {
    try {
      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 🔄 Starting delta scanning resume:', {
        scannedDocuments: scanCheckpoint.scannedDocuments,
        totalDocuments: scanCheckpoint.totalDocuments,
        currentFile: scanCheckpoint.currentFile,
        currentPath: scanCheckpoint.currentPath,
        timestamp: new Date().toISOString(),
      });

      state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();

      state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, false);

      state.stats.scannedPages = scanCheckpoint.scannedDocuments || 0;
      state.stats.totalPages = scanCheckpoint.totalDocuments || 0;
      state.stats.totalAssets = scanCheckpoint.totalAssets || 0;
      state.discoveryComplete = true;

      if (scanCheckpoint.currentFile && scanCheckpoint.currentPath) {
        const resumeIndex = state.documentsToScan.findIndex((doc) => doc.sourceFile === scanCheckpoint.currentFile
          && doc.path === scanCheckpoint.currentPath);

        if (resumeIndex > 0) {
          state.documentsToScan = state.documentsToScan.slice(resumeIndex);

          // eslint-disable-next-line no-console
          console.log('[Queue Manager] 📋 Resuming from document index:', resumeIndex);
        }
      }

      // eslint-disable-next-line no-console
      console.log('[Queue Manager] 📊 Delta scanning analysis:', {
        totalDocuments: state.stats.totalPages,
        scannedDocuments: state.stats.scannedPages,
        remainingDocuments: state.documentsToScan.length,
        resumePoint: scanCheckpoint.currentPath,
        scanBreakdown: {
          new: state.documentsToScan.filter((doc) => doc.scanReason === 'new').length,
          changed: state.documentsToScan.filter((doc) => doc.scanReason === 'changed').length,
          unknown: state.documentsToScan.filter((doc) => doc.scanReason === 'unknown').length,
        },
      });

      if (state.scanWorker) {
        state.scanWorker.postMessage({
          type: 'startQueueProcessing',
        });
      }

      emit('scanningStarted', { stats: state.stats, forceRescan: false, resumed: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Queue Manager] Failed to resume scanning from checkpoint:', error);
      state.discoveryComplete = true;
      state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
      state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, false);

      if (state.scanWorker) {
        state.scanWorker.postMessage({
          type: 'startQueueProcessing',
        });
      }

      emit('scanningStarted', { stats: state.stats, forceRescan: false, resumed: false });
    }
  }

  return {
    init,
    startQueueScanning,
    stopQueueScanning,
    getStats,
    getPersistentStats,
    isScanActive,
    forceCompleteScan,
    on,
    off,
    getQueueSize,
    cleanup,
    resetStatsAndCheckpoints,
    resumeDiscoveryFromCheckpoint,
    resumeScanningFromCheckpoint,
    detectChangedDocuments,
    loadDiscoveryFilesWithChangeDetection,
    getConfig: () => config,
    get stateManager() { return state.stateManager; },
  };
}

export { createQueueManager };
