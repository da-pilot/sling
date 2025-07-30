export default function createUploadQueueManager() {
  const state = {
  };

  function emit(event, data) {
    if (state.listeners.has(event)) {
      state.listeners.get(event).forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error('[Upload Queue Manager] Error in event handler:', error);
        }
      });
    }
  }

  async function processUploadItem(uploadItem) {
    const startTime = Date.now();
    try {
      uploadItem.attempts += 1;
      uploadItem.status = 'processing';
      emit('uploadStarted', { uploadItem });
      await state.metadataManager.saveMetadata(uploadItem.mediaData);
      uploadItem.status = 'completed';
      const duration = Date.now() - startTime;
      emit('uploadSuccess', { uploadItem, duration });
      return { success: true, duration };
    } catch (error) {
      uploadItem.status = 'failed';
      uploadItem.error = error.message;
      const duration = Date.now() - startTime;
      console.error('[Upload Queue Manager] ❌ Upload failed:', {
        uploadItem,
        error: error.message,
        duration,
      });
      if (uploadItem.attempts < state.maxRetries) {
        emit('uploadRetry', { uploadItem, error, duration });
        state.uploadQueue.push(uploadItem);
      } else {
        console.error('[Upload Queue Manager] 💀 Upload permanently failed:', {
          uploadItem,
          error: error.message,
          attempts: uploadItem.attempts,
        });
      }
      emit('uploadError', { uploadItem, error, duration });
      throw error;
    }
  }

  async function processUploadBatch(batch) {
    emit('batchStarted', { batchSize: batch.length });
    const startTime = Date.now();
    const results = await Promise.allSettled(
      batch.map((uploadItem) => processUploadItem(uploadItem)),
    );
    const duration = Date.now() - startTime;
    emit('batchCompleted', { results, duration });
  }

  async function processUploadQueue() {
    if (state.isProcessing || state.uploadQueue.length === 0) {
      return;
    }
    state.isProcessing = true;

    const processNextBatch = async () => {
      if (state.uploadQueue.length === 0) {
        state.isProcessing = false;
        return;
      }
      const batch = state.uploadQueue.splice(0, state.batchSize);
      await processUploadBatch(batch);
      if (state.uploadQueue.length > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, state.retryDelay);
        });
        await processNextBatch();
      } else {
        state.isProcessing = false;
      }
    };

    await processNextBatch();
  }

  async function init(metadataManagerInstance) {
    try {
      state.metadataManager = metadataManagerInstance;
    } catch (error) {
      console.error('[Upload Queue Manager] ❌ Initialization failed:', error);
      throw error;
    }
  }

  function queueUpload(mediaData, priority = 'normal') {
    const uploadItem = {
      mediaData,
      priority,
      attempts: 0,
      status: 'queued',
      id: Date.now() + Math.random(),
    };
    state.uploadQueue.push(uploadItem);
    emit('uploadQueued', { uploadItem, priority });
    if (!state.isProcessing) {
      processUploadQueue();
    }
    return uploadItem.id;
  }

  function getQueueStatus() {
    return {
      stats: {
        totalUploads: 0, // No performance monitor, so no stats to report
      },
      queueLength: state.uploadQueue.length,
      isProcessing: state.isProcessing,
    };
  }

  function clearQueue() {
    const clearedCount = state.uploadQueue.length;
    state.uploadQueue = [];
    return clearedCount;
  }

  function setUploadDelay(delay) {
    state.retryDelay = delay;
  }

  function setBatchSize(size) {
    state.batchSize = size;
  }

  function setRetryAttempts(attempts) {
    state.maxRetries = attempts;
  }

  function on(event, callback) {
    if (!state.listeners.has(event)) {
      state.listeners.set(event, []);
    }
    state.listeners.get(event).push(callback);
  }

  function off(event, callback) {
    if (state.listeners.has(event)) {
      const listeners = state.listeners.get(event);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  return {
    init,
    queueUpload,
    processUploadQueue,
    getQueueStatus,
    clearQueue,
    setUploadDelay,
    setBatchSize,
    setRetryAttempts,
    on,
    off,
  };
}