/**
 * Discovery persistence manager
 * Handles all persistence operations for discovery data
 */

import {
  saveData,
  loadData,
} from '../sheet-utils.js';

export default function createDiscoveryPersistenceManager() {
  const state = {
    apiConfig: null,
    processingStateManager: null,
    daApi: null,
  };

  /**
   * Initialize the persistence manager
   * @param {Object} apiConfig - API configuration
   * @param {Object} processingStateManager - Processing state manager
   * @param {Object} daApi - DA API instance
   */
  function init(apiConfig, processingStateManager, daApi = null) {
    state.apiConfig = apiConfig;
    state.processingStateManager = processingStateManager;
    state.daApi = daApi;
  }

  /**
   * Load discovery checkpoint and determine discovery type
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Promise<Object>} Discovery type and checkpoint data
   */
  async function loadDiscoveryCheckpoint(forceRescan = false) {
    try {
      if (forceRescan) {
        return {
          discoveryType: 'full',
          checkpoint: {
            totalFolders: 0,
            completedFolders: 0,
            totalDocuments: 0,
            status: 'idle',
          },
        };
      }
      const checkpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
      let discoveryType = 'full';
      if (checkpoint.status === 'completed') {
        discoveryType = 'incremental';
      }
      return {
        discoveryType,
        checkpoint,
      };
    } catch (error) {
      return {
        discoveryType: 'full',
        checkpoint: {
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: 0,
          status: 'idle',
        },
      };
    }
  }

  /**
   * Save discovery checkpoint file
   * @param {Object} checkpoint - Checkpoint data to save
   */
  async function saveDiscoveryCheckpointFile(checkpoint) {
    try {
      const jsonToWrite = checkpoint;
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.processing/discovery-checkpoint.json`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;
      await saveData(url, jsonToWrite, state.apiConfig.token);
    } catch (error) {
      console.error('[Persistence Manager] ❌ Failed to save discovery checkpoint:', error);
      throw error;
    }
  }

  /**
   * Load existing discovery file for a folder
   * @param {string} folderPath - Folder path
   * @returns {Array} Existing documents
   */
  async function loadExistingDiscoveryFile(folderPath) {
    try {
      const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop() || 'root';
      const items = await loadData('.media/.pages');
      const existingFile = items.find((item) => item.name && item.name === `${folderName}.json`);
      if (existingFile) {
        try {
          const configData = await loadData(`.media/.pages/${existingFile.name}`);
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
   * Validate discovery files are complete
   * @returns {Object} Validation result
   */
  async function validateDiscoveryFilesComplete() {
    try {
      const items = await loadData('.media/.pages');
      const discoveryFiles = items.filter((item) => item.name && item.name.endsWith('.json'));

      if (discoveryFiles.length === 0) {
        return { isValid: false, reason: 'No discovery files found' };
      }

      const fileContents = await Promise.all(
        discoveryFiles.map(async (file) => {
          try {
            const data = await loadData(`.media/.pages/${file.name}`);
            return {
              name: file.name,
              data: data?.data || [],
              documentCount: data?.data?.length || 0,
            };
          } catch (error) {
            return {
              name: file.name,
              data: [],
              documentCount: 0,
              error: error.message,
            };
          }
        }),
      );

      const totalDocuments = fileContents.reduce((sum, file) => sum + file.documentCount, 0);
      const filesWithErrors = fileContents.filter((file) => file.error);

      return {
        isValid: filesWithErrors.length === 0 && totalDocuments > 0,
        totalFiles: discoveryFiles.length,
        totalDocuments,
        filesWithErrors: filesWithErrors.length,
        fileDetails: fileContents,
      };
    } catch (error) {
      return {
        isValid: false,
        reason: error.message,
        totalFiles: 0,
        totalDocuments: 0,
        filesWithErrors: 0,
        fileDetails: [],
      };
    }
  }

  /**
   * Ensure required folders exist
   */
  async function ensureRequiredFolders() {
    try {
      if (!state.daApi) {
        throw new Error('DA API not initialized');
      }
      const requiredFolders = [
        '.media',
        '.media/.pages',
        '.media/.processing',
        '.media/.sessions',
      ];
      await Promise.all(requiredFolders.map((folder) => state.daApi.ensureFolder(folder)));
    } catch (error) {
      console.error('[Persistence Manager] ❌ Failed to ensure required folders:', error.message);
    }
  }

  /**
   * Save discovery data for a folder
   * @param {string} folderName - Folder name
   * @param {Array} documents - Documents to save
   */
  async function saveDiscoveryData(folderName, documents) {
    try {
      const jsonToWrite = documents;
      const fileName = `${folderName}.json`;
      const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;
      await saveData(url, jsonToWrite, state.apiConfig.token);
    } catch (error) {
      console.error('[Persistence Manager] ❌ Failed to save discovery data:', error);
      throw error;
    }
  }

  /**
   * Load all discovery files
   * @returns {Array} All discovery files
   */
  async function loadAllDiscoveryFiles() {
    try {
      const items = await loadData('.media/.pages');
      const discoveryFiles = items.filter((item) => item.name && item.name.endsWith('.json'));
      const fileContents = await Promise.all(
        discoveryFiles.map(async (file) => {
          try {
            const data = await loadData(`.media/.pages/${file.name}`);
            return {
              name: file.name,
              data: data?.data || [],
              documentCount: data?.data?.length || 0,
            };
          } catch (error) {
            return {
              name: file.name,
              data: [],
              documentCount: 0,
              error: error.message,
            };
          }
        }),
      );
      return fileContents;
    } catch (error) {
      console.error('[Persistence Manager] ❌ Failed to load discovery files:', error);
      return [];
    }
  }
  return {
    init,
    loadDiscoveryCheckpoint,
    saveDiscoveryCheckpointFile,
    loadExistingDiscoveryFile,
    validateDiscoveryFilesComplete,
    ensureRequiredFolders,
    saveDiscoveryData,
    loadAllDiscoveryFiles,
  };
}