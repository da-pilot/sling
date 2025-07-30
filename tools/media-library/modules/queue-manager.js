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

export default function createQueueManager() {
  const state = {
    scanWorker: null,
    discoveryManager: null,
    sessionManager: null,
    processingStateManager: null,
    scanStatusManager: null,
    mediaProcessor: null, // Add media processor reference
    daApi: null,
    isActive: false,
    isStopping: false,
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
    listeners: new Map(),
    batchSize: 10,
  };

  let config = null;

  /**
   * Initialize queue manager with persistent state and multi-threaded discovery
   */
  async function init(
    docAuthoringService,
    sessionManagerInstance,
    processingStateManagerInstance,
    mediaProcessorInstance,
  ) {
    config = docAuthoringService.getConfig();
    try {
      state.daApi = docAuthoringService;

      if (sessionManagerInstance) {
        state.sessionManager = sessionManagerInstance;
      } else {
        state.sessionManager = createSessionManager();
        await state.sessionManager.init(docAuthoringService);
      }

      if (processingStateManagerInstance) {
        state.processingStateManager = processingStateManagerInstance;
      } else {
        state.processingStateManager = createProcessingStateManager(docAuthoringService);
        await state.processingStateManager.init(config);
      }

      if (mediaProcessorInstance) {
        state.mediaProcessor = mediaProcessorInstance;
      } else {
        // This will be initialized in startQueueScanning if not provided
      }

      state.discoveryManager = createDiscoveryManager();
      await state.discoveryManager.init(
        docAuthoringService,
        state.sessionManager,
        state.processingStateManager,
        state.scanStatusManager,
      );

      state.scanWorker = new Worker('./workers/media-scan-worker.js', { type: 'module' });
      setupScanWorkerHandlers();

      await initializeWorker(state.scanWorker, 'scan', config);
      return true;
    } catch (error) {
      console.error('Queue Manager initialization failed:', error.message);
      cleanup();
      throw error;
    }
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
      // eslint-disable-next-line no-console
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
        const uploadCheckpoint = await state.processingStateManager.loadUploadCheckpoint();
        const isIncremental = (forceRescan || (!forceRescan && discoveryCheckpoint.status === 'completed'));
        const needsDiscovery = forceRescan || !discoveryCheckpoint.status || discoveryCheckpoint.status === 'idle';
        const needsScanning = scanningCheckpoint.status !== 'completed';
        const needsUpload = uploadCheckpoint.status !== 'completed';
        if (needsDiscovery && state.discoveryManager) {
          setupDiscoveryManagerHandlers();
          if (isIncremental) {
            const changeResult = await checkForStructuralChanges();
            const incrementalSuccess = await performIncrementalDiscovery(changeResult.changes);
            if (!incrementalSuccess) {
              await state.discoveryManager.startDiscoveryWithSession(sessionId);
            }
          } else if (discoveryCheckpoint.status === 'running') {
            await resumeDiscoveryFromCheckpoint(discoveryCheckpoint);
          } else {
            await state.discoveryManager.startDiscoveryWithSession(sessionId);
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
          if (needsUpload && uploadStatus.mediaAvailable) {
            if (uploadCheckpoint.status === 'running') {
              await startBatchProcessingPhase();
            } else {
              await triggerUploadPhase();
            }
          }
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

    if (state.scanWorker) {
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
    try {
      console.log('🚀 [SCANNING] Starting scanning phase with discovery file:', discoveryFile);
      let discoveryFiles = state.discoveryFilesCache;
      if (!discoveryFiles) {
        discoveryFiles = await loadDiscoveryFiles();
      }
      const documentsToScan = getDocumentsToScan(discoveryFiles, forceRescan);
      const totalPages = discoveryFiles.reduce((sum, file) => sum + file.documents.length, 0);

      console.log('🚀 [SCANNING] Calculated total pages:', {
        totalPages,
        documentsToScan: documentsToScan.length,
        discoveryFiles: discoveryFiles.length,
      });

      state.stats.totalPages = totalPages;
      state.stats.queuedPages = documentsToScan.length;
      state.stats.startTime = Date.now();
      state.discoveryFilesCache = discoveryFiles;
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

      console.log('🚀 [SCANNING] Scanning phase started successfully');
    } catch (error) {
      console.error('[Queue Manager] ❌ Failed to start scanning phase:', error);
      throw error;
    }
  }

  /**
   * Add a folder's discovery file to the scanning queue
   */
  async function addFolderToScanningQueue(discoveryFile, documents) {
    try {
      console.log('[Queue Manager] 📝 Adding folder to scanning queue:', {
        discoveryFile,
        documentCount: documents.length,
        isScanningActive: state.isActive,
      });

      // If scanning is not yet active, start it
      if (!state.isActive) {
        console.log('[Queue Manager] 🚀 Starting scanning phase for first folder');
        await startScanningPhase(discoveryFile, false);
        return;
      }

      // If scanning is already active, add documents to existing queue
      if (state.scanWorker && state.isActive) {
        // Add new documents incrementally to existing queue
        const newDocumentsToScan = getDocumentsToScan([{ documents }], false);
        // Deduplicate to avoid adding the same document multiple times
        const existingPaths = new Set(state.documentsToScan.map((doc) => doc.path));
        const uniqueNewDocuments = newDocumentsToScan.filter((doc) => !existingPaths.has(doc.path));

        state.documentsToScan.push(...uniqueNewDocuments);

        // Update stats incrementally
        state.stats.totalPages += documents.length;
        state.stats.queuedPages += uniqueNewDocuments.length;

        console.log('[Queue Manager] 📊 Incrementally updated scanning queue:', {
          newDocuments: uniqueNewDocuments.length,
          totalPages: state.stats.totalPages,
          queuedPages: state.stats.queuedPages,
        });

        // Update scanning progress
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
            totalPages: state.stats.totalPages,
            pendingPages: state.stats.queuedPages,
            currentDiscoveryFile: discoveryFile,
            status: 'running',
          });
        }

        // Trigger batch processing for new documents
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
      console.log('[Queue Manager] 📝 Processing media immediately:', {
        mediaCount: media?.length || 0,
        sessionId,
        hasMediaProcessor: !!state.mediaProcessor,
        currentUserId: state.currentUserId,
        currentBrowserId: state.currentBrowserId,
      });

      if (!state.mediaProcessor) {
        console.error('[Queue Manager] ❌ Media processor not available');
        return;
      }

      if (sessionId && state.currentUserId && state.currentBrowserId) {
        console.log('[Queue Manager] 🔧 Setting session for media processor:', {
          sessionId,
          userId: state.currentUserId,
          browserId: state.currentBrowserId,
        });
        state.mediaProcessor.setCurrentSession(
          sessionId,
          state.currentUserId,
          state.currentBrowserId,
        );
      } else {
        console.warn('[Queue Manager] ⚠️ Missing session info for media processor:', {
          sessionId,
          currentUserId: state.currentUserId,
          currentBrowserId: state.currentBrowserId,
        });
      }

      console.log('[Queue Manager] 📤 Calling queueMediaForBatchProcessing with', media?.length || 0, 'items');
      await state.mediaProcessor.queueMediaForBatchProcessing(media);

      await checkThresholdTrigger();

      console.log('[Queue Manager] ✅ Media processing completed successfully');

      if (state.processingStateManager && sessionId) {
        await state.processingStateManager.updateScanningProgress(sessionId, {
          totalMedia: media.length,
          lastScannedAt: Date.now(),
        });
      }
    } catch (error) {
      console.error('[Queue Manager] ❌ Error processing media immediately:', error);
      console.error('[Queue Manager] ❌ Error details:', {
        message: error.message,
        stack: error.stack,
        mediaCount: media?.length || 0,
        sessionId,
      });
    }
  }

  async function checkThresholdTrigger() {
    try {
      const now = Date.now();
      const persistenceManager = createPersistenceManager();
      await persistenceManager.init();
      const queueItems = await persistenceManager.getProcessingQueue(state.currentSessionId);
      const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);
      const isStateStuck = state.batchProcessingPhase?.status === 'running'
        && (now - (state.batchProcessingPhase.startTime || now) > 30000);
      const hasPendingItems = totalQueuedItems > 0;
      const canProcess = isStateStuck || (!state.batchProcessingPhase?.status === 'running' && hasPendingItems);
      const timeSinceLastBatch = now - state.lastBatchProcessingTime;
      const minIntervalMet = timeSinceLastBatch >= state.batchProcessingConfig.minInterval;
      const thresholdMet = totalQueuedItems >= state.batchProcessingConfig.queueThreshold;
      if (canProcess && minIntervalMet && thresholdMet) {
        state.lastBatchProcessingTime = now;
        await startBatchProcessingPhase();
      }
    } catch (error) {
      console.error('[Queue Manager] Error checking threshold trigger:', error);
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
          state.stats.scannedPages = Math.min(newScannedPages, state.stats.totalPages);
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
            await updateDiscoveryFileScanStatus(
              data.sourceFile,
              data.page,
              'completed',
              data?.mediaCount || 0,
            );
          }

          // Update processing state manager
          if (state.processingStateManager && state.currentSessionId) {
            await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
              scannedPages: state.stats.scannedPages,
              pendingPages: state.stats.queuedPages,
              totalMedia: state.stats.totalMedia,
              currentPage: data?.page || '',
              scanRate,
              lastScannedAt: Date.now(),
            });
          }

          // Check if scanning is complete
          const isScanningComplete = state.stats.scannedPages >= state.stats.totalPages
            && state.stats.totalPages > 0 && state.stats.scannedPages <= state.stats.totalPages;
          if (isScanningComplete) {
            await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
              status: 'completed',
              scannedPages: state.stats.scannedPages,
              pendingPages: 0,
              totalMedia: state.stats.totalMedia,
              endTime: Date.now(),
            });
            await processRemainingMedia();
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
            && state.stats.totalPages > 0 && state.stats.scannedPages <= state.stats.totalPages;
          if (state.processingStateManager && state.currentSessionId) {
            if (isScanningComplete) {
              await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
                status: 'completed',
                scannedPages: state.stats.scannedPages,
                pendingPages: 0,
                totalMedia: state.stats.totalMedia,
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

          // Update scan status manager
          if (data?.page && data?.sourceFile) {
            await updateDiscoveryFileScanStatus(
              data.sourceFile,
              data.page,
              'failed',
              0,
              data.error,
            );
          }

          // Update processing state manager
          if (state.processingStateManager && state.currentSessionId) {
            await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
              failedPages: state.stats.errors,
            });
          }

          emit('pageScanError', data);
          break;

        case 'queueProcessingStopped':
          emit('queueProcessingStopped', data);
          break;

        case 'error':
          state.stats.errors += 1;
          // Update processing state manager with error status
          if (state.processingStateManager && state.currentSessionId) {
            await state.processingStateManager.updateScanningProgress(state.currentSessionId, {
              status: 'error',
              errors: state.stats.errors,
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

    state.discoveryHandlersSetup = true;

    state.discoveryManager.on('documentsDiscovered', async (data) => {
      try {
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
            totalDocuments: data.totalDocumentsSoFar || 0,
            status: 'running',
          });
        }
      } catch (error) {
        console.error('[Queue Manager] ❌ Failed to update discovery progress:', error);
      }
    });

    state.discoveryManager.on('folderComplete', async (data) => {
      try {
        // Update discovery progress
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.updateDiscoveryProgress(state.currentSessionId, {
            completedFolders: data.completedFolders || 0,
            totalFolders: data.totalFolders || 0,
            totalDocuments: data.totalDocumentsSoFar || 0,
            status: data.completedFolders >= data.totalFolders ? 'completed' : 'running',
          });
        }

        // Start scanning for this folder's discovery file
        if (data.documents && data.documents.length > 0) {
          // Ensure folderPath exists, fallback to workerId if not available
          const folderPath = data.folderPath || (data.workerId ? data.workerId.split('_')[1] : 'root');
          const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
          const discoveryFile = `/${config.org}/${config.repo}/.media/.pages/${folderName}.json`;

          console.log('[Queue Manager] 🚀 Starting scanning for folder:', {
            folderPath: data.folderPath,
            discoveryFile,
            documentCount: data.documents.length,
            workerId: data.workerId,
          });

          // Add this folder's documents to the scanning queue
          await addFolderToScanningQueue(discoveryFile, data.documents);
        }

        // Final completion check
        if (data.completedFolders >= data.totalFolders) {
          state.discoveryComplete = true;
          console.log('[Queue Manager] 🎯 All folders completed, triggering final scanning phase');
          await startScanningPhase(null, false);
        }
      } catch (error) {
        console.error('[Queue Manager] ❌ Failed to handle folder completion:', error);
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

      if (!state.daApi) {
        // eslint-disable-next-line no-console
        console.error('[Queue Manager] DA API service not initialized');
        return [];
      }
      const items = await state.daApi.listPath('.media/.pages');
      const discoveryFiles = [];
      const filePromises = [];
      items.forEach((item) => {
        const isJsonFile = item.name && item.ext === 'json';
        if (isJsonFile) {
          filePromises.push((async () => {
            try {
              const fileUrl = `${CONTENT_DA_LIVE_BASE}/${config.org}/${config.repo}/.media/.pages/${item.name}.json`;
              // eslint-disable-next-line no-console
              console.log('[Queue Manager] 📄 Fetching discovery file:', fileUrl);
              const parsedData = await loadData(fileUrl, config.token);
              // Handle both single-sheet and multi-sheet formats
              let documents;
              if (parsedData.data && parsedData.data.data) {
                documents = parsedData.data.data;
              } else if (parsedData.data) {
                documents = parsedData.data;
              } else {
                const sheetNames = Object.keys(parsedData);
                const firstSheet = sheetNames.find(
                  (name) => parsedData[name] && parsedData[name].data,
                );
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
              }
            } catch (fileError) {
              // eslint-disable-next-line no-console
              console.log('[Queue Manager] ❌ Error loading discovery file:', {
                fileName: item.name,
                error: fileError.message,
                timestamp: new Date().toISOString(),
              });
            }
          })());
        }
      });
      await Promise.all(filePromises);
      return discoveryFiles;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Queue Manager] Error loading discovery files:', error);
      return [];
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

        // Discovery file logic
        const hasScanStatus = Object.prototype.hasOwnProperty.call(doc, 'scanStatus');
        const hasScanComplete = Object.prototype.hasOwnProperty.call(doc, 'scanComplete');

        // Check if page needs scanning based on core or legacy logic
        let needsScan = false;
        let scanReason = 'unknown';

        if (forceRescan) {
          needsScan = true;
          scanReason = 'force';
        } else if (hasScanStatus) {
          // Discovery file logic
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
          // Legacy discovery file logic (backward compatibility)
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
    const discoveryFiles = await loadDiscoveryFiles();

    await detectChangedDocuments(discoveryFiles);

    return discoveryFiles;
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

      if (batch.length === 0) {
        if (state.discoveryComplete) {
          //  completion checkpoint using processing state manager
          if (state.processingStateManager && state.currentSessionId) {
            await state.processingStateManager.saveScanningCheckpointFile({
              status: 'completed',
              totalPages: state.stats.totalPages,
              scannedPages: state.stats.scannedPages,
              totalMedia: state.stats.totalMedia,
              files: state.discoveryFilesCache.map((file) => ({
                fileName: file.fileName,
                status: 'completed',
                totalDocuments: file.documents.length,
                scannedDocuments: file.documents.filter((doc) => doc.scanStatus === 'completed').length,
              })),
            });
          }

          // Stop the scanning process since there are no documents to scan
          await stopQueueScanning(true, 'completed');
          return;
        }

        // Discovery not complete, don't poll - let discovery complete first
        return;
      }

      if (batch.length > 0) {
        const currentFile = batch[0]?.sourceFile;
        const currentPath = batch[0]?.path;

        // Save checkpoint using processing state manager
        if (state.processingStateManager && state.currentSessionId) {
          await state.processingStateManager.saveScanningCheckpointFile({
            status: 'running',
            totalPages: state.stats.totalPages,
            scannedPages: state.stats.scannedPages,
            totalMedia: state.stats.totalMedia,
            currentFile,
            currentPath,
            lastBatchSize: batch.length,
            lastBatchTime: Date.now(),
            remainingDocuments: state.documentsToScan.length,
            files: state.discoveryFilesCache.map((file) => ({
              fileName: file.fileName,
              status: file.documents.every((doc) => doc.scanStatus === 'completed') ? 'completed' : 'partial',
              totalDocuments: file.documents.length,
              scannedDocuments: file.documents.filter((doc) => doc.scanStatus === 'completed').length,
            })),
          });
        }

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
      state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
      state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, false);
      state.stats.scannedPages = scanCheckpoint.scannedDocuments || 0;
      state.stats.totalPages = scanCheckpoint.totalDocuments || 0;
      state.stats.totalMedia = scanCheckpoint.totalMedia || 0;
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
      const uploadCheckpoint = await state.processingStateManager.loadUploadCheckpoint();
      const persistenceManager = createPersistenceManager();
      await persistenceManager.init();
      const queueItems = await persistenceManager.getProcessingQueue(state.currentSessionId);
      return {
        checkpointValid: uploadCheckpoint.status === 'completed',
        mediaAvailable: queueItems.length > 0,
        shouldRunUpload: uploadCheckpoint.status !== 'completed' && queueItems.length > 0,
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
    if (uploadStatus.shouldRunUpload && state.batchProcessingPhase?.status !== 'running') {
      await startBatchProcessingPhase();
    }
  }
  async function checkForStructuralChanges() {
    try {
      if (!config) {
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
      const mergedFiles = await state.discoveryManager.mergeIncrementalResults(incrementalResults);
      state.discoveryFilesCache = mergedFiles;
      state.documentsToScan = getDocumentsToScan(mergedFiles, false);

      return true;
    } catch (error) {
      console.error('[Queue Manager] ❌ Error during incremental discovery:', error);
      return false;
    }
  }

  async function startBatchProcessingPhase() {
    state.batchProcessingPhase.status = 'running';
    state.batchProcessingPhase.startTime = Date.now();

    await state.processingStateManager.saveUploadCheckpoint(state.currentSessionId, {
      status: 'running',
      totalBatches: 0,
      processedBatches: 0,
      uploadedBatches: 0,
      failedBatches: 0,
      totalMedia: 0,
      startTime: state.batchProcessingPhase.startTime,
    });

    emit('batchProcessingStarted', state.batchProcessingPhase);

    try {
      await state.mediaProcessor.processAndUploadQueuedMedia();

      state.batchProcessingPhase.status = 'completed';
      state.batchProcessingPhase.endTime = Date.now();

      await state.processingStateManager.saveUploadCheckpoint(state.currentSessionId, {
        status: 'completed',
        ...state.batchProcessingPhase,
        endTime: state.batchProcessingPhase.endTime,
      });

      emit('batchProcessingComplete', state.batchProcessingPhase);
    } catch (error) {
      state.batchProcessingPhase.status = 'failed';
      state.batchProcessingPhase.endTime = Date.now();

      await state.processingStateManager.saveUploadCheckpoint(state.currentSessionId, {
        status: 'failed',
        error: error.message,
        ...state.batchProcessingPhase,
        endTime: state.batchProcessingPhase.endTime,
      });

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
    try {
      const filePath = `/${state.daApi.getConfig().org}/${state.daApi.getConfig().repo}/.media/.pages/${fileName}`;
      const url = `${state.daApi.getConfig().baseUrl}/source${filePath}.json`;

      const contentUrl = `${CONTENT_DA_LIVE_BASE}${filePath}.json`;
      const parsedData = await loadData(contentUrl, state.daApi.getConfig().token);

      if (!parsedData.data || !Array.isArray(parsedData.data)) {
        console.error('[Queue Manager] ❌ No existing discovery file data found:', fileName);
        return;
      }

      const documents = parsedData.data;
      const pageIndex = documents.findIndex((doc) => doc.path === pagePath);

      if (pageIndex === -1) {
        console.error('[Queue Manager] ❌ Page not found in discovery file:', pagePath);
        return;
      }

      documents[pageIndex] = {
        ...documents[pageIndex],
        scanStatus: status,
        scanComplete: status === 'completed',
        needsRescan: status === 'failed',
        lastScannedAt: status === 'completed' || status === 'failed' ? Date.now() : null,
        mediaCount: status === 'completed' ? mediaCount : documents[pageIndex].mediaCount || 0,
        scanErrors: status === 'failed' ? [error] : documents[pageIndex].scanErrors || [],
        scanAttempts: (documents[pageIndex].scanAttempts || 0) + 1,
      };

      const jsonToWrite = buildSingleSheet(documents);
      await saveSheetFile(url, jsonToWrite, state.daApi.getConfig().token);

      console.log('[Queue Manager] ✅ Updated discovery file scan status:', {
        fileName,
        pagePath,
        status,
        mediaCount,
      });
    } catch (err) {
      console.error('[Queue Manager] ❌ Failed to update discovery file scan status:', err);
    }
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
    updateDiscoveryFileScanStatus,
    configureBatchProcessing,
    getBatchProcessingConfig,
    processRemainingMedia,
    getConfig: () => config,
  };
}
