/**
 * Discovery events
 * Handles event management and coordination for discovery process
 */

import { createEventEmitter } from '../../shared/index.js';

export default function createDiscoveryEvents() {
  const eventEmitter = createEventEmitter('Discovery Events');

  // Discovery-specific event types
  const DISCOVERY_EVENTS = {
    DISCOVERY_STARTED: 'discoveryStarted',
    DISCOVERY_COMPLETE: 'discoveryComplete',
    DISCOVERY_ERROR: 'discoveryError',
    DISCOVERY_STOPPED: 'discoveryStopped',
    DOCUMENTS_DISCOVERED: 'documentsDiscovered',
    FOLDER_COMPLETE: 'folderComplete',
  };

  /**
   * Emit discovery started event
   * @param {Object} data - Event data
   */
  function emitDiscoveryStarted(data) {
    eventEmitter.emit(DISCOVERY_EVENTS.DISCOVERY_STARTED, data);
  }

  /**
   * Emit discovery complete event
   * @param {Object} data - Event data
   */
  function emitDiscoveryComplete(data) {
    eventEmitter.emit(DISCOVERY_EVENTS.DISCOVERY_COMPLETE, data);
  }

  /**
   * Emit discovery error event
   * @param {Object} data - Event data
   */
  function emitDiscoveryError(data) {
    eventEmitter.emit(DISCOVERY_EVENTS.DISCOVERY_ERROR, data);
  }

  /**
   * Emit discovery stopped event
   * @param {Object} data - Event data
   */
  function emitDiscoveryStopped(data) {
    eventEmitter.emit(DISCOVERY_EVENTS.DISCOVERY_STOPPED, data);
  }

  /**
   * Emit documents discovered event
   * @param {Object} data - Event data
   */
  function emitDocumentsDiscovered(data) {
    eventEmitter.emit(DISCOVERY_EVENTS.DOCUMENTS_DISCOVERED, data);
  }

  /**
   * Emit folder complete event
   * @param {Object} data - Event data
   */
  function emitFolderComplete(data) {
    eventEmitter.emit(DISCOVERY_EVENTS.FOLDER_COMPLETE, data);
  }

  /**
   * Emit discovery progress event
   * @param {Object} data - Progress data
   */
  function emitDiscoveryProgress(data) {
    eventEmitter.emit('discoveryProgress', data);
  }

  /**
   * Emit discovery status event
   * @param {Object} data - Status data
   */
  function emitDiscoveryStatus(data) {
    eventEmitter.emit('discoveryStatus', data);
  }

  /**
   * Emit discovery warning event
   * @param {Object} data - Warning data
   */
  function emitDiscoveryWarning(data) {
    eventEmitter.emit('discoveryWarning', data);
  }

  /**
   * Emit discovery info event
   * @param {Object} data - Info data
   */
  function emitDiscoveryInfo(data) {
    eventEmitter.emit('discoveryInfo', data);
  }

  /**
   * Emit discovery debug event
   * @param {Object} data - Debug data
   */
  function emitDiscoveryDebug(data) {
    eventEmitter.emit('discoveryDebug', data);
  }

  return {
    ...eventEmitter,
    DISCOVERY_EVENTS,
    emitDiscoveryStarted,
    emitDiscoveryComplete,
    emitDiscoveryError,
    emitDiscoveryStopped,
    emitDocumentsDiscovered,
    emitFolderComplete,
    emitDiscoveryProgress,
    emitDiscoveryStatus,
    emitDiscoveryWarning,
    emitDiscoveryInfo,
    emitDiscoveryDebug,
  };
}