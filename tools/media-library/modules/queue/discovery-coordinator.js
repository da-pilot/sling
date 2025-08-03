/**
 * Queue Discovery Handler - Handles discovery events and integration
 */
import createEventEmitter from '../../shared/event-emitter.js';

export default function createQueueDiscoveryHandler() {
  const eventEmitter = createEventEmitter('Queue Discovery Handler');
  const state = {
    discoveryCoordinator: null,
    processingStateManager: null,
  };
  /**
   * Initialize discovery handler
   * @param {Object} discoveryCoordinator - Discovery coordinator instance
   * @param {Object} processingStateManager - Processing state manager instance
   */
  async function init(discoveryCoordinator, processingStateManager) {
    state.discoveryCoordinator = discoveryCoordinator;
    state.processingStateManager = processingStateManager;
  }
  /**
   * Setup discovery event handlers
   * @param {Object} handlers - Event handlers object
   */
  function setupDiscoveryHandlers(handlers) {
    const {
      onDocumentsDiscovered, onFolderComplete, onDocumentsChanged, onDiscoveryComplete,
    } = handlers;
    if (!state.discoveryCoordinator) {
      return;
    }
    state.discoveryCoordinator.on('documentsDiscovered', async (data) => {
      await onDocumentsDiscovered(data);
    });
    state.discoveryCoordinator.on('folderComplete', async (data) => {
      await onFolderComplete(data);
    });
    state.discoveryCoordinator.on('documentsChanged', async (data) => {
      await onDocumentsChanged(data);
    });
    state.discoveryCoordinator.on('discoveryComplete', async (data) => {
      await onDiscoveryComplete(data);
    });
  }
  /**
   * Start discovery with session
   * @param {string} sessionId - Session ID
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Promise<Object>}
   */
  async function startDiscoveryWithSession(sessionId, forceRescan = false) {
    if (!state.discoveryCoordinator) {
      throw new Error('Discovery coordinator not initialized');
    }
    return state.discoveryCoordinator.startDiscoveryWithSession(sessionId, forceRescan);
  }
  /**
   * Stop discovery
   * @returns {Promise<void>}
   */
  async function stopDiscovery() {
    if (!state.discoveryCoordinator) {
      return;
    }
    await state.discoveryCoordinator.stopDiscovery();
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
    return state.discoveryCoordinator.resumeDiscoveryFromCheckpoint(discoveryCheckpoint);
  }
  /**
   * Check if discovery files exist
   * @returns {Promise<Object>}
   */
  async function checkDiscoveryFilesExist() {
    console.log('[Queue Discovery Handler] 🔍 Checking if discovery files exist...');
    console.log('[Queue Discovery Handler] 🔍 Debug - state.discoveryCoordinator:', {
      exists: !!state.discoveryCoordinator,
      type: typeof state.discoveryCoordinator,
      hasMethod: state.discoveryCoordinator ? typeof state.discoveryCoordinator.checkDiscoveryFilesExist : 'N/A',
    });

    if (!state.discoveryCoordinator) {
      console.error('[Queue Discovery Handler] ❌ Discovery coordinator not initialized');
      return { filesExist: false, shouldRunDiscovery: true };
    }

    if (typeof state.discoveryCoordinator.checkDiscoveryFilesExist !== 'function') {
      console.error('[Queue Discovery Handler] ❌ checkDiscoveryFilesExist method not found on discovery coordinator');
      console.log('[Queue Discovery Handler] 🔍 Available methods:', Object.keys(state.discoveryCoordinator));
      return { filesExist: false, shouldRunDiscovery: true };
    }

    try {
      const result = await state.discoveryCoordinator.checkDiscoveryFilesExist();
      console.log('[Queue Discovery Handler] ✅ Discovery files check result:', result);
      return result;
    } catch (error) {
      console.error('[Queue Discovery Handler] ❌ Error checking discovery files:', error);
      return { filesExist: false, shouldRunDiscovery: true };
    }
  }
  /**
   * Load discovery files
   * @returns {Promise<Array>}
   */
  async function loadDiscoveryFiles() {
    if (!state.discoveryCoordinator) {
      return [];
    }
    return state.discoveryCoordinator.loadDiscoveryFiles();
  }
  /**
   * Clear discovery files
   * @returns {Promise<void>}
   */
  async function clearDiscoveryFiles() {
    if (!state.discoveryCoordinator) {
      return;
    }
    await state.discoveryCoordinator.clearDiscoveryFiles();
  }
  /**
   * Get documents to scan
   * @param {Array} discoveryFiles - Discovery files array
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Array}
   */
  function getDocumentsToScan(discoveryFiles, forceRescan = false) {
    if (!state.discoveryCoordinator) {
      return [];
    }
    return state.discoveryCoordinator.getDocumentsToScan(discoveryFiles, forceRescan);
  }
  /**
   * Detect changed documents
   * @param {Array} discoveryFiles - Discovery files array
   * @returns {Promise<Array>}
   */
  async function detectChangedDocuments(discoveryFiles) {
    if (!state.discoveryCoordinator) {
      return [];
    }
    return state.discoveryCoordinator.detectChangedDocuments(discoveryFiles);
  }

  /**
   * Load discovery files with change detection
   * @returns {Promise<Array>}
   */
  async function loadDiscoveryFilesWithChangeDetection() {
    if (!state.discoveryCoordinator) {
      return [];
    }
    return state.discoveryCoordinator.loadDiscoveryFilesWithChangeDetection();
  }

  /**
   * Get config from discovery coordinator
   * @returns {Object}
   */
  function getConfig() {
    if (!state.discoveryCoordinator) {
      return null;
    }
    return state.discoveryCoordinator.getConfig();
  }

  /**
   * Get DA API from discovery coordinator
   * @returns {Object}
   */
  function getDaApi() {
    if (!state.discoveryCoordinator) {
      return null;
    }
    return state.discoveryCoordinator.getDaApi();
  }

  /**
   * Get processing state manager
   * @returns {Object}
   */
  function getProcessingStateManager() {
    return state.processingStateManager;
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
    setupDiscoveryHandlers,
    startDiscoveryWithSession,
    stopDiscovery,
    resumeDiscoveryFromCheckpoint,
    checkDiscoveryFilesExist,
    loadDiscoveryFiles,
    clearDiscoveryFiles,
    getDocumentsToScan,
    detectChangedDocuments,
    loadDiscoveryFilesWithChangeDetection,
    getConfig,
    getDaApi,
    getProcessingStateManager,
    on,
    off,
    emit,
  };
}