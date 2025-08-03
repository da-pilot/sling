/* eslint-disable no-unused-vars */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-use-before-define, no-console */
/**
 * Queue Manager - Orchestrates between multi-threaded discovery and media scanning workers
 * Manages the queue-based scanning system for enterprise-scale sites with parallel folder discovery
 */

import createDiscoveryManager from './discovery-manager.js';
import createSessionManager from '../services/session-manager.js';
import createProcessingStateManager from '../services/processing-state-manager.js';
import createPersistenceManager from '../services/persistence-manager.js';
import createMetadataManager from '../services/metadata-manager.js';
import { CONTENT_DA_LIVE_BASE } from '../constants.js';
import {
  buildSingleSheet,
  saveSheetFile,
  loadData,
} from './sheet-utils.js';
import createQueueEventEmitter, { createDiscoveryFileManager, createScanStatusUpdater } from './queue/index.js';
import createSiteAggregator from './discovery/site-aggregator.js';

export default function createQueueManager() {
  console.log('[Queue Manager] 🚀 Creating queue manager instance');
  const eventEmitter = createQueueEventEmitter();
  const discoveryFileManager = createDiscoveryFileManager();
  const scanStatusUpdater = createScanStatusUpdater();
  const state = {
    scanWorker: null,
    discoveryManager: null,
    sessionManager: null,
    processingStateManager: null,
    scanStatusManager: null,
    mediaProcessor: null,
    daApi: null,
    config: null,
    isActive: false,
    isStopping: false,
    completionProcessed: false,
    discoveryHandlersSetup: false,
    discoveryComplete: false,
    discoveryFilesCache: null,
    documentsToScan: [],
    currentSessionId: null,
    currentUserId: null,
    currentBrowserId: null,
    stats: {
      totalPages: 0,
      queuedPages: 0,
      scannedPages: 0,
      totalMedia: 0,
      errors: 0,
    },
    batchProcessingPhase: {
      status: 'pending',
      totalBatches: 0,
      processedBatches: 0,
      uploadedBatches: 0,
      failedBatches: 0,
      totalMedia: 0,
      startTime: null,
      endTime: null,
    },
    batchProcessingConfig: {
      queueThreshold: 10,
      minInterval: 2000,
    },
    lastBatchProcessingTime: 0,
    batchSize: 10,
  };

  /**
   * Initialize queue manager with persistent state and multi-threaded discovery
   */
  async function init(
    docAuthoringService,
    sessionManagerInstance,
    processingStateManagerInstance,
    mediaProcessorInstance,
    persistenceManagerInstance,
  ) {
    console.log('[Queue Manager] 🔧 Starting initialization with services:', {
      hasDocAuthoringService: !!docAuthoringService,
      hasSessionManager: !!sessionManagerInstance,
      hasProcessingStateManager: !!processingStateManagerInstance,
      hasMediaProcessor: !!mediaProcessorInstance,
      hasPersistenceManager: !!persistenceManagerInstance,
    });

    state.docAuthoringService = docAuthoringService;
    state.daApi = docAuthoringService;
    state.sessionManager = sessionManagerInstance;
    state.processingStateManager = processingStateManagerInstance;
    state.mediaProcessor = mediaProcessorInstance;
    state.persistenceManager = persistenceManagerInstance;
    state.config = docAuthoringService.getConfig();

    console.log('[Queue Manager] 📋 Config loaded:', {
      org: state.config?.org,
      repo: state.config?.repo,
      hasToken: !!state.config?.token,
    });

    console.log('[Queue Manager] 🔍 Creating discovery manager...');
    state.discoveryManager = createDiscoveryManager();

    console.log('[Queue Manager] 🔧 Initializing discovery manager...');
    await state.discoveryManager.init(
      docAuthoringService,
      sessionManagerInstance,
      processingStateManagerInstance,
    );

    state.scanWorker = null;
    state.isStopping = false;
    state.discoveryComplete = false;
    state.currentSessionId = null;
    state.discoveryFilesCache = null;
    state.documentsToScan = null;
    state.batchSize = 5;
    state.batchProcessingConfig = {
      batchSize: 50,
      uploadDelay: 1000,
      maxRetries: 3,
    };

    resetStats();

    state.scanWorker = new Worker(new URL('../workers/media-scan-worker.js', import.meta.url), {
      type: 'module',
    });
    await initializeWorker(state.scanWorker, 'scan', state.config);

    setupScanWorkerHandlers();
    setupDiscoveryManagerHandlers();
  }

  /**
   * Start the multi-threaded discovery and scanning system with persistence
   */
  async function startQueueScanning(
    forceRescan = false,
    sessionId = null,
    userId = null,
    browserId = null,
  ) {
    if (state.isActive) {
      console.warn('[Queue Manager] Queue scanning already active');
      return;
    }

    // Set current session
    state.currentSessionId = sessionId;
    state.currentUserId = userId;
    state.currentBrowserId = browserId;

    resetStats();

    // Check for conflicting sessions
    if (state.sessionManager && sessionId) {
      const conflictingSessions = await state.sessionManager.checkForConflictingSessions(sessionId);
      if (conflictingSessions.length > 0) {
        conflictingSessions.forEach(async (conflictingSession) => {
          await state.sessionManager.coordinateSessions(sessionId, conflictingSession.sessionId);
        });
      }
    }

    // Check if scan is active using session manager
    const activeSessions = state.sessionManager
      ? await state.sessionManager.getActiveSessions()
      : [];

    const scanAlreadyActive = activeSessions.some(
      (session) => session.currentStage === 'discovery' || session.currentStage === 'scanning',
    );
    if (scanAlreadyActive) {
      throw new Error('Scan already in progress by another user. Please wait for it to complete.');
    }

    try {
      // Session manager handles scan coordination
      if (state.sessionManager && sessionId) {
        await state.sessionManager.acquireSessionLock(sessionId, forceRescan ? 'force' : 'incremental');
      }

      state.isActive = true;
      state.isStopping = false;
      state.completionProcessed = false;
      state.discoveryComplete = false;

      // Update session heartbeat
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

      if (forceRescan) {
        resetStats();
      }

      if (state.processingStateManager) {
        const discoveryCheckpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
        const scanningCheckpoint = await state.processingStateManager.loadScanningCheckpoint();
        console.log('[Queue Manager] 🔍 Discovery checkpoint analysis:', {
          forceRescan,
          discoveryStatus: discoveryCheckpoint.status,
          needsDiscovery: forceRescan || !discoveryCheckpoint.status || discoveryCheckpoint.status === 'idle',
        });
        if (forceRescan) {
          await state.processingStateManager.clearCheckpoints();
          await clearDiscoveryFiles();
          if (state.discoveryManager && typeof state.discoveryManager.clearStructureBaseline === 'function') {
            await state.discoveryManager.clearStructureBaseline();
          }
        }
        const needsDiscovery = forceRescan || !discoveryCheckpoint.status || discoveryCheckpoint.status === 'idle';
        const needsScanning = scanningCheckpoint.status !== 'completed';
        if (needsDiscovery && state.discoveryManager) {
          setupDiscoveryManagerHandlers();
          if (discoveryCheckpoint.status === 'running') {
            await resumeDiscoveryFromCheckpoint(discoveryCheckpoint);
          } else {
            await state.discoveryManager.startDiscoveryWithSession(sessionId, forceRescan);
          }
          const discoveryStatus = await checkDiscoveryFilesExist();
          if (needsScanning && discoveryStatus.filesExist) {
            if (scanningCheckpoint.status === 'running') {
              await resumeScanningFromCheckpoint(scanningCheckpoint);
            } else {
              await startScanningPhase(null, forceRescan);
            }
          }
          const uploadStatus = await checkMediaAvailable();
          if (uploadStatus.mediaAvailable) {
            await triggerUploadPhase();
          }
        } else if (discoveryCheckpoint.status === 'completed') {
          // Discovery already complete, populate cache
          console.log('[Queue Manager] ✅ Discovery already complete, populating cache...');
          state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
          console.log('[Queue Manager] 📋 Populated discovery files cache from checkpoint:', {
            fileCount: state.discoveryFilesCache.length,
            fileNames: state.discoveryFilesCache.map((f) => f.fileName),
          });
        }

        // eslint-disable-next-line no-console
        console.log('[Queue Manager] 🚀 Queue scanning started:', {
          forceRescan,
          sessionId,
          userId,
          browserId,
          timestamp: new Date().toISOString(),
        });

        emit('queueScanningStarted', {
          forceRescan,
          sessionId,
          userId,
          browserId,
        });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Queue Manager] ❌ Failed to start queue scanning:', error);
      state.isActive = false;
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
        // Check discovery completion using processing state manager
        const isDiscoveryComplete = state.processingStateManager
          ? await state.processingStateManager.isDiscoveryComplete(state.currentSessionId)
          : false;
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

    if (state.scanWorker && !state.isStopping) {
      state.scanWorker.postMessage({ type: 'stopQueueProcessing' });
    }

    // Update processing state manager
    if (state.processingStateManager && state.currentSessionId && saveState) {
      await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
        totalPages: state.stats.totalPages,
        scannedPages: state.stats.scannedPages,
        totalMedia: state.stats.totalMedia,
        status,
        endTime: Date.now(),
      });
    }

    // Clear discovery queue using discovery manager
    if (state.discoveryManager) {
      await state.discoveryManager.clearQueue();
    }

    // Release session lock
    if (state.sessionManager && state.currentSessionId) {
      await state.sessionManager.releaseSessionLock(state.currentSessionId, status);
    }

    state.isStopping = false;

    if (status === 'completed') {
      await processRemainingMedia();
    }

    emit('scanningStopped', { stats: state.stats, saveState, status });

    if (status === 'completed') {
      console.log('✅ [PROCESSING] All pages processed and scanning completed');
    }
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
    // Use processing state manager for persistent stats
    if (!state.processingStateManager || !state.currentSessionId) {
      return getStats();
    }

    try {
      const discoveryProgress = await state.processingStateManager
        .getDiscoveryProgress(state.currentSessionId);
      const scanningProgress = await state.processingStateManager
        .getScanningProgress(state.currentSessionId);

      return {
        ...state.stats,
        totalFolders: discoveryProgress?.totalFolders || 0,
        completedFolders: discoveryProgress?.completedFolders || 0,
        totalDocuments: discoveryProgress?.totalDocuments || 0,
        isActive: scanningProgress?.status === 'running',
        currentSession: true, // We have the current session
        lastScanTime: scanningProgress?.lastUpdated || discoveryProgress?.lastUpdated,
      };
    } catch (error) {
      return getStats();
    }
  }

  /**
   * Check if scan is currently active
   */
  async function isScanActive() {
    // Check if scan is active using processing state manager
    if (!state.processingStateManager || !state.currentSessionId) {
      return state.isActive;
    }

    try {
      const scanningProgress = await state.processingStateManager
        .getScanningProgress(state.currentSessionId);
      return scanningProgress?.status === 'running' || state.isActive;
    } catch (error) {
      return state.isActive;
    }
  }

  /**
   * Force complete scan (clear all state)
   */
  async function forceCompleteScan() {
    try {
      // Clear discovery queue using discovery manager
      if (state.discoveryManager) {
        await state.discoveryManager.clearQueue();
      }

      // Release session lock
      if (state.sessionManager && state.currentSessionId) {
        await state.sessionManager.releaseSessionLock(state.currentSessionId, 'force_completed');
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error forcing scan completion:', error);
    }
  }

  /**
   * Start scanning phase immediately when first discovery file is available
   */
  async function startScanningPhase(discoveryFile = null, forceRescan = false) {
    let { documentsToScan } = state;
    let { totalPages } = state.stats;
    if (!state.discoveryComplete && (!documentsToScan || documentsToScan.length === 0)) {
      documentsToScan = state.documentsToScan || [];
      totalPages = documentsToScan.length;
    }
    state.stats.totalPages = totalPages;
    state.stats.queuedPages = documentsToScan.length;
    state.stats.startTime = Date.now();
    state.documentsToScan = documentsToScan;
    if (state.processingStateManager && state.currentSessionId) {
      await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
        totalPages,
        scannedPages: 0,
        pendingPages: documentsToScan.length,
        failedPages: 0,
        totalMedia: 0,
        currentDiscoveryFile: discoveryFile,
        currentPage: null,
        lastScannedAt: null,
        scanRate: 0,
        status: 'running',
      });
    }
    if (state.scanWorker) {
      state.scanWorker.postMessage({
        type: 'startQueueProcessing',
        data: {
          sessionId: state.currentSessionId,
          userId: state.currentUserId,
          browserId: state.currentBrowserId,
          discoveryFile,
        },
      });
    }
  }

  /**
   * Add a folder's discovery file to the scanning queue
   */
  async function addDocumentsForScanning(discoveryFile, documents) {
    try {
      if (!state.isActive) {
        await startScanningPhase(discoveryFile, false);
        return;
      }

      if (state.scanWorker && state.isActive) {
        const newDocumentsToScan = getDocumentsToScan([{ documents }], false);
        const existingPaths = new Set(state.documentsToScan.map((doc) => doc.path));
        const uniqueNewDocuments = newDocumentsToScan.filter((doc) => !existingPaths.has(doc.path));
        state.documentsToScan.push(...uniqueNewDocuments);
        state.stats.totalPages += uniqueNewDocuments.length;
        state.stats.queuedPages += uniqueNewDocuments.length;
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
            totalPages: state.stats.totalPages,
            pendingPages: state.stats.queuedPages,
            currentDiscoveryFile: discoveryFile,
            status: 'running',
          });
        }
        if (uniqueNewDocuments.length > 0) {
          await requestBatch();
        }
      }
    } catch (error) {
      console.error('[Queue Manager] ❌ Failed to add folder to scanning queue:', error);
      throw error;
    }
  }

  /**
   * Process media immediately for progressive loading
   */
  async function processMediaImmediately(media, sessionId) {
    try {
      if (!state.mediaProcessor) {
        return;
      }
      if (sessionId && state.currentUserId && state.currentBrowserId) {
        state.mediaProcessor.setCurrentSession(
          sessionId,
          state.currentUserId,
          state.currentBrowserId,
        );
      }
      await state.mediaProcessor.queueMediaForBatchProcessing(media);
      if (state.processingStateManager && sessionId) {
        await state.processingStateManager.updateScanningProgress(sessionId, {
          totalMedia: media.length,
          lastScannedAt: Date.now(),
        });
      }
    } catch (error) {
      state.stats.errors += 1;
    }
  }

  async function checkThresholdTrigger() {
    try {
      const now = Date.now();
      const persistenceManager = createPersistenceManager();
      await persistenceManager.init();
      const queueItems = await persistenceManager.getProcessingQueue(state.currentSessionId);
      const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);
      const timeSinceLastBatch = now - state.lastBatchProcessingTime;
      const minIntervalMet = timeSinceLastBatch >= state.batchProcessingConfig.minInterval;
      const thresholdMet = totalQueuedItems >= state.batchProcessingConfig.queueThreshold;
      if (minIntervalMet && thresholdMet && totalQueuedItems > 0) {
        state.lastBatchProcessingTime = now;
        setTimeout(() => startBatchProcessingPhase(), 0);
      }
    } catch (error) {
      state.stats.errors += 1;
    }
  }

  async function processRemainingMedia() {
    try {
      const persistenceManager = createPersistenceManager();
      await persistenceManager.init();
      const queueItems = await persistenceManager.getProcessingQueue(state.currentSessionId);
      const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);

      if (totalQueuedItems > 0) {
        await startBatchProcessingPhase();
      }
    } catch (error) {
      console.error('[Queue Manager] Error processing remaining media:', error);
    }
  }

  /**
   * Setup scan worker message handlers
   */
  function setupScanWorkerHandlers() {
    if (!state.scanWorker) {
      return;
    }
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

        case 'pageScanned': {
          state.stats.totalMedia += data?.mediaCount || 0;
          state.stats.queuedPages = Math.max(0, state.stats.queuedPages - 1);
          const newScannedPages = state.stats.scannedPages + 1;
          state.stats.scannedPages = newScannedPages;
          if (data?.mediaCount > 0) {
            await triggerUploadPhase();
          }

          // Calculate scan rate (pages per minute)
          const now = Date.now();
          const timeDiff = (now - (state.stats.startTime || now)) / 60000;
          const scanRate = state.stats.scannedPages > 0
            ? Math.round((state.stats.scannedPages / timeDiff) * 100) / 100
            : 0;

          // Update scan status manager
          if (data?.page && data?.sourceFile) {
            await state.persistenceManager.savePageScanStatus({
              pagePath: data.page,
              sourceFile: data.sourceFile,
              status: 'completed',
              mediaCount: data?.mediaCount || 0,
              sessionId: state.currentSessionId,
              lastScannedAt: Date.now(),
            });
          }

          // Update processing state manager
          if (state.processingStateManager && state.currentSessionId) {
            await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
              scannedPages: state.stats.scannedPages,
              pendingPages: state.stats.totalPages - state.stats.scannedPages,
              totalMedia: state.stats.totalMedia,
              currentPage: data?.page || '',
              currentDiscoveryFile: data?.sourceFile ? `/${state.config.org}/${state.config.repo}/.media/.pages/${data.sourceFile}.json` : null,
              scanRate,
              lastScannedAt: Date.now(),
            });
          }

          // Check if scanning is complete
          const isScanningComplete = state.stats.scannedPages >= state.stats.totalPages
            && state.stats.totalPages > 0;
          if (state.processingStateManager && state.currentSessionId) {
            if (isScanningComplete) {
              await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
                status: 'completed',
                scannedPages: state.stats.scannedPages,
                pendingPages: 0,
                totalMedia: state.stats.totalMedia,
                currentDiscoveryFile: null,
                currentPage: null,
                endTime: Date.now(),
              });
            } else {
              await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
                status: 'running',
                pendingPages: state.stats.totalPages - state.stats.scannedPages,
                lastUpdated: Date.now(),
              });
            }
          }
          emit('pageScanned', {
            page: data?.page,
            sourceFile: data?.sourceFile,
            mediaCount: data?.mediaCount || 0,
            stats: state.stats,
          });
          break;
        }

        case 'markPageScanned':
          break;

        case 'batchComplete': {
          emit('batchComplete', { ...data, stats: state.stats });
          const isDiscoveryComplete = state.processingStateManager
            ? await state.processingStateManager.isDiscoveryComplete(state.currentSessionId)
            : false;
          const isScanningComplete = state.stats.scannedPages >= state.stats.totalPages
            && state.stats.totalPages > 0;
          if (state.processingStateManager && state.currentSessionId) {
            if (isScanningComplete) {
              await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
                status: 'completed',
                scannedPages: state.stats.scannedPages,
                pendingPages: 0,
                totalMedia: state.stats.totalMedia,
                currentDiscoveryFile: null,
                currentPage: null,
                endTime: Date.now(),
              });
            } else {
              await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
                status: 'running',
                lastUpdated: Date.now(),
              });
            }
          }
          if (isDiscoveryComplete && isScanningComplete && !state.isStopping) {
            await startBatchProcessingPhase();
          }
          break;
        }

        case 'pageScanError':
          state.stats.errors += 1;
          if (data?.page && data?.sourceFile) {
            await state.persistenceManager.savePageScanStatus({
              pagePath: data.page,
              sourceFile: data.sourceFile,
              status: 'failed',
              mediaCount: 0,
              sessionId: state.currentSessionId,
              lastScannedAt: Date.now(),
            });
          }
          if (state.processingStateManager && state.currentSessionId) {
            await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
              failedPages: state.stats.errors,
              lastError: data?.error || 'Unknown error',
              lastErrorPage: data?.page || '',
              lastErrorTime: Date.now(),
            });
          }
          emit('pageScanError', data);
          break;

        case 'queueProcessingStopped':
          if (state.completionProcessed) {
            console.log('[Queue Manager] ⚠️ Already processed completion, skipping duplicate queueProcessingStopped');
            return;
          }

          console.log('[Queue Manager] 🎯 Worker stopped, completing scanning process...');
          state.completionProcessed = true;

          // Save final checkpoint
          if (state.processingStateManager && state.currentSessionId) {
            let discoveryFiles = state.discoveryFilesCache;
            if (!discoveryFiles || discoveryFiles.length === 0) {
              discoveryFiles = await loadDiscoveryFilesWithChangeDetection();
            }
            await state.processingStateManager.saveScanningCheckpointFile({
              status: 'completed',
              totalPages: state.stats.totalPages,
              scannedPages: state.stats.scannedPages,
              totalMedia: state.stats.totalMedia,
              files: await Promise.all(
                discoveryFiles.map(async (file) => {
                  const completedPages = await state.persistenceManager.getCompletedPagesByFile(
                    file.fileName,
                  );
                  return {
                    fileName: file.fileName,
                    status: 'completed',
                    totalDocuments: file.documents.length,
                    scannedDocuments: completedPages.length,
                  };
                }),
              ),
            });
          }

          await updateAllDiscoveryFiles();
          await updateSiteStructureWithMediaCounts();
          await stopQueueScanning(true, 'completed');
          emit('queueProcessingStopped', data);
          break;

        case 'error':
          state.stats.errors += 1;
          if (state.processingStateManager && state.currentSessionId) {
            await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
              status: 'error',
              errors: state.stats.errors,
              lastError: data?.error || 'Worker error',
              lastErrorTime: Date.now(),
            });
          }
          emit('workerError', { worker: 'scan', ...data });
          break;

        case 'mediaDiscovered':
          await processMediaImmediately(data.media, state.currentSessionId);
          break;

        default:
      }
    };

    state.scanWorker.onerror = (error) => {
      state.stats.errors += 1;
      emit('workerError', { worker: 'scan', error: error.message });
    };
  }

  /**
   * Setup discovery manager event handlers
   */
  function setupDiscoveryManagerHandlers() {
    if (state.discoveryHandlersSetup) {
      return;
    }

    if (!state.discoveryManager) {
      return;
    }

    state.discoveryHandlersSetup = true;

    state.discoveryManager.on('documentsDiscovered', async (data) => {
      try {
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
            totalDocuments: data.totalDocumentsSoFar || 0,
            status: 'running',
          });
        }
        if (data.documents && data.documents.length > 0) {
          const folderPath = data.folderPath || 'root';
          const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
          const discoveryFile = `/${state.config.org}/${state.config.repo}/.media/.pages/${folderName}.json`;
          await addDocumentsForScanning(discoveryFile, data.documents);
        }
      } catch (error) {
        console.error('[Queue Manager] ❌ Failed to update discovery progress:', error);
      }
    });

    state.discoveryManager.on('folderComplete', async (data) => {
      try {
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
            completedFolders: data.completedFolders || 0,
            totalFolders: data.totalFolders || 0,
            totalDocuments: data.totalDocumentsSoFar || 0,
            status: data.completedFolders >= data.totalFolders ? 'completed' : 'running',
          });
        }
        if (data.documents && data.documents.length > 0) {
          const folderPath = data.folderPath || (data.workerId ? data.workerId.split('_')[1] : 'root');
          const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
          const discoveryFile = `/${state.config.org}/${state.config.repo}/.media/.pages/${folderName}.json`;
          await addDocumentsForScanning(discoveryFile, data.documents);
        }
        if (data.completedFolders >= data.totalFolders) {
          state.discoveryComplete = true;
          // Populate discovery files cache when discovery completes
          if (!state.discoveryFilesCache || state.discoveryFilesCache.length === 0) {
            state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
            console.log('[Queue Manager] 📋 Populated discovery files cache after completion:', {
              fileCount: state.discoveryFilesCache.length,
              fileNames: state.discoveryFilesCache.map((f) => f.fileName),
            });
          }
        }
      } catch (error) {
        console.error('[Queue Manager] ❌ Error in folderComplete handler:', error);
        state.stats.errors += 1;
      }
    });

    state.discoveryManager.on('documentsChanged', async (data) => {
      try {
        if (data.documents && data.documents.length > 0) {
          const folderPath = data.folder || 'root';
          const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
          const discoveryFile = `/${state.config.org}/${state.config.repo}/.media/.pages/${folderName}.json`;
          await addDocumentsForScanning(discoveryFile, data.documents);
        }
      } catch (error) {
        console.error('[Queue Manager] ❌ Failed to handle documentsChanged:', error);
        state.stats.errors += 1;
      }
    });

    state.discoveryManager.on('discoveryComplete', async (data) => {
      try {
        console.log('[Queue Manager] ✅ Discovery completed, populating discovery files cache...');
        // Populate discovery files cache when discovery completes
        state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
        console.log('[Queue Manager] 📋 Populated discovery files cache after completion:', {
          fileCount: state.discoveryFilesCache.length,
          fileNames: state.discoveryFilesCache.map((f) => f.fileName),
        });
      } catch (error) {
        console.error('[Queue Manager] ❌ Failed to populate discovery files cache:', error);
      }
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
      totalMedia: 0,
      errors: 0,
    };
    state.discoveryFilesCache = null;
    state.documentsToScan = [];
    state.completionProcessed = false;
  }

  /**
   * Add event listener
   */
  function on(event, callback) {
    eventEmitter.on(event, callback);
  }

  /**
   * Remove event listener
   */
  function off(event, callback) {
    eventEmitter.off(event, callback);
  }

  /**
   * Emit event to listeners
   */
  function emit(event, data) {
    eventEmitter.emit(event, data);
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

    // Cleanup core services
    if (state.sessionManager) {
      state.sessionManager = null;
    }
    if (state.processingStateManager) {
      state.processingStateManager = null;
    }
    if (state.scanStatusManager) {
      state.scanStatusManager = null;
    }

    state.isActive = false;
    eventEmitter.clearListeners();
  }

  /**
   * Load all discovery files from .pages folder
   */
  async function loadDiscoveryFiles() {
    return discoveryFileManager.loadDiscoveryFiles(state.config, state.daApi);
  }

  /**
   * Clear discovery files from .pages folder
   */
  async function clearDiscoveryFiles() {
    await discoveryFileManager.clearDiscoveryFiles(state.config, state.daApi);
    if (state.discoveryManager && typeof state.discoveryManager.clearStructureBaseline === 'function') {
      await state.discoveryManager.clearStructureBaseline();
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
        totalDocuments += 1;
        const hasScanStatus = Object.prototype.hasOwnProperty.call(doc, 'scanStatus');
        const hasScanComplete = Object.prototype.hasOwnProperty.call(doc, 'scanComplete');
        let needsScan = false;
        let scanReason = 'unknown';
        if (forceRescan) {
          needsScan = true;
          scanReason = 'force';
        } else if (hasScanStatus) {
          needsScan = doc.scanStatus === 'pending' || doc.scanStatus === 'failed';
          if (needsScan) {
            scanReason = doc.scanStatus === 'failed' ? 'retry' : 'new';
            if (doc.scanStatus === 'failed') {
              changedDocuments += 1;
            } else {
              newDocuments += 1;
            }
          }
        } else {
          needsScan = !doc.scanComplete || doc.needsRescan;
          if (needsScan) {
            if (!hasScanComplete) {
              scanReason = 'new';
              newDocuments += 1;
            } else if (doc.needsRescan) {
              scanReason = 'changed';
              changedDocuments += 1;
            } else {
              scanReason = 'incomplete';
            }
          }
        }
        if (!hasScanComplete && !hasScanStatus) {
          missingScanComplete += 1;
        }
        if (needsScan) {
          if (!doc.path) {
            return;
          }
          documentsToScan.push({
            ...doc,
            sourceFile: file.fileName,
            scanReason,
          });
        } else {
          alreadyScanned += 1;
        }
        if (doc.needsRescan) {
          needsRescan += 1;
        }
      });
    });
    console.log('[Queue Manager] 📋 Document scanning analysis:', {
      totalDocuments,
      documentsToScan: documentsToScan.length,
      alreadyScanned,
      newDocuments,
      changedDocuments,
      needsRescan,
      missingScanComplete,
      scanReasons: documentsToScan.reduce((acc, doc) => {
        acc[doc.scanReason] = (acc[doc.scanReason] || 0) + 1;
        return acc;
      }, {}),
    });
    return documentsToScan;
  }

  /**
   * Detect changed documents by comparing lastModified timestamps
   */
  async function detectChangedDocuments(discoveryFiles) {
    let changedCount = 0;
    let unchangedCount = 0;
    discoveryFiles.forEach((file) => {
      file.documents.forEach((doc) => {
        if (doc.lastScanned && doc.lastModified) {
          const lastScannedTime = new Date(doc.lastScanned).getTime();
          const lastModifiedTime = new Date(doc.lastModified).getTime();
          if (lastModifiedTime > lastScannedTime) {
            doc.needsRescan = true;
            changedCount += 1;
          } else {
            doc.needsRescan = false;
            unchangedCount += 1;
          }
        } else {
          doc.needsRescan = true;
          changedCount += 1;
        }
      });
    });

    return { changedCount, unchangedCount };
  }

  /**
   * Load discovery files with change detection
   */
  async function loadDiscoveryFilesWithChangeDetection() {
    return discoveryFileManager.loadDiscoveryFilesWithChangeDetection(
      state.config,
      state.daApi,
      detectChangedDocuments,
    );
  }

  async function requestBatch() {
    try {
      if (state.isStopping) {
        return;
      }

      if (!state.discoveryFilesCache || !state.documentsToScan) {
        state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
        state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, false);
      }

      const batch = state.documentsToScan.slice(0, state.batchSize);

      if (batch.length > 0) {
        state.documentsToScan = state.documentsToScan.slice(state.batchSize);
      }

      // Always send response to worker (even if empty)
      state.scanWorker.postMessage({
        type: 'processBatch',
        data: { pages: batch },
      });

      // If empty, tell worker to stop
      if (batch.length === 0 && !state.isStopping) {
        state.scanWorker.postMessage({
          type: 'stopQueueProcessing',
        });
      }

      // Save checkpoint for running batches
      if (batch.length > 0 && state.processingStateManager && state.currentSessionId) {
        const currentFile = batch[0]?.sourceFile;
        const currentPath = batch[0]?.path;
        await state.processingStateManager.saveScanningCheckpointFile({
          status: 'running',
          totalPages: state.stats.totalPages,
          scannedPages: state.stats.scannedPages,
          totalMedia: state.stats.totalMedia,
          currentFile,
          currentPath,
          lastBatchSize: batch.length,
          lastBatchTime: Date.now(),
          remainingDocuments: state.stats.totalPages - state.stats.scannedPages,
          files: await Promise.all((state.discoveryFilesCache || []).map(async (file) => {
            const filePath = `/${state.config.org}/${state.config.repo}/.media/.pages/${file.fileName}`;
            const contentUrl = `${CONTENT_DA_LIVE_BASE}${filePath}.json`;
            try {
              const parsedData = await loadData(contentUrl, state.config.token);
              const documents = parsedData.data || [];
              const completedDocs = documents.filter((doc) => doc.scanStatus === 'completed').length;
              return {
                fileName: file.fileName,
                status: completedDocs === documents.length ? 'completed' : 'partial',
                totalDocuments: documents.length,
                scannedDocuments: completedDocs,
              };
            } catch (error) {
              return {
                fileName: file.fileName,
                status: 'partial',
                totalDocuments: file.documents.length,
                scannedDocuments: 0,
              };
            }
          })),
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
  async function resumeDiscoveryFromCheckpoint(discoveryCheckpoint) {
    try {
      const { folders } = await state.discoveryManager.getTopLevelItems();
      const pendingFolders = [];
      const completedFolders = [];
      folders.forEach((folder) => {
        const folderName = folder.path === '/' ? 'root' : folder.path.split('/').pop() || 'root';
        const isCompleted = discoveryCheckpoint.folderStatus?.[folderName]?.status === 'completed';
        if (isCompleted) {
          completedFolders.push(folder);
        } else {
          pendingFolders.push(folder);
        }
      });
      state.stats.totalPages = discoveryCheckpoint.totalDocuments || 0;
      state.stats.completedFolders = completedFolders.length;
      state.stats.totalFolders = folders.length;
      if (pendingFolders.length === 0) {
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
      console.log('[Queue Manager] 🔄 Resuming discovery with pending folders only');
      if (state.processingStateManager && state.currentSessionId) {
        await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
          totalFolders: folders.length,
          completedFolders: completedFolders.length,
          totalDocuments: discoveryCheckpoint.totalDocuments || 0,
        });
      }
      await state.discoveryManager.resumeDiscovery(pendingFolders, completedFolders);
    } catch (error) {
      console.error('[Queue Manager] Failed to resume discovery from checkpoint:', error);
      await state.discoveryManager.startDiscoveryWithSession(
        state.currentSessionId,
      );
    }
  }

  /**
   * Resume scanning from checkpoint with delta processing
   */
  async function resumeScanningFromCheckpoint(scanCheckpoint) {
    try {
      // Handle both old and new field names
      const totalDocuments = scanCheckpoint?.totalDocuments || scanCheckpoint?.totalPages;
      const scannedDocuments = scanCheckpoint?.scannedDocuments || scanCheckpoint?.scannedPages;

      if (!scanCheckpoint || !totalDocuments || totalDocuments < 0) {
        console.error('[Queue Manager] Invalid scanning checkpoint data:', scanCheckpoint);
        throw new Error('Invalid scanning checkpoint data');
      }
      state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
      state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, false);
      state.stats.scannedPages = Math.max(0, scannedDocuments || 0);
      state.stats.totalPages = Math.max(0, totalDocuments || 0);
      state.stats.totalMedia = Math.max(0, scanCheckpoint.totalMedia || 0);
      state.discoveryComplete = true;

      if (scanCheckpoint.currentFile && scanCheckpoint.currentPath) {
        const resumeIndex = state.documentsToScan.findIndex(
          (doc) => doc.sourceFile === scanCheckpoint.currentFile
            && doc.path === scanCheckpoint.currentPath,
        );

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

  /**
   * Enhanced structural change detection with incremental discovery support
   * @returns {Promise<Object>} Object containing change details and whether
   * incremental discovery is possible
   */
  async function checkDiscoveryFilesExist() {
    try {
      const discoveryCheckpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
      const discoveryFiles = await loadDiscoveryFiles();
      return {
        checkpointValid: discoveryCheckpoint.status === 'completed',
        filesExist: discoveryFiles.length > 0,
        shouldRunDiscovery: discoveryCheckpoint.status !== 'completed' || discoveryFiles.length === 0,
      };
    } catch (error) {
      console.error('[Queue Manager] Error checking discovery files:', error);
      return {
        checkpointValid: false,
        filesExist: false,
        shouldRunDiscovery: true,
      };
    }
  }
  async function checkMediaAvailable() {
    try {
      const persistenceManager = createPersistenceManager();
      await persistenceManager.init();
      const queueItems = await persistenceManager.getProcessingQueue(state.currentSessionId);
      return {
        checkpointValid: true,
        mediaAvailable: queueItems.length > 0,
        shouldRunUpload: false,
      };
    } catch (error) {
      console.error('[Queue Manager] Error checking media availability:', error);
      return {
        checkpointValid: false,
        mediaAvailable: false,
        shouldRunUpload: false,
      };
    }
  }
  async function triggerUploadPhase() {
    const uploadStatus = await checkMediaAvailable();
    if (uploadStatus.mediaAvailable && state.batchProcessingPhase?.status !== 'running') {
      await startBatchProcessingPhase();
    }
  }
  async function checkForStructuralChanges() {
    try {
      console.log('[Queue Manager] 🔍 Starting structural change detection');
      if (!state.config) {
        console.error('[Queue Manager] Config not available for checkForStructuralChanges');
        return { hasChanges: false, canUseIncremental: false };
      }

      console.log('[Queue Manager] 🔍 Starting enhanced structural change detection');

      // Check if discovery manager has the required method
      if (!state.discoveryManager || typeof state.discoveryManager.getStructuralChanges !== 'function') {
        console.log('[Queue Manager] ℹ️ Structural change detection not available, assuming no changes');
        return {
          hasChanges: false,
          canUseIncremental: false,
          changes: {
            newFolders: [],
            deletedFolders: [],
            newFiles: [],
            deletedFiles: [],
            modifiedFiles: [],
          },
        };
      }

      // Get detailed structural changes from discovery manager
      const structuralChanges = await state.discoveryManager.getStructuralChanges();

      const hasChanges = structuralChanges.newFolders.length > 0
        || structuralChanges.deletedFolders.length > 0
        || structuralChanges.newFiles.length > 0
        || structuralChanges.deletedFiles.length > 0
        || structuralChanges.modifiedFiles.length > 0;

      // Determine if incremental discovery is possible
      const canUseIncremental = hasChanges
        && (structuralChanges.newFolders.length > 0
          || structuralChanges.newFiles.length > 0
          || structuralChanges.modifiedFiles.length > 0);

      return {
        hasChanges,
        canUseIncremental,
        changes: structuralChanges,
      };
    } catch (error) {
      console.error('[Queue Manager] ❌ Error during enhanced structural change detection:', error);
      return { hasChanges: false, canUseIncremental: false, error: error.message };
    }
  }

  /**
   * Perform incremental discovery for structural changes
   * @param {Object} changes - Structural changes object
   * @returns {Promise<boolean>} True if incremental discovery was successful
   */
  async function performIncrementalDiscovery(changes) {
    try {
      console.log('[Queue Manager] 🚀 Starting incremental discovery process');

      // Check if discovery manager has the required methods
      if (!state.discoveryManager
          || typeof state.discoveryManager.performIncrementalDiscovery !== 'function'
          || typeof state.discoveryManager.mergeIncrementalResults !== 'function') {
        console.log('[Queue Manager] ℹ️ Incremental discovery not available, skipping');
        return false;
      }

      const incrementalResults = await state.discoveryManager.performIncrementalDiscovery(changes);
      console.log('[Queue Manager] 📊 Incremental discovery results:', {
        incrementalResultsCount: incrementalResults.length,
        incrementalResults: incrementalResults.map((r) => ({
          fileName: r.fileName,
          documentCount: r.documents.length,
        })),
      });
      const mergedFiles = await state.discoveryManager.mergeIncrementalResults(incrementalResults);
      console.log('[Queue Manager] 📊 Merged files:', {
        mergedFilesCount: mergedFiles.length,
        mergedFiles: mergedFiles.map((f) => ({
          fileName: f.fileName,
          documentCount: f.documents.length,
        })),
      });
      state.discoveryFilesCache = mergedFiles;
      state.documentsToScan = getDocumentsToScan(mergedFiles, false);
      console.log('[Queue Manager] 📋 Documents to scan after incremental discovery:', {
        totalDocuments: state.documentsToScan.length,
        documentsByReason: state.documentsToScan.reduce((acc, doc) => {
          acc[doc.scanReason] = (acc[doc.scanReason] || 0) + 1;
          return acc;
        }, {}),
      });

      return true;
    } catch (error) {
      console.error('[Queue Manager] ❌ Error during incremental discovery:', error);
      return false;
    }
  }

  async function startBatchProcessingPhase() {
    state.batchProcessingPhase.status = 'running';
    state.batchProcessingPhase.startTime = Date.now();

    emit('batchProcessingStarted', state.batchProcessingPhase);

    try {
      await state.mediaProcessor.processAndUploadQueuedMedia();

      state.batchProcessingPhase.status = 'completed';
      state.batchProcessingPhase.endTime = Date.now();

      emit('batchProcessingComplete', state.batchProcessingPhase);
    } catch (error) {
      state.batchProcessingPhase.status = 'failed';
      state.batchProcessingPhase.endTime = Date.now();

      emit('batchProcessingFailed', { error: error.message, stats: state.batchProcessingPhase });
    }
  }

  async function processAndUploadBatches() {
    const persistenceManager = createPersistenceManager();
    await persistenceManager.init();
    const pendingBatches = await persistenceManager.getPendingBatches(state.currentSessionId);
    state.batchProcessingPhase.totalBatches = pendingBatches.length;

    await state.processingStateManager.updateUploadProgress(state.currentSessionId, {
      totalBatches: pendingBatches.length,
    });

    for (let i = 0; i < pendingBatches.length; i += 1) {
      const batch = pendingBatches[i];

      try {
        state.batchProcessingPhase.processedBatches = i + 1;

        await state.processingStateManager.saveBatchStatus(
          state.currentSessionId,
          batch.id,
          'processing',
        );

        await uploadBatchSequentially(batch);

        state.batchProcessingPhase.uploadedBatches += 1;
        state.batchProcessingPhase.totalMedia += batch.media.length;

        await state.processingStateManager.updateUploadProgress(state.currentSessionId, {
          processedBatches: state.batchProcessingPhase.processedBatches,
          uploadedBatches: state.batchProcessingPhase.uploadedBatches,
          totalMedia: state.batchProcessingPhase.totalMedia,
          currentBatch: batch.batchNumber,
        });

        await state.processingStateManager.saveBatchStatus(
          state.currentSessionId,
          batch.id,
          'completed',
        );

        emit('batchUploaded', {
          batchNumber: batch.batchNumber,
          mediaCount: batch.media.length,
          stats: state.batchProcessingPhase,
        });
      } catch (error) {
        state.batchProcessingPhase.failedBatches += 1;

        await state.processingStateManager.saveBatchStatus(
          state.currentSessionId,
          batch.id,
          'failed',
        );

        await state.processingStateManager.updateRetryAttempts(
          state.currentSessionId,
          batch.id,
          batch.retryAttempts || 0,
        );

        emit('batchFailed', {
          batchNumber: batch.batchNumber,
          error: error.message,
          stats: state.batchProcessingPhase,
        });
      }
    }
  }

  async function uploadBatchSequentially(batch) {
    try {
      const metadataManager = createMetadataManager(state.daApi, '/.media/media.json');
      await metadataManager.init(state.daApi.getConfig());

      const existingData = await metadataManager.getMetadata();
      const updatedMedia = await state.mediaProcessor.mergeMediaWithDeduplication(
        existingData || [],
        batch.media,
      );

      await metadataManager.saveMetadata(updatedMedia);

      const persistenceManager = createPersistenceManager();
      await persistenceManager.init();
      await persistenceManager.confirmBatchUpload(batch.id, {
        count: updatedMedia.length,
      });
    } catch (error) {
      console.error('[Queue Manager] ❌ Failed to upload batch:', error);
      state.batchProcessingPhase.failedBatches += 1;
      throw error;
    }
  }

  async function updateDiscoveryFileScanStatus(
    fileName,
    pagePath,
    status,
    mediaCount = 0,
    error = null,
  ) {
    return scanStatusUpdater.updateDiscoveryFileScanStatus(
      state.config,
      state.daApi,
      state.processingStateManager,
      fileName,
      pagePath,
      status,
      mediaCount,
      error,
    );
  }

  function configureBatchProcessing(batchConfig) {
    state.batchProcessingConfig = {
      ...state.batchProcessingConfig,
      ...batchConfig,
    };
  }

  function getBatchProcessingConfig() {
    return { ...state.batchProcessingConfig };
  }

  async function loadSiteStructureForComparison() {
    try {
      if (!state.processingStateManager) {
        console.log('[Queue Manager] ℹ️ Processing state manager not available');
        return null;
      }
      const siteStructure = await state.processingStateManager.loadSiteStructureFile();
      if (!siteStructure) {
        console.log('[Queue Manager] ℹ️ No existing site structure found');
        return null;
      }
      console.log('[Queue Manager] ✅ Loaded site structure for comparison:', {
        totalFolders: siteStructure.stats?.totalFolders || 0,
        totalFiles: siteStructure.stats?.totalFiles || 0,
        lastUpdated: siteStructure.lastUpdated,
      });
      return siteStructure;
    } catch (error) {
      console.error('[Queue Manager] ❌ Error loading site structure for comparison:', error);
      return null;
    }
  }
  async function calculateDiscoveryDelta(baselineStructure, currentStructure) {
    try {
      if (!baselineStructure || !currentStructure) {
        return {
          folders: {
            added: [],
            deleted: [],
            modified: [],
            unexcluded: [],
            excluded: [],
          },
          files: {
            added: [],
            deleted: [],
            modified: [],
            unchanged: [],
          },
        };
      }
      const delta = {
        folders: {
          added: [],
          deleted: [],
          modified: [],
          unexcluded: [],
          excluded: [],
        },
        files: {
          added: [],
          deleted: [],
          modified: [],
          unchanged: [],
        },
      };
      const baselineFolders = Object.keys(baselineStructure.structure.root.subfolders || {});
      const currentFolders = Object.keys(currentStructure.structure.root.subfolders || {});
      baselineFolders.forEach((folderName) => {
        if (!currentFolders.includes(folderName)) {
          delta.folders.deleted.push(folderName);
        }
      });
      currentFolders.forEach((folderName) => {
        if (!baselineFolders.includes(folderName)) {
          delta.folders.added.push(folderName);
        } else {
          const baselineFolder = baselineStructure.structure.root.subfolders[folderName];
          const currentFolder = currentStructure.structure.root.subfolders[folderName];
          if (baselineFolder.excluded && !currentFolder.excluded) {
            delta.folders.unexcluded.push(folderName);
          } else if (!baselineFolder.excluded && currentFolder.excluded) {
            delta.folders.excluded.push(folderName);
          } else if (baselineFolder.files.length !== currentFolder.files.length) {
            delta.folders.modified.push(folderName);
            const fileChanges = calculateFileChanges(baselineFolder.files, currentFolder.files);
            delta.files.added.push(...fileChanges.added);
            delta.files.deleted.push(...fileChanges.deleted);
            delta.files.modified.push(...fileChanges.modified);
          }
        }
      });
      console.log('[Queue Manager] ✅ Calculated discovery delta:', {
        foldersAdded: delta.folders.added.length,
        foldersDeleted: delta.folders.deleted.length,
        foldersModified: delta.folders.modified.length,
        foldersUnexcluded: delta.folders.unexcluded.length,
        foldersExcluded: delta.folders.excluded.length,
        filesAdded: delta.files.added.length,
        filesDeleted: delta.files.deleted.length,
        filesModified: delta.files.modified.length,
      });
      return delta;
    } catch (error) {
      console.error('[Queue Manager] ❌ Error calculating discovery delta:', error);
      return {
        folders: {
          added: [],
          deleted: [],
          modified: [],
          unexcluded: [],
          excluded: [],
        },
        files: {
          added: [],
          deleted: [],
          modified: [],
          unchanged: [],
        },
      };
    }
  }
  function calculateFileChanges(baselineFiles, currentFiles) {
    const changes = {
      added: [],
      deleted: [],
      modified: [],
    };
    const baselineFilePaths = new Set(baselineFiles.map((f) => f.path));
    const currentFilePaths = new Set(currentFiles.map((f) => f.path));
    baselineFiles.forEach((file) => {
      if (!currentFilePaths.has(file.path)) {
        changes.deleted.push(file);
      } else {
        const currentFile = currentFiles.find((f) => f.path === file.path);
        if (currentFile && currentFile.lastModified !== file.lastModified) {
          changes.modified.push(currentFile);
        }
      }
    });
    currentFiles.forEach((file) => {
      if (!baselineFilePaths.has(file.path)) {
        changes.added.push(file);
      }
    });
    return changes;
  }

  async function generateDiscoveryFileForFolder(folderPath, folderData) {
    try {
      if (!state.processingStateManager) {
        console.log('[Queue Manager] ℹ️ Processing state manager not available');
        return null;
      }
      const documentsToSave = folderData.files.map((file) => ({
        ...file,
        scanStatus: 'pending',
        scanComplete: false,
        needsRescan: false,
        lastScannedAt: null,
        scanAttempts: 0,
        scanErrors: [],
        mediaCount: 0,
      }));
      const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop();
      const discoveryFile = `${folderName}.json`;
      const filePath = `/${state.config.org}/${state.config.repo}/.media/.pages/${discoveryFile}`;
      const jsonToWrite = buildSingleSheet(documentsToSave);
      const url = `${state.config.baseUrl}/source${filePath}`;
      await saveSheetFile(url, jsonToWrite, state.config.token);
      console.log('[Queue Manager] ✅ Generated discovery file for new folder:', {
        folderPath,
        discoveryFile,
        documentCount: documentsToSave.length,
      });
      return discoveryFile;
    } catch (error) {
      console.error('[Queue Manager] ❌ Error generating discovery file for folder:', error);
      return null;
    }
  }
  async function updateDiscoveryFileForFileChanges(folderPath, fileChanges) {
    try {
      if (!state.processingStateManager) {
        console.log('[Queue Manager] ℹ️ Processing state manager not available');
        return false;
      }
      const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop();
      const discoveryFile = `${folderName}.json`;
      const filePath = `/${state.config.org}/${state.config.repo}/.media/.pages/${discoveryFile}`;
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${filePath}`;
      const existingData = await loadData(contentUrl, state.config.token);
      let documents = [];
      if (existingData.data && Array.isArray(existingData.data) && existingData.data.length > 0) {
        documents = existingData.data[0].data || [];
      }
      const updatedDocuments = [...documents];
      fileChanges.added.forEach((file) => {
        const newDocument = {
          ...file,
          scanStatus: 'pending',
          scanComplete: false,
          needsRescan: false,
          lastScannedAt: null,
          scanAttempts: 0,
          scanErrors: [],
          mediaCount: 0,
        };
        updatedDocuments.push(newDocument);
      });
      fileChanges.modified.forEach((file) => {
        const existingIndex = updatedDocuments.findIndex((doc) => doc.path === file.path);
        if (existingIndex !== -1) {
          updatedDocuments[existingIndex] = {
            ...updatedDocuments[existingIndex],
            lastModified: file.lastModified,
            needsRescan: true,
            scanStatus: 'pending',
            scanComplete: false,
          };
        }
      });
      fileChanges.deleted.forEach((file) => {
        const existingIndex = updatedDocuments.findIndex((doc) => doc.path === file.path);
        if (existingIndex !== -1) {
          updatedDocuments.splice(existingIndex, 1);
        }
      });
      const jsonToWrite = buildSingleSheet(updatedDocuments);
      const url = `${state.config.baseUrl}/source${filePath}`;
      await saveSheetFile(url, jsonToWrite, state.config.token);
      console.log('[Queue Manager] ✅ Updated discovery file for file changes:', {
        folderPath,
        discoveryFile,
        added: fileChanges.added.length,
        modified: fileChanges.modified.length,
        deleted: fileChanges.deleted.length,
        totalDocuments: updatedDocuments.length,
      });
      return true;
    } catch (error) {
      console.error('[Queue Manager] ❌ Error updating discovery file for file changes:', error);
      return false;
    }
  }

  async function processDiscoveryDelta(delta, baselineStructure, currentStructure) {
    try {
      console.log('[Queue Manager] 🔄 Processing discovery delta...');
      const results = {
        newDiscoveryFiles: [],
        updatedDiscoveryFiles: [],
        errors: [],
      };
      await Promise.all(delta.folders.added.map(async (folderName) => {
        try {
          const folderPath = `/${state.config.org}/${state.config.repo}/${folderName}`;
          const folderData = currentStructure.structure.root.subfolders[folderName];
          const discoveryFile = await generateDiscoveryFileForFolder(folderPath, folderData);
          if (discoveryFile) {
            results.newDiscoveryFiles.push(discoveryFile);
          }
        } catch (error) {
          console.error('[Queue Manager] ❌ Error processing added folder:', folderName, error);
          results.errors.push({ type: 'added_folder', folder: folderName, error: error.message });
        }
      }));
      await Promise.all(delta.folders.unexcluded.map(async (folderName) => {
        try {
          const folderPath = `/${state.config.org}/${state.config.repo}/${folderName}`;
          const folderData = currentStructure.structure.root.subfolders[folderName];
          const discoveryFile = await generateDiscoveryFileForFolder(folderPath, folderData);
          if (discoveryFile) {
            results.newDiscoveryFiles.push(discoveryFile);
          }
        } catch (error) {
          console.error('[Queue Manager] ❌ Error processing unexcluded folder:', folderName, error);
          results.errors.push({ type: 'unexcluded_folder', folder: folderName, error: error.message });
        }
      }));
      await Promise.all(delta.folders.modified.map(async (folderName) => {
        try {
          const folderPath = `/${state.config.org}/${state.config.repo}/${folderName}`;
          const baselineFolder = baselineStructure.structure.root.subfolders[folderName];
          const currentFolder = currentStructure.structure.root.subfolders[folderName];
          const fileChanges = calculateFileChanges(baselineFolder.files, currentFolder.files);
          if (fileChanges.added.length > 0 || fileChanges.modified.length > 0
              || fileChanges.deleted.length > 0) {
            const success = await updateDiscoveryFileForFileChanges(folderPath, fileChanges);
            if (success) {
              results.updatedDiscoveryFiles.push(`${folderName}.json`);
            }
          }
        } catch (error) {
          console.error('[Queue Manager] ❌ Error processing modified folder:', folderName, error);
          results.errors.push({ type: 'modified_folder', folder: folderName, error: error.message });
        }
      }));
      console.log('[Queue Manager] ✅ Completed delta processing:', {
        newDiscoveryFiles: results.newDiscoveryFiles.length,
        updatedDiscoveryFiles: results.updatedDiscoveryFiles.length,
        errors: results.errors.length,
      });
      return results;
    } catch (error) {
      console.error('[Queue Manager] ❌ Error processing discovery delta:', error);
      return {
        newDiscoveryFiles: [],
        updatedDiscoveryFiles: [],
        errors: [{ type: 'delta_processing', error: error.message }],
      };
    }
  }

  async function updateSiteStructureMediaCount(pagePath, mediaCount) {
    return scanStatusUpdater.updateSiteStructureMediaCount(
      state.processingStateManager,
      pagePath,
      mediaCount,
    );
  }

  function updateFolderMediaCount(folder, pagePath, mediaCount) {
    return scanStatusUpdater.updateFolderMediaCount(folder, pagePath, mediaCount);
  }

  async function updateAllDiscoveryFiles() {
    let discoveryFiles = state.discoveryFilesCache;
    if (!discoveryFiles || discoveryFiles.length === 0) {
      discoveryFiles = await loadDiscoveryFilesWithChangeDetection();
    }

    return scanStatusUpdater.updateAllDiscoveryFiles(
      state.config,
      state.daApi,
      state.persistenceManager,
      discoveryFiles,
    );
  }
  async function updateSiteStructureWithMediaCounts() {
    try {
      console.log('[Queue Manager] 🔄 Reconstructing site structure from updated discovery files...');

      // Use the site aggregator to create proper site structure format
      const siteAggregator = createSiteAggregator();
      siteAggregator.init(state.config);
      siteAggregator.setDaApi(state.daApi);

      const newSiteStructure = await siteAggregator.createSiteStructure();

      if (newSiteStructure) {
        // Save the reconstructed site structure
        await state.processingStateManager.saveSiteStructureFile(newSiteStructure);
        console.log('[Queue Manager] ✅ Site structure reconstructed and saved from discovery files:', {
          totalFolders: newSiteStructure?.stats?.totalFolders || 0,
          totalFiles: newSiteStructure?.stats?.totalFiles || 0,
          totalMediaItems: newSiteStructure?.stats?.totalMediaItems || 0,
        });
      } else {
        console.error('[Queue Manager] ❌ Failed to create site structure');
      }

      // Clear media store to prevent stale data in next scan
      try {
        await state.persistenceManager.clearMediaStore();
        console.log('[Queue Manager] 🗑️ Cleared media store to prevent stale data');
      } catch (error) {
        console.warn('[Queue Manager] ⚠️ Failed to clear media store:', error.message);
      }
    } catch (error) {
      console.error('[Queue Manager] ❌ Failed to reconstruct site structure:', error);
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
    resetStats,
    resumeDiscoveryFromCheckpoint,
    resumeScanningFromCheckpoint,
    detectChangedDocuments,
    loadDiscoveryFilesWithChangeDetection,
    checkForStructuralChanges,
    performIncrementalDiscovery,
    startBatchProcessingPhase,
    processAndUploadBatches,
    uploadBatchSequentially,
    configureBatchProcessing,
    getBatchProcessingConfig,
    processRemainingMedia,
    loadSiteStructureForComparison,
    calculateDiscoveryDelta,
    generateDiscoveryFileForFolder,
    updateDiscoveryFileForFileChanges,
    processDiscoveryDelta,
    updateSiteStructureMediaCount,
    updateAllDiscoveryFiles,
    updateSiteStructureWithMediaCounts,
  };
}
