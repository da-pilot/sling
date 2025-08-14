/**
 * Direct Discovery Updater - Updates discovery files directly from scan results
 */
import { saveData } from './sheet-utils.js';

export default function createDirectDiscoveryUpdater() {
  /**
   * Update all discovery files with scan results
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API instance
   * @param {Object} scanResultsManager - Scan results manager instance
   * @param {Array} discoveryFiles - Discovery files to update
   * @returns {Promise<Array>} Updated discovery files
   */
  async function updateAllDiscoveryFiles(config, daApi, scanResultsManager, discoveryFiles) {
    try {
      const allScanResults = await scanResultsManager.getAllScanResults();
      const updatedFiles = discoveryFiles.map((file) => {
        const fileScanResults = allScanResults.filter(
          (result) => result.sourceFile === file.fileName,
        );
        const updatedDocuments = file.documents.map((doc) => {
          const scanResult = fileScanResults.find((result) => {
            const pathMatch = result.pagePath === doc.path;
            const normalizedPathMatch = result.pagePath?.replace(/^\//, '') === doc.path?.replace(/^\//, '');
            return pathMatch || normalizedPathMatch;
          });
          if (scanResult) {
            return {
              ...doc,
              mediaCount: scanResult.mediaCount || 0,
              scanStatus: scanResult.status || 'completed',
              scanComplete: scanResult.status === 'completed',
              scanAttempts: scanResult.scanAttempts || 1,
              entryStatus: scanResult.entryStatus || 'completed',
              needsRescan: scanResult.needsRescan || false,
              lastScannedAt: scanResult.lastScannedAt || new Date().toISOString(),
              scanErrors: scanResult.scanErrors || [],
            };
          }
          return doc;
        });
        return { ...file, documents: updatedDocuments };
      });
      const updatePromises = updatedFiles.map(async (file) => {
        const filePath = `/${config.org}/${config.repo}/.media/.pages/${file.fileName}.json`;
        const url = `${config.baseUrl}/source${filePath}`;
        try {
          await saveData(url, file.documents, config.token);
          return { fileName: file.fileName, success: true };
        } catch (error) {
          console.error('[Direct Discovery Updater] ❌ Failed to update file:', file.fileName, error);
          return { fileName: file.fileName, success: false, error: error.message };
        }
      });
      await Promise.all(updatePromises);
      return updatedFiles;
    } catch (error) {
      console.error('[Direct Discovery Updater] ❌ Failed to update discovery files:', error);
      throw error;
    }
  }

  return { updateAllDiscoveryFiles };
}
