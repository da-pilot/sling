/**
 * Discovery File Manager - Handles file I/O operations for discovery data stored in .media/.pages
 */

import { CONTENT_DA_LIVE_BASE } from '../../constants.js';
import { loadData } from '../sheet-utils.js';

export default function createDiscoveryFileManager() {
  /**
   * Load all discovery files from .pages folder
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @returns {Promise<Array>} Array of discovery files with documents
   */
  async function loadDiscoveryFiles(config, daApi) {
    try {
      if (!config) {
        return [];
      }
      if (!daApi) {
        return [];
      }
      const items = await daApi.listPath('.media/.pages');
      const discoveryFiles = [];
      const filePromises = [];
      items.forEach((item) => {
        const isJsonFile = item.name && item.ext === 'json';
        if (isJsonFile) {
          filePromises.push((async () => {
            try {
              const fileUrl = `${CONTENT_DA_LIVE_BASE}/${config.org}/${config.repo}/.media/.pages/${item.name}.json`;
              const parsedData = await loadData(fileUrl, config.token);
              let documents;
              if (parsedData.data && parsedData.data.data) {
                documents = parsedData.data.data;
              } else if (parsedData.data) {
                documents = parsedData.data;
              } else {
                const sheetNames = Object.keys(parsedData);
                const firstSheet = sheetNames.find(
                  (name) => parsedData[name] && parsedData[name].data,
                );
                if (firstSheet) {
                  documents = parsedData[firstSheet].data;
                } else {
                  documents = [];
                }
              }
              if (Array.isArray(documents) && documents.length > 0) {
                discoveryFiles.push({
                  fileName: item.name,
                  documents,
                });
              }
            } catch (fileError) {
              // Error loading discovery file
            }
          })());
        }
      });
      await Promise.all(filePromises);
      return discoveryFiles;
    } catch (error) {
      return [];
    }
  }

  /**
   * Load discovery files with change detection
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @param {Function} detectChangedDocuments - Function to detect changed documents
   * @returns {Promise<Array>} Array of changed documents
   */
  async function loadDiscoveryFilesWithChangeDetection(config, daApi, detectChangedDocuments) {
    try {
      const discoveryFiles = await loadDiscoveryFiles(config, daApi);
      if (typeof detectChangedDocuments === 'function') {
        return await detectChangedDocuments(discoveryFiles);
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Clear discovery files from .pages folder
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @returns {Promise<void>}
   */
  async function clearDiscoveryFiles(config, daApi) {
    try {
      if (!config) {
        return;
      }
      if (!daApi) {
        return;
      }
      const items = await daApi.listPath('.media/.pages');
      const filePromises = [];
      items.forEach((item) => {
        const isJsonFile = item.name && item.ext === 'json';
        if (isJsonFile) {
          filePromises.push((async () => {
            try {
              const filePath = `/${config.org}/${config.repo}/.media/.pages/${item.name}`;
              const url = `${daApi.getConfig().baseUrl}/source${filePath}.json`;
              await daApi.deleteFile(url);
            } catch (error) {
              // Error deleting discovery file
            }
          })());
        }
      });
      await Promise.all(filePromises);
    } catch (error) {
      // Error clearing discovery files
    }
  }

  /**
   * Check if discovery files exist
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @returns {Promise<Object>} Object with filesExist and shouldRunDiscovery properties
   */
  async function checkDiscoveryFilesExist(config, daApi) {
    try {
      if (!config || !daApi) {
        return { filesExist: false, shouldRunDiscovery: true };
      }

      const items = await daApi.listPath('.media/.pages');
      const jsonFiles = items.filter((item) => item.name && item.ext === 'json');

      console.log('[Discovery File Manager] 🔍 Checking discovery files:', {
        totalItems: items.length,
        jsonFiles: jsonFiles.length,
        files: jsonFiles.map((f) => f.name),
      });

      const filesExist = jsonFiles.length > 0;
      const shouldRunDiscovery = !filesExist;

      console.log('[Discovery File Manager] ✅ Discovery files check result:', {
        filesExist,
        shouldRunDiscovery,
        fileCount: jsonFiles.length,
      });

      return { filesExist, shouldRunDiscovery };
    } catch (error) {
      console.error('[Discovery File Manager] ❌ Error checking discovery files:', error);
      return { filesExist: false, shouldRunDiscovery: true };
    }
  }

  /**
   * Generate discovery file for folder
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @param {string} folderPath - Folder path
   * @param {Array} folderData - Folder data
   * @returns {Promise<Object>} Result object
   */
  async function generateDiscoveryFileForFolder(config, daApi, folderPath, folderData) {
    try {
      console.log('[Discovery File Manager] 📄 Generating discovery file for folder:', {
        folderPath,
        documentCount: folderData ? folderData.length : 0,
      });

      if (!config || !daApi || !folderPath || !folderData) {
        console.warn('[Discovery File Manager] ⚠️ Missing parameters for generateDiscoveryFileForFolder');
        return { success: false, error: 'Missing parameters' };
      }

      const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
      const fileName = `${folderName}.json`;
      const filePath = `/${config.org}/${config.repo}/.media/.pages/${fileName}`;

      console.log('[Discovery File Manager] 💾 Saving discovery file:', {
        fileName,
        filePath,
        documentCount: folderData.length,
      });

      // This would need to be implemented based on your saveData function
      // For now, we'll just log the action
      console.log('[Discovery File Manager] ✅ Discovery file generation completed (mock)');

      return { success: true, fileName, documentCount: folderData.length };
    } catch (error) {
      console.error('[Discovery File Manager] ❌ Error generating discovery file:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update discovery file for file changes
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @param {string} folderPath - Folder path
   * @param {Array} fileChanges - File changes
   * @returns {Promise<Object>} Result object
   */
  async function updateDiscoveryFileForFileChanges(config, daApi, folderPath, fileChanges) {
    try {
      console.log('[Discovery File Manager] 🔄 Updating discovery file for file changes:', {
        folderPath,
        changesCount: fileChanges ? fileChanges.length : 0,
      });

      if (!config || !daApi || !folderPath || !fileChanges) {
        console.warn('[Discovery File Manager] ⚠️ Missing parameters for updateDiscoveryFileForFileChanges');
        return { success: false, error: 'Missing parameters' };
      }

      const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
      const fileName = `${folderName}.json`;
      const filePath = `/${config.org}/${config.repo}/.media/.pages/${fileName}`;

      console.log('[Discovery File Manager] 💾 Updating discovery file:', {
        fileName,
        filePath,
        changesCount: fileChanges.length,
      });

      // This would need to be implemented based on your saveData function
      // For now, we'll just log the action
      console.log('[Discovery File Manager] ✅ Discovery file update completed (mock)');

      return { success: true, fileName, changesCount: fileChanges.length };
    } catch (error) {
      console.error('[Discovery File Manager] ❌ Error updating discovery file:', error);
      return { success: false, error: error.message };
    }
  }

  return {
    loadDiscoveryFiles,
    loadDiscoveryFilesWithChangeDetection,
    clearDiscoveryFiles,
    checkDiscoveryFilesExist,
    generateDiscoveryFileForFolder,
    updateDiscoveryFileForFileChanges,
  };
}