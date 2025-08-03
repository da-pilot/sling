/**
 * Queue Checkpoint Manager - Handles checkpoint resumption and management
 */
import createEventEmitter from '../../shared/event-emitter.js';

export default function createQueueCheckpointManager() {
  const eventEmitter = createEventEmitter('Queue Checkpoint Manager');
  const state = {
    discoveryCoordinator: null,
    scanStateManager: null,
    processingStateManager: null,
  };
  /**
   * Initialize checkpoint manager
   * @param {Object} discoveryCoordinator - Discovery coordinator instance
   * @param {Object} scanStateManager - Scan state manager instance
   * @param {Object} processingStateManager - Processing state manager instance
   */
  async function init(discoveryCoordinator, scanStateManager, processingStateManager) {
    state.discoveryCoordinator = discoveryCoordinator;
    state.scanStateManager = scanStateManager;
    state.processingStateManager = processingStateManager;
  }
  /**
   * Resume discovery from checkpoint
   * @param {Object} discoveryCheckpoint - Discovery checkpoint data
   * @returns {Promise<Object>}
   */
  async function resumeDiscoveryFromCheckpoint(discoveryCheckpoint) {
    if (!state.discoveryCoordinator) {
      throw new Error('Discovery coordinator not initialized');
    }
    const result = await state.discoveryCoordinator.resumeDiscoveryFromCheckpoint(
      discoveryCheckpoint,
    );
    if (result.discoveryComplete) {
      return { discoveryComplete: true, shouldStartScanning: true };
    }
    return {
      discoveryComplete: false,
      pendingFolders: result.pendingFolders,
      completedFolders: result.completedFolders,
    };
  }
  /**
   * Resume scanning from checkpoint
   * @param {Object} scanCheckpoint - Scan checkpoint data
   * @returns {Promise<Object>}
   */
  async function resumeScanningFromCheckpoint(scanCheckpoint) {
    const {
      documentsToScan,
      completedPages,
      scannedPages,
      totalPages,
    } = scanCheckpoint;
    if (!documentsToScan || documentsToScan.length === 0) {
      return { scanningComplete: true };
    }
    const remainingDocuments = documentsToScan.filter((doc) => {
      const isCompleted = completedPages.includes(doc.path);
      const isScanned = scannedPages.includes(doc.path);
      return !isCompleted && !isScanned;
    });
    return {
      scanningComplete: false,
      documentsToScan: remainingDocuments,
      completedPages,
      scannedPages,
      totalPages,
    };
  }
  /**
   * Save discovery checkpoint
   * @param {Object} checkpointData - Checkpoint data to save
   * @returns {Promise<void>}
   */
  async function saveDiscoveryCheckpoint(checkpointData) {
    if (!state.processingStateManager) {
      return;
    }
    try {
      await state.processingStateManager.saveDiscoveryCheckpoint(checkpointData);
    } catch (error) {
      // Discovery checkpoint save failed
    }
  }
  /**
   * Save scan checkpoint
   * @param {Object} checkpointData - Checkpoint data to save
   * @returns {Promise<void>}
   */
  async function saveScanCheckpoint(checkpointData) {
    if (!state.processingStateManager) {
      return;
    }
    try {
      await state.processingStateManager.saveScanCheckpoint(checkpointData);
    } catch (error) {
      // Scan checkpoint save failed
    }
  }
  /**
   * Load discovery checkpoint
   * @returns {Promise<Object|null>}
   */
  async function loadDiscoveryCheckpoint() {
    if (!state.processingStateManager) {
      return null;
    }
    try {
      const checkpoint = await state.processingStateManager.loadDiscoveryCheckpoint();
      return checkpoint;
    } catch (error) {
      return null;
    }
  }
  /**
   * Load scan checkpoint
   * @returns {Promise<Object|null>}
   */
  async function loadScanCheckpoint() {
    if (!state.processingStateManager) {
      return null;
    }
    try {
      const checkpoint = await state.processingStateManager.loadScanCheckpoint();
      return checkpoint;
    } catch (error) {
      return null;
    }
  }
  /**
   * Clear checkpoints
   * @returns {Promise<void>}
   */
  async function clearCheckpoints() {
    if (!state.processingStateManager) {
      return;
    }
    try {
      await state.processingStateManager.clearCheckpoints();
    } catch (error) {
      // Checkpoint clear failed
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
    resumeDiscoveryFromCheckpoint,
    resumeScanningFromCheckpoint,
    saveDiscoveryCheckpoint,
    saveScanCheckpoint,
    loadDiscoveryCheckpoint,
    loadScanCheckpoint,
    clearCheckpoints,
    on,
    off,
    emit,
  };
}