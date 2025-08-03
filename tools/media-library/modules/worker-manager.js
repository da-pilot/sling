export default function createWorkerManager() {
  const state = {
    scanWorker: null,
    batchSize: 10,
    isInitialized: false,
  };

  async function init(apiConfig) {
    state.scanWorker = new Worker(new URL('../workers/media-scan-worker.js', import.meta.url), {
      type: 'module',
    });
    await initializeWorkerInstance(state.scanWorker, 'scan', apiConfig);
    state.isInitialized = true;
  }

  async function initializeWorkerInstance(worker, workerType, apiConfig) {
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

  function setupWorkerHandlers(handlers) {
    if (!state.scanWorker) {
      return;
    }
    state.scanWorker.onmessage = async (event) => {
      const { type, data } = event.data;
      switch (type) {
        case 'initialized':
          break;
        case 'queueProcessingStarted':
          handlers.onQueueProcessingStarted?.(data);
          break;
        case 'requestBatch':
          await handlers.onRequestBatch?.();
          break;
        case 'pageScanned':
          await handlers.onPageScanned?.(data);
          break;
        case 'markPageScanned':
          break;
        case 'batchComplete':
          await handlers.onBatchComplete?.(data);
          break;
        case 'pageScanError':
          await handlers.onPageScanError?.(data);
          break;
        case 'queueProcessingStopped':
          await handlers.onQueueProcessingStopped?.(data);
          break;
        case 'error':
          await handlers.onWorkerError?.(data);
          break;
        case 'mediaDiscovered':
          await handlers.onMediaDiscovered?.(data);
          break;
        default:
          break;
      }
    };
    state.scanWorker.onerror = (error) => {
      handlers.onWorkerError?.({ error: error.message });
    };
  }

  function startQueueProcessing() {
    if (state.scanWorker) {
      state.scanWorker.postMessage({
        type: 'startQueueProcessing',
        data: {},
      });
    }
  }

  function stopQueueProcessing() {
    if (state.scanWorker && !state.isStopping) {
      state.scanWorker.postMessage({
        type: 'stopQueueProcessing',
      });
    }
  }

  function requestBatch(batch) {
    if (state.scanWorker) {
      state.scanWorker.postMessage({
        type: 'processBatch',
        data: { pages: batch },
      });
    }
  }

  function cleanup() {
    if (state.scanWorker) {
      state.scanWorker.terminate();
      state.scanWorker = null;
    }
    state.isInitialized = false;
  }

  function getWorker() {
    return state.scanWorker;
  }

  function isInitialized() {
    return state.isInitialized;
  }

  function setBatchSize(size) {
    state.batchSize = size;
  }

  function getBatchSize() {
    return state.batchSize;
  }

  return {
    init,
    setupWorkerHandlers,
    startQueueProcessing,
    stopQueueProcessing,
    requestBatch,
    cleanup,
    getWorker,
    isInitialized,
    setBatchSize,
    getBatchSize,
  };
} 