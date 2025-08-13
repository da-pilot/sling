/* eslint-disable no-use-before-define */
/**
 * Selective Rescan Module - Handles targeted rescanning of specific folders and pages
 * Provides intelligent rescan capabilities for incremental updates
 */

import createDocumentScanner from './discovery/document-scanner.js';

export default function createSelectiveRescan() {
  const state = {
    daApi: null,
    sessionManager: null,
    processingStateManager: null,
    persistenceManager: null,
    queueOrchestrator: null,
    mediaProcessor: null,
    documentScanner: null,
    config: null,
    isActive: false,
    currentSessionId: null,
    currentUserId: null,
    currentBrowserId: null,
    stats: {
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      scannedDocuments: 0,
      errors: 0,
    },
    listeners: new Map(),
  };

  /**
   * Initialize selective rescan with dependencies
   * @param {Object} docAuthoringService - Document authoring service instance
   * @param {Object} sessionManagerInstance - Session manager instance
   * @param {Object} processingStateManagerInstance - Processing state manager instance
   * @param {Object} persistenceManagerInstance - Persistence manager instance
   * @param {Object} mediaProcessorInstance - Media processor instance
   * @param {Object} queueOrchestratorInstance - Queue orchestrator instance
   * @returns {Promise<boolean>} Initialization success status
   */
  async function init(
    docAuthoringService,
    sessionManagerInstance,
    processingStateManagerInstance,
    persistenceManagerInstance,
    mediaProcessorInstance,
    queueOrchestratorInstance,
  ) {
    state.sessionManager = sessionManagerInstance;
    state.processingStateManager = processingStateManagerInstance;
    state.persistenceManager = persistenceManagerInstance;
    state.mediaProcessor = mediaProcessorInstance;
    state.queueOrchestrator = queueOrchestratorInstance;
    state.daApi = docAuthoringService;
    state.documentScanner = createDocumentScanner();
    state.config = docAuthoringService.getConfig();
    await state.documentScanner.init(state.config, docAuthoringService);
    state.isActive = true;
    return true;
  }

  /**
   * Set current session for rescan operations
   * @param {string} sessionId - Session ID
   * @param {string} userId - User ID
   * @param {string} browserId - Browser ID
   */
  function setCurrentSession(sessionId, userId, browserId) {
    state.currentSessionId = sessionId;
    state.currentUserId = userId;
    state.currentBrowserId = browserId;
  }

  /**
   * Rescan specific folder with intelligent change detection
   * @param {string} folderPath - Folder path to rescan
   * @param {Object} options - Rescan options
   * @returns {Promise<Object>} Rescan results
   */
  async function rescanFolder(folderPath, options = {}) {
    if (!state.isActive) {
      console.error('[Selective Rescan] ❌ Not initialized');
      throw new Error('Selective rescan not initialized');
    }
    emit('rescanStarted', { type: 'folder', path: folderPath, options });
    console.log('[Selective Rescan] 🔍 Starting folder rescan:', { folderPath });
    const pagePaths = await discoverAllPagesInFolderRecursive(folderPath);
    if (pagePaths.length === 0) {
      console.log('[Selective Rescan] ⚠️ No pages found in folder:', { folderPath });
      emit('rescanCompleted', { type: 'folder', path: folderPath, documentsScanned: 0 });
      return { documentsScanned: 0, errors: 0 };
    }
    console.log('[Selective Rescan] 📁 Found pages in folder:', { folderPath, pageCount: pagePaths.length, pages: pagePaths });
    const documentsToScan = pagePaths.map((path) => ({
      path,
      scanStatus: 'pending',
      needsRescan: true,
      scanComplete: false,
      lastScannedAt: null,
      scanAttempts: 0,
      scanErrors: [],
      discoveredAt: new Date().toISOString(),
      discoveryComplete: true,
      mediaCount: 0,
      entryStatus: 'pending',
    }));
    const result = await state.queueOrchestrator.scanningCoordinator
      .startSelectiveScanningPhase(documentsToScan, false);
    console.log('[Selective Rescan] 📊 Scanning phase result:', result);
    emit('rescanCompleted', {
      type: 'folder',
      path: folderPath,
      documentsScanned: pagePaths.length,
      errors: result.success ? 0 : 1,
    });
    return { documentsScanned: pagePaths.length, errors: result.success ? 0 : 1 };
  }

  /**
   * Discover all pages in a folder recursively using DA API
   * @param {string} folderPath - Folder path to discover
   * @returns {Promise<Array>} Array of page paths
   */
  async function discoverAllPagesInFolderRecursive(folderPath) {
    console.log('[Selective Rescan] 🔍 Discovering pages recursively:', { folderPath });
    const allPages = [];
    await discoverFolderRecursively(folderPath, allPages);
    console.log('[Selective Rescan] ✅ Discovery complete:', { folderPath, totalPages: allPages.length });
    return allPages;
  }

  /**
   * Discover pages in a folder recursively
   * @param {string} folderPath - Folder path to process
   * @param {Array} allPages - Array to collect page paths
   * @returns {Promise<void>}
   */
  async function discoverFolderRecursively(folderPath, allPages) {
    try {
      console.log('[Selective Rescan] 📂 Processing folder:', { folderPath });
      const items = await state.daApi.listPath(folderPath);
      const htmlFiles = items.filter((item) => item.ext && item.ext === 'html');
      const subfolders = items.filter((item) => !item.ext);
      console.log('[Selective Rescan] 📄 Found HTML files:', { folderPath, htmlCount: htmlFiles.length, files: htmlFiles.map((f) => f.path) });
      console.log('[Selective Rescan] 📁 Found subfolders:', { folderPath, subfolderCount: subfolders.length, subfolders: subfolders.map((f) => f.path) });
      htmlFiles.forEach((file) => {
        allPages.push(file.path);
      });
      const subfolderPromises = subfolders.map(async (subfolder) => {
        if (subfolder.path !== folderPath) {
          await discoverFolderRecursively(subfolder.path, allPages);
        }
      });
      await Promise.all(subfolderPromises);
    } catch (error) {
      console.error('[Selective Rescan] ❌ Error discovering folder:', { folderPath, error: error.message });
    }
  }

  /**
   * Rescan specific pages with change detection
   * @param {Array} pagePaths - Array of page paths to rescan
   * @param {Object} options - Rescan options
   * @returns {Promise<Object>} Rescan results
   */
  async function rescanPages(pagePaths, options = {}) {
    if (!state.isActive) {
      console.error('[Selective Rescan] ❌ Not initialized');
      throw new Error('Selective rescan not initialized');
    }
    emit('rescanStarted', { type: 'pages', paths: pagePaths, options });
    const fullPaths = pagePaths.map((path) => {
      const fullPath = path.startsWith('/da-pilot/sling/') ? path : `/da-pilot/sling${path}`;
      return fullPath;
    });
    console.log('[Selective Rescan] 📄 Starting selective scanning:', { pageCount: fullPaths.length, pages: fullPaths });
    const documentsToScan = fullPaths.map((path) => ({
      path,
      scanStatus: 'pending',
      needsRescan: true,
      scanComplete: false,
      lastScannedAt: null,
      scanAttempts: 0,
      scanErrors: [],
      discoveredAt: new Date().toISOString(),
      discoveryComplete: true,
      mediaCount: 0,
      entryStatus: 'pending',
    }));
    const result = await state.queueOrchestrator.scanningCoordinator
      .startSelectiveScanningPhase(documentsToScan, false);
    console.log('[Selective Rescan] 📊 Scanning phase result:', result);
    emit('rescanCompleted', {
      type: 'pages',
      documentsScanned: fullPaths.length,
      errors: result.success ? 0 : 1,
    });
    return { documentsScanned: fullPaths.length, errors: result.success ? 0 : 1 };
  }

  /**
   * Rescan documents modified since a specific date
   * @param {string} sinceDate - Date to check modifications since
   * @param {Object} options - Rescan options
   * @returns {Promise<Object>} Rescan results
   */
  async function rescanModifiedSince(sinceDate, options = {}) {
    if (!state.isActive) {
      console.error('[Selective Rescan] ❌ Not initialized');
      throw new Error('Selective rescan not initialized');
    }
    emit('rescanStarted', { type: 'modified-since', sinceDate, options });
    const allDocuments = await discoverAllDocuments();
    const modifiedDocuments = allDocuments.filter((doc) => {
      const lastModified = new Date(doc.lastModified || 0);
      return lastModified >= new Date(sinceDate);
    });
    if (modifiedDocuments.length === 0) {
      emit('rescanCompleted', { type: 'modified-since', documentsScanned: 0 });
      return { documentsScanned: 0, errors: 0 };
    }
    const pagePaths = modifiedDocuments.map((doc) => doc.path);
    console.log('[Selective Rescan] 📅 Rescanning modified documents:', { sinceDate, pageCount: pagePaths.length, pages: pagePaths });
    const documentsToScan = pagePaths.map((path) => ({
      path,
      scanStatus: 'pending',
      needsRescan: true,
      scanComplete: false,
      lastScannedAt: null,
      scanAttempts: 0,
      scanErrors: [],
      discoveredAt: new Date().toISOString(),
      discoveryComplete: true,
      mediaCount: 0,
      entryStatus: 'pending',
    }));
    const result = await state.queueOrchestrator.scanningCoordinator
      .startSelectiveScanningPhase(documentsToScan, false);
    emit('rescanCompleted', {
      type: 'modified-since',
      documentsScanned: pagePaths.length,
      errors: result.success ? 0 : 1,
    });
    return { documentsScanned: pagePaths.length, errors: result.success ? 0 : 1 };
  }

  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function on(event, callback) {
    if (!state.listeners.has(event)) {
      state.listeners.set(event, []);
    }
    state.listeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
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
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  function emit(event, data) {
    const callbacks = state.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  /**
   * Discover all documents in the repository
   * @returns {Promise<Array>} Array of all documents
   */
  async function discoverAllDocuments() {
    try {
      if (!state.daApi) {
        console.error('[Selective Rescan] ❌ DA API not initialized');
        throw new Error('DA API not initialized');
      }
      const allItems = await state.daApi.getAllHTMLFiles();
      const documents = allItems.filter((item) => item.type === 'file' && item.ext === 'html');
      return documents;
    } catch (error) {
      console.error('[Selective Rescan] ❌ Error discovering all documents:', error);
      throw error;
    }
  }

  /**
   * Get folder statistics for analysis
   * @returns {Promise<Object>} Folder statistics
   */
  async function getFolderStatistics() {
    try {
      const stats = {
        totalFolders: 0,
        foldersWithErrors: 0,
        foldersWithMedia: 0,
        averageDocumentsPerFolder: 0,
      };
      if (!state.daApi) {
        return stats;
      }
      const folders = await state.daApi.listPath('/');
      const folderItems = folders.filter((item) => item.type === 'folder');
      stats.totalFolders = folderItems.length;
      const folderPromises = folderItems.map(async (folder) => {
        try {
          const items = await state.daApi.listPath(folder.path);
          const documents = items.filter((item) => item.type === 'file' && item.ext === 'html');
          return {
            path: folder.path,
            documentCount: documents.length,
            hasErrors: false,
          };
        } catch (error) {
          return {
            path: folder.path,
            documentCount: 0,
            hasErrors: true,
          };
        }
      });
      const folderResults = await Promise.all(folderPromises);
      folderResults.forEach((result) => {
        if (result.hasErrors) {
          stats.foldersWithErrors += 1;
        }
        if (result.documentCount > 0) {
          stats.foldersWithMedia += 1;
        }
      });
      const totalDocuments = folderResults.reduce((sum, result) => sum + result.documentCount, 0);
      stats.averageDocumentsPerFolder = stats.totalFolders > 0
        ? Math.round(totalDocuments / stats.totalFolders)
        : 0;
      return stats;
    } catch (error) {
      console.error('[Selective Rescan] ❌ Error getting folder statistics:', error);
      return {
        totalFolders: 0,
        foldersWithErrors: 0,
        foldersWithMedia: 0,
        averageDocumentsPerFolder: 0,
      };
    }
  }

  /**
   * Get rescan statistics
   * @returns {Object} Rescan statistics
   */
  function getStats() {
    return { ...state.stats };
  }

  /**
   * Cleanup resources
   */
  function cleanup() {
    state.isActive = false;
    state.listeners.clear();
  }

  return {
    init,
    setCurrentSession,
    rescanFolder,
    rescanPages,
    rescanModifiedSince,
    getFolderStatistics,
    on,
    off,
    getStats,
    cleanup,
  };
}