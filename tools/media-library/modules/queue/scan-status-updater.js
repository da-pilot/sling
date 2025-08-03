import { CONTENT_DA_LIVE_BASE } from '../../constants.js';
import { loadData, buildSingleSheet, saveSheetFile } from '../sheet-utils.js';

export default function createScanStatusUpdater() {
  /**
   * Update folder media count recursively
   * @param {Object} folder - Folder object
   * @param {string} pagePath - Page path
   * @param {number} mediaCount - Media count
   * @returns {boolean} Whether folder was updated
   */
  function updateFolderMediaCount(folder, pagePath, mediaCount) {
    let updated = false;
    const pathWithoutOrgRepo = pagePath.replace(/^\/[^/]+\/[^/]+\//, '/');
    if (folder.files && Array.isArray(folder.files)) {
      const fileIndex = folder.files.findIndex((file) => file.path === pathWithoutOrgRepo);
      if (fileIndex !== -1) {
        folder.files[fileIndex].mediaCount = mediaCount;
        updated = true;
      }
    }
    if (folder.subfolders && typeof folder.subfolders === 'object') {
      const subfolderNames = Object.keys(folder.subfolders);
      subfolderNames.forEach((subfolderName) => {
        const subfolder = folder.subfolders[subfolderName];
        if (updateFolderMediaCount(subfolder, pagePath, mediaCount)) {
          updated = true;
        }
      });
    }
    return updated;
  }

  /**
   * Update site structure media count
   * @param {Object} processingStateManager - Processing state manager
   * @param {string} pagePath - Page path
   * @param {number} mediaCount - Media count
   * @returns {Promise<void>}
   */
  async function updateSiteStructureMediaCount(processingStateManager, pagePath, mediaCount) {
    try {
      if (!processingStateManager) {
        return;
      }
      const siteStructure = await processingStateManager.loadSiteStructureFile();
      if (!siteStructure || !siteStructure.structure || !siteStructure.structure.root) {
        return;
      }
      const updated = updateFolderMediaCount(siteStructure.structure.root, pagePath, mediaCount);
      if (updated) {
        siteStructure.lastUpdated = Date.now();
        await processingStateManager.saveSiteStructureFile(siteStructure);
        console.log('[Scan Status Updater] ✅ Updated site structure media count:', {
          pagePath,
          mediaCount,
        });
      }
    } catch (error) {
      console.error('[Scan Status Updater] ❌ Error updating site structure media count:', error);
    }
  }
  /**
   * Update discovery file scan status
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @param {Object} processingStateManager - Processing state manager
   * @param {string} fileName - Discovery file name
   * @param {string} pagePath - Page path
   * @param {string} status - Scan status
   * @param {number} mediaCount - Media count
   * @param {string} error - Error message
   * @returns {Promise<void>}
   */
  async function updateDiscoveryFileScanStatus(
    config,
    daApi,
    processingStateManager,
    fileName,
    pagePath,
    status,
    mediaCount = 0,
    error = null,
  ) {
    try {
      const filePath = `/${config.org}/${config.repo}/.media/.pages/${fileName}`;
      const url = `${daApi.getConfig().baseUrl}/source${filePath}.json`;
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${filePath}.json`;
      const parsedData = await loadData(contentUrl, config.token);
      if (!parsedData.data || !Array.isArray(parsedData.data)) {
        console.log('[Scan Status Updater] ⚠️ No valid data found in discovery file:', fileName);
        return;
      }
      const documents = parsedData.data;
      const pageIndex = documents.findIndex((doc) => doc.path === pagePath);
      if (pageIndex === -1) {
        console.log('[Scan Status Updater] ⚠️ Page not found in discovery file:', {
          fileName,
          pagePath,
          availablePaths: documents.map((doc) => doc.path).slice(0, 5),
        });
        return;
      }
      documents[pageIndex] = {
        ...documents[pageIndex],
        scanStatus: status,
        scanComplete: status === 'completed',
        needsRescan: status === 'failed',
        lastScannedAt: status === 'completed' || status === 'failed' ? Date.now() : null,
        mediaCount: status === 'completed' ? mediaCount : documents[pageIndex].mediaCount || 0,
        scanErrors: status === 'failed' ? [error] : documents[pageIndex].scanErrors || [],
        scanAttempts: (documents[pageIndex].scanAttempts || 0) + 1,
      };
      const jsonToWrite = buildSingleSheet(documents);
      await saveSheetFile(url, jsonToWrite, config.token);
      console.log('[Scan Status Updater] ✅ Updated discovery file scan status:', {
        fileName,
        pagePath,
        status,
        mediaCount,
      });
      if (status === 'completed' && mediaCount > 0) {
        await updateSiteStructureMediaCount(processingStateManager, pagePath, mediaCount);
      }
    } catch (err) {
      console.error('[Scan Status Updater] ❌ Failed to update discovery file scan status:', err);
    }
  }
  /**
   * Update all discovery files with scan status
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   * @param {Object} persistenceManager - Persistence manager
   * @param {Array} discoveryFiles - Discovery files cache
   * @returns {Promise<Array>} Update results
   */
  async function updateAllDiscoveryFiles(config, daApi, persistenceManager, discoveryFiles) {
    try {
      const allPageStatus = await persistenceManager.getAllPageScanStatus();
      const updatePromises = discoveryFiles.map(async (file) => {
        const filePages = allPageStatus.filter((page) => page.sourceFile === file.fileName);
        const completedPages = filePages.filter((page) => page.scanStatus === 'completed');
        const filePath = `/${config.org}/${config.repo}/.media/.pages/${file.fileName}`;
        const contentUrl = `${CONTENT_DA_LIVE_BASE}${filePath}.json`;
        try {
          const parsedData = await loadData(contentUrl, config.token);
          const documents = parsedData.data || [];
          documents.forEach((doc) => {
            const pageStatus = filePages.find((page) => page.pageUrl === doc.path);
            if (pageStatus) {
              doc.scanStatus = pageStatus.scanStatus;
              doc.scanComplete = pageStatus.scanStatus === 'completed';
              doc.mediaCount = pageStatus.mediaCount;
              doc.lastScannedAt = pageStatus.lastScannedAt;
              doc.scanAttempts = pageStatus.scanAttempts;
              doc.scanErrors = pageStatus.scanErrors;
            }
          });
          const jsonToWrite = buildSingleSheet(documents);
          const url = `${daApi.getConfig().baseUrl}/source${filePath}.json`;
          await saveSheetFile(url, jsonToWrite, config.token);
          console.log('[Scan Status Updater] ✅ Updated discovery file:', {
            fileName: file.fileName,
            completedPages: completedPages.length,
            totalPages: documents.length,
          });
          return {
            fileName: file.fileName,
            completedPages: completedPages.length,
            totalPages: documents.length,
            status: 'updated',
          };
        } catch (error) {
          return {
            fileName: file.fileName,
            completedPages: 0,
            totalPages: 0,
            status: 'error',
            error: error.message,
          };
        }
      });
      const results = await Promise.all(updatePromises);
      console.log('[Scan Status Updater] ✅ Batch update completed:', {
        totalFiles: results.length,
        updatedFiles: results.filter((r) => r.status === 'updated').length,
        errorFiles: results.filter((r) => r.status === 'error').length,
      });
      return results;
    } catch (error) {
      console.error('[Scan Status Updater] ❌ Failed to update discovery files:', error);
      return [];
    }
  }
  return {
    updateDiscoveryFileScanStatus,
    updateSiteStructureMediaCount,
    updateFolderMediaCount,
    updateAllDiscoveryFiles,
  };
}