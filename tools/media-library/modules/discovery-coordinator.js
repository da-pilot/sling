/**
 * Discovery Coordinator - Orchestrates discovery process and manages state between components
 */

import createDiscoveryManager from './discovery-manager.js';
import createDiscoveryFileManager from './queue/discovery-file-manager.js';

export default function createDiscoveryCoordinator() {
  const state = {
    discoveryManager: null,
    discoveryFileManager: null,
    config: null,
    daApi: null,
    discoveryHandlersSetup: false,
    discoveryFilesCache: null,
    documentsToScan: null,
  };

  async function init(config, daApi, sessionManager = null, processingStateManager = null) {
    state.config = config;
    state.daApi = daApi;
    state.discoveryManager = createDiscoveryManager();
    state.discoveryFileManager = createDiscoveryFileManager();

    await state.discoveryManager.init(daApi, sessionManager, processingStateManager);
  }

  async function loadDiscoveryFiles() {
    const files = await state.discoveryFileManager.loadDiscoveryFiles(state.config, state.daApi);
    return files;
  }

  async function clearDiscoveryFiles() {
    await state.discoveryFileManager.clearDiscoveryFiles(state.config, state.daApi);
    if (state.discoveryManager && typeof state.discoveryManager.clearStructureBaseline === 'function') {
      await state.discoveryManager.clearStructureBaseline();
    }
  }

  async function loadDiscoveryFilesWithChangeDetection() {
    const files = await state.discoveryFileManager.loadDiscoveryFilesWithChangeDetection(
      state.config,
      state.daApi,
      async (discoveryFiles) => {
        const changedDocuments = [];
        discoveryFiles.forEach((file) => {
          file.documents.forEach((doc) => {
            if (doc.needsRescan || doc.scanStatus === 'failed') {
              changedDocuments.push({
                ...doc,
                sourceFile: file.fileName,
              });
            }
          });
        });
        return changedDocuments;
      },
    );
    return files;
  }

  function getDocumentsToScan(discoveryFiles, forceRescan = false) {
    const documentsToScan = [];

    discoveryFiles.forEach((file) => {
      file.documents.forEach((doc) => {
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
          }
        } else {
          needsScan = !doc.scanComplete || doc.needsRescan;
          if (needsScan) {
            if (!hasScanComplete) {
              scanReason = 'new';
            } else if (doc.needsRescan) {
              scanReason = 'changed';
            } else {
              scanReason = 'incomplete';
            }
          }
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
        }
      });
    });
    return documentsToScan;
  }

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

  async function checkDiscoveryFilesExist() {
    try {
      const files = await state.discoveryFileManager.loadDiscoveryFiles(state.config, state.daApi);
      return {
        filesExist: files.length > 0,
        shouldRunDiscovery: files.length === 0,
        fileCount: files.length,
      };
    } catch (error) {
      return {
        filesExist: false,
        shouldRunDiscovery: true,
        fileCount: 0,
      };
    }
  }

  async function startDiscoveryWithSession(sessionId, forceRescan) {
    return state.discoveryManager.startDiscoveryWithSession(sessionId, forceRescan);
  }

  async function stopDiscovery() {
    return state.discoveryManager.stopDiscovery();
  }

  async function resumeDiscoveryFromCheckpoint(discoveryCheckpoint) {
    return state.discoveryManager.resumeDiscoveryFromCheckpoint(discoveryCheckpoint);
  }

  function setupDiscoveryHandlers(eventHandlers) {
    if (state.discoveryManager && typeof state.discoveryManager.setupDiscoveryHandlers === 'function') {
      state.discoveryManager.setupDiscoveryHandlers(eventHandlers);
    }
  }

  function getDiscoveryManager() {
    return state.discoveryManager;
  }

  function getDiscoveryFilesCache() {
    return state.discoveryFilesCache;
  }

  function setDiscoveryFilesCache(cache) {
    state.discoveryFilesCache = cache;
  }

  /**
   * Update discovery file in cache with scan results
   * @param {string} fileName - Discovery file name
   * @param {string} pagePath - Page path
   * @param {string} status - Scan status
   * @param {number} mediaCount - Media count
   * @param {string} error - Error message if any
   */
  function updateDiscoveryFileInCache(fileName, pagePath, status, mediaCount = 0, error = null) {
    if (!state.discoveryFilesCache || !Array.isArray(state.discoveryFilesCache)) {
      return false;
    }

    const fileIndex = state.discoveryFilesCache.findIndex((file) => file.fileName === fileName);
    if (fileIndex === -1) {
      return false;
    }

    const file = state.discoveryFilesCache[fileIndex];
    if (!file.documents || !Array.isArray(file.documents)) {
      return false;
    }

    const documentIndex = file.documents.findIndex((doc) => doc.path === pagePath);
    if (documentIndex === -1) {
      return false;
    }

    const currentDoc = file.documents[documentIndex];
    const now = new Date().toISOString();
    const isCompleted = status === 'completed';
    const scanAttempts = (currentDoc.scanAttempts || 0) + 1;

    file.documents[documentIndex] = {
      ...currentDoc,
      scanStatus: status,
      mediaCount,
      lastScannedAt: now,
      lastScanned: now,
      scanComplete: isCompleted,
      scanErrors: error ? [error] : [],
      scanAttempts,
      needsRescan: !isCompleted,
      entryStatus: isCompleted ? 'completed' : status === 'failed' ? 'failed' : 'pending',
    };

    return true;
  }

  /**
   * Update multiple discovery files in cache with scan results
   * @param {Array} updates - Array of update objects
   */
  function updateDiscoveryFilesInCache(updates) {
    if (!Array.isArray(updates)) {
      return false;
    }

    let successCount = 0;
    updates.forEach((update) => {
      const success = updateDiscoveryFileInCache(
        update.fileName,
        update.pagePath,
        update.status,
        update.mediaCount,
        update.error,
      );
      if (success) {
        successCount += 1;
      }
    });

    return successCount;
  }

  /**
   * Get updated discovery files from cache for persistence
   * @returns {Array} Updated discovery files
   */
  function getUpdatedDiscoveryFilesFromCache() {
    return state.discoveryFilesCache || [];
  }

  function getDocumentsToScanFromCache() {
    return state.documentsToScan;
  }

  function setDocumentsToScanInCache(documents) {
    state.documentsToScan = documents;
  }

  function getConfig() {
    return state.config;
  }

  function getDaApi() {
    return state.daApi;
  }

  function getProcessingStateManager() {
    // The discovery manager doesn't have getProcessingStateManager method
    // This method is kept for backward compatibility but returns null
    // The processing state manager should be passed directly to components that need it
    return null;
  }

  async function performIncrementalDiscovery(changes) {
    if (state.discoveryManager && typeof state.discoveryManager.performIncrementalDiscovery === 'function') {
      return state.discoveryManager.performIncrementalDiscovery(changes);
    }
    return [];
  }

  async function loadSiteStructureForComparison() {
    if (state.discoveryManager && typeof state.discoveryManager.loadSiteStructureForComparison === 'function') {
      return state.discoveryManager.loadSiteStructureForComparison();
    }
    return null;
  }

  async function generateDiscoveryFileForFolder(folderPath, folderData) {
    if (state.discoveryManager && typeof state.discoveryManager.generateDiscoveryFileForFolder === 'function') {
      return state.discoveryManager.generateDiscoveryFileForFolder(folderPath, folderData);
    }
    return null;
  }

  async function updateDiscoveryFileForFileChanges(folderPath, fileChanges) {
    if (state.discoveryManager && typeof state.discoveryManager.updateDiscoveryFileForFileChanges === 'function') {
      return state.discoveryManager.updateDiscoveryFileForFileChanges(folderPath, fileChanges);
    }
    return false;
  }

  return {
    init,
    loadDiscoveryFiles,
    clearDiscoveryFiles,
    loadDiscoveryFilesWithChangeDetection,
    getDocumentsToScan,
    detectChangedDocuments,
    checkDiscoveryFilesExist,
    startDiscoveryWithSession,
    stopDiscovery,
    resumeDiscoveryFromCheckpoint,
    setupDiscoveryHandlers,
    getDiscoveryManager,
    getDiscoveryFilesCache,
    setDiscoveryFilesCache,
    updateDiscoveryFileInCache,
    updateDiscoveryFilesInCache,
    getUpdatedDiscoveryFilesFromCache,
    getDocumentsToScanFromCache,
    setDocumentsToScanInCache,
    getConfig,
    getDaApi,
    getProcessingStateManager,
    performIncrementalDiscovery,
    loadSiteStructureForComparison,
    generateDiscoveryFileForFolder,
    updateDiscoveryFileForFileChanges,
  };
}