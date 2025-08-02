/**
 * Discovery module index
 * Exports all discovery modules and provides the main discovery API
 */

export { default as createDiscoveryEngine } from './discovery-engine.js';
export { default as createDiscoveryEvents } from './discovery-events.js';
export { default as createStatsTracker } from './stats-tracker.js';
export { default as createDiscoveryPersistenceManager } from './persistence-manager.js';
export { default as createParallelProcessor } from './parallel-processor.js';
export { default as createDocumentScanner } from './document-scanner.js';
export { default as createSiteAggregator } from './site-aggregator.js';
export { default as createDocumentMapper } from './document-mapper.js';

// Main discovery API
export { default as createDiscoveryManager } from './discovery-engine.js';