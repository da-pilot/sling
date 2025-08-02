/**
 * Site aggregator
 * Handles site structure creation and validation
 */

import { buildSingleSheet, saveSheetFile } from '../sheet-utils.js';
import { DA_PATHS, CONTENT_DA_LIVE_BASE } from '../../constants.js';

export default function createSiteAggregator() {
  const state = {
    apiConfig: null,
    daApi: null,
  };

  /**
   * Parse individual sheet data
   * @param {Object} sheet - Sheet data
   * @returns {Object} Parsed sheet data
   */
  function parseSheetData(sheet) {
    if (!sheet || typeof sheet !== 'object') {
      return { data: [] };
    }

    if (Array.isArray(sheet)) {
      return { data: sheet };
    }

    if (sheet.data && Array.isArray(sheet.data)) {
      return { data: sheet.data };
    }

    if (sheet.rows && Array.isArray(sheet.rows)) {
      return { data: sheet.rows };
    }

    return { data: [] };
  }

  /**
   * Parse sheet data into structured format
   * @param {Object} sheetData - Raw sheet data
   * @returns {Object} Parsed data
   */
  function parseSheet(sheetData) {
    if (!sheetData || typeof sheetData !== 'object') {
      return {};
    }

    if (sheetData[':type'] === 'sheet' && sheetData.data) {
      return {
        data: sheetData.data,
      };
    }

    const result = {};
    Object.keys(sheetData).forEach((key) => {
      if (sheetData[key] && typeof sheetData[key] === 'object') {
        result[key] = parseSheetData(sheetData[key]);
      }
    });

    return result;
  }

  /**
   * Initialize the site aggregator
   * @param {Object} apiConfig - API configuration
   */
  function init(apiConfig) {
    state.apiConfig = apiConfig;
  }

  /**
   * Set DA API instance
   * @param {Object} daApi - DA API instance
   */
  function setDaApi(daApi) {
    state.daApi = daApi;
  }

  /**
   * Load data from content path using CONTENT_DA_LIVE_BASE
   * @param {string} path - Relative path to load
   * @returns {Promise<Object>} Loaded data
   */
  async function loadContentData(path) {
    try {
      const url = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/${path}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${state.apiConfig.token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load data: ${response.status} ${response.statusText}`);
      }

      const rawData = await response.json();
      return parseSheet(rawData);
    } catch (error) {
      throw new Error(`Failed to load content data: ${error.message}`);
    }
  }

  /**
   * Get existing root files
   * @returns {Array} Root files
   */
  async function getExistingRootFiles() {
    try {
      const items = await loadContentData('.media/.pages');
      const rootFile = items.find((item) => item.name && item.name === 'root.json');
      if (rootFile) {
        const data = await loadContentData('.media/.pages/root.json');
        return data?.data || [];
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Build site structure from discovery files using listPath
   * @returns {Object} Validation result and structure
   */
  async function buildSiteStructureFromDiscoveryFiles() {
    try {
      if (!state.daApi) {
        throw new Error('DA API not initialized');
      }

      const pagesFolderPath = '.media/.pages';
      const files = await state.daApi.listPath(pagesFolderPath);
      const discoveryFiles = files?.filter((file) => file.ext === 'json' && file.name !== 'discovery-checkpoint' && file.name !== 'site-structure') || [];

      if (discoveryFiles.length === 0) {
        return {
          isValid: false,
          reason: 'No discovery files found',
          structure: {},
        };
      }

      const fileContents = await Promise.all(
        discoveryFiles.map(async (file) => {
          try {
            const data = await loadContentData(`.media/.pages/${file.name}`);
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

      const structure = {
        totalFiles: discoveryFiles.length,
        totalDocuments,
        filesWithErrors: filesWithErrors.length,
        fileDetails: fileContents,
      };

      return {
        isValid: filesWithErrors.length === 0 && totalDocuments > 0,
        structure,
      };
    } catch (error) {
      return {
        isValid: false,
        reason: error.message,
        structure: {},
      };
    }
  }

  /**
   * Create comprehensive site structure with folder hierarchy
   * @returns {Object|false} Site structure or false if validation fails
   */
  async function createSiteStructure() {
    try {
      if (!state.daApi) {
        throw new Error('DA API not initialized');
      }

      const siteStructure = {
        org: state.apiConfig.org,
        repo: state.apiConfig.repo,
        lastUpdated: Date.now(),
        version: '1.0',
        structure: {
          root: {
            path: '/',
            type: 'folder',
            files: [],
            subfolders: {},
          },
        },
        excluded: {
          folders: [],
          patterns: [],
        },
        stats: {
          totalFolders: 0,
          totalFiles: 0,
          totalExcludedFolders: 0,
          totalMediaItems: 0,
          deepestNesting: 0,
        },
      };

      const pagesFolderPath = '.media/.pages';
      const files = await state.daApi.listPath(pagesFolderPath);
      const discoveryFiles = files?.filter((file) => file.ext === 'json' && file.name !== 'discovery-checkpoint' && file.name !== 'site-structure') || [];

      if (discoveryFiles.length === 0) {
        return false;
      }

      let totalFiles = 0;
      const excludedFolders = [];

      const fileDataPromises = discoveryFiles.map(async (discoveryFile) => {
        try {
          const fileData = await loadContentData(`.media/.pages/${discoveryFile.name}.json`);
          return { discoveryFile, fileData };
        } catch (error) {
          return { discoveryFile, fileData: null, error: error.message };
        }
      });

      const fileDataResults = await Promise.all(fileDataPromises);

      fileDataResults.forEach(({ fileData, error }) => {
        if (error) {
          console.warn('[Site Aggregator] ⚠️ Error loading discovery file:', error);
          return;
        }

        if (fileData && fileData.data && Array.isArray(fileData.data)) {
          fileData.data.forEach((file) => {
            const fullPath = file.path;
            const pathWithoutOrgRepo = fullPath.replace(`/${state.apiConfig.org}/${state.apiConfig.repo}`, '');
            const pathParts = pathWithoutOrgRepo.split('/').filter((part) => part.length > 0);
            const fileName = pathParts[pathParts.length - 1];
            const isHtmlFile = fileName.endsWith('.html');

            if (isHtmlFile) {
              const fileInfo = {
                name: fileName.replace('.html', ''),
                ext: 'html',
                path: pathWithoutOrgRepo,
                lastModified: file.lastModified || Date.now(),
                mediaCount: file.mediaCount || 0,
              };

              if (pathParts.length === 1) {
                siteStructure.structure.root.files.push(fileInfo);
              } else {
                const folderPath = pathParts.slice(0, -1);
                let currentFolder = siteStructure.structure.root;

                folderPath.forEach((folderName) => {
                  if (!currentFolder.subfolders[folderName]) {
                    currentFolder.subfolders[folderName] = {
                      path: `/${folderPath.slice(0, folderPath.indexOf(folderName) + 1).join('/')}`,
                      type: 'folder',
                      excluded: false,
                      files: [],
                      subfolders: {},
                    };
                  }
                  currentFolder = currentFolder.subfolders[folderName];
                });

                currentFolder.files.push(fileInfo);
              }

              totalFiles += 1;
            }
          });
        }
      });

      siteStructure.stats = {
        totalFolders: Object.keys(siteStructure.structure.root.subfolders).length,
        totalFiles,
        totalExcludedFolders: excludedFolders.length,
        totalMediaItems: 0,
        deepestNesting: 3,
      };

      return siteStructure;
    } catch (error) {
      console.error('[Site Aggregator] ❌ Error creating site structure:', error);
      return false;
    }
  }

  /**
   * Save site structure to the site-structure.json file
   * @param {Object} siteStructure - The site structure to save
   * @returns {Promise<boolean>} True if saved successfully, false otherwise
   */
  async function saveSiteStructure(siteStructure) {
    try {
      const filePath = DA_PATHS.getSiteStructureFile(state.apiConfig.org, state.apiConfig.repo);
      const data = {
        ...siteStructure,
        lastUpdated: Date.now(),
      };
      const sheetData = buildSingleSheet(data);
      const url = `${state.apiConfig.baseUrl}/source${filePath}`;
      await saveSheetFile(url, sheetData, state.apiConfig.token);
      return true;
    } catch (error) {
      console.error('[Site Aggregator] ❌ Failed to save site structure:', error);
      return false;
    }
  }

  /**
   * Validate site structure
   * @returns {Object} Validation result
   */
  async function validateSiteStructure() {
    try {
      const validationResult = await buildSiteStructureFromDiscoveryFiles();
      return {
        isValid: validationResult.isValid,
        reason: validationResult.reason,
        stats: validationResult.structure,
      };
    } catch (error) {
      return {
        isValid: false,
        reason: error.message,
        stats: {},
      };
    }
  }

  /**
   * Get site statistics
   * @returns {Object} Site statistics
   */
  async function getSiteStatistics() {
    try {
      const validationResult = await buildSiteStructureFromDiscoveryFiles();
      return {
        totalFiles: validationResult.structure.totalFiles || 0,
        totalDocuments: validationResult.structure.totalDocuments || 0,
        filesWithErrors: validationResult.structure.filesWithErrors || 0,
        isValid: validationResult.isValid,
      };
    } catch (error) {
      return {
        totalFiles: 0,
        totalDocuments: 0,
        filesWithErrors: 0,
        isValid: false,
      };
    }
  }

  return {
    init,
    setDaApi,
    getExistingRootFiles,
    buildSiteStructureFromDiscoveryFiles,
    createSiteStructure,
    saveSiteStructure,
    validateSiteStructure,
    getSiteStatistics,
  };
}