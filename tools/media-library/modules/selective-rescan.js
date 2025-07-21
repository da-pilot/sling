/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
/**
 * Selective Rescan Module - Granular control over rescanning
 * Provides options to rescan specific folders, pages, or document sets
 */

function createSelectiveRescan() {
  const state = {
    daApi: null,
    isActive: false,
    currentRescan: null,
    stats: {
      totalItems: 0,
      processedItems: 0,
      errors: 0,
      assetsFound: 0,
    },
    listeners: new Map(),
  };

  const api = {
    init,
    rescanFolder,
    rescanPages,
    rescanModifiedSince,
    getRescanSuggestions,
    on,
    off,
    emit,
  };

  async function init(apiConfig) {
    // Create and initialize DA API service
    const { createDAApiService } = await import('../services/da-api.js');
    state.daApi = createDAApiService();
    await state.daApi.init(apiConfig);
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

      const documentsToScan = await state.daApi.getDocumentsToScan(
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

      const documentsToScan = await state.daApi.getDocumentsToScan(
        documents,
        { forceRescan, specificPaths: pagePaths },
      );

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

      const allDocuments = folderPath
        ? await discoverDocumentsInFolder(folderPath, true)
        : await discoverAllDocuments();

      const modifiedDocuments = allDocuments.filter((doc) => doc.lastModified > sinceDate.getTime());

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
      const statistics = await state.daApi.getStatistics();
      const suggestions = [];

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
        const items = await state.daApi.listFolderContents(currentFolder);

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

      const successfulResults = allResults.filter((result) => result.success);
      const documentsProcessed = successfulResults.length;
      const totalAssetsFound = successfulResults.reduce((sum, result) => sum + result.assetsFound, 0);

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
          await state.daApi.saveDocumentResults([{
            path: doc.path,
            assets,
            lastModified: doc.lastModified,
            scanDuration: Date.now() - Date.now(),
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
    const { getSource } = await import('../services/da-api.js');
    const html = await getSource(document.path, 'html');
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

    const links = doc.querySelectorAll('a[href]');
    links.forEach((link) => {
      const { href } = link;
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
    if (!state.daApi) {
      throw new Error('DA API service not initialized');
    }
    return state.daApi.listPath(folderPath);
  }

  async function getDocumentStats(path) {
    try {
      if (!state.daApi) {
        throw new Error('DA API service not initialized');
      }
      await state.daApi.getSource(path, 'html');
      return {
        lastModified: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  async function getFolderStatistics() {
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
