/**
 * Queue Module Index - Exports all queue-related modules
 */
import createQueueEventEmitter from './event-emitter.js';
import createQueueWorkerCoordinator from './worker-coordinator.js';
import createQueueDiscoveryCoordinator from './discovery-coordinator.js';
import createQueueBatchHandler from './batch-handler.js';
import createQueueDocumentHandler from './document-handler.js';
import createQueueCheckpointHandler from './checkpoint-handler.js';
import createQueueDeltaHandler from './delta-handler.js';
import createQueueStatusCoordinator from './status-coordinator.js';
import createQueueOrchestrator from './queue-orchestrator.js';
import createDiscoveryFileHandler from './discovery-file-handler.js';

export default createQueueEventEmitter;
export {
  createQueueWorkerCoordinator,
  createQueueDiscoveryCoordinator,
  createQueueBatchHandler,
  createQueueDocumentHandler,
  createQueueCheckpointHandler,
  createQueueDeltaHandler,
  createQueueStatusCoordinator,
  createQueueOrchestrator,
  createDiscoveryFileHandler,
};