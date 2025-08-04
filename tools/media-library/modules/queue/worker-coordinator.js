/**
 * Queue Worker Manager - Handles worker initialization and communication
 */
import createEventEmitter from '../../shared/event-emitter.js';

export default function createQueueWorkerManager() {
  const eventEmitter = createEventEmitter('Queue Worker Manager');
  const state = {
    workers: new Map(),
    workerConfigs: new Map(),
  };

  /**
   * Initialize worker manager
   * @param {Object} config - Configuration object
   */
  async function init(config) {
    state.config = config;
  }

  /**
   * Initialize a worker and wait for confirmation
   * @param {Worker} worker - Worker instance
   * @param {string} workerType - Type of worker
   * @param {Object} apiConfig - API configuration
   * @returns {Promise<void>}
   */
  async function initializeWorker(worker, workerType, apiConfig) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${workerType} worker initialization timeout`));
      }, 10000);
      const handleMessage = (event) => {
        if (event.data.type === 'initialized') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handleMessage);
          resolve();
        }
      };
      worker.addEventListener('message', handleMessage);
      worker.postMessage({ type: 'init', data: { apiConfig } });
    });
  }

  /**
   * Setup worker event handlers
   * @param {Object} handlers - Event handlers object
   */
  function setupWorkerHandlers(handlers) {
    const {
      onBatchComplete, onScanComplete, onError, onProgress,
    } = handlers;
    eventEmitter.on('batchComplete', onBatchComplete);
    eventEmitter.on('scanComplete', onScanComplete);
    eventEmitter.on('error', onError);
    eventEmitter.on('progress', onProgress);
  }

  /**
   * Register worker
   * @param {string} workerId - Worker identifier
   * @param {Worker} worker - Worker instance
   */
  function registerWorker(workerId, worker) {
    state.workers.set(workerId, worker);
  }

  /**
   * Unregister worker
   * @param {string} workerId - Worker identifier
   */
  function unregisterWorker(workerId) {
    state.workers.delete(workerId);
  }

  /**
   * Get worker by ID
   * @param {string} workerId - Worker identifier
   * @returns {Worker|null}
   */
  function getWorker(workerId) {
    return state.workers.get(workerId) || null;
  }

  /**
   * Get the default media scan worker
   * @returns {Worker|null}
   */
  async function getDefaultWorker() {
    const mediaScanWorker = state.workers.get('media-scan');
    if (!mediaScanWorker) {
      try {
        const worker = new Worker(
          new URL('../../workers/media-scan-worker.js', import.meta.url),
          { type: 'module' },
        );
        await initializeWorker(worker, 'media-scan', state.config);
        state.workers.set('media-scan', worker);
        return worker;
      } catch (error) {
        return null;
      }
    }
    return mediaScanWorker;
  }

  /**
   * Create and initialize a new worker
   * @param {string} workerType - Type of worker
   * @param {Object} apiConfig - API configuration
   * @returns {Promise<Worker|null>}
   */
  async function createWorker(workerType, apiConfig) {
    try {
      let workerPath;
      switch (workerType) {
        case 'media-scan':
          workerPath = '../../workers/media-scan-worker.js';
          break;
        default:
          throw new Error(`Unknown worker type: ${workerType}`);
      }

      const worker = new Worker(new URL(workerPath, import.meta.url), { type: 'module' });
      await initializeWorker(worker, workerType, apiConfig);
      state.workers.set(workerType, worker);
      return worker;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all workers
   * @returns {Map} Map of workers
   */
  function getAllWorkers() {
    return state.workers;
  }

  /**
   * Cleanup all workers
   */
  function cleanup() {
    state.workers.forEach((worker) => {
      if (worker && typeof worker.terminate === 'function') {
        worker.terminate();
      }
    });
    state.workers.clear();
    state.workerConfigs.clear();
  }

  /**
   * Check if any workers are active
   * @returns {boolean}
   */
  function hasActiveWorkers() {
    return state.workers.size > 0;
  }

  /**
   * Cleanup all workers (alias for cleanup)
   */
  function cleanupAll() {
    return cleanup();
  }

  /**
   * Reset statistics
   */
  function resetStats() {
    state.workers.clear();
    state.workerConfigs.clear();
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
    initializeWorker,
    setupWorkerHandlers,
    registerWorker,
    unregisterWorker,
    getWorker,
    getDefaultWorker,
    createWorker,
    getAllWorkers,
    cleanup,
    cleanupAll,
    hasActiveWorkers,
    resetStats,
    on,
    off,
    emit,
  };
}