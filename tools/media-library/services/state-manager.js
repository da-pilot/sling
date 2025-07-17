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

// DA Sheet Utility
const DASheetUtil = {
  // Write: Build DA-compliant JSON for single or multi-sheet
  build(sheetMap, options = {}) {
    const sheetNames = Object.keys(sheetMap);
    if (sheetNames.length === 1 && (!options.forceMultiSheet)) {
      // Single sheet
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
    // Multi-sheet
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
  // Read: Parse DA-compliant JSON into a map of sheetName -> {data: [...]}
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
  // Internal: Ensure all values in data array are strings
  _stringifySheet(sheet) {
    return {
      ...sheet,
      data: (sheet.data || []).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, v != null ? String(v) : '']),
        ),
      ),
    };
  },
  // Internal: Optionally convert all values to strings (or keep as-is for reading)
  _parseDataArray(dataArr) {
    return Array.isArray(dataArr) ? dataArr.map((row) => ({ ...row })) : [];
  },
};

function createStateManager() {
  const state = {
    apiConfig: null,
    sessionId: null,
    scanLockKey: 'da_media_scan_lock',
    scanStateKey: 'da_media_scan_state',
    scanResultsKey: 'da_media_scan_results',
    discoveryQueueKey: 'da_media_discovery_queue',
    heartbeatInterval: null,
    heartbeatIntervalMs: 30000, // 30 seconds
  };

  let cachedMediaData = null;

  /**
   * Initialize state manager with API configuration
   */
  async function init(apiConfig) {
    state.apiConfig = apiConfig;
    state.sessionId = generateSessionId();

    // Ensure storage structure exists
    await ensureStorageStructure();

    // Start heartbeat to maintain scan lock
    startHeartbeat();
  }

  /**
   * Check if a scan is currently active
   */
  async function isScanActive() {
    try {
      const scanState = await getScanState();
      const isActive = scanState.isActive && scanState.sessionId;
      return isActive;
    } catch (error) {
      // Silent error handling for state management
      return false;
    }
  }

  /**
   * Acquire scan lock to prevent multiple simultaneous scans
   */
  async function acquireScanLock(scanType = 'full') {
    try {
      // Ensure session ID is set
      if (!state.sessionId) {
        state.sessionId = generateSessionId();
      }

      const currentState = await getScanState();

      if (currentState.isActive && currentState.sessionId !== state.sessionId) {
        throw new Error('Scan already in progress by another user');
      }

      const newState = {
        isActive: true,
        sessionId: state.sessionId,
        scanType,
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        status: 'running',
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
      // Silent error handling for state management
      throw new Error(`Failed to acquire scan lock: ${error.message}`);
    }
  }

  /**
   * Release scan lock
   */
  async function releaseScanLock() {
    stopHeartbeat(); // Stop heartbeat before saving scan state
    const scanState = await getScanState();
    scanState.isActive = false;
    scanState.status = 'completed';
    scanState.sessionId = null;
    scanState.scanType = null;
    scanState.startedAt = null;
    scanState.lastHeartbeat = null;
    await saveScanState(scanState);
    // Defensive: Reload and log isActive for verification
    const verifyState = await getScanState();
    if (verifyState.isActive === true || verifyState.isActive === 'true') {
      verifyState.isActive = false;
      await saveScanState(verifyState);
    }
  }

  /**
   * Update scan progress
   */
  async function updateScanProgress(progress) {
    try {
      // Ensure session ID is set
      if (!state.sessionId) {
        return;
      }

      const currentState = await getScanState();

      if (currentState.sessionId !== state.sessionId) {
        // If we don't own the lock, try to acquire it
        if (!currentState.isActive) {
          await acquireScanLock('full');
          return;
        }
        return;
      }

      const updatedState = {
        ...currentState,
        lastHeartbeat: Date.now(),
        progress: {
          ...currentState.progress,
          ...progress,
          lastUpdated: Date.now(),
        },
      };

      await saveScanState(updatedState);
    } catch (error) {
      // Silent error handling for state management
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
      };
    } catch (error) {
      // Silent error handling for state management
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
      
      // Build map of existing results for faster lookup
      existingResults.forEach(result => {
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
          // Update existing result
          const idx = updatedResults.findIndex(r => r.path === doc.path);
          if (idx > -1) {
            updatedResults[idx] = { ...existing, ...resultData };
          }
        } else {
          // Add new result
          updatedResults.push(resultData);
        }
      }
      
      await saveScanResults(updatedResults);
      
      console.log(`[State Manager] Saved ${documents.length} document results`);
    } catch (error) {
      console.error(`[State Manager] Failed to save document results:`, error);
    }
  }

  /**
   * Get documents that need scanning
   */
  async function getDocumentsToScan(discoveredDocuments, forceRescan = false) {
    try {
      if (forceRescan) {
        console.log('[State Manager] Force rescan requested - scanning all documents');
        return discoveredDocuments;
      }

      const existingResults = await loadScanResults();
      const existingPaths = new Map();
      
      // Build map of existing results for faster lookup
      existingResults.forEach(result => {
        existingPaths.set(result.path, {
          lastScanned: result.lastScanned || 0,
          lastModified: result.lastModified || 0
        });
      });

      const documentsToScan = [];
      const skippedDocuments = [];
      const newDocuments = [];
      const changedDocuments = [];

      for (const doc of discoveredDocuments) {
        const existing = existingPaths.get(doc.path);
        
        if (!existing) {
          // New document - always scan
          newDocuments.push(doc);
          documentsToScan.push(doc);
          continue;
        }

        // Check if document has changed using multiple methods
        const hasChanged = await checkDocumentChanged(doc, existing);
        
        if (hasChanged) {
          changedDocuments.push(doc);
          documentsToScan.push(doc);
        } else {
          skippedDocuments.push(doc);
        }
      }

      // Log incremental scan statistics
      console.log(`[State Manager] Incremental scan: ${newDocuments.length} new, ${changedDocuments.length} changed, ${skippedDocuments.length} skipped, ${documentsToScan.length} total to scan`);

      return documentsToScan;
    } catch (error) {
      console.error('[State Manager] Error in incremental scan, falling back to full scan:', error);
      return discoveredDocuments;
    }
  }

  /**
   * Check if a document has changed using server lastModified
   */
  async function checkDocumentChanged(doc, existing) {
    try {
      // Primary method: Compare lastModified timestamps (server is reliable)
      if (doc.lastModified && existing.lastModified) {
        return doc.lastModified > existing.lastModified;
      }

      // If document has lastModified but existing doesn't, scan it
      if (doc.lastModified && !existing.lastModified) {
        return true;
      }

      // If existing has lastModified but document doesn't, scan it
      if (!doc.lastModified && existing.lastModified) {
        return true;
      }

      // Fallback: Check if file was never scanned
      if (!existing.lastScanned) {
        return true; // File was never scanned
      }

      // If neither has lastModified, default to scanning
      return true;
    } catch (error) {
      console.warn(`[State Manager] Error checking document changes for ${doc.path}:`, error);
      return true; // Default to scanning if we can't determine
    }
  }

  /**
   * Save discovery queue for resumption
   */
  async function saveDiscoveryQueue(queue) {
    try {
      const existingQueue = await loadDiscoveryQueue();
      const existingPaths = new Set(existingQueue.map(item => item.path));
      
      // Filter out documents that are already in the queue
      const newDocuments = queue.filter(doc => !existingPaths.has(doc.path));
      
      if (newDocuments.length > 0) {
        // Also filter out documents that have already been scanned
        const scanResults = await loadScanResults();
        const scannedPaths = new Set(scanResults.map(result => result.path));
        const unscannedNewDocuments = newDocuments.filter(doc => !scannedPaths.has(doc.path));
        
        if (unscannedNewDocuments.length > 0) {
          const updatedQueue = [...existingQueue, ...unscannedNewDocuments];
          
          const jsonToWrite = buildSingleSheet(updatedQueue);
          const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-discovery-queue.json`;
          const url = `${state.apiConfig.baseUrl}/source${filePath}`;

          await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
        }
      }
    } catch (error) {
      console.error(`[State Manager] Failed to save discovery queue:`, error);
    }
  }

  /**
   * Load discovery queue for resumption
   */
  async function loadDiscoveryQueue() {
    try {
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-discovery-queue.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      const data = await loadSheetFile(url, state.apiConfig.token);
      const parsedData = parseSheet(data);

      return parsedData.data?.data || [];
    } catch (error) {
      // Silent error handling for state management
      return [];
    }
  }

  /**
   * Clear discovery queue
   */
  async function clearDiscoveryQueue() {
    try {
      const jsonToWrite = buildSingleSheet([]);
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-discovery-queue.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
    } catch (error) {
      // Silent error handling for state management
    }
  }

  /**
   * Get scan statistics
   */
  async function getScanStatistics() {
    try {
      const scanState = await getScanState();
      const scanResults = await loadScanResults();

      return {
        totalDocuments: scanResults.length,
        totalAssets: scanResults.reduce((sum, result) => sum + (result.assets?.length || 0), 0),
        lastScanTime: scanState.startedAt,
        scanDuration: scanState.startedAt ? Date.now() - scanState.startedAt : 0,
        isActive: scanState.isActive,
      };
    } catch (error) {
      // Silent error handling for state management
      return {
        totalDocuments: 0,
        totalAssets: 0,
        lastScanTime: null,
        scanDuration: 0,
        isActive: false,
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
      
      existingResults.forEach(result => {
        existingPaths.set(result.path, {
          lastScanned: result.lastScanned || 0,
          lastModified: result.lastModified || 0
        });
      });

      const stats = {
        total: discoveredDocuments.length,
        new: 0,
        changed: 0,
        unchanged: 0,
        toScan: 0,
        skipped: 0
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
      console.error('[State Manager] Error getting incremental scan stats:', error);
      return {
        total: discoveredDocuments.length,
        new: 0,
        changed: 0,
        unchanged: 0,
        toScan: discoveredDocuments.length,
        skipped: 0
      };
    }
  }

  /**
   * Ensure storage structure exists
   */
  async function ensureStorageStructure() {
    try {
      const folderPath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da`;
      await createFolderIfNotExists(folderPath);

      // Create initial sheet files if they don't exist
      await createInitialSheetFiles();
    } catch (error) {
      // Silent error handling for state management
    }
  }

  /**
   * Create initial sheet files for state management
   */
  async function createInitialSheetFiles() {
    const files = [
      {
        path: `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-scan-state.json`,
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
      {
        path: `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-scan-results.json`,
        type: 'multi-sheet',
        data: {
          results: [],
        },
        version: 3,
      },
      {
        path: `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-discovery-queue.json`,
        type: 'single-sheet',
        data: [],
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
      // Build DA-compliant JSON
      const jsonToWrite = DASheetUtil.build(file.data, { version: file.version });

      const url = `${state.apiConfig.baseUrl}/source${file.path}`;

      // Create FormData and append the JSON as a file
      const formData = new FormData();
      const jsonBlob = new Blob([JSON.stringify(jsonToWrite)], { type: 'application/json' });
      formData.append('file', jsonBlob, 'data.json');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.apiConfig.token}`,
        },
        body: formData,
      });

      return response.ok;
    } catch (error) {
      // Silent error handling for state management
      return false;
    }
  }

  /**
   * Load scan state from storage
   */
  async function loadScanState() {
    try {
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-scan-state.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      const data = await loadSheetFile(url, state.apiConfig.token);
      const parsedData = parseSheet(data);

      const stateData = parsedData.state?.data?.[0] || {};
      const progressData = parsedData.progress?.data?.[0] || {};

      // Convert string values back to proper types
      const isActive = stateData.isActive === 'true' || stateData.isActive === true;
      const startedAt = stateData.startedAt ? parseInt(stateData.startedAt, 10) : null;
      const lastHeartbeat = stateData.lastHeartbeat ? parseInt(stateData.lastHeartbeat, 10) : null;
      const totalDocuments = progressData.totalDocuments ? parseInt(progressData.totalDocuments, 10) : 0;
      const scannedDocuments = progressData.scannedDocuments ? parseInt(progressData.scannedDocuments, 10) : 0;
      const totalAssets = progressData.totalAssets ? parseInt(progressData.totalAssets, 10) : 0;
      const lastUpdated = progressData.lastUpdated ? parseInt(progressData.lastUpdated, 10) : Date.now();

      return {
        isActive: isActive,
        sessionId: stateData.sessionId || null,
        scanType: stateData.scanType || null,
        startedAt: startedAt,
        lastHeartbeat: lastHeartbeat,
        progress: {
          totalDocuments: totalDocuments,
          scannedDocuments: scannedDocuments,
          totalAssets: totalAssets,
          lastUpdated: lastUpdated,
        },
      };
    } catch (error) {
      // Silent error handling for state management
      return null;
    }
  }

  /**
   * Save scan state to storage
   */
  async function saveScanState(scanState) {
    try {
      const sheetMap = {
        state: [scanState],
        progress: [scanState.progress || {}],
      };
      const jsonToWrite = buildMultiSheet(sheetMap, 3);
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-scan-state.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
    } catch (error) {
      // Silent error handling for state management
    }
  }

  /**
   * Load scan results from storage
   */
  async function loadScanResults() {
    try {
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-scan-results.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      const data = await loadSheetFile(url, state.apiConfig.token);
      const parsedData = parseSheet(data);

      return parsedData.results?.data || [];
    } catch (error) {
      // Silent error handling for state management
      return [];
    }
  }

  /**
   * Save scan results to storage
   */
  async function saveScanResults(results) {
    try {
      const sheetMap = {
        results: results,
      };
      const jsonToWrite = buildMultiSheet(sheetMap, 3);
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-scan-results.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
    } catch (error) {
      // Silent error handling for state management
    }
  }

  /**
   * Clear scan lock (force release)
   */
  async function clearScanLock() {
    try {
      await releaseScanLock();
    } catch (error) {
      // Silent error handling for state management
    }
  }

  /**
   * Clear scan results to force a fresh scan
   */
  async function clearScanResults() {
    try {
      // Clear scan results file
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-scan-results.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;

      try {
        await fetch(url, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.apiConfig.token}` },
        });
      } catch (error) {
        // Scan results file may not exist, which is fine
      }

      // Clear discovery queue
      await clearDiscoveryQueue();

      // Reset scan state
      const emptyScanState = {
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
      };
      await saveScanState(emptyScanState);
    } catch (error) {
      // Silent error handling for state management
      throw error;
    }
  }

  /**
   * Force clear stale scan locks (older than 1 hour)
   */
  async function forceClearStaleScanLock() {
    try {
      const currentState = await getScanState();
      const oneHourAgo = Date.now() - (60 * 60 * 1000);

      // Handle both string and boolean isActive values
      const isActive = currentState.isActive === 'true' || currentState.isActive === true;

      if (isActive && currentState.lastHeartbeat && currentState.lastHeartbeat < oneHourAgo) {
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
      // Silent error handling for state management
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
      // Silent error handling for state management
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
        // Silent error handling for state management
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
    try {
      const url = `${state.apiConfig.baseUrl}/source${folderPath}/.folder`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.apiConfig.token}`,
        },
        body: new FormData(),
      });

      return response.ok;
    } catch (error) {
      // Folder might already exist
      // Silent error handling for state management
      return false;
    }
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
   * Remove a page from the discovery queue by path
   */
  async function removeFromDiscoveryQueue(path) {
    try {
      const queue = await loadDiscoveryQueue();
      const updatedQueue = queue.filter((item) => item.path !== path);
      const jsonToWrite = buildSingleSheet(updatedQueue);
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/media-discovery-queue.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;
      await saveSheetFile(url, jsonToWrite, state.apiConfig.token);
    } catch (error) {
      // Silent error handling for state management
    }
  }

  async function setScanStatus(status) {
    const scanState = await getScanState();
    scanState.status = status;
    scanState.isActive = (status === 'running');
    await saveScanState(scanState);
  }

  /**
   * Get cached media data from IndexedDB
   */
  async function getMediaData() {
    try {
      // Initialize IndexedDB
      await mediaDB.init();
      
      // Get from IndexedDB
      const assets = await mediaDB.getAssets();
  
      
      return assets;
    } catch (error) {
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
      console.error('Error getting media stats:', error);
      return { total: 0, byType: {}, byExternal: {}, unused: 0 };
    }
  }

  return {
    init,
    isScanActive,
    acquireScanLock,
    releaseScanLock,
    clearScanLock,
    forceClearStaleScanLock,
    forceClearAllScanLocks,
    updateScanProgress,
    getScanState,
    saveDocumentResults,
    getDocumentsToScan,
    saveDiscoveryQueue,
    loadDiscoveryQueue,
    clearDiscoveryQueue,
    getScanStatistics,
    getIncrementalScanStats,
    ensureStorageStructure,
    cleanup,
    removeFromDiscoveryQueue,
    setScanStatus,
    loadScanResults,
    clearScanResults,
    getMediaData,
    syncMediaData,
    clearMediaCache,
    searchMediaAssets,
    getMediaStats,
  };
}

export { createStateManager };
