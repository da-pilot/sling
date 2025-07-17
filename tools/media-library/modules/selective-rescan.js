/**
 * Selective Rescan Module - Granular control over rescanning
 * Provides options to rescan specific folders, pages, or document sets
 */

function createSelectiveRescan() {
  const state = {
    apiConfig: null,
    discoveryManager: null,
    assetStorageManager: null,
    listeners: new Map(),
  };

  /**
   * Initialize selective rescan module
   */
  async function init(apiConfig, discoveryManager, assetStorageManager) {
    state.apiConfig = apiConfig;
    state.discoveryManager = discoveryManager;
    state.assetStorageManager = assetStorageManager;
    // Selective Rescan: Initialized
  }

  /**
   * Rescan specific folder and all its subfolders
   */
  async function rescanFolder(folderPath, options = {}) {
    const {
      recursive = true,
      forceRescan = false,
    } = options;

    try {
      emit('rescanStarted', {
        type: 'folder',
        target: folderPath,
        recursive,
        forceRescan,
      });

      // Discover documents in the folder
      const documents = await discoverDocumentsInFolder(folderPath, recursive);

      if (documents.length === 0) {
        emit('rescanComplete', {
          type: 'folder',
          target: folderPath,
          documentsProcessed: 0,
          assetsFound: 0,
        });
        return { documentsProcessed: 0, assetsFound: 0 };
      }

      // Filter documents that need rescanning
      const documentsToScan = await state.assetStorageManager.getDocumentsToScan(
        documents,
        { forceRescan, folderPath },
      );

      if (documentsToScan.length === 0) {
        emit('rescanComplete', {
          type: 'folder',
          target: folderPath,
          documentsProcessed: 0,
          assetsFound: 0,
          reason: 'no_changes_detected',
        });
        return { documentsProcessed: 0, assetsFound: 0 };
      }

      // Process documents in batches
      const results = await processBatchRescan(documentsToScan, {
        type: 'folder',
        target: folderPath,
      });

      emit('rescanComplete', {
        type: 'folder',
        target: folderPath,
        ...results,
      });

      return results;

    } catch (error) {
      emit('rescanError', {
        type: 'folder',
        target: folderPath,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Rescan specific pages/documents
   */
  async function rescanPages(pagePaths, options = {}) {
    const { forceRescan = true } = options;

    try {
      emit('rescanStarted', {
        type: 'pages',
        target: pagePaths,
        count: pagePaths.length,
        forceRescan,
      });

      // Validate and get document details
      const documents = await validateAndGetDocuments(pagePaths);

      if (documents.length === 0) {
        emit('rescanComplete', {
          type: 'pages',
          target: pagePaths,
          documentsProcessed: 0,
          assetsFound: 0,
          reason: 'no_valid_documents',
        });
        return { documentsProcessed: 0, assetsFound: 0 };
      }

      // Filter documents that need rescanning
      const documentsToScan = await state.assetStorageManager.getDocumentsToScan(
        documents,
        { forceRescan, specificPaths: pagePaths },
      );

      // Process documents
      const results = await processBatchRescan(documentsToScan, {
        type: 'pages',
        target: pagePaths,
      });

      emit('rescanComplete', {
        type: 'pages',
        target: pagePaths,
        ...results,
      });

      return results;

    } catch (error) {
      emit('rescanError', {
        type: 'pages',
        target: pagePaths,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Rescan documents modified since a specific date
   */
  async function rescanModifiedSince(sinceDate, options = {}) {
    const {
      folderPath = null,
      forceRescan = false,
    } = options;

    try {
      emit('rescanStarted', {
        type: 'modified_since',
        target: sinceDate,
        folderPath,
        forceRescan,
      });

      // Discover all documents
      const allDocuments = folderPath
        ? await discoverDocumentsInFolder(folderPath, true)
        : await discoverAllDocuments();

      // Filter by modification date
      const modifiedDocuments = allDocuments.filter((doc) =>
        doc.lastModified > sinceDate.getTime(),
      );

      if (modifiedDocuments.length === 0) {
        emit('rescanComplete', {
          type: 'modified_since',
          target: sinceDate,
          documentsProcessed: 0,
          assetsFound: 0,
          reason: 'no_modified_documents',
        });
        return { documentsProcessed: 0, assetsFound: 0 };
      }

      // Process documents
      const results = await processBatchRescan(modifiedDocuments, {
        type: 'modified_since',
        target: sinceDate,
        folderPath,
      });

      emit('rescanComplete', {
        type: 'modified_since',
        target: sinceDate,
        folderPath,
        ...results,
      });

      return results;

    } catch (error) {
      emit('rescanError', {
        type: 'modified_since',
        target: sinceDate,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get rescan suggestions based on analysis
   */
  async function getRescanSuggestions() {
    try {
      const statistics = await state.assetStorageManager.getStatistics();
      const suggestions = [];

      // Suggest rescanning old documents
      if (statistics.lastScanTime) {
        const daysSinceLastScan = (Date.now() - statistics.lastScanTime) / (1000 * 60 * 60 * 24);

        if (daysSinceLastScan > 7) {
          suggestions.push({
            type: 'age_based',
            priority: 'medium',
            title: 'Weekly rescan recommended',
            description: `Last scan was ${Math.floor(daysSinceLastScan)} days ago`,
            action: 'rescan_modified_since',
            target: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)),
          });
        }
      }

      // Suggest rescanning folders with many assets
      const folderStats = await getFolderStatistics();
      folderStats.forEach((folder) => {
        if (folder.assetCount > 50 && folder.daysSinceLastScan > 3) {
          suggestions.push({
            type: 'folder_based',
            priority: folder.assetCount > 100 ? 'high' : 'medium',
            title: `Rescan ${folder.path}`,
            description: `${folder.assetCount} assets, last scanned ${folder.daysSinceLastScan} days ago`,
            action: 'rescan_folder',
            target: folder.path,
          });
        }
      });

      // Sort by priority
      suggestions.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });

      return suggestions;

    } catch (error) {
      return [];
    }
  }

  /**
   * Private helper functions
   */
  async function discoverDocumentsInFolder(folderPath, recursive = true) {
    const documents = [];
    const foldersToScan = [folderPath];

    while (foldersToScan.length > 0) {
      const currentFolder = foldersToScan.shift();

      try {
        const items = await listFolderContents(currentFolder);

        for (const item of items) {
          if (item.ext === 'html') {
            documents.push({
              path: item.path,
              name: item.name,
              lastModified: item.lastModified,
              folder: currentFolder,
            });
          } else if (!item.ext && recursive) {
            foldersToScan.push(item.path);
          }
        }
      } catch (error) {
        // Selective Rescan: Error scanning folder
        emit('folderScanError', {
          folderPath: currentFolder,
          error: error.message,
        });
      }
    }

    return documents;
  }

  async function discoverAllDocuments() {
    return discoverDocumentsInFolder('/', true);
  }

  async function validateAndGetDocuments(pagePaths) {
    const documents = [];

    for (const path of pagePaths) {
      try {
        const stats = await getDocumentStats(path);
        if (stats) {
          documents.push({
            path,
            name: path.split('/').pop(),
            lastModified: stats.lastModified,
            folder: path.substring(0, path.lastIndexOf('/')),
          });
        }
      } catch (error) {
        // Selective Rescan: Invalid document path
        emit('invalidDocument', { path, error: error.message });
      }
    }

    return documents;
  }

  async function processBatchRescan(documents, context) {
    const batchSize = 5;
    const allResults = [];

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(processSingleDocument),
      );

      allResults.push(...batchResults);

      // Update progress after each batch
      const successfulResults = allResults.filter((result) => result.success);
      const documentsProcessed = successfulResults.length;
      const totalAssetsFound = successfulResults.reduce((sum, result) => sum + result.assetsFound, 0);

      // Emit events for this batch
      batchResults.forEach((result) => {
        if (result.success) {
          emit('documentScanned', {
            ...context,
            document: result.document,
            assetsFound: result.assetsFound,
            progress: documentsProcessed / documents.length,
          });
        }
      });

      emit('batchProgress', {
        ...context,
        documentsProcessed,
        totalDocuments: documents.length,
        assetsFound: totalAssetsFound,
        progress: documentsProcessed / documents.length,
      });
    }

    const finalSuccessfulResults = allResults.filter((result) => result.success);
    const finalDocumentsProcessed = finalSuccessfulResults.length;
    const finalTotalAssetsFound = finalSuccessfulResults.reduce((sum, result) => sum + result.assetsFound, 0);

    return {
      documentsProcessed: finalDocumentsProcessed,
      assetsFound: finalTotalAssetsFound,
    };

    async function processSingleDocument(doc) {
      try {
        const assets = await scanDocumentForAssets(doc);

        if (assets.length > 0) {
          await state.assetStorageManager.saveDocumentResults([{
            path: doc.path,
            assets,
            lastModified: doc.lastModified,
            scanDuration: Date.now() - Date.now(), // Placeholder
          }]);
        }

        return {
          document: doc.path,
          assetsFound: assets.length,
          success: true,
        };

      } catch (error) {
        emit('documentScanError', {
          ...context,
          document: doc.path,
          error: error.message,
        });
        return {
          document: doc.path,
          assetsFound: 0,
          error: error.message,
          success: false,
        };
      }
    }
  }

  async function scanDocumentForAssets(document) {
    // Use path as-is - it's the unique identifier
    const url = `${state.apiConfig.baseUrl}/source${document.path}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.apiConfig.token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch document: ${response.status}`);
    }

    const html = await response.text();
    return extractAssetsFromHTML(html, document.path);
  }

  function isProbablyUrl(str) {
    return typeof str === 'string' && /^@?https?:\/\//.test(str);
  }

  function getLinkAssetName(link) {
    if (link.title && !isProbablyUrl(link.title)) return link.title.trim();
    if (link.textContent && !isProbablyUrl(link.textContent)) return link.textContent.trim();
    return extractAssetNameFromUrl(link.href);
  }

  function extractAssetsFromHTML(html, documentPath) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const assets = [];

    // Extract images
    const images = doc.querySelectorAll('img[src]');
    images.forEach((img) => {
      assets.push({
        src: img.src,
        type: 'image',
        alt: img.alt || '',
        title: img.title || '',
        context: getElementContext(img),
        documentPath,
      });
    });

    // Extract videos
    const videos = doc.querySelectorAll('video[src], source[src]');
    videos.forEach((video) => {
      assets.push({
        src: video.src,
        type: 'video',
        title: video.title || '',
        context: getElementContext(video),
        documentPath,
      });
    });

    // Extract other media
    const links = doc.querySelectorAll('a[href]');
    links.forEach((link) => {
      const href = link.href;
      if (isMediaFile(href)) {
        assets.push({
          src: href,
          type: determineAssetType(href),
          title: getLinkAssetName(link),
          context: getElementContext(link),
          documentPath,
        });
      }
    });

    return assets;
  }

  function getElementContext(element) {
    // Determine context based on parent elements or classes
    const parent = element.closest('section, article, header, footer, nav, aside');
    if (parent) {
      return parent.tagName.toLowerCase();
    }

    const classNames = element.className.toString();
    if (classNames.includes('hero')) return 'hero';
    if (classNames.includes('gallery')) return 'gallery';
    if (classNames.includes('thumbnail')) return 'thumbnail';

    return 'content';
  }

  function isMediaFile(url) {
    const mediaExtensions = [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp',
      'mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    ];

    const extension = url.split('.').pop().toLowerCase();
    return mediaExtensions.includes(extension);
  }

  function determineAssetType(src) {
    const extension = src.split('.').pop().toLowerCase();

    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(extension)) {
      return 'image';
    }

    if (['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv'].includes(extension)) {
      return 'video';
    }

    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) {
      return 'document';
    }

    return 'other';
  }

  async function listFolderContents(folderPath) {
    // Use folderPath as-is since it already includes org/repo prefix
    const url = `${state.apiConfig.baseUrl}/list${folderPath}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.apiConfig.token}` },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const items = Array.isArray(data) ? data : data.items || [];

    return items.map((item) => ({
      name: item.name,
      path: item.path,
      ext: item.ext,
      lastModified: item.lastModified,
    }));
  }

  async function getDocumentStats(path) {
    try {
      // Use path as-is - it's the unique identifier
      const url = `${state.apiConfig.baseUrl}/source${path}`;

      const response = await fetch(url, {
        method: 'HEAD',
        headers: { 'Authorization': `Bearer ${state.apiConfig.token}` },
      });

      if (!response.ok) {
        return null;
      }

      const lastModified = response.headers.get('last-modified');
      return {
        lastModified: lastModified ? new Date(lastModified).getTime() : Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  async function getFolderStatistics() {
    // This would require analyzing the existing asset storage
    // For now, return empty array
    return [];
  }


  /**
   * Event system
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
          // Selective Rescan: Error in event listener
        }
      });
    }
  }

  return {
    init,
    rescanFolder,
    rescanPages,
    rescanModifiedSince,
    getRescanSuggestions,
    on,
    off,
  };
}

export { createSelectiveRescan };
