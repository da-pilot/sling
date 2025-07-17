/**
 * Folder Discovery Worker - Discovers HTML documents within a specific folder
 * Enables multi-threaded parallel document discovery across folder structure
 */

import { fetchSheetJson } from '../modules/sheet-utils.js';

const state = {
  apiConfig: null,
  folderPath: null,
  isRunning: false,
};

/**
 * Initialize folder discovery worker
 */
function init(config) {
  state.apiConfig = config;
  console.log('[Folder Discovery Worker] Initialized with config:', {
    baseUrl: config.baseUrl,
    org: config.org,
    repo: config.repo
  });
  
  // Add heartbeat to track background activity
  setInterval(() => {
    if (state.isRunning) {
      console.log('[Folder Discovery Worker] Background heartbeat - Running:', {
        folderPath: state.folderPath,
        timestamp: new Date().toISOString()
      });
    }
  }, 30000); // Every 30 seconds
}

/**
 * Start discovering documents in assigned folder
 */
async function discoverFolder(folderPath) {
  state.folderPath = folderPath;
  state.isRunning = true;

  console.log('[Folder Discovery Worker] Starting folder discovery:', {
    folderPath,
    timestamp: new Date().toISOString()
  });

  try {
    const documents = await discoverDocumentsInFolder(folderPath);

    console.log('[Folder Discovery Worker] Folder discovery complete:', {
      folderPath,
      documentCount: documents.length,
      timestamp: new Date().toISOString()
    });

    postMessage({
      type: 'folderDiscoveryComplete',
      data: {
        folderPath,
        documents,
        documentCount: documents.length,
      },
    });

  } catch (error) {
    console.error('[Folder Discovery Worker] Folder discovery failed:', {
      folderPath,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    postMessage({
      type: 'folderDiscoveryError',
      data: {
        folderPath,
        error: error.message,
      },
    });
  } finally {
    state.isRunning = false;
    console.log('[Folder Discovery Worker] Discovery stopped:', {
      folderPath,
      timestamp: new Date().toISOString()
    });
  }
}

function matchesExcludePatterns(path, patterns) {
  return patterns.some(pattern => {
    // Extract org and repo from the current path
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
    const config = await fetchSheetJson(state.apiConfig, 'media-library-config.json');
    excludePatterns = [];
    if (config?.data) {
      for (const row of config.data) {
        if (typeof row.exclude === 'string') {
          excludePatterns.push(...row.exclude.split(',').map(s => s.trim()).filter(Boolean));
        }
      }
    }
    // Log exclusion patterns for debugging
    console.log('[Folder Discovery Worker] Loaded exclusion patterns:', excludePatterns);
  } catch (e) {
    excludePatterns = [];
    console.error('[Folder Discovery Worker] Failed to load exclusion patterns:', e);
  }

  while (foldersToScan.length > 0) {
    const currentFolder = foldersToScan.shift();

    try {
      const items = await listFolderContents(currentFolder);
      // console.log(`[Folder Discovery Worker] Scanning ${currentFolder}, found ${items.length} items`);

      for (const item of items) {
        // Exclude folders if they match exclusion patterns
        if (!item.ext) {
          if (matchesExcludePatterns(item.path, excludePatterns)) {
            continue;
          }
          foldersToScan.push(item.path);
          continue;
        }
        // Only process HTML files
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
        console.log('[Folder Discovery Worker] Progress update:', {
          folderPath: state.folderPath,
          currentFolder,
          documentsFound: documents.length,
          foldersRemaining: foldersToScan.length,
          timestamp: new Date().toISOString()
        });
        
        postMessage({
          type: 'folderProgress',
          data: {
            folderPath: state.folderPath,
            currentFolder,
            documentsFound: documents.length,
            foldersRemaining: foldersToScan.length,
          },
        });
      }

    } catch (error) {
      postMessage({
        type: 'folderScanError',
        data: {
          folderPath: currentFolder,
          error: error.message,
        },
      });
    }
  }

  console.log('[Folder Discovery Worker] Discovery summary:', {
    folderPath,
    totalDocuments: documents.length,
    timestamp: new Date().toISOString()
  });
  return documents;
}

/**
 * List contents of a specific folder
 */
async function listFolderContents(folderPath) {
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

/**
 * Stop folder discovery
 */
function stopDiscovery() {
  state.isRunning = false;
  console.log('[Folder Discovery Worker] Discovery stopped by request:', {
    folderPath: state.folderPath,
    timestamp: new Date().toISOString()
  });

  postMessage({
    type: 'folderDiscoveryStopped',
    data: { folderPath: state.folderPath },
  });
}


// Message handler
// eslint-disable-next-line no-restricted-globals
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  try {
    switch (type) {
      case 'init': {
        init(data.apiConfig);
        postMessage({ type: 'initialized' });
        break;
      }

      case 'discoverFolder': {
        await discoverFolder(data.folderPath);
        break;
      }

      case 'stopDiscovery': {
        stopDiscovery();
        break;
      }

      default: {
        // Folder Discovery Worker: Unknown message type
      }
    }
  } catch (error) {
    // Folder Discovery Worker: Error handling message
    postMessage({
      type: 'error',
      data: { error: error.message, originalType: type },
    });
  }
});
