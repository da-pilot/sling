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
    isActive: false,
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

  let config = null; // Store the config for later access

  /**
   * Initialize queue manager with persistent state and multi-threaded discovery
   */
  async function init(apiConfig) {
    config = apiConfig; // Save the config
    try {
      // Initialize state manager
      state.stateManager = createStateManager();
      await state.stateManager.init(apiConfig);

      // Initialize discovery manager
      state.discoveryManager = createDiscoveryManager();
      await state.discoveryManager.init(apiConfig);
      setupDiscoveryManagerHandlers();

      // Initialize media scan worker
      state.scanWorker = new Worker('./workers/media-scan-worker.js');
      setupScanWorkerHandlers();

      // Initialize scan worker
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
      console.warn('[Queue Manager] Queue scanning already active');
      return;
    }

    console.log('[Queue Manager] Starting queue scanning:', {
      forceRescan,
      timestamp: new Date().toISOString()
    });

    // Reset scan stats at the start of every scan
    resetStats();

    // Check if another user is already scanning
    const isScanActive = await state.stateManager.isScanActive();
    if (isScanActive) {
      throw new Error('Scan already in progress by another user. Please wait for it to complete.');
    }

    try {
      // Acquire scan lock
      await state.stateManager.acquireScanLock(forceRescan ? 'force' : 'incremental');

      state.isActive = true;

      // Pass forceRescan to setupDiscoveryManagerHandlers
      setupDiscoveryManagerHandlers(forceRescan);

      // Check for resumable discovery queue
      if (!forceRescan) {
        const pendingQueue = await state.stateManager.loadDiscoveryQueue();
        if (pendingQueue.length > 0) {
          console.log('[Queue Manager] Resuming from existing queue:', {
            queueSize: pendingQueue.length,
            timestamp: new Date().toISOString()
          });
          
          // Resume from saved queue
          emit('resumingFromQueue', { queueSize: pendingQueue.length });

          // Send pending documents to scan worker
          state.scanWorker.postMessage({
            type: 'processBatch',
            data: { pages: pendingQueue },
          });
        }
      }

      // Start multi-threaded discovery
      await state.discoveryManager.startDiscovery();

      // Start scan worker queue processing
      state.scanWorker.postMessage({
        type: 'startQueueProcessing',
      });

      console.log('[Queue Manager] Queue scanning started successfully:', {
        forceRescan,
        timestamp: new Date().toISOString()
      });

      emit('scanningStarted', { stats: state.stats, forceRescan });

    } catch (error) {
      state.isActive = false;
      console.error('[Queue Manager] Failed to start queue scanning:', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Stop the multi-threaded discovery and scanning system with state persistence
   */
  async function stopQueueScanning(saveState = true, status = 'completed') {
    if (!state.isActive) {
      console.log('[Queue Manager] Queue scanning not active, nothing to stop');
      return;
    }

    console.log('[Queue Manager] Stopping queue scanning:', {
      saveState,
      status,
      timestamp: new Date().toISOString()
    });

    state.isActive = false;

    // Stop discovery manager
    if (state.discoveryManager) {
      await state.discoveryManager.stopDiscovery();
    }

    // Stop scan worker
    if (state.scanWorker) {
      state.scanWorker.postMessage({ type: 'stopQueueProcessing' });
    }

    // Save state and release lock
    if (state.stateManager) {
      if (saveState) {
        // Save current progress for resumption
        await state.stateManager.updateScanProgress({
          totalDocuments: state.stats.totalPages,
          scannedDocuments: state.stats.scannedPages,
          totalAssets: state.stats.totalAssets,
        });
      }
      // Always clear queue after scan completes
      await state.stateManager.clearDiscoveryQueue();

      await state.stateManager.setScanStatus(status);
      await state.stateManager.releaseScanLock(status);
    }

    console.log('[Queue Manager] Queue scanning stopped:', {
      status,
      finalStats: state.stats,
      timestamp: new Date().toISOString()
    });

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
          state.stats.totalAssets += data.assetCount;
          state.stats.queuedPages = Math.max(0, state.stats.queuedPages - 1);
          state.stats.scannedPages++;

          // Save scan results persistently
          if (state.stateManager) {
            state.stateManager.saveDocumentResults([{
              path: data.page,
              assets: data.assets || [],
              scanDuration: data.scanTime,
              lastModified: data.lastModified,
            }]);
          }

          // Remove from discovery queue after scan (await to ensure sync)
          if (data.page) {
            await state.stateManager.removeFromDiscoveryQueue(data.page);
          }

          // Update scan progress
          state.stateManager.updateScanProgress({
            totalDocuments: state.stats.totalPages,
            scannedDocuments: state.stats.scannedPages,
            totalAssets: state.stats.totalAssets,
          });

          emit('pageScanned', { ...data, stats: state.stats });
          break;

        case 'markPageScanned':
          // Page already marked as scanned in stats above
          break;

        case 'batchComplete':
          emit('batchComplete', { ...data, stats: state.stats });
          // After last batch, check if queue is empty
          remainingQueue = await state.stateManager.loadDiscoveryQueue();
          if (!remainingQueue || remainingQueue.length === 0) {
            // Stop the scan worker's processing loop
            if (state.scanWorker) {
              state.scanWorker.postMessage({
                type: 'stopQueueProcessing',
                data: {},
              });
            }

            await stopQueueScanning(true, 'completed');
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
          // Unknown scan worker message
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
      // Add discovered documents to scan queue with persistence
      if (data.documents && data.documents.length > 0) {
        try {
          // Save ALL discovered documents to discovery queue for resumption
          await state.stateManager.saveDiscoveryQueue(data.documents);
          
          // Get incremental scan statistics for better feedback
          const incrementalStats = await state.stateManager.getIncrementalScanStats(data.documents);
          
          // Filter documents that need scanning
          const documentsToScan = await state.stateManager.getDocumentsToScan(data.documents, forceRescan);
          
          if (documentsToScan.length > 0) {
            state.stats.totalPages += documentsToScan.length;
            state.stats.queuedPages += documentsToScan.length;

            // Send documents to scan worker for processing
            state.scanWorker.postMessage({
              type: 'processBatch',
              data: { pages: documentsToScan },
            });

            // Update scan progress
            await state.stateManager.updateScanProgress({
              totalDocuments: state.stats.totalPages,
            });

            emit('documentsDiscovered', {
              ...data,
              documentsToScan: documentsToScan.length,
              documentsSkipped: data.documents.length - documentsToScan.length,
              incrementalStats,
              stats: state.stats,
            });
          } else {
            emit('documentsSkipped', {
              ...data,
              reason: 'already_scanned',
              incrementalStats,
              stats: state.stats,
            });
          }
        } catch (error) {
          emit('documentsError', { ...data, error: error.message });
        }
      }
    });

    state.discoveryManager.on('discoveryComplete', async (data) => {
      state.stats.totalPages = data.totalDocuments;
      // Discovery queue is already saved in documentsDiscovered handler
      // Just update progress and emit completion
      await state.stateManager.updateScanProgress({
        totalDocuments: state.stats.totalPages,
        scannedDocuments: state.stats.scannedPages,
        totalAssets: state.stats.totalAssets,
      });
      emit('discoveryComplete', { ...data, stats: state.stats });
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

  async function requestBatch() {
    // Reload queue and results from disk
    const discoveryQueue = await state.stateManager.loadDiscoveryQueue();
    const results = await state.stateManager.loadScanResults();
    const scannedPaths = new Set((results && results.length ? results.map((r) => r.path) : []));
    // Filter out already scanned pages
    const batch = discoveryQueue.filter((item) => item.path && !scannedPaths.has(item.path)).slice(0, state.batchSize);

    if (batch.length === 0) {
      // No more pages to scan - complete the scan

      // Stop the scan worker's processing loop
      if (state.scanWorker) {
        state.scanWorker.postMessage({
          type: 'stopQueueProcessing',
          data: {},
        });
      }

      await stopQueueScanning(true, 'completed');
      return;
    }

    if (batch.length > 0) {
      state.scanWorker.postMessage({
        type: 'processBatch',
        data: { pages: batch },
      });
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
    getConfig: () => config, // Expose the config
    get stateManager() { return state.stateManager; },
  };
}

export { createQueueManager };
