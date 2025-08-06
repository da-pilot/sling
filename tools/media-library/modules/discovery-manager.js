/**
 * Discovery Manager - Wrapper for the new modular discovery system
 * Uses the discovery engine to provide the same API as before
 */

import { createDiscoveryEngine } from './discovery/index.js';

function createDiscoveryManager() {
  const engine = createDiscoveryEngine();

  /**
   * Initialize the discovery manager
   * @param {Object} docAuthoringService - Document authoring service
   * @param {Object} sessionManagerInstance - Session manager instance
   * @param {Object} processingStateManagerInstance - Processing state manager instance
   */
  async function init(
    docAuthoringService,
    sessionManagerInstance,
    processingStateManagerInstance,
  ) {
    return engine.init(
      docAuthoringService,
      sessionManagerInstance,
      processingStateManagerInstance,
    );
  }

  /**
   * Start discovery with session
   * @param {string} sessionId - Session ID
   * @param {string} discoveryType - Discovery type ('full' or 'incremental')
   * @returns {Promise<Object>} Discovery result
   */
  async function startDiscoveryWithSession(sessionId, discoveryType) {
    console.log('[Discovery Manager] 🔍 Starting discovery with type:', discoveryType);
    return engine.startDiscoveryWithSession(sessionId, discoveryType);
  }

  /**
   * Stop discovery process
   */
  async function stopDiscovery() {
    return engine.stopDiscovery();
  }

  /**
   * Pause discovery process
   * @param {string} sessionId - Session ID
   * @param {string} userId - User ID
   */
  async function pauseDiscovery(sessionId, userId) {
    return engine.pauseDiscovery(sessionId, userId);
  }

  /**
   * Resume discovery process
   * @param {string} sessionId - Session ID
   * @param {string} userId - User ID
   * @param {Array} pendingFolders - Pending folders to process
   */
  async function resumeDiscovery(sessionId, userId, pendingFolders) {
    return engine.resumeDiscovery(sessionId, userId, pendingFolders);
  }

  /**
   * Reset discovery state
   */
  async function resetDiscoveryState() {
    return engine.resetDiscoveryState();
  }

  /**
   * Register event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function on(event, callback) {
    return engine.on(event, callback);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function off(event, callback) {
    return engine.off(event, callback);
  }

  /**
   * Get current progress
   * @returns {Object} Progress data
   */
  function getProgress() {
    return engine.getProgress();
  }

  /**
   * Get progress summary
   * @returns {Object} Progress summary
   */
  function getProgressSummary() {
    return engine.getProgressSummary();
  }
  /**
   * Build site structure from discovery files
   * @returns {Object} Site structure
   */
  async function buildSiteStructureFromDiscoveryFiles() {
    return engine.buildSiteStructureFromDiscoveryFiles();
  }
  /**
   * Clear queue
   */
  async function clearQueue() {
    return engine.clearQueue();
  }

  function setMediaProcessor(mediaProcessor) {
    return engine.setMediaProcessor(mediaProcessor);
  }

  return {
    init,
    startDiscoveryWithSession,
    stopDiscovery,
    pauseDiscovery,
    resumeDiscovery,
    resetDiscoveryState,
    on,
    off,
    getProgress,
    getProgressSummary,
    buildSiteStructureFromDiscoveryFiles,
    clearQueue,
    setMediaProcessor,
  };
}

export default createDiscoveryManager;
