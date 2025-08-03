/**
 * Queue Status Updater - Handles status updates and file status management
 */
import createEventEmitter from '../../shared/event-emitter.js';

export default function createQueueStatusUpdater() {
  const eventEmitter = createEventEmitter('Queue Status Updater');
  const state = {
    scanCompletionHandler: null,
    processingStateManager: null,
  };
  /**
   * Initialize status updater
   * @param {Object} scanCompletionHandler - Scan completion handler instance
   * @param {Object} processingStateManager - Processing state manager instance
   */
  async function init(scanCompletionHandler, processingStateManager) {
    state.scanCompletionHandler = scanCompletionHandler;
    state.processingStateManager = processingStateManager;
  }
  /**
   * Update discovery file scan status
   * @param {string} fileName - File name
   * @param {string} pagePath - Page path
   * @param {string} status - Status value
   * @param {number} mediaCount - Media count
   * @param {Error} scanError - Error object
   * @returns {Promise<void>}
   */
  async function updateDiscoveryFileScanStatus(
    fileName,
    pagePath,
    status,
    mediaCount = 0,
    scanError = null,
  ) {
    if (!state.scanCompletionHandler) {
      return;
    }
    try {
      await state.scanCompletionHandler.updateDiscoveryFileScanStatus(
        fileName,
        pagePath,
        status,
        mediaCount,
        scanError,
      );
    } catch (error) {
      // Scan status update failed
    }
  }
  /**
   * Update site structure media count
   * @param {string} pagePath - Page path
   * @param {number} mediaCount - Media count
   * @returns {Promise<void>}
   */
  async function updateSiteStructureMediaCount(pagePath, mediaCount) {
    if (!state.scanCompletionHandler) {
      return;
    }
    try {
      await state.scanCompletionHandler.updateSiteStructureMediaCount(pagePath, mediaCount);
    } catch (error) {
      // Media count update failed
    }
  }
  /**
   * Update folder media count
   * @param {Object} folder - Folder object
   * @param {string} pagePath - Page path
   * @param {number} mediaCount - Media count
   * @returns {void}
   */
  function updateFolderMediaCount(folder, pagePath, mediaCount) {
    if (!folder || !pagePath) {
      return;
    }
    if (folder.path === pagePath) {
      folder.mediaCount = (folder.mediaCount || 0) + mediaCount;
    }
    if (folder.children) {
      folder.children.forEach((child) => updateFolderMediaCount(child, pagePath, mediaCount));
    }
  }
  /**
   * Update all discovery files
   * @returns {Promise<void>}
   */
  async function updateAllDiscoveryFiles() {
    if (!state.scanCompletionHandler) {
      return;
    }
    try {
      await state.scanCompletionHandler.updateAllDiscoveryFiles();
    } catch (error) {
      // Discovery files update failed
    }
  }
  /**
   * Update site structure with media counts
   * @returns {Promise<void>}
   */
  async function updateSiteStructureWithMediaCounts() {
    if (!state.scanCompletionHandler) {
      return;
    }
    try {
      await state.scanCompletionHandler.updateSiteStructureWithMediaCounts();
    } catch (error) {
      // Site structure update failed
    }
  }
  /**
   * Update processing status
   * @param {string} status - Status value
   * @param {Object} data - Status data
   * @returns {Promise<void>}
   */
  async function updateProcessingStatus(status, data = {}) {
    if (!state.processingStateManager) {
      return;
    }
    try {
      await state.processingStateManager.updateStatus(status, data);
    } catch (error) {
      // Processing status update failed
    }
  }
  /**
   * Update scan progress
   * @param {Object} progress - Progress data
   * @returns {Promise<void>}
   */
  async function updateScanProgress(progress) {
    if (!state.processingStateManager) {
      return;
    }
    try {
      await state.processingStateManager.updateScanProgress(progress);
    } catch (error) {
      // Scan progress update failed
    }
  }
  /**
   * Update discovery progress
   * @param {Object} progress - Progress data
   * @returns {Promise<void>}
   */
  async function updateDiscoveryProgress(progress) {
    if (!state.processingStateManager) {
      return;
    }
    try {
      await state.processingStateManager.updateDiscoveryProgress(progress);
    } catch (error) {
      // Discovery progress update failed
    }
  }
  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function on(event, callback) {
    eventEmitter.on(event, callback);
  }
  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function off(event, callback) {
    eventEmitter.off(event, callback);
  }
  /**
   * Emit event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  function emit(event, data) {
    eventEmitter.emit(event, data);
  }
  return {
    init,
    updateDiscoveryFileScanStatus,
    updateSiteStructureMediaCount,
    updateFolderMediaCount,
    updateAllDiscoveryFiles,
    updateSiteStructureWithMediaCounts,
    updateProcessingStatus,
    updateScanProgress,
    updateDiscoveryProgress,
    on,
    off,
    emit,
  };
}