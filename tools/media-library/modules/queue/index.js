import createQueueEventEmitter from './event-emitter.js';
import createDiscoveryFileManager from './discovery-file-manager.js';
import createScanStatusUpdater from './scan-status-updater.js';

export default createQueueEventEmitter;
export { createDiscoveryFileManager, createScanStatusUpdater };