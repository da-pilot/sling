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
      console.log('[Direct Discovery Updater] 🔍 Total scan results:', allScanResults.length);
      if (allScanResults.length > 0) {
        console.log('[Direct Discovery Updater] 🔍 Sample scan result:', {
          pagePath: allScanResults[0].pagePath,
          sourceFile: allScanResults[0].sourceFile,
          mediaCount: allScanResults[0].mediaCount,
          status: allScanResults[0].status,
        });
      }
      const updatedFiles = discoveryFiles.map((file) => {
        console.log('[Direct Discovery Updater] 🔍 Processing discovery file:', file.fileName, 'Documents:', file.documents?.length || 0);
        const fileScanResults = allScanResults.filter(
          (result) => result.sourceFile === file.fileName,
        );
        console.log('[Direct Discovery Updater] 🔍 File:', file.fileName, 'Scan results:', fileScanResults.length);
        const updatedDocuments = file.documents.map((doc) => {
          const scanResult = fileScanResults.find((result) => {
            const pathMatch = result.pagePath === doc.path;
            const normalizedPathMatch = result.pagePath?.replace(/^\//, '') === doc.path?.replace(/^\//, '');
            if (pathMatch || normalizedPathMatch) {
              console.log('[Direct Discovery Updater] 🔍 Path match found:', {
                docPath: doc.path,
                scanPath: result.pagePath,
                pathMatch,
                normalizedPathMatch,
              });
            }
            return pathMatch || normalizedPathMatch;
          });
          if (scanResult) {
            console.log('[Direct Discovery Updater] ✅ Matched:', doc.path, 'mediaCount:', scanResult.mediaCount);
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
          if (!scanResult) {
            console.log('[Direct Discovery Updater] ❌ No match for:', doc.path, 'Available scan results:', fileScanResults.map((r) => r.pagePath));
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
