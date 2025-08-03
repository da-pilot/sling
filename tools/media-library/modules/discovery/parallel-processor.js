/**
 * Parallel processor
 * Handles worker management and parallel processing communication
 */

// Worker script path - using media-scan-worker as fallback
const WORKER_SCRIPT_PATH = '../../workers/media-scan-worker.js';

export default function createParallelProcessor() {
  const state = {
    folderWorkers: new Map(),
    maxWorkers: 4,
  };

  /**
   * Create a worker for folder processing
   * @param {Object} folder - Folder to process
   * @param {string} workerId - Unique worker ID
   * @returns {Promise<Worker>} Promise that resolves to the created worker
   */
  function createWorker(folder, workerId) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(new URL(WORKER_SCRIPT_PATH, import.meta.url), { type: 'module' });
      } catch (workerError) {
        console.error('[Parallel Processor] ❌ Failed to create worker:', { workerId, error: workerError.message, path: WORKER_SCRIPT_PATH });
        reject(workerError);
        return;
      }

      // Add error handler to catch worker loading issues
      worker.onerror = (error) => {
        console.error('[Parallel Processor] ❌ Worker error:', { workerId, error: error.message });
        reject(error);
      };

      state.folderWorkers.set(workerId, {
        worker,
        folder,
      });

      resolve(worker);
    });
  }

  /**
   * Clean up a specific worker
   * @param {string} workerId - Worker ID to clean up
   */
  function cleanup(workerId) {
    const workerInfo = state.folderWorkers.get(workerId);
    if (workerInfo) {
      workerInfo.worker.terminate();
      state.folderWorkers.delete(workerId);
    }
  }

  /**
   * Clean up all workers
   */
  function cleanupAll() {
    state.folderWorkers.forEach((workerInfo, workerId) => {
      workerInfo.worker.postMessage({ type: 'stopDiscovery' });
      cleanup(workerId);
    });
    state.folderWorkers.clear();
  }

  /**
   * Get maximum number of workers
   * @returns {number} Maximum workers
   */
  function getMaxWorkers() {
    return state.maxWorkers;
  }

  /**
   * Get current worker count
   * @returns {number} Current worker count
   */
  function getWorkerCount() {
    return state.folderWorkers.size;
  }

  /**
   * Check if any workers are active
   * @returns {boolean} True if workers are active
   */
  function hasActiveWorkers() {
    return state.folderWorkers.size > 0;
  }

  /**
   * Send message to all workers
   * @param {Object} message - Message to send
   */
  function broadcastToWorkers(message) {
    state.folderWorkers.forEach((workerInfo) => {
      workerInfo.worker.postMessage(message);
    });
  }

  /**
   * Send message to specific worker
   * @param {string} workerId - Worker ID
   * @param {Object} message - Message to send
   */
  function sendToWorker(workerId, message) {
    const workerInfo = state.folderWorkers.get(workerId);
    if (workerInfo) {
      workerInfo.worker.postMessage(message);
    }
  }

  return {
    createWorker,
    cleanup,
    cleanupAll,
    getMaxWorkers,
    getWorkerCount,
    hasActiveWorkers,
    broadcastToWorkers,
    sendToWorker,
  };
}