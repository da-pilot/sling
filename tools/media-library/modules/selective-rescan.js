/* eslint-disable no-use-before-define */
/**
 * Selective Rescan Module - Handles targeted rescanning of specific folders and pages
 * Provides intelligent rescan capabilities for incremental updates
 */

export default function createSelectiveRescan() {
  const state = {
    daApi: null,
    sessionManager: null,
    processingStateManager: null,
    scanStatusManager: null,
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
   */
  async function init(
    docAuthoringService,
    sessionManagerInstance,
    processingStateManagerInstance,
    scanStatusManagerInstance,
  ) {
    try {
      state.sessionManager = sessionManagerInstance;
      state.processingStateManager = processingStateManagerInstance;
      state.scanStatusManager = scanStatusManagerInstance;

      state.daApi = docAuthoringService;

      console.log('[Selective Rescan] ✅ Initialized successfully');
      return true;
    } catch (error) {
      console.error('[Selective Rescan] ❌ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set current session for rescan operations
   */
  function setCurrentSession(sessionId, userId, browserId) {
    state.currentSessionId = sessionId;
    state.currentUserId = userId;
    state.currentBrowserId = browserId;

    // eslint-disable-next-line no-console
    console.log('[Selective Rescan] 🔄 Session updated:', {
      sessionId,
      userId,
      browserId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Rescan specific folder with intelligent change detection
   */
  async function rescanFolder(folderPath, options = {}) {
    if (!state.isActive) {
      throw new Error('Selective rescan not initialized');
    }

    try {
      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 🔍 Starting folder rescan:', folderPath);

      emit('rescanStarted', { type: 'folder', path: folderPath, options });

      const documents = await discoverDocumentsInFolder(folderPath);
      const validDocuments = await validateAndGetDocuments(documents, options);

      if (validDocuments.length === 0) {
        // eslint-disable-next-line no-console
        console.log('[Selective Rescan] ⚠️ No valid documents found in folder:', folderPath);
        emit('rescanCompleted', { type: 'folder', path: folderPath, documentsScanned: 0 });
        return { documentsScanned: 0, errors: 0 };
      }

      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 📄 Processing documents:', validDocuments.length);

      const results = await processBatchRescan(validDocuments, options);

      emit('rescanCompleted', {
        type: 'folder',
        path: folderPath,
        documentsScanned: results.scanned,
        errors: results.errors,
      });

      return results;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Folder rescan failed:', error);
      emit('rescanError', { type: 'folder', path: folderPath, error: error.message });
      throw error;
    }
  }

  /**
   * Rescan specific pages with change detection
   */
  async function rescanPages(pagePaths, options = {}) {
    if (!state.isActive) {
      throw new Error('Selective rescan not initialized');
    }

    try {
      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 🔍 Starting page rescan:', pagePaths.length, 'pages');

      emit('rescanStarted', { type: 'pages', paths: pagePaths, options });

      const validDocuments = await validateAndGetDocuments(pagePaths, options);

      if (validDocuments.length === 0) {
        // eslint-disable-next-line no-console
        console.log('[Selective Rescan] ⚠️ No valid pages found for rescan');
        emit('rescanCompleted', { type: 'pages', documentsScanned: 0 });
        return { documentsScanned: 0, errors: 0 };
      }

      const results = await processBatchRescan(validDocuments, options);

      emit('rescanCompleted', {
        type: 'pages',
        documentsScanned: results.scanned,
        errors: results.errors,
      });

      return results;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Page rescan failed:', error);
      emit('rescanError', { type: 'pages', error: error.message });
      throw error;
    }
  }

  /**
   * Rescan documents modified since a specific date
   */
  async function rescanModifiedSince(sinceDate, options = {}) {
    if (!state.isActive) {
      throw new Error('Selective rescan not initialized');
    }

    try {
      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 🔍 Starting modified-since rescan:', sinceDate);

      emit('rescanStarted', { type: 'modified-since', sinceDate, options });

      const allDocuments = await discoverAllDocuments();
      const modifiedDocuments = allDocuments.filter((doc) => {
        const lastModified = new Date(doc.lastModified || 0);
        return lastModified >= new Date(sinceDate);
      });

      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 📄 Found modified documents:', modifiedDocuments.length);

      const validDocuments = await validateAndGetDocuments(modifiedDocuments, options);

      if (validDocuments.length === 0) {
        // eslint-disable-next-line no-console
        console.log('[Selective Rescan] ⚠️ No valid modified documents found');
        emit('rescanCompleted', { type: 'modified-since', documentsScanned: 0 });
        return { documentsScanned: 0, errors: 0 };
      }

      const results = await processBatchRescan(validDocuments, options);

      emit('rescanCompleted', {
        type: 'modified-since',
        documentsScanned: results.scanned,
        errors: results.errors,
      });

      return results;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Modified-since rescan failed:', error);
      emit('rescanError', { type: 'modified-since', error: error.message });
      throw error;
    }
  }

  /**
   * Get intelligent rescan suggestions based on analysis
   */
  async function getRescanSuggestions() {
    try {
      const suggestions = [];

      // Analyze scan status for failed pages
      if (state.scanStatusManager) {
        const failedPages = await state.scanStatusManager.getFailedPages();
        if (failedPages.length > 0) {
          suggestions.push({
            type: 'failed-pages',
            count: failedPages.length,
            description: `${failedPages.length} pages failed during previous scan`,
            priority: 'high',
          });
        }
      }

      // Analyze processing state for incomplete scans
      if (state.processingStateManager && state.currentSessionId) {
        const scanningProgress = await state.processingStateManager
          .getScanningProgress(state.currentSessionId);

        if (scanningProgress && scanningProgress.status === 'incomplete') {
          suggestions.push({
            type: 'incomplete-scan',
            count: scanningProgress.pendingPages || 0,
            description: 'Previous scan was incomplete',
            priority: 'medium',
          });
        }
      }

      // Analyze folder statistics for potential issues
      const folderStats = await getFolderStatistics();
      if (folderStats.foldersWithErrors > 0) {
        suggestions.push({
          type: 'error-folders',
          count: folderStats.foldersWithErrors,
          description: `${folderStats.foldersWithErrors} folders have scanning errors`,
          priority: 'medium',
        });
      }

      return suggestions;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Error getting suggestions:', error);
      return [];
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
   * Discover documents in a specific folder
   */
  async function discoverDocumentsInFolder(folderPath) {
    try {
      if (!state.daApi) {
        throw new Error('DA API not initialized');
      }

      const items = await state.daApi.listPath(folderPath);
      const documents = items.filter((item) => item.type === 'file' && item.ext === 'html');

      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 📁 Discovered documents in folder:', {
        folderPath,
        totalItems: items.length,
        documents: documents.length,
      });

      return documents;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Error discovering documents:', error);
      throw error;
    }
  }

  /**
   * Discover all documents in the repository
   */
  async function discoverAllDocuments() {
    try {
      if (!state.daApi) {
        throw new Error('DA API not initialized');
      }

      const allItems = await state.daApi.getAllHTMLFiles();
      const documents = allItems.filter((item) => item.type === 'file' && item.ext === 'html');

      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 📁 Discovered all documents:', documents.length);

      return documents;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Error discovering all documents:', error);
      throw error;
    }
  }

  /**
   * Process batch rescan with progress tracking
   */
  async function processBatchRescan(documents, options) {
    const results = {
      scanned: 0,
      errors: 0,
      details: [],
    };

    const batchSize = options.batchSize || 10;
    const batches = [];

    // Create batches
    for (let i = 0; i < documents.length; i += batchSize) {
      batches.push(documents.slice(i, i + batchSize));
    }

    // Process batches with progress updates
    const allBatchPromises = batches.map(async (batch, i) => {
      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 📦 Processing batch:', i + 1, 'of', batches.length);

      const batchPromises = batch.map(async (document) => {
        try {
          const result = await processSingleDocument(document);
          results.scanned += 1;
          return { success: true, document, result };
        } catch (error) {
          results.errors += 1;
          return { success: false, document, error: error.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.details.push(...batchResults);

      // Update progress
      emit('rescanProgress', {
        currentBatch: i + 1,
        totalBatches: batches.length,
        documentsScanned: results.scanned,
        errors: results.errors,
      });

      return batchResults;
    });

    await Promise.all(allBatchPromises);

    return results;
  }

  /**
   * Validate and get documents for rescan
   */
  async function validateAndGetDocuments(documents, options) {
    const validDocuments = [];

    documents.forEach((doc) => {
      // Basic validation
      if (!doc.path || !doc.name) {
        return;
      }

      // Check if document should be rescanned based on options
      if (options.skipScanned && doc.scanComplete) {
        return;
      }

      if (options.onlyFailed && doc.scanStatus !== 'failed') {
        return;
      }

      validDocuments.push(doc);
    });

    // eslint-disable-next-line no-console
    console.log('[Selective Rescan] ✅ Validated documents:', {
      total: documents.length,
      valid: validDocuments.length,
    });

    return validDocuments;
  }

  /**
   * Process a single document for rescan
   */
  async function processSingleDocument(document) {
    try {
      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 📄 Processing document:', document.path);

      // Get document content
      const content = await state.daApi.getSource(document.path);

      // Scan document for media
      const media = await scanDocumentForMedia(content, document.path);

      // Update scan status
      if (state.scanStatusManager) {
        await state.scanStatusManager.markPageScanned(
          document.sourceFile || 'unknown',
          document.path,
          media.length,
        );
      }

      emit('documentScanned', {
        path: document.path,
        mediaCount: media.length,
      });

      return { mediaCount: media.length, success: true };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Error processing document:', document.path, error);

      // Update scan status for failed document
      if (state.scanStatusManager) {
        await state.scanStatusManager.markPageFailed(
          document.sourceFile || 'unknown',
          document.path,
          error.message,
        );
      }

      emit('documentError', {
        path: document.path,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Scan document for media content
   */
  async function scanDocumentForMedia(content, documentPath) {
    try {
      // Extract media from HTML content
      const media = extractMediaFromHTML(content, documentPath);

      // eslint-disable-next-line no-console
      console.log('[Selective Rescan] 🖼️ Extracted media from document:', {
        path: documentPath,
        mediaCount: media.length,
      });

      return media;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Error scanning document for media:', error);
      return [];
    }
  }

  /**
   * Extract media from HTML content
   */
  function extractMediaFromHTML(content) {
    const media = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');

    // Extract images
    const images = doc.querySelectorAll('img[src]');
    images.forEach((img) => {
      const src = img.getAttribute('src');
      if (src) {
        media.push({
          src,
          alt: img.getAttribute('alt') || '',
          type: 'image',
          context: getElementContext(img),
        });
      }
    });

    // Extract videos
    const videos = doc.querySelectorAll('video source[src]');
    videos.forEach((source) => {
      const src = source.getAttribute('src');
      if (src) {
        media.push({
          src,
          type: 'video',
          context: getElementContext(source),
        });
      }
    });

    // Extract background images
    const elements = doc.querySelectorAll('*');
    elements.forEach((element) => {
      const { style } = element;
      if (style.backgroundImage && style.backgroundImage !== 'none') {
        const matches = style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/g);
        if (matches) {
          matches.forEach((match) => {
            const src = match.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
            if (src) {
              media.push({
                src,
                type: 'background-image',
                context: getElementContext(element),
              });
            }
          });
        }
      }
    });

    return media;
  }

  /**
   * Get element context for media
   */
  function getElementContext(element) {
    const context = [];

    // Get parent heading
    const heading = element.closest('h1, h2, h3, h4, h5, h6');
    if (heading) {
      context.push(heading.textContent.trim().substring(0, 30));
    }

    // Get parent section
    const section = element.closest('section, article, div[class*="content"]');
    if (section) {
      const sectionText = section.textContent.trim().substring(0, 50);
      if (sectionText) {
        context.push(sectionText);
      }
    }

    return context.join(' - ');
  }

  /**
   * Get folder statistics for analysis
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

      // Analyze each folder
      const folderPromises = folderItems.map(async (folder) => {
        try {
          const items = await state.daApi.listPath(folder.path);
          const documents = items.filter((item) => item.type === 'file' && item.ext === 'html');

          return {
            path: folder.path,
            documentCount: documents.length,
            hasErrors: false, // This would need to be determined from scan status
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
      // eslint-disable-next-line no-console
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
   * Get document statistics
   */
  async function getDocumentStats(documentPath) {
    try {
      const content = await state.daApi.getSource(documentPath);
      const media = extractMediaFromHTML(content);

      return {
        path: documentPath,
        mediaCount: media.length,
        lastModified: new Date().toISOString(),
        size: content.length,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Selective Rescan] ❌ Error getting document stats:', error);
      return {
        path: documentPath,
        mediaCount: 0,
        lastModified: null,
        size: 0,
        error: error.message,
      };
    }
  }

  /**
   * Get rescan statistics
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
    getRescanSuggestions,
    on,
    off,
    getStats,
    getDocumentStats,
    cleanup,
  };
}