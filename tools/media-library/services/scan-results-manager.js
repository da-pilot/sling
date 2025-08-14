/**
 * Scan Results Manager - Centralized management of scan results using existing IndexedDB
 */
export default function createScanResultsManager() {
  const state = {
    persistenceManager: null,
  };

  /**
   * Initialize scan results manager
   * @param {Object} persistenceManager - Persistence manager instance
   */
  async function init(persistenceManager) {
    state.persistenceManager = persistenceManager;
  }

  /**
   * Save scan result to IndexedDB
   * @param {Object} scanResult - Scan result data
   * @returns {Promise<boolean>} Success status
   */
  async function saveScanResult(scanResult) {
    try {
      if (!state.persistenceManager) {
        console.error('[Scan Results Manager] ❌ Persistence manager not initialized');
        return false;
      }
      await state.persistenceManager.savePageScanStatus(scanResult);
      return true;
    } catch (error) {
      console.error('[Scan Results Manager] ❌ Failed to save scan result:', error);
      return false;
    }
  }

  /**
   * Get scan result by page path
   * @param {string} pagePath - Page path
   * @returns {Promise<Object|null>} Scan result or null
   */
  async function getScanResult(pagePath) {
    try {
      if (!state.persistenceManager) {
        return null;
      }
      const pageStatuses = await state.persistenceManager.getStoreData('pageScanStatus');
      return pageStatuses.find((status) => status.pagePath === pagePath) || null;
    } catch (error) {
      console.error('[Scan Results Manager] ❌ Failed to get scan result:', error);
      return null;
    }
  }

  /**
   * Get all scan results
   * @returns {Promise<Array>} All scan results
   */
  async function getAllScanResults() {
    try {
      if (!state.persistenceManager) {
        return [];
      }
      return await state.persistenceManager.getStoreData('pageScanStatus');
    } catch (error) {
      console.error('[Scan Results Manager] ❌ Failed to get all scan results:', error);
      return [];
    }
  }

  /**
   * Get scan results by file name
   * @param {string} fileName - File name
   * @returns {Promise<Array>} Scan results for file
   */
  async function getScanResultsByFile(fileName) {
    try {
      if (!state.persistenceManager) {
        return [];
      }
      return await state.persistenceManager.getScanResultsBySourceFile(fileName);
    } catch (error) {
      console.error('[Scan Results Manager] ❌ Failed to get scan results by file:', error);
      return [];
    }
  }

  /**
   * Clear all scan results
   * @returns {Promise<boolean>} Success status
   */
  async function clearAllScanResults() {
    try {
      if (!state.persistenceManager) {
        return false;
      }
      await state.persistenceManager.saveStoreData('pageScanStatus', []);
      console.log('[Scan Results Manager] 🗑️ All scan results cleared');
      return true;
    } catch (error) {
      console.error('[Scan Results Manager] ❌ Failed to clear scan results:', error);
      return false;
    }
  }

  return {
    init,
    saveScanResult,
    getScanResult,
    getAllScanResults,
    getScanResultsByFile,
    clearAllScanResults,
  };
}
