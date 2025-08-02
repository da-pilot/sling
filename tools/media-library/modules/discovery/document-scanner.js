/**
 * Document scanner
 * Handles document discovery and processing
 */

import {
  saveData,
  loadData,
} from '../sheet-utils.js';
import { CONTENT_DA_LIVE_BASE, DA_PATHS } from '../../constants.js';

export default function createDocumentScanner() {
  const state = {
    apiConfig: null,
    excludedPatterns: [],
    daApi: null,
  };

  /**
   * Check if path matches exclude patterns
   * @param {string} path - Path to check
   * @param {Array} patterns - Patterns to match against
   * @returns {boolean} True if path matches any pattern
   */
  function matchesExcludePatterns(path, patterns) {
    return patterns.some((pattern) => {
      const pathParts = path.split('/');
      if (pathParts.length >= 3) {
        const org = pathParts[1];
        const repo = pathParts[2];
        const orgRepoPrefix = `/${org}/${repo}`;

        if (pattern.endsWith('/*')) {
          const patternWithoutWildcard = pattern.slice(0, -1);
          const fullPattern = `${orgRepoPrefix}${patternWithoutWildcard}`;
          const matches = path.startsWith(fullPattern) || path === fullPattern.slice(0, -1);
          return matches;
        }
        const matches = path === `${orgRepoPrefix}${pattern}`;
        return matches;
      }
      return false;
    });
  }

  /**
   * Load exclusion patterns from config.json
   * @returns {Array} Array of exclusion patterns
   */
  async function loadExclusionPatterns() {
    try {
      const configUrl = `${CONTENT_DA_LIVE_BASE}${DA_PATHS.getConfigFile(state.apiConfig.org, state.apiConfig.repo)}`;
      const parsedConfig = await loadData(configUrl, state.apiConfig.token);
      const excludePatterns = [];

      if (parsedConfig && parsedConfig.data && Array.isArray(parsedConfig.data)) {
        parsedConfig.data.forEach((row) => {
          if (row.key === 'excludes' && typeof row.value === 'string') {
            const patterns = row.value.split(',').map((s) => s.trim()).filter(Boolean);
            excludePatterns.push(...patterns);
          }
        });
      }

      return excludePatterns;
    } catch (error) {
      console.error('[Document Scanner] ❌ Failed to load exclusion patterns:', error);
      return [];
    }
  }

  /**
   * Initialize the document scanner
   * @param {Object} apiConfig - API configuration
   * @param {Object} daApi - DA API instance
   */
  async function init(apiConfig, daApi = null) {
    state.apiConfig = apiConfig;
    state.daApi = daApi;

    // Load exclusion patterns from config.json
    state.excludedPatterns = await loadExclusionPatterns();
  }

  /**
   * Process root files and save discovery data
   * @param {Array} files - Root files to process
   * @param {Object} progressTracker - Progress tracker instance
   * @param {Object} eventEmitter - Event emitter instance
   */
  async function processRootFiles(files, progressTracker, eventEmitter) {
    try {
      if (files && files.length > 0) {
        const documentsToSave = files.map((file) => ({
          name: file.name,
          ext: file.ext,
          lastModified: file.lastModified,
          path: file.path,
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
        }));
        const fileName = 'root.json';
        const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
        const url = `${state.apiConfig.baseUrl}/source${filePath}`;
        await saveData(url, documentsToSave, state.apiConfig.token);
        eventEmitter.emitDocumentsDiscovered({
          documents: documentsToSave,
          folder: '/',
        });

        // Increment completed folders count for root files processing
        progressTracker.incrementCompletedFolders();
        progressTracker.incrementTotalDocuments(documentsToSave.length);
      }
    } catch (error) {
      console.error('[Document Scanner] ❌ Failed to process root files:', error);
    }
  }

  /**
   * Process a single folder using worker
   * @param {Object} folder - Folder to process
   * @param {string} discoveryType - Type of discovery
   * @param {Object} workerManager - Worker manager instance
   * @param {Object} progressTracker - Progress tracker instance
   * @param {Object} eventEmitter - Event emitter instance
   * @param {Object} checkpointManager - Checkpoint manager instance
   * @returns {Promise} Promise that resolves when folder processing is complete
   */
  async function processFolder(
    folder,
    discoveryType,
    workerManager,
    progressTracker,
    eventEmitter,
  ) {
    return new Promise((resolve, reject) => {
      const workerId = `worker_${folder.path.replace(/[/\\]/g, '_')}_${Date.now()}`;

      workerManager.createWorker(folder, workerId).then((worker) => {
        worker.onmessage = async (event) => {
          const { type, data } = event.data;

          switch (type) {
            case 'initialized':
              worker.postMessage({
                type: 'discoverFolder',
                data: {
                  folderPath: folder.path,
                  workerId,
                  discoveryType,
                },
              });
              break;

            case 'folderDiscoveryComplete': {
              progressTracker.incrementCompletedFolders();
              progressTracker.incrementTotalDocuments(data.documentCount || 0);

              if (data.documents && data.documents.length > 0) {
                const folderName = folder.path === '/' ? 'root' : folder.path.split('/').pop() || 'root';
                const fileName = `${folderName}.json`;
                const documentsToSave = data.documents.map((doc) => ({
                  ...doc,
                  scanStatus: 'pending',
                  scanComplete: false,
                  needsRescan: false,
                  lastScannedAt: null,
                  scanAttempts: 0,
                  scanErrors: [],
                  mediaCount: 0,
                }));

                const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
                const url = `${state.apiConfig.baseUrl}/source${filePath}`;
                await saveData(url, documentsToSave, state.apiConfig.token);

                eventEmitter.emitDocumentsDiscovered({
                  documents: documentsToSave,
                  folder: folder.path,
                });
              }

              workerManager.cleanup(workerId);
              resolve();
              break;
            }

            case 'folderDiscoveryError':
              progressTracker.incrementCompletedFolders();
              progressTracker.incrementErrors();
              workerManager.cleanup(workerId);
              reject(new Error(data.error));
              break;

            default:
              break;
          }
        };

        worker.onerror = (error) => {
          console.error('[Document Scanner] ❌ Worker error:', {
            folderPath: folder.path,
            workerId,
            error: error.message,
          });
          workerManager.cleanup(workerId);
          reject(error);
        };

        worker.postMessage({ type: 'init', data: { apiConfig: state.apiConfig } });
      }).catch((error) => {
        console.error('[Document Scanner] ❌ Failed to create worker:', {
          folderPath: folder.path,
          error: error.message,
        });
        reject(error);
      });
    });
  }

  /**
   * Get top-level items (folders and files)
   * @returns {Object} Object containing folders and files arrays
   */
  async function getTopLevelItems() {
    try {
      if (!state.daApi) {
        throw new Error('DA API service not initialized');
      }

      const items = await state.daApi.listPath('/');

      // Apply exclusion patterns (excluded folders are filtered out)

      const folders = items
        .filter((item) => !item.ext && !matchesExcludePatterns(item.path, state.excludedPatterns))
        .map((item) => ({ path: item.path }));

      const files = items
        .filter((item) => item.ext && item.ext === 'html' && !matchesExcludePatterns(item.path, state.excludedPatterns))
        .map((item) => ({
          name: item.name,
          ext: item.ext,
          path: item.path,
          lastModified: item.lastModified,
        }));

      return { folders, files };
    } catch (error) {
      console.error('[Document Scanner] ❌ Failed to get top-level items:', error);
      if (error.message.includes('DA API not available') || error.message.includes('DA API service not initialized')) {
        return { folders: [], files: [] };
      }
      return { folders: [], files: [] };
    }
  }

  return {
    init,
    processRootFiles,
    processFolder,
    getTopLevelItems,
    matchesExcludePatterns,
  };
}