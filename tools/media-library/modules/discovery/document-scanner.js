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

        progressTracker.incrementCompletedFolders();
        progressTracker.incrementTotalDocuments(documentsToSave.length);
      }
    } catch (error) {
      throw new Error(`Failed to process root files: ${error.message}`);
    }
  }

  /**
   * Process documents with incremental logic
   * @param {Array} documents - Documents to process
   * @param {string} folderName - Folder name
   * @param {Array} existingDocuments - Existing documents from DA
   * @returns {Promise<Array>} Documents that need scanning
   */
  async function processDocumentsIncremental(documents, folderName, existingDocuments) {
    const existingDocs = new Map();
    existingDocuments.forEach((doc) => {
      existingDocs.set(doc.path, doc);
    });
    const documentsToSave = [];
    const documentsToScan = [];
    documents.forEach((doc) => {
      const existingDoc = existingDocs.get(doc.path);
      const isNew = !existingDoc;
      const isModified = existingDoc && doc.lastModified !== existingDoc.lastModified;
      if (isNew || isModified) {
        const documentToSave = {
          ...doc,
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
          entryStatus: isNew ? 'new' : 'updated',
        };
        documentsToSave.push(documentToSave);
        documentsToScan.push(documentToSave);
      } else {
        const documentToSave = {
          name: existingDoc.name,
          ext: existingDoc.ext,
          path: existingDoc.path,
          lastModified: existingDoc.lastModified,
          discoveredAt: existingDoc.discoveredAt,
          discoveryComplete: existingDoc.discoveryComplete,
          scanComplete: existingDoc.scanComplete,
          needsRescan: existingDoc.needsRescan,
          lastScanned: existingDoc.lastScanned,
          mediaCount: existingDoc.mediaCount,
          scanStatus: existingDoc.scanStatus,
          lastScannedAt: existingDoc.lastScannedAt,
          scanAttempts: existingDoc.scanAttempts,
          scanErrors: existingDoc.scanErrors,
          entryStatus: 'unchanged',
        };
        documentsToSave.push(documentToSave);
      }
    });
    if (documentsToSave.length > 0) {
      const fileName = `${folderName}.json`;
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;
      await saveData(url, documentsToSave, state.apiConfig.token);
    }
    return documentsToScan;
  }

  /**
   * Process a single folder using worker
   * @param {Object} folder - Folder to process
   * @param {string} discoveryType - Type of discovery
   * @param {Object} workerManager - Worker manager instance
   * @param {Object} progressTracker - Progress tracker instance
   * @param {Object} eventEmitter - Event emitter instance
   * @param {Array} existingDocuments - Existing documents for incremental processing
   * @returns {Promise} Promise that resolves when folder processing is complete
   */
  async function processFolder(
    folder,
    discoveryType,
    workerManager,
    progressTracker,
    eventEmitter,
    incrementalChanges = null,
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

                if (discoveryType === 'incremental' && incrementalChanges) {
                  const existingFolderDocs = incrementalChanges.existingFiles.find(
                    (file) => file.name === folderName,
                  )?.data || [];
                  const isNewFolder = !existingFolderDocs || existingFolderDocs.length === 0;

                  if (isNewFolder) {
                    await processDocumentsIncremental(data.documents, folderName, []);
                  } else {
                    await processDocumentsIncremental(
                      data.documents,
                      folderName,
                      existingFolderDocs,
                    );
                  }
                } else {
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
          workerManager.cleanup(workerId);
          reject(error);
        };

        worker.postMessage({ type: 'init', data: { apiConfig: state.apiConfig } });
      }).catch((error) => {
        reject(error);
      });
    });
  }

  /**
   * Get top level items
   * @returns {Promise<Object>} Top level items
   */
  async function getTopLevelItems() {
    try {
      if (!state.daApi) {
        throw new Error('DA API service not initialized');
      }

      const items = await state.daApi.listPath('/');

      const folders = items
        .filter((item) => {
          const isFolder = !item.ext || item.ext === '';
          const isExcluded = matchesExcludePatterns(item.path, state.excludedPatterns);
          return isFolder && !isExcluded;
        })
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
    processDocumentsIncremental,
  };
}