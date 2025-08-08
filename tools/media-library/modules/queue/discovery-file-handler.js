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
   * Load discovery files with change detection
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @param {Function} detectChangedDocuments - Function to detect changed documents
   * @returns {Promise<Array>} Array of discovery files with documents
   */
  async function loadDiscoveryFilesWithChangeDetection(config, daApi, detectChangedDocuments) {
    const discoveryFiles = await loadDiscoveryFiles(config, daApi);
    await detectChangedDocuments(discoveryFiles);
    return discoveryFiles;
  }

  return {
    loadDiscoveryFiles,
    clearDiscoveryFiles,
    loadDiscoveryFilesWithChangeDetection,
  };
}