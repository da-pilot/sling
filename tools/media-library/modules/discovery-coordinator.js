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

  async function init(config, daApi) {
    state.config = config;
    state.daApi = daApi;
    state.discoveryManager = createDiscoveryManager();
    state.discoveryFileManager = createDiscoveryFileManager();
    await state.discoveryManager.init(daApi, null, null);
  }

  async function loadDiscoveryFiles() {
    return state.discoveryFileManager.loadDiscoveryFiles(state.config, state.daApi);
  }

  async function clearDiscoveryFiles() {
    await state.discoveryFileManager.clearDiscoveryFiles(state.config, state.daApi);
    if (state.discoveryManager && typeof state.discoveryManager.clearStructureBaseline === 'function') {
      await state.discoveryManager.clearStructureBaseline();
    }
  }

  async function loadDiscoveryFilesWithChangeDetection() {
    return state.discoveryFileManager.loadDiscoveryFilesWithChangeDetection(
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
  }

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
    console.log('[Discovery Coordinator] Document scanning analysis:', {
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

  async function detectChangedDocuments(discoveryFiles) {
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
  }

  async function checkDiscoveryFilesExist() {
    try {
      const discoveryFiles = await loadDiscoveryFiles();
      return {
        filesExist: discoveryFiles.length > 0,
        shouldRunDiscovery: discoveryFiles.length === 0,
      };
    } catch (error) {
      console.error('[Discovery Coordinator] Error checking discovery files:', error);
      return {
        filesExist: false,
        shouldRunDiscovery: true,
      };
    }
  }

  async function startDiscoveryWithSession(sessionId, forceRescan) {
    return state.discoveryManager.startDiscoveryWithSession(sessionId, forceRescan);
  }

  async function stopDiscovery() {
    if (state.discoveryManager) {
      await state.discoveryManager.stopDiscovery();
    }
  }

  async function resumeDiscoveryFromCheckpoint(discoveryCheckpoint) {
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
    if (pendingFolders.length === 0) {
      console.log('[Discovery Coordinator] All folders already discovered, marking discovery complete');
      state.discoveryComplete = true;
      state.discoveryFilesCache = await loadDiscoveryFilesWithChangeDetection();
      state.documentsToScan = getDocumentsToScan(state.discoveryFilesCache, false);
      return { discoveryComplete: true };
    }
    console.log('[Discovery Coordinator] Resuming discovery with pending folders only');
    return { discoveryComplete: false, pendingFolders, completedFolders };
  }

  function setupDiscoveryHandlers(eventHandlers) {
    if (state.discoveryHandlersSetup) {
      return;
    }
    if (!state.discoveryManager) {
      return;
    }
    state.discoveryHandlersSetup = true;
    state.discoveryManager.on('documentsDiscovered', eventHandlers.onDocumentsDiscovered);
    state.discoveryManager.on('folderComplete', eventHandlers.onFolderComplete);
    state.discoveryManager.on('documentsChanged', eventHandlers.onDocumentsChanged);
    state.discoveryManager.on('discoveryComplete', eventHandlers.onDiscoveryComplete);
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

  function getDocumentsToScanFromCache() {
    return state.documentsToScan;
  }

  function setDocumentsToScanInCache(documents) {
    state.documentsToScan = documents;
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
    getDocumentsToScanFromCache,
    setDocumentsToScanInCache,
  };
}