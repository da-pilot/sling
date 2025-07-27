/* eslint-disable no-use-before-define, no-console */

/**
 * Folder Discovery Worker - Discovers HTML documents within a specific folder
 * Enables multi-threaded parallel document discovery across folder structure
 */

import {
  createWorkerDaApi,
  createWorkerSheetUtils,
  CONTENT_DA_LIVE_BASE,
} from '../services/worker-utils.js';

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
let sheetUtils = null;

/**
 * Initialize worker with configuration
 */
async function init(workerConfig) {
  config = workerConfig;
  daApi = createWorkerDaApi();
  sheetUtils = createWorkerSheetUtils();
  await daApi.init(config);
}

/**
 * Start discovering documents in assigned folder
 */
async function discoverFolder(folderPath, workerId, discoveryType = 'full') {
  const folderPathState = folderPath;
  const workerIdState = workerId;
  try {
    const existingDocuments = discoveryType === 'incremental' ? await loadExistingDiscovery(folderPathState) : [];
    const currentDocuments = await discoverDocumentsInFolder(folderPathState);
    const mergedDocuments = discoveryType === 'incremental'
      ? mergeDiscoveryData(existingDocuments, currentDocuments)
      : currentDocuments;
    if (mergedDocuments.length > 0) {
      await saveWorkerQueue(mergedDocuments);
    }
    postMessage({
      type: 'folderDiscoveryComplete',
      data: {
        folderPath: folderPathState,
        documents: mergedDocuments,
        documentCount: mergedDocuments.length,
        workerId: workerIdState,
        existingCount: existingDocuments.length,
        currentCount: currentDocuments.length,
        discoveryType,
      },
    });
  } catch (error) {
    postMessage({
      type: 'folderDiscoveryError',
      data: {
        folderPath: folderPathState,
        error: error.message,
      },
    });
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
  const documents = [];
  const foldersToScan = [folderPath];
  let excludePatterns = [];
  try {
    const configUrl = `${CONTENT_DA_LIVE_BASE}/${config.org}/${config.repo}/.media/config.json`;
    const configData = await sheetUtils.loadSheetFile(configUrl, config.token);
    const parsedConfig = sheetUtils.parseSheet(configData);

    if (parsedConfig && parsedConfig.data && Array.isArray(parsedConfig.data)) {
      parsedConfig.data.forEach((row) => {
        if (row.key === 'excludes' && typeof row.value === 'string') {
          excludePatterns.push(...row.value.split(',').map((s) => s.trim()).filter(Boolean));
        }
      });
    }
  } catch (e) {
    excludePatterns = [];
  }

  while (foldersToScan.length > 0) {
    const currentFolder = foldersToScan.shift();

    try {
      // eslint-disable-next-line no-await-in-loop
      const items = await listFolderContents(currentFolder);
      items.forEach((item) => {
        if (!item.ext) {
          if (matchesExcludePatterns(item.path, excludePatterns)) {
            return;
          }
          foldersToScan.push(item.path);
          return;
        }
        if (item.ext === 'html') {
          if (typeof item.lastModified === 'undefined') {
            return;
          }
          if (matchesExcludePatterns(item.path, excludePatterns)) {
            return;
          }
          documents.push({
            name: item.name,
            path: item.path,
            ext: item.ext,
            lastModified: item.lastModified,
          });
        }
      });

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
      // Don't send individual folder scan errors, just log them
      // The main error will be sent when the entire discovery fails
    }
  }

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
          ...existingDoc,
          lastModified: currentDoc.lastModified,
          discoveredAt: new Date().toISOString(),
          scanComplete: false,
          needsRescan: true,
          lastScanned: '',
          mediaCount: 0,
          scanStatus: 'pending',
          lastScannedAt: '',
          scanAttempts: 0,
          scanErrors: [],
          entryStatus: 'updated',
        });
      } else {
        merged.push({
          ...existingDoc,
          entryStatus: 'unchanged',
        });
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
        lastScanned: '',
        mediaCount: 0,
        scanStatus: 'pending',
        lastScannedAt: '',
        scanAttempts: 0,
        scanErrors: [],
        entryStatus: 'new',
      });
    }
  });
  existingMap.forEach((existingDoc) => {
    merged.push({
      ...existingDoc,
      entryStatus: 'deleted',
      deletedAt: new Date().toISOString(),
    });
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
    const items = await daApi.listPath('.media/.pages');
    const existingFile = items.find((item) => item.name && item.name === `${folderName}.json`);
    if (existingFile) {
      try {
        const configData = await sheetUtils.fetchSheetJson(config, existingFile.name);
        return configData?.data || [];
      } catch (fileError) {
        return [];
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
async function saveWorkerQueue(documents) {
  try {
    if (!config) {
      return;
    }
    const folderName = state.folderPath === '/' ? 'root' : state.folderPath.split('/').pop() || 'root';
    const documentsWithMetadata = documents.map((doc) => ({
      ...doc,
      discoveryComplete: true,
    }));
    const jsonToWrite = sheetUtils.buildSingleSheet(documentsWithMetadata);
    const filePath = `/${config.org}/${config.repo}/.media/.pages/${folderName}.json`;
    const url = `${config.baseUrl}/source${filePath}`;
    await sheetUtils.saveSheetFile(url, jsonToWrite, config.token);
  } catch (error) {
    // Ignore errors
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
          return;
        }
        state.isRunning = true;
        state.folderPath = data.folderPath;
        state.workerId = data.workerId;
        await discoverFolder(data.folderPath, data.workerId, data.discoveryType);
        break;
      }

      case 'stopDiscovery': {
        stopDiscovery();
        break;
      }

      default: {
        break;
      }
    }
  } catch (error) {
    postMessage({
      type: 'error',
      data: { error: error.message, originalType: type },
    });
  }
});