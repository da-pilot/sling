/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
/**
 * Folder Discovery Worker - Discovers HTML documents within a specific folder
 * Enables multi-threaded parallel document discovery across folder structure
 */

import { createWorkerDaApi, createWorkerSheetUtils, createWorkerStateManager } from '../services/worker-utils.js';

const state = {
  config: null,
  daApi: null,
  sheetUtils: null,
  stateManager: null,
  folderPath: null,
  isRunning: false,
  documents: [],
  excludePatterns: [],
};

let config = null;
let daApi = null;
const sheetUtils = createWorkerSheetUtils();
const stateManager = createWorkerStateManager();

/**
 * Initialize worker with configuration
 */
async function init(workerConfig) {
  config = workerConfig;
  daApi = createWorkerDaApi();
  await daApi.init(config);

  // eslint-disable-next-line no-console
  console.log('[Folder Discovery Worker] 🔧 Initialized with config:', {
    folderPath: state.folderPath,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Start discovering documents in assigned folder
 */
async function discoverFolder(folderPath, workerId) {
  const folderPathState = folderPath;
  const workerIdState = workerId;
  let isRunning = true;

  // eslint-disable-next-line no-console
  console.log('[Folder Discovery Worker] 🚀 Starting folder discovery:', {
    folderPath: folderPathState,
    workerId: workerIdState,
    timestamp: new Date().toISOString(),
  });

  try {
    const discoveryStartTime = Date.now();

    const folderName = folderPathState === '/' ? 'root' : folderPathState.split('/').pop() || 'root';
    const shortWorkerId = workerIdState.split('_').slice(-2).join('-');
    const fileName = `${folderName}-${shortWorkerId}.json`;

    // eslint-disable-next-line no-console
    console.log('[Folder Discovery Worker] 📁 Discovery setup:', {
      folderPath: folderPathState,
      folderName,
      fileName,
      timestamp: new Date().toISOString(),
    });

    // Progress tracking is handled by the main thread via postMessage

    // eslint-disable-next-line no-console
    console.log('[Folder Discovery Worker] 🔍 Loading existing discovery for:', folderPathState);
    const existingDocuments = await loadExistingDiscovery(folderPathState);

    // eslint-disable-next-line no-console
    console.log('[Folder Discovery Worker] 🔍 Discovering documents in folder:', folderPathState);
    const currentDocuments = await discoverDocumentsInFolder(folderPathState);

    // eslint-disable-next-line no-console
    console.log('[Folder Discovery Worker] 📊 Discovery results:', {
      folderPath: folderPathState,
      existingCount: existingDocuments.length,
      currentCount: currentDocuments.length,
      timestamp: new Date().toISOString(),
    });

    const mergedDocuments = mergeDiscoveryData(existingDocuments, currentDocuments);

    const discoveryEndTime = Date.now();
    const discoveryDuration = discoveryEndTime - discoveryStartTime;
    const discoveryDurationSeconds = Math.round(discoveryDuration / 1000);

    if (mergedDocuments.length > 0) {
      await saveWorkerQueue(mergedDocuments, workerIdState);
    }

    // State management is handled by the main thread via postMessage

    postMessage({
      type: 'folderDiscoveryComplete',
      data: {
        folderPath: folderPathState,
        documents: mergedDocuments,
        documentCount: mergedDocuments.length,
        workerId: workerIdState,
        existingCount: existingDocuments.length,
        currentCount: currentDocuments.length,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Folder Discovery Worker] Folder discovery failed:', {
      folderPath: folderPathState,
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    // Error handling is done via postMessage to main thread

    postMessage({
      type: 'folderDiscoveryError',
      data: {
        folderPath: folderPathState,
        error: error.message,
      },
    });
  } finally {
    isRunning = false;
  }
}

function matchesExcludePatterns(path, patterns) {
  return patterns.some((pattern) => {
    const pathParts = path.split('/');
    if (pathParts.length >= 3) {
      const org = pathParts[1];
      const repo = pathParts[2];
      const orgRepoPrefix = `/${org}/${repo}`;

      if (pattern.endsWith('/*')) {
        const fullPattern = `${orgRepoPrefix}${pattern}`;
        return path.startsWith(fullPattern.slice(0, -1));
      }
      return path === `${orgRepoPrefix}${pattern}`;
    }
    return false;
  });
}

/**
 * Recursively discover documents in folder and subfolders
 */
async function discoverDocumentsInFolder(folderPath) {
  // eslint-disable-next-line no-console
  console.log('[Folder Discovery Worker] 🔍 Starting document discovery in folder:', {
    folderPath,
    timestamp: new Date().toISOString(),
  });

  const documents = [];
  const foldersToScan = [folderPath];

  // eslint-disable-next-line no-console
  console.log('[Folder Discovery Worker] 📋 Initial setup:', {
    folderPath,
    foldersToScan,
    timestamp: new Date().toISOString(),
  });

  let excludePatterns = [];
  try {
    const configData = await sheetUtils.fetchSheetJson(config, 'media-library-config.json');
    excludePatterns = [];
    if (configData?.data) {
      for (const row of configData.data) {
        if (typeof row.exclude === 'string') {
          excludePatterns.push(...row.exclude.split(',').map((s) => s.trim()).filter(Boolean));
        }
      }
    }
  } catch (e) {
    excludePatterns = [];

    // eslint-disable-next-line no-console
    console.error('[Folder Discovery Worker] Failed to load exclusion patterns:', e);
  }

  // eslint-disable-next-line no-console
  console.log('[Folder Discovery Worker] 📋 Starting folder scan with exclude patterns:', {
    folderPath,
    excludePatterns,
    foldersToScan: foldersToScan.length,
    timestamp: new Date().toISOString(),
  });

  while (foldersToScan.length > 0) {
    const currentFolder = foldersToScan.shift();

    // eslint-disable-next-line no-console
    console.log('[Folder Discovery Worker] 📁 Scanning folder:', {
      currentFolder,
      foldersRemaining: foldersToScan.length,
      documentsFound: documents.length,
      timestamp: new Date().toISOString(),
    });

    try {
      const items = await listFolderContents(currentFolder);

      // Debug: Log folder detection for first few items
      if (items.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[Folder Discovery] Processing folder:', {
          folder: currentFolder,
          itemCount: items.length,
          sampleItems: items.slice(0, 3).map((item) => ({
            name: item.name,
            path: item.path,
            ext: item.ext,
            isFolder: !item.ext,
            isHTML: item.ext === 'html',
          })),
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('[Folder Discovery Worker] ⚠️ No items found in folder:', {
          folder: currentFolder,
          timestamp: new Date().toISOString(),
        });
      }

      for (const item of items) {
        if (!item.ext) {
          if (matchesExcludePatterns(item.path, excludePatterns)) {
            continue;
          }
          foldersToScan.push(item.path);
          continue;
        }
        if (item.ext === 'html') {
          if (typeof item.lastModified === 'undefined') {
            continue;
          }
          if (matchesExcludePatterns(item.path, excludePatterns)) {
            continue;
          }
          documents.push({
            name: item.name,
            path: item.path,
            ext: item.ext,
            lastModified: item.lastModified,
          });
        }
      }

      if (documents.length > 0 && documents.length % 50 === 0) {
        postMessage({
          type: 'folderProgress',
          data: {
            folderPath,
            currentFolder,
            documentsFound: documents.length,
            foldersRemaining: foldersToScan.length,
          },
        });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Folder Discovery Worker] ❌ Error scanning folder:', {
        folder: currentFolder,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      // Don't send individual folder scan errors, just log them
      // The main error will be sent when the entire discovery fails
    }
  }

  // eslint-disable-next-line no-console
  console.log('[Folder Discovery Worker] ✅ Document discovery complete:', {
    folderPath,
    totalDocuments: documents.length,
    timestamp: new Date().toISOString(),
  });

  return documents;
}

/**
 * List contents of a specific folder
 */
async function listFolderContents(folderPath) {
  return daApi.listPath(folderPath);
}

/**
 * Merge existing and current discovery data
 */
function mergeDiscoveryData(existingDocuments, currentDocuments) {
  const existingMap = new Map();
  const merged = [];

  existingDocuments.forEach((doc) => {
    existingMap.set(doc.path, doc);
  });

  currentDocuments.forEach((currentDoc) => {
    const existingDoc = existingMap.get(currentDoc.path);

    if (existingDoc) {
      if (currentDoc.lastModified > existingDoc.lastModified) {
        merged.push({
          path: currentDoc.path,
          lastModified: currentDoc.lastModified,
          discoveredAt: new Date().toISOString(),
          discoveryComplete: true,
          lastScanned: existingDoc.lastScanned,
          scanComplete: existingDoc.scanComplete,
          assetCount: existingDoc.assetCount,
          needsRescan: true,
        });
      } else {
        merged.push(existingDoc);
      }
      existingMap.delete(currentDoc.path);
    } else {
      merged.push({
        path: currentDoc.path,
        lastModified: currentDoc.lastModified,
        discoveredAt: new Date().toISOString(),
        discoveryComplete: true,
        scanComplete: false,
        needsRescan: true,
        lastScanned: null,
        assetCount: 0,
      });
    }
  });

  existingMap.forEach((existingDoc) => {
    merged.push(existingDoc);
  });

  return merged;
}

/**
 * Load existing discovery data for re-discovery
 */
async function loadExistingDiscovery(folderPath) {
  try {
    const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
    if (!daApi) {
      throw new Error('DA API service not initialized');
    }

    // Discovery files are stored in .da/.pages, not in the folder path
    const items = await daApi.listPath('.da/.pages');

    const existingFile = items.find((item) => item.name && item.name.startsWith(`${folderName}-`) && item.name.endsWith('.json'));

    if (existingFile) {
      try {
        const configData = await sheetUtils.fetchSheetJson(config, existingFile.name);
        return configData?.data || [];
      } catch (fileError) {
        // eslint-disable-next-line no-console
        console.log('[Folder Discovery Worker] ⚠️ Could not load existing discovery file:', fileError.message);
      }
    }

    return [];
  } catch (error) {
    return [];
  }
}

/**
 * Save worker's own queue file
 */
async function saveWorkerQueue(documents, workerId) {
  try {
    if (!config) {
      // eslint-disable-next-line no-console
      console.error('[Folder Discovery Worker] No config available for queue save');
      return;
    }

    const shortWorkerId = workerId.split('_').slice(-2).join('-');
    const folderName = state.folderPath === '/' ? 'root' : state.folderPath.split('/').pop() || 'root';

    const documentsWithMetadata = documents.map((doc) => ({
      ...doc,
      discoveryComplete: true,
    }));

    const jsonToWrite = sheetUtils.buildSingleSheet(documentsWithMetadata);
    const filePath = `/${config.org}/${config.repo}/.da/.pages/${folderName}-${shortWorkerId}.json`;
    const url = `${config.baseUrl}/source${filePath}`;

    await sheetUtils.saveSheetFile(url, jsonToWrite, config.token);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Folder Discovery Worker] Failed to save worker queue:', {
      workerId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Stop folder discovery
 */
function stopDiscovery() {
  state.isRunning = false;

  postMessage({
    type: 'folderDiscoveryStopped',
    data: { folderPath: state.folderPath },
  });
}

// eslint-disable-next-line no-restricted-globals
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  try {
    switch (type) {
      case 'init': {
        const workerConfig = data.apiConfig;
        await init(workerConfig);
        postMessage({ type: 'initialized' });
        break;
      }

      case 'discoverFolder': {
        if (state.isRunning) {
          // eslint-disable-next-line no-console
          console.log('[Folder Discovery Worker] ⚠️ Discovery already running, skipping duplicate request');
          return;
        }
        state.isRunning = true;
        state.folderPath = data.folderPath;
        state.workerId = data.workerId;
        await discoverFolder(data.folderPath, data.workerId);
        break;
      }

      case 'stopDiscovery': {
        stopDiscovery();
        break;
      }

      default: {
        // eslint-disable-next-line no-console
        console.warn('[Folder Discovery Worker] ⚠️ Unknown message type:', type);
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Folder Discovery Worker] ❌ Error handling message:', {
      type,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    postMessage({
      type: 'error',
      data: { error: error.message, originalType: type },
    });
  }
});