/**
 * Queue Delta Processor - Handles structural changes and delta processing
 */
import createEventEmitter from '../../shared/event-emitter.js';
import { CONTENT_DA_LIVE_BASE } from '../../constants.js';
import { loadData } from '../sheet-utils.js';

export default function createQueueDeltaProcessor() {
  const eventEmitter = createEventEmitter('Queue Delta Processor');
  const state = {
    daApi: null,
    config: null,
  };
  /**
   * Initialize delta processor
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API service
   */
  async function init(config, daApi) {
    state.config = config;
    state.daApi = daApi;
  }
  /**
   * Calculate discovery delta
   * @param {Object} baselineStructure - Baseline structure
   * @param {Object} currentStructure - Current structure
   * @returns {Object}
   */
  function calculateDiscoveryDelta(baselineStructure, currentStructure) {
    const baselineFiles = baselineStructure.files || [];
    const currentFiles = currentStructure.files || [];
    const baselinePaths = new Set(baselineFiles.map((f) => f.path));
    const currentPaths = new Set(currentFiles.map((f) => f.path));
    const added = currentFiles.filter((f) => !baselinePaths.has(f.path));
    const removed = baselineFiles.filter((f) => !currentPaths.has(f.path));
    const modified = currentFiles.filter((f) => {
      if (!baselinePaths.has(f.path)) return false;
      const baselineFile = baselineFiles.find((bf) => bf.path === f.path);
      return baselineFile && baselineFile.lastModified !== f.lastModified;
    });
    return { added, modified, removed };
  }
  /**
   * Process discovery delta
   * @param {Object} delta - Delta object
   * @returns {Promise<Object>}
   */
  async function processDiscoveryDelta(delta) {
    if (!delta || !delta.path) {
      return null;
    }
    try {
      const discoveryData = {
        path: delta.path,
        type: delta.type || 'file',
        lastModified: delta.lastModified || Date.now(),
        size: delta.size || 0,
        discoveredAt: Date.now(),
      };
      eventEmitter.emit('deltaProcessed', discoveryData);
      return discoveryData;
    } catch (error) {
      return null;
    }
  }
  /**
   * Check for structural changes
   * @param {Object} baselineStructure - Baseline site structure
   * @param {Object} currentStructure - Current site structure
   * @returns {Promise<Object>}
   */
  async function checkForStructuralChanges(baselineStructure, currentStructure) {
    if (!baselineStructure || !currentStructure) {
      return { hasChanges: false, changes: [] };
    }
    const changes = calculateDiscoveryDelta(baselineStructure, currentStructure);
    const hasChanges = changes.added.length > 0
      || changes.modified.length > 0
      || changes.removed.length > 0;
    return { hasChanges, changes };
  }
  /**
   * Perform incremental discovery
   * @param {Object} changes - Changes object
   * @returns {Promise<Object>}
   */
  async function performIncrementalDiscovery(changes) {
    if (!changes || (!changes.added.length && !changes.modified.length)) {
      return { success: true, discoveredItems: [] };
    }
    const discoveredItems = [];
    const allChanges = [...changes.added, ...changes.modified];
    const discoveryPromises = allChanges.map(async (change) => {
      try {
        const discoveryResult = await processDiscoveryDelta(change);
        return discoveryResult;
      } catch (error) {
        return null;
      }
    });
    const results = await Promise.all(discoveryPromises);
    discoveredItems.push(...results.filter(Boolean));
    return { success: true, discoveredItems };
  }
  /**
   * Calculate file changes
   * @param {Array} baselineFiles - Baseline files array
   * @param {Array} currentFiles - Current files array
   * @returns {Object}
   */
  function calculateFileChanges(baselineFiles, currentFiles) {
    const baselinePaths = new Set(baselineFiles.map((f) => f.path));
    const currentPaths = new Set(currentFiles.map((f) => f.path));
    const added = currentFiles.filter((f) => !baselinePaths.has(f.path));
    const removed = baselineFiles.filter((f) => !currentPaths.has(f.path));
    const modified = currentFiles.filter((f) => {
      if (!baselinePaths.has(f.path)) return false;
      const baselineFile = baselineFiles.find((bf) => bf.path === f.path);
      return baselineFile && baselineFile.lastModified !== f.lastModified;
    });
    return { added, modified, removed };
  }

  /**
   * Load site structure for comparison
   * @returns {Promise<Object|null>}
   */
  async function loadSiteStructureForComparison() {
    if (!state.config || !state.daApi) {
      return null;
    }
    try {
      const structureUrl = `${CONTENT_DA_LIVE_BASE}/${state.config.org}/${state.config.repo}/.media/.pages/structure-baseline.json`;
      const structureData = await loadData(structureUrl, state.config.token);
      return structureData;
    } catch (error) {
      return null;
    }
  }
  /**
   * Generate discovery file for folder
   * @param {string} folderPath - Folder path
   * @param {Object} folderData - Folder data
   * @returns {Promise<Object>}
   */
  async function generateDiscoveryFileForFolder(folderPath, folderData) {
    if (!folderPath || !folderData) {
      return null;
    }
    const discoveryFile = {
      folderPath,
      documents: folderData.documents || [],
      lastModified: Date.now(),
      documentCount: folderData.documents?.length || 0,
    };
    eventEmitter.emit('discoveryFileGenerated', discoveryFile);
    return discoveryFile;
  }
  /**
   * Update discovery file for file changes
   * @param {string} folderPath - Folder path
   * @param {Object} fileChanges - File changes object
   * @returns {Promise<Object>}
   */
  async function updateDiscoveryFileForFileChanges(folderPath, fileChanges) {
    if (!folderPath || !fileChanges) {
      return null;
    }
    const updatedFile = {
      folderPath,
      changes: fileChanges,
      updatedAt: Date.now(),
    };
    eventEmitter.emit('discoveryFileUpdated', updatedFile);
    return updatedFile;
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
    checkForStructuralChanges,
    performIncrementalDiscovery,
    calculateDiscoveryDelta,
    calculateFileChanges,
    processDiscoveryDelta,
    loadSiteStructureForComparison,
    generateDiscoveryFileForFolder,
    updateDiscoveryFileForFileChanges,
    on,
    off,
    emit,
  };
}
