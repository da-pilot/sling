/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
/**
 * State Manager - Handles persistent state storage and scan coordination
 * Manages scan locks, progress tracking, and queue persistence across sessions
 */

import {
  buildSingleSheet,
  buildMultiSheet,
  parseSheet,
  saveSheetFile,
  loadSheetFile,
} from '../modules/sheet-utils.js';
import mediaDB from './indexed-db.js';
import {
  DA_PATHS,
  SCAN_CONFIG,
  SCAN_STATUS,
  STAGE_STATUS,
  STORAGE_KEYS,
  ERROR_MESSAGES,
} from '../constants.js';

const DASheetUtil = {
  build(sheetMap, options = {}) {
    const sheetNames = Object.keys(sheetMap);
    if (sheetNames.length === 1 && (!options.forceMultiSheet)) {
      const name = sheetNames[0];
      const sheet = DASheetUtil._stringifySheet(sheetMap[name]);
      return {
        total: sheet.data.length,
        limit: sheet.data.length,
        offset: 0,
        data: sheet.data,
        ':type': 'sheet',
      };
    }
    const out = {};
    for (const name of sheetNames) {
      const sheet = DASheetUtil._stringifySheet(sheetMap[name]);
      out[name] = {
        total: sheet.data.length,
        limit: sheet.data.length,
        offset: 0,
        data: sheet.data,
      };
    }
    out[':version'] = options.version || 3;
    out[':names'] = sheetNames;
    out[':type'] = 'multi-sheet';
    return out;
  },
  parse(json) {
    if (json[':type'] === 'sheet') {
      return {
        data: {
          data: DASheetUtil._parseDataArray(json.data),
        },
      };
    }
    if (json[':type'] === 'multi-sheet') {
      const out = {};
      for (const name of json[':names'] || []) {
        out[name] = {
          data: DASheetUtil._parseDataArray(json[name]?.data || []),
        };
      }
      return out;
    }
    throw new Error('Unknown DA sheet type');
  },
  _stringifySheet(sheet) {
    return {
      ...sheet,
      data: (sheet.data || []).map((row) => Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, v != null ? String(v) : '']),
      )),
    };
  },
  _parseDataArray(dataArr) {
    return Array.isArray(dataArr) ? dataArr.map((row) => ({ ...row })) : [];
  },
};

function createStateManager() {
  const state = {
    apiConfig: null,
    daApi: null,
    isInitialized: false,
    scanStatus: 'idle',
    lastHeartbeat: null,
    sessionId: null,
    scanType: null,
    startedAt: null,
    stats: {
      totalDocuments: 0,
      scannedDocuments: 0,
      totalAssets: 0,
      lastUpdated: Date.now(),
    },
    listeners: new Map(),
  };

  const api = {
    init,
    getScanStatus,
    setScanStatus,
    getStats,
    updateStats,
    setSessionId,
    getSessionId,
    setScanType,
    getScanType,
    setStartedAt,
    getStartedAt,
    updateHeartbeat,
    getLastHeartbeat,
    isActive,
    cleanup,
    checkFileExists,
    createDefaultStateFiles,
    createInitialSheetFile,
    clearScanResults,
    getScanStatistics,
    createFolderIfNotExists,
    on,
    off,
    emit,
  };

  async function init(apiConfig) {
    state.apiConfig = apiConfig;

    // Create and initialize DA API service
    const { createDAApiService } = await import('./da-api.js');
    state.daApi = createDAApiService();
    await state.daApi.init(apiConfig);

    state.isInitialized = true;
  }

  /**
   * Get current scan status
   */
  async function getScanStatus() {
    try {
      const scanState = await getScanState();
      return scanState.status || 'idle';
    } catch (error) {
      return 'idle';
    }
  }

  /**
   * Set scan status
   */
  async function setScanStatus(status) {
    try {
      const scanState = await getScanState();
      scanState.status = status;
      await saveScanState(scanState);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to set scan status:', error);
    }
  }

  /**
   * Get scan statistics
   */
  async function getStats() {
    try {
      const scanState = await getScanState();
      return scanState.progress || state.stats;
    } catch (error) {
      return state.stats;
    }
  }

  /**
   * Update scan statistics
   */
  async function updateStats(newStats) {
    try {
      const scanState = await getScanState();
      scanState.progress = { ...scanState.progress, ...newStats, lastUpdated: Date.now() };
      await saveScanState(scanState);
      state.stats = { ...state.stats, ...newStats };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to update stats:', error);
    }
  }

  /**
   * Set session ID
   */
  function setSessionId(sessionId) {
    state.sessionId = sessionId;
  }

  /**
   * Get session ID
   */
  function getSessionId() {
    return state.sessionId;
  }

  /**
   * Set scan type
   */
  function setScanType(scanType) {
    state.scanType = scanType;
  }

  /**
   * Get scan type
   */
  function getScanType() {
    return state.scanType;
  }

  /**
   * Set started at time
   */
  function setStartedAt(startedAt) {
    state.startedAt = startedAt;
  }

  /**
   * Get started at time
   */
  function getStartedAt() {
    return state.startedAt;
  }

  /**
   * Update heartbeat
   */
  async function updateHeartbeat() {
    try {
      const scanState = await getScanState();
      scanState.lastHeartbeat = Date.now();
      await saveScanState(scanState);
      state.lastHeartbeat = Date.now();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to update heartbeat:', error);
    }
  }

  /**
   * Get last heartbeat
   */
  function getLastHeartbeat() {
    return state.lastHeartbeat;
  }

  /**
   * Check if scan is active
   */
  async function isActive() {
    return isScanActive();
  }

  /**
   * Event handling functions
   */
  function on(event, callback) {
    if (!state.listeners.has(event)) {
      state.listeners.set(event, []);
    }
    state.listeners.get(event).push(callback);
  }

  function off(event, callback) {
    const callbacks = state.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  function emit(event, data) {
    const callbacks = state.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`[State Manager] Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Check if a scan is currently active and not stale
   */
  async function isScanActive() {
    try {
      const scanState = await getScanState();

      if (!scanState.isActive || !scanState.sessionId) {
        return false;
      }

      if (scanState.lastHeartbeat) {
        const timeSinceHeartbeat = Date.now() - scanState.lastHeartbeat;
        if (timeSinceHeartbeat > SCAN_CONFIG.STALE_LOCK_THRESHOLD_MS) {
          // eslint-disable-next-line no-console
          console.log('⚠️ [STALE] Detected stale scan, marking as interrupted:', {
            timeSinceHeartbeat: `${Math.round(timeSinceHeartbeat / 1000)}s`,
            threshold: `${Math.round(SCAN_CONFIG.STALE_LOCK_THRESHOLD_MS / 1000)}s`,
            sessionId: scanState.sessionId,
          });
          await markScanAsInterrupted(scanState, 'stale_heartbeat');
          return false;
        }
      }

      return true;
    } catch (error) {
      if (error.message && error.message.includes('404')) {
        return false;
      }

      // eslint-disable-next-line no-console
      console.warn('[State Manager] Error checking scan active status:', error.message);
      return false;
    }
  }

  /**
   * Mark a scan as interrupted (for stale scans)
   */
  async function markScanAsInterrupted(scanState, reason = 'unknown') {
    try {
      const interruptedState = {
        ...scanState,
        isActive: false,
        status: SCAN_STATUS.INTERRUPTED,
        interruptedAt: Date.now(),
        reason,
        lastHeartbeat: Date.now(),
      };

      if (interruptedState.stages) {
        if (interruptedState.stages.discovery && interruptedState.stages.discovery.status === STAGE_STATUS.RUNNING) {
          interruptedState.stages.discovery.status = STAGE_STATUS.INTERRUPTED;
          interruptedState.stages.discovery.interruptedAt = Date.now();
          interruptedState.interruptedStage = 'discovery';
        } else if (interruptedState.stages.scanning && interruptedState.stages.scanning.status === STAGE_STATUS.RUNNING) {
          interruptedState.stages.scanning.status = STAGE_STATUS.INTERRUPTED;
          interruptedState.stages.scanning.interruptedAt = Date.now();
          interruptedState.interruptedStage = 'scanning';
        }
      }

      await saveScanState(interruptedState);

      return interruptedState;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to mark scan as interrupted:', error);
      throw error;
    }
  }

  /**
   * Acquire scan lock to prevent multiple simultaneous scans
   */
  async function acquireScanLock(scanType = 'full') {
    try {
      if (!state.sessionId) {
        state.sessionId = generateSessionId();
      }

      const currentState = await getScanState();

      if (currentState.isActive && currentState.sessionId !== state.sessionId) {
        throw new Error(ERROR_MESSAGES.SCAN_ALREADY_ACTIVE);
      }

      const newState = {
        isActive: true,
        sessionId: state.sessionId,
        scanType,
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        status: SCAN_STATUS.RUNNING,
        stages: {
          discovery: {
            status: STAGE_STATUS.RUNNING,
            startTime: Date.now(),
            completeTime: null,
            totalFolders: 0,
            completedFolders: 0,
            totalDocuments: 0,
          },
          scanning: {
            status: STAGE_STATUS.PENDING,
            startTime: null,
            completeTime: null,
            totalDocuments: 0,
            scannedDocuments: 0,
            totalAssets: 0,
          },
        },
        progress: {
          totalDocuments: 0,
          scannedDocuments: 0,
          totalAssets: 0,
          lastUpdated: Date.now(),
        },
      };

      await saveScanState(newState);
      return true;
    } catch (error) {
      throw new Error(`${ERROR_MESSAGES.SCAN_LOCK_FAILED}: ${error.message}`);
    }
  }

  /**
   * Release scan lock
   */
  async function releaseScanLock() {
    stopHeartbeat();
    const scanState = await getScanState();
    scanState.isActive = false;
    scanState.status = SCAN_STATUS.COMPLETE;
    scanState.sessionId = null;
    scanState.scanType = null;
    scanState.startedAt = null;
    scanState.lastHeartbeat = null;
    await saveScanState(scanState);

    const verifyState = await getScanState();
    if (verifyState?.isActive === true || verifyState?.isActive === 'true') {
      verifyState.isActive = false;
      await saveScanState(verifyState);
    }
  }

  /**
   * Update scan progress
   */
  async function updateScanProgress(progress) {
    try {
      if (!state.sessionId) {
        return;
      }

      const currentState = await getScanState();

      if (currentState?.sessionId !== state.sessionId) {
        if (!currentState?.isActive) {
          await acquireScanLock('full');
          return;
        }
        return;
      }

      const updatedState = {
        ...currentState,
        lastHeartbeat: Date.now(),
        progress: {
          ...currentState?.progress,
          ...progress,
          lastUpdated: Date.now(),
        },
      };

      if (progress.scannedDocuments !== undefined || progress.totalAssets !== undefined) {
        if (!updatedState.stages) {
          updatedState.stages = {};
        }
        if (!updatedState.stages.scanning) {
          updatedState.stages.scanning = {
            status: 'running',
            startTime: currentState.stages?.scanning?.startTime || Date.now(),
            completeTime: null,
            totalDocuments: 0,
            scannedDocuments: 0,
            totalAssets: 0,
          };
        }

        updatedState.stages.scanning = {
          ...updatedState.stages.scanning,
          scannedDocuments: progress.scannedDocuments !== undefined ? progress.scannedDocuments : updatedState.stages.scanning.scannedDocuments,
          totalAssets: progress.totalAssets !== undefined ? progress.totalAssets : updatedState.stages.scanning.totalAssets,
        };
      }

      await saveScanState(updatedState);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to update scan progress:', error);
    }
  }

  /**
   * Get current scan state
   */
  async function getScanState() {
    try {
      const scanState = await loadScanState();
      return scanState || {
        isActive: false,
        sessionId: null,
        scanType: null,
        startedAt: null,
        lastHeartbeat: null,
        progress: {
          totalDocuments: 0,
          scannedDocuments: 0,
          totalAssets: 0,
          lastUpdated: null,
        },
        stages: {},
      };
    } catch (error) {
      if (error.message && error.message.includes('404')) {
        return {
          isActive: false,
          sessionId: null,
          scanType: null,
          startedAt: null,
          lastHeartbeat: null,
          progress: {
            totalDocuments: 0,
            scannedDocuments: 0,
            totalAssets: 0,
            lastUpdated: null,
          },
          stages: {},
        };
      }

      // eslint-disable-next-line no-console
      console.warn('[State Manager] Error getting scan state:', error.message);
      return {
        isActive: false,
        sessionId: null,
        scanType: null,
        startedAt: null,
        lastHeartbeat: null,
        progress: {
          totalDocuments: 0,
          scannedDocuments: 0,
          totalAssets: 0,
          lastUpdated: null,
        },
        stages: {},
      };
    }
  }

  /**
   * Save document scan results
   */
  async function saveDocumentResults(documents) {
    try {
      const existingResults = await loadScanResults();
      const existingPaths = new Map();
      const now = Date.now();

      existingResults.forEach((result) => {
        existingPaths.set(result.path, result);
      });

      const updatedResults = [...existingResults];

      for (const doc of documents) {
        const existing = existingPaths.get(doc.path);

        const resultData = {
          path: doc.path,
          lastScanned: now,
          lastModified: doc.lastModified,
          scanDuration: doc.scanDuration || 0,
          assetCount: (doc.assets || []).length,
        };

        if (existing) {
          const idx = updatedResults.findIndex((r) => r.path === doc.path);
          if (idx > -1) {
            updatedResults[idx] = { ...existing, ...resultData };
          }
        } else {
          updatedResults.push(resultData);
        }
      }

      await saveScanResults(updatedResults);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to save document results:', error);
    }
  }

  /**
   * Get documents that need scanning
   */
  async function getDocumentsToScan(discoveredDocuments, forceRescan = false) {
    try {
      if (forceRescan) {
        return discoveredDocuments;
      }

      const existingResults = await loadScanResults();
      const existingPaths = new Map();

      existingResults.forEach((result) => {
        existingPaths.set(result.path, {
          lastScanned: result.lastScanned || 0,
          lastModified: result.lastModified || 0,
        });
      });

      const documentsToScan = [];
      const skippedDocuments = [];
      const newDocuments = [];
      const changedDocuments = [];

      for (const doc of discoveredDocuments) {
        const existing = existingPaths.get(doc.path);

        if (!existing) {
          newDocuments.push(doc);
          documentsToScan.push(doc);
          continue;
        }

        const hasChanged = await checkDocumentChanged(doc, existing);

        if (hasChanged) {
          changedDocuments.push(doc);
          documentsToScan.push(doc);
        } else {
          skippedDocuments.push(doc);
        }
      }

      return documentsToScan;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Error in incremental scan, falling back to full scan:', error);
      return discoveredDocuments;
    }
  }

  /**
   * Check if a document has changed using server lastModified
   */
  async function checkDocumentChanged(doc, existing) {
    try {
      if (doc.lastModified && existing.lastModified) {
        return doc.lastModified > existing.lastModified;
      }

      if (doc.lastModified && !existing.lastModified) {
        return true;
      }

      if (!doc.lastModified && existing.lastModified) {
        return true;
      }

      if (!existing.lastScanned) {
        return true;
      }

      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[State Manager] Error checking document changes for ${doc.path}:`, error);
      return true;
    }
  }

  /**
   * Save discovery queue for resumption
   * OBSOLETE: Replaced by unified discovery files in .pages folder
   */
  async function saveDiscoveryQueue(queue) {
    // OBSOLETE: Replaced by unified discovery files in .pages folder
    return Promise.resolve();
  }

  /**
   * Load discovery queue for resumption
   * OBSOLETE: Replaced by unified discovery files in .pages folder
   */
  async function loadDiscoveryQueue() {
    return [];
  }

  /**
   * Clear discovery queue
   * OBSOLETE: Replaced by unified discovery files in .pages folder
   */
  async function clearDiscoveryQueue() {
    // OBSOLETE: Replaced by unified discovery files in .pages folder
    return Promise.resolve();
  }

  /**
   * Get scan statistics
   */
  async function getScanStatistics() {
    try {
      const filePath = DA_PATHS.getResultsFile(state.apiConfig.org, state.apiConfig.repo);
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      const data = await loadSheetFile(url, state.apiConfig.token);
      const parsedData = parseSheet(data);

      if (parsedData.results && parsedData.results.data) {
        return {
          totalScanned: parsedData.results.data.length,
          lastScanTime: parsedData.results.data.length > 0 ? Date.now() : null,
        };
      }

      return {
        totalScanned: 0,
        lastScanTime: null,
      };
    } catch (error) {
      return {
        totalScanned: 0,
        lastScanTime: null,
      };
    }
  }

  /**
   * Get incremental scan statistics
   */
  async function getIncrementalScanStats(discoveredDocuments) {
    try {
      const existingResults = await loadScanResults();
      const existingPaths = new Map();

      existingResults.forEach((result) => {
        existingPaths.set(result.path, {
          lastScanned: result.lastScanned || 0,
          lastModified: result.lastModified || 0,
        });
      });

      const stats = {
        total: discoveredDocuments.length,
        new: 0,
        changed: 0,
        unchanged: 0,
        toScan: 0,
        skipped: 0,
      };

      for (const doc of discoveredDocuments) {
        const existing = existingPaths.get(doc.path);

        if (!existing) {
          stats.new++;
          stats.toScan++;
        } else {
          const hasChanged = await checkDocumentChanged(doc, existing);
          if (hasChanged) {
            stats.changed++;
            stats.toScan++;
          } else {
            stats.unchanged++;
            stats.skipped++;
          }
        }
      }

      return stats;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Error getting incremental scan stats:', error);
      return {
        total: discoveredDocuments.length,
        new: 0,
        changed: 0,
        unchanged: 0,
        toScan: discoveredDocuments.length,
        skipped: 0,
      };
    }
  }

  /**
   * Initialize state persistence - creates files if they don't exist
   */
  async function initializeStatePersistence() {
    try {
      const folderPath = DA_PATHS.getStorageDir(state.apiConfig.org, state.apiConfig.repo);
      await createFolderIfNotExists(folderPath);

      const stateFileExists = await checkFileExists(DA_PATHS.getStateFile(state.apiConfig.org, state.apiConfig.repo));
      if (!stateFileExists) {
        await createDefaultStateFiles();
      }
    } catch (error) {
    }
  }

  /**
   * Check if a file exists in DA storage
   */
  async function checkFileExists(fileName) {
    try {
      if (!state.daApi) {
        throw new Error('DA API service not initialized');
      }

      const { DA_STORAGE } = await import('../constants.js');
      const items = await state.daApi.listPath(DA_STORAGE.PAGES_DIR);

      return items.some((item) => item.name === fileName);
    } catch (error) {
      return false;
    }
  }

  /**
   * Create default state files for state management
   */
  async function createDefaultStateFiles() {
    const files = [
      {
        path: DA_PATHS.getStateFile(state.apiConfig.org, state.apiConfig.repo),
        type: 'multi-sheet',
        data: {
          state: [{
            isActive: false,
            sessionId: null,
            scanType: null,
            startedAt: null,
            lastHeartbeat: null,
          }],
          progress: [{
            totalDocuments: 0,
            scannedDocuments: 0,
            totalAssets: 0,
            lastUpdated: Date.now(),
          }],
        },
        version: 3,
      },
    ];

    for (const file of files) {
      await createInitialSheetFile(file);
    }
  }

  /**
   * Create initial sheet file
   */
  async function createInitialSheetFile(file) {
    try {
      const jsonToWrite = DASheetUtil.build(file.data, { version: file.version });

      const url = `${state.apiConfig.baseUrl}/source${file.path}`;

      await saveSheetFile(url, jsonToWrite, state.apiConfig.token);

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load scan state from storage
   */
  async function loadScanState() {
    try {
      const filePath = DA_PATHS.getStateFile(state.apiConfig.org, state.apiConfig.repo);
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      const data = await loadSheetFile(url, state.apiConfig.token);
      const parsedData = parseSheet(data);

      let stateData = parsedData.state?.data?.[0] || {};

      if (parsedData.progress && parsedData.stages) {
        const progressData = parsedData.progress?.data?.[0] || {};
        const stagesData = parsedData.stages?.data?.[0] || {};

        stateData = {
          ...stateData,
          progress: progressData,
          stages: stagesData,
        };
      }

      const isActiveState = stateData.isActive === 'true' || stateData.isActive === true;
      const startedAt = stateData.startedAt ? parseInt(stateData.startedAt, 10) : null;
      const lastHeartbeat = stateData.lastHeartbeat ? parseInt(stateData.lastHeartbeat, 10) : null;

      const progress = stateData.progress || {};
      const totalDocuments = progress.totalDocuments ? parseInt(progress.totalDocuments, 10) : 0;
      const scannedDocuments = progress.scannedDocuments ? parseInt(progress.scannedDocuments, 10) : 0;
      const totalAssets = progress.totalAssets ? parseInt(progress.totalAssets, 10) : 0;
      const lastUpdated = progress.lastUpdated ? parseInt(progress.lastUpdated, 10) : Date.now();

      const stages = {};
      const stagesData = stateData.stages || {};

      if (stagesData.discovery) {
        stages.discovery = {
          status: stagesData.discovery.status || 'pending',
          startTime: stagesData.discovery.startTime ? parseInt(stagesData.discovery.startTime, 10) : null,
          completeTime: stagesData.discovery.completeTime ? parseInt(stagesData.discovery.completeTime, 10) : null,
          totalFolders: stagesData.discovery.totalFolders ? parseInt(stagesData.discovery.totalFolders, 10) : 0,
          completedFolders: stagesData.discovery.completedFolders ? parseInt(stagesData.discovery.completedFolders, 10) : 0,
          totalDocuments: stagesData.discovery.totalDocuments ? parseInt(stagesData.discovery.totalDocuments, 10) : 0,
        };
      }
      if (stagesData.scanning) {
        stages.scanning = {
          status: stagesData.scanning.status || 'pending',
          startTime: stagesData.scanning.startTime ? parseInt(stagesData.scanning.startTime, 10) : null,
          completeTime: stagesData.scanning.completeTime ? parseInt(stagesData.scanning.completeTime, 10) : null,
          totalDocuments: stagesData.scanning.totalDocuments ? parseInt(stagesData.scanning.totalDocuments, 10) : 0,
          scannedDocuments: stagesData.scanning.scannedDocuments ? parseInt(stagesData.scanning.scannedDocuments, 10) : 0,
          totalAssets: stagesData.scanning.totalAssets ? parseInt(stagesData.scanning.totalAssets, 10) : 0,
        };
      }

      return {
        isActive: isActiveState,
        sessionId: stateData.sessionId || null,
        scanType: stateData.scanType || null,
        startedAt,
        lastHeartbeat,
        progress: {
          totalDocuments,
          scannedDocuments,
          totalAssets,
          lastUpdated,
        },
        stages,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Save scan state to storage
   */
  async function saveScanState(scanState) {
    try {
      const unifiedState = {
        isActive: scanState.isActive || false,
        sessionId: scanState.sessionId || null,
        scanType: scanState.scanType || null,
        startedAt: scanState.startedAt || null,
        lastHeartbeat: scanState.lastHeartbeat || Date.now(),
        status: scanState.status || 'pending',

        progress: scanState.progress || {
          totalDocuments: scanState.stages?.discovery?.totalDocuments || 0,
          scannedDocuments: scanState.stages?.scanning?.scannedDocuments || 0,
          totalAssets: scanState.stages?.scanning?.totalAssets || 0,
          lastUpdated: Date.now(),
        },

        stages: scanState.stages || {
          discovery: {
            status: 'pending',
            startTime: null,
            completeTime: null,
            totalFolders: 0,
            completedFolders: 0,
            totalDocuments: 0,
          },
          scanning: {
            status: 'pending',
            startTime: null,
            completeTime: null,
            totalDocuments: 0,
            scannedDocuments: 0,
            totalAssets: 0,
          },
        },
      };

      const sheetMap = {
        state: [unifiedState],
      };
      const jsonToWrite = buildMultiSheet(sheetMap, 3);
      const filePath = DA_PATHS.getStateFile(state.apiConfig.org, state.apiConfig.repo);
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('❌ [STATE] Failed to save scan state:', error);
      throw error;
    }
  }

  /**
   * Load scan results from storage
   * OBSOLETE: Replaced by unified discovery files in .pages folder
   */
  async function loadScanResults() {
    return [];
  }

  /**
   * Save scan results to storage
   * OBSOLETE: Replaced by unified discovery files in .pages folder
   */
  async function saveScanResults(results) {
    // OBSOLETE: Replaced by unified scan files in .pages folder
    return Promise.resolve();
  }

  /**
   * Clear scan lock (force release)
   */
  async function clearScanLock() {
    try {
      await releaseScanLock();
    } catch (error) {
    }
  }

  /**
   * Clear scan results to force a fresh scan
   */
  async function clearScanResults() {
    try {
      const filePath = DA_PATHS.getResultsFile(state.apiConfig.org, state.apiConfig.repo);
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      const emptyResults = buildMultiSheet({ results: [] }, 3);
      await saveSheetFile(url, emptyResults, state.apiConfig.token);

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Force clear stale scan locks (older than 1 hour)
   */
  async function forceClearStaleScanLock() {
    try {
      const currentState = await getScanState();
      const oneHourAgo = Date.now() - SCAN_CONFIG.STALE_LOCK_THRESHOLD_MS;

      const isActiveState = currentState.isActive === 'true' || currentState.isActive === true;

      if (isActiveState && currentState.lastHeartbeat && currentState.lastHeartbeat < oneHourAgo) {
        const newState = {
          isActive: false,
          sessionId: null,
          scanType: null,
          startedAt: null,
          lastHeartbeat: null,
        };
        await saveScanState(newState);
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Force clear ALL scan locks (emergency reset)
   */
  async function forceClearAllScanLocks() {
    try {
      const newState = {
        isActive: false,
        sessionId: null,
        scanType: null,
        startedAt: null,
        lastHeartbeat: null,
        progress: {
          totalDocuments: 0,
          scannedDocuments: 0,
          totalAssets: 0,
          lastUpdated: Date.now(),
        },
      };
      await saveScanState(newState);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start heartbeat to maintain scan lock
   */
  function startHeartbeat() {
    if (state.heartbeatInterval) {
      clearInterval(state.heartbeatInterval);
    }

    state.heartbeatInterval = setInterval(async () => {
      try {
        const currentState = await getScanState();
        if (currentState.isActive && currentState.sessionId === state.sessionId) {
          await updateScanProgress(currentState.progress);
        }
      } catch (error) {
      }
    }, state.heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat
   */
  function stopHeartbeat() {
    if (state.heartbeatInterval) {
      clearInterval(state.heartbeatInterval);
      state.heartbeatInterval = null;
    }
  }

  /**
   * Create folder if it doesn't exist
   */
  async function createFolderIfNotExists(folderPath) {
    // DA doesn't require explicit folder creation
    return true;
  }

  /**
   * Generate unique session ID
   */
  function generateSessionId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup resources
   */
  function cleanup() {
    stopHeartbeat();
  }

  /**
   * Remove a document from discovery queue after scanning
   */
  async function removeFromDiscoveryQueue(path) {
    try {
      const queue = await loadDiscoveryQueue();
      const updatedQueue = queue?.filter((item) => item?.path !== path) || [];

      const jsonToWrite = buildSingleSheet(updatedQueue);
      const filePath = DA_PATHS.getDiscoveryQueueFile(state.apiConfig.org, state.apiConfig.repo);
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to remove from discovery queue:', error);
    }
  }

  /**
   * Check if discovery is complete
   */
  async function isDiscoveryComplete() {
    try {
      const currentState = await getScanState();
      const isComplete = currentState.stages?.discovery?.status === 'complete';

      // eslint-disable-next-line no-console
      console.log('[State Manager] 🔍 Checking discovery status:', {
        hasStages: !!currentState.stages,
        hasDiscovery: !!currentState.stages?.discovery,
        discoveryStatus: currentState.stages?.discovery?.status,
        isComplete,
        timestamp: new Date().toISOString(),
      });

      return isComplete;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to check discovery status:', error);
      return false;
    }
  }

  /**
   * Check if scanning is complete
   */
  async function isScanningComplete() {
    try {
      const currentState = await getScanState();
      return currentState.stages?.scanning?.status === 'complete';
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to check scanning status:', error);
      return false;
    }
  }

  /**
   * Update discovery progress
   */
  async function updateDiscoveryProgress(progress) {
    try {
      const currentState = await getScanState();

      if (!currentState.stages) {
        currentState.stages = {};
      }

      if (!currentState.stages.discovery) {
        currentState.stages.discovery = {
          status: 'running',
          startTime: currentState.startedAt || Date.now(),
          completeTime: null,
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: 0,
        };
      }

      const currentStatus = currentState.stages.discovery.status;
      const isComplete = currentStatus === 'complete';

      if (isComplete && progress.status && progress.status !== 'complete') {
        // eslint-disable-next-line no-console
        console.log('[State Manager] ⚠️ Ignoring status change from progress update (discovery already complete):', {
          currentStatus,
          attemptedStatus: progress.status,
          timestamp: new Date().toISOString(),
        });
        const { status, ...progressWithoutStatus } = progress;
        currentState.stages.discovery = {
          ...currentState.stages.discovery,
          ...progressWithoutStatus,
        };
      } else {
        currentState.stages.discovery = {
          ...currentState.stages.discovery,
          ...progress,
          status: isComplete ? 'complete' : (progress.status || currentStatus),
        };
      }

      // eslint-disable-next-line no-console
      console.log('[State Manager] 💾 Saving discovery progress update');
      await saveScanState(currentState);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to update discovery progress:', error);
    }
  }

  /**
   * Mark discovery as complete
   */
  async function setDiscoveryComplete(totalDocuments = null) {
    try {
      // eslint-disable-next-line no-console
      console.log('[State Manager] 🎯 Setting discovery complete:', {
        totalDocuments,
        timestamp: new Date().toISOString(),
      });

      const currentState = await getScanState();

      // eslint-disable-next-line no-console
      console.log('[State Manager] 📊 Current state before update:', {
        hasStages: !!currentState.stages,
        hasDiscovery: !!currentState.stages?.discovery,
        discoveryStatus: currentState.stages?.discovery?.status,
        timestamp: new Date().toISOString(),
      });

      if (!currentState.stages) {
        currentState.stages = {};
      }

      if (!currentState.stages.discovery) {
        currentState.stages.discovery = {
          status: 'running',
          startTime: currentState.startedAt || Date.now(),
          completeTime: null,
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: 0,
        };
      }

      currentState.stages.discovery.status = 'complete';
      currentState.stages.discovery.completeTime = Date.now();

      if (totalDocuments !== null) {
        currentState.stages.discovery.totalDocuments = totalDocuments;
      }

      // eslint-disable-next-line no-console
      console.log('[State Manager] 📝 Discovery state to save:', {
        discoveryStatus: currentState.stages.discovery.status,
        discoveryCompleteTime: currentState.stages.discovery.completeTime,
        discoveryTotalDocuments: currentState.stages.discovery.totalDocuments,
        timestamp: new Date().toISOString(),
      });

      await saveScanState(currentState);

      const verifyState = await getScanState();
      const isComplete = verifyState.stages?.discovery?.status === 'complete';

      // eslint-disable-next-line no-console
      console.log('[State Manager] ✅ Discovery marked complete successfully:', {
        isComplete,
        status: verifyState.stages?.discovery?.status,
        totalDocuments: verifyState.stages?.discovery?.totalDocuments,
        timestamp: new Date().toISOString(),
      });

      return isComplete;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to mark discovery complete:', error);
      return false;
    }
  }

  async function initializeScanningStage() {
    try {
      // eslint-disable-next-line no-console
      console.log('[State Manager] 🔄 Initializing scanning stage');

      const currentState = await getScanState();

      if (!currentState.stages.scanning) {
        currentState.stages.scanning = {
          status: 'pending',
          startTime: null,
          completeTime: null,
          totalDocuments: 0,
          scannedDocuments: 0,
          totalAssets: 0,
        };
      }

      currentState.stages.scanning.status = 'running';
      currentState.stages.scanning.startTime = Date.now();
      currentState.stages.scanning.totalDocuments = currentState.stages.discovery.totalDocuments || 0;

      currentState.progress = {
        totalDocuments: currentState.stages.discovery.totalDocuments || 0,
        scannedDocuments: 0,
        totalAssets: 0,
        lastUpdated: Date.now(),
      };

      // eslint-disable-next-line no-console
      console.log('[State Manager] 📝 Scanning state to save:', {
        scanningStatus: currentState.stages.scanning.status,
        scanningStartTime: currentState.stages.scanning.startTime,
        scanningTotalDocuments: currentState.stages.scanning.totalDocuments,
        timestamp: new Date().toISOString(),
      });

      await saveScanState(currentState);

      // eslint-disable-next-line no-console
      console.log('[State Manager] ✅ Scanning stage initialized successfully');

      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to initialize scanning stage:', error);
      return false;
    }
  }

  /**
   * Get cached media data from IndexedDB
   */
  async function getMediaData() {
    try {
      await mediaDB.init();

      const assets = await mediaDB.getAssets();

      return assets;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[StateManager] Error getting media data:', error);
      return [];
    }
  }

  /**
   * Sync media data with IndexedDB
   */
  async function syncMediaData(assets) {
    try {
      await mediaDB.init();
      await mediaDB.storeAssets(assets);
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error syncing media data:', error);
      return false;
    }
  }

  /**
   * Clear media data cache
   */
  async function clearMediaCache() {
    try {
      await mediaDB.clear();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error clearing media cache:', error);
    }
  }

  /**
   * Search assets using IndexedDB
   */
  async function searchMediaAssets(searchTerm, filters = {}) {
    try {
      await mediaDB.init();
      return await mediaDB.searchAssets(searchTerm, filters);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error searching media assets:', error);
      return [];
    }
  }

  /**
   * Get asset statistics from IndexedDB
   */
  async function getMediaStats() {
    try {
      await mediaDB.init();
      return await mediaDB.getAssetStats();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error getting media stats:', error);
      return {
        total: 0, byType: {}, byExternal: {}, unused: 0,
      };
    }
  }

  /**
   * Save discovery checkpoint with file-level granularity
   */
  async function saveDiscoveryCheckpoint(checkpoint) {
    try {
      const currentState = await getScanState();

      if (!currentState.stages) {
        currentState.stages = {};
      }

      if (!currentState.stages.discovery) {
        currentState.stages.discovery = {
          status: 'running',
          startTime: currentState.startedAt || Date.now(),
          completeTime: null,
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: 0,
          files: [],
        };
      }

      currentState.stages.discovery = {
        ...currentState.stages.discovery,
        ...checkpoint,
        lastCheckpointTime: Date.now(),
      };

      await saveScanState(currentState);

      // eslint-disable-next-line no-console
      console.log('[State Manager] 💾 Discovery checkpoint saved:', {
        totalFiles: checkpoint.files?.length || 0,
        completedFiles: checkpoint.files?.filter((f) => f.status === 'complete').length || 0,
        currentFile: checkpoint.currentFile,
        currentPath: checkpoint.currentPath,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to save discovery checkpoint:', error);
    }
  }

  /**
   * Save scanning checkpoint with document-level granularity
   */
  async function saveScanCheckpoint(checkpoint) {
    try {
      const currentState = await getScanState();

      if (!currentState.stages) {
        currentState.stages = {};
      }

      if (!currentState.stages.scanning) {
        currentState.stages.scanning = {
          status: 'pending',
          startTime: null,
          completeTime: null,
          totalDocuments: 0,
          scannedDocuments: 0,
          totalAssets: 0,
          files: [],
        };
      }

      currentState.stages.scanning = {
        ...currentState.stages.scanning,
        ...checkpoint,
        lastCheckpointTime: Date.now(),
      };

      await saveScanState(currentState);

      // eslint-disable-next-line no-console
      console.log('[State Manager] 💾 Scanning checkpoint saved:', {
        totalDocuments: checkpoint.totalDocuments || 0,
        scannedDocuments: checkpoint.scannedDocuments || 0,
        currentFile: checkpoint.currentFile,
        currentPath: checkpoint.currentPath,
        lastBatchSize: checkpoint.lastBatchSize,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to save scanning checkpoint:', error);
    }
  }

  /**
   * Get discovery checkpoint for resume
   */
  async function getDiscoveryCheckpoint() {
    try {
      const currentState = await getScanState();
      const discovery = currentState.stages?.discovery;

      if (!discovery) {
        return null;
      }

      return {
        status: discovery.status,
        totalFolders: discovery.totalFolders || 0,
        completedFolders: discovery.completedFolders || 0,
        files: discovery.files || [],
        currentFile: discovery.currentFile,
        currentPath: discovery.currentPath,
        lastCheckpointTime: discovery.lastCheckpointTime,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to get discovery checkpoint:', error);
      return null;
    }
  }

  /**
   * Get scanning checkpoint for resume
   */
  async function getScanCheckpoint() {
    try {
      const currentState = await getScanState();
      const scanning = currentState.stages?.scanning;

      if (!scanning) {
        return null;
      }

      return {
        status: scanning.status,
        totalDocuments: scanning.totalDocuments || 0,
        scannedDocuments: scanning.scannedDocuments || 0,
        totalAssets: scanning.totalAssets || 0,
        files: scanning.files || [],
        currentFile: scanning.currentFile,
        currentPath: scanning.currentPath,
        lastBatchSize: scanning.lastBatchSize,
        lastCheckpointTime: scanning.lastCheckpointTime,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to get scanning checkpoint:', error);
      return null;
    }
  }

  /**
   * Update discovery file status
   */
  async function updateDiscoveryFileStatus(fileName, status, data = {}) {
    try {
      const currentState = await getScanState();

      if (!currentState.stages?.discovery?.files) {
        currentState.stages.discovery.files = [];
      }

      const fileIndex = currentState.stages.discovery.files.findIndex((f) => f.fileName === fileName);
      const fileData = {
        fileName,
        status,
        lastUpdated: Date.now(),
        ...data,
      };

      if (fileIndex >= 0) {
        currentState.stages.discovery.files[fileIndex] = fileData;
      } else {
        currentState.stages.discovery.files.push(fileData);
      }

      await saveScanState(currentState);

      // eslint-disable-next-line no-console
      console.log('[State Manager] 📁 Discovery file status updated:', {
        fileName,
        status,
        totalDocuments: data.totalDocuments,
        completedDocuments: data.completedDocuments,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to update discovery file status:', error);
    }
  }

  /**
   * Update scanning file status
   */
  async function updateScanningFileStatus(fileName, status, data = {}) {
    try {
      const currentState = await getScanState();

      if (!currentState.stages?.scanning?.files) {
        currentState.stages.scanning.files = [];
      }

      const fileIndex = currentState.stages.scanning.files.findIndex((f) => f.fileName === fileName);
      const fileData = {
        fileName,
        status,
        lastUpdated: Date.now(),
        ...data,
      };

      if (fileIndex >= 0) {
        currentState.stages.scanning.files[fileIndex] = fileData;
      } else {
        currentState.stages.scanning.files.push(fileData);
      }

      await saveScanState(currentState);

      // eslint-disable-next-line no-console
      console.log('[State Manager] 📄 Scanning file status updated:', {
        fileName,
        status,
        totalDocuments: data.totalDocuments,
        scannedDocuments: data.scannedDocuments,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to update scanning file status:', error);
    }
  }

  /**
   * Get pending discovery files
   */
  async function getPendingDiscoveryFiles() {
    try {
      const checkpoint = await getDiscoveryCheckpoint();
      if (!checkpoint?.files) {
        return [];
      }

      return checkpoint.files.filter((file) => file.status === 'pending' || file.status === 'partial');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to get pending discovery files:', error);
      return [];
    }
  }

  /**
   * Get pending scanning files
   */
  async function getPendingScanningFiles() {
    try {
      const checkpoint = await getScanCheckpoint();
      if (!checkpoint?.files) {
        return [];
      }

      return checkpoint.files.filter((file) => file.status === 'pending' || file.status === 'partial');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to get pending scanning files:', error);
      return [];
    }
  }

  /**
   * Clear all checkpoints (for fresh start)
   */
  async function clearCheckpoints() {
    try {
      const currentState = await getScanState();

      if (currentState.stages?.discovery) {
        currentState.stages.discovery.files = [];
        currentState.stages.discovery.currentFile = null;
        currentState.stages.discovery.currentPath = null;
        currentState.stages.discovery.lastCheckpointTime = null;
      }

      if (currentState.stages?.scanning) {
        currentState.stages.scanning.files = [];
        currentState.stages.scanning.currentFile = null;
        currentState.stages.scanning.currentPath = null;
        currentState.stages.scanning.lastCheckpointTime = null;
      }

      await saveScanState(currentState);

      // eslint-disable-next-line no-console
      console.log('[State Manager] 🗑️ All checkpoints cleared');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[State Manager] Failed to clear checkpoints:', error);
    }
  }

  return {
    init,
    getScanStatus,
    setScanStatus,
    getStats,
    updateStats,
    setSessionId,
    getSessionId,
    setScanType,
    getScanType,
    setStartedAt,
    getStartedAt,
    updateHeartbeat,
    getLastHeartbeat,
    isActive,
    isScanActive,
    markScanAsInterrupted,
    acquireScanLock,
    releaseScanLock,
    clearScanLock,
    forceClearStaleScanLock,
    forceClearAllScanLocks,
    updateScanProgress,
    getScanState,
    saveScanState,
    saveDocumentResults,
    getDocumentsToScan,
    saveDiscoveryQueue,
    loadDiscoveryQueue,
    clearDiscoveryQueue,
    getScanStatistics,
    getIncrementalScanStats,
    initializeStatePersistence,
    checkFileExists,
    createDefaultStateFiles,
    createInitialSheetFile,
    clearScanResults,
    createFolderIfNotExists,
    cleanup,
    removeFromDiscoveryQueue,
    isDiscoveryComplete,
    isScanningComplete,
    updateDiscoveryProgress,
    setDiscoveryComplete,
    initializeScanningStage,
    loadScanResults,
    getMediaData,
    syncMediaData,
    clearMediaCache,
    searchMediaAssets,
    getMediaStats,
    saveDiscoveryCheckpoint,
    saveScanCheckpoint,
    getDiscoveryCheckpoint,
    getScanCheckpoint,
    updateDiscoveryFileStatus,
    updateScanningFileStatus,
    getPendingDiscoveryFiles,
    getPendingScanningFiles,
    clearCheckpoints,
    on,
    off,
    emit,
  };
}

export { createStateManager };
