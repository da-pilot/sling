/**
 * Queue Batch Processor - Handles batch processing and upload management
 */
import createEventEmitter from '../../shared/event-emitter.js';

export default function createQueueBatchProcessor() {
  const eventEmitter = createEventEmitter('Queue Batch Processor');
  const state = {
    batchProcessingPhase: {
      status: 'pending',
      totalBatches: 0,
      processedBatches: 0,
      uploadedBatches: 0,
      failedBatches: 0,
      totalMedia: 0,
      startTime: null,
      endTime: null,
    },
    batchProcessingConfig: {
      batchSize: 50,
      uploadDelay: 1000,
      maxRetries: 3,
    },
    lastBatchProcessingTime: 0,
    mediaProcessor: null,
    currentSessionId: null,
  };

  /**
   * Initialize batch processor
   * @param {Object} mediaProcessor - Media processor instance
   */
  async function init(mediaProcessor) {
    state.mediaProcessor = mediaProcessor;
  }

  /**
   * Set current session
   * @param {string} sessionId - Session ID
   */
  function setCurrentSession(sessionId) {
    state.currentSessionId = sessionId;
  }

  /**
   * Start batch processing phase
   * @returns {Promise<void>}
   */
  async function startBatchProcessingPhase() {
    state.batchProcessingPhase = {
      status: 'active',
      totalBatches: 0,
      processedBatches: 0,
      uploadedBatches: 0,
      failedBatches: 0,
      totalMedia: 0,
      startTime: Date.now(),
      endTime: null,
    };
  }

  /**
   * Upload batch sequentially
   * @param {Array} batch - Batch of media items
   * @returns {Promise<void>}
   */
  async function uploadBatchSequentially(batch) {
    if (!state.mediaProcessor) {
      throw new Error('Media processor not initialized');
    }
    const mediaPromises = batch.map(async (media) => {
      await state.mediaProcessor.processMediaImmediately(media, state.currentSessionId);
    });
    await Promise.all(mediaPromises);
  }

  /**
   * Process and upload batches
   * @param {Array} batches - Array of batches to process
   * @returns {Promise<Object>}
   */
  async function processAndUploadBatches(batches) {
    if (!state.mediaProcessor) {
      throw new Error('Media processor not initialized');
    }
    state.batchProcessingPhase.totalBatches = batches.length;
    state.batchProcessingPhase.totalMedia = batches.reduce(
      (total, batch) => total + batch.length,
      0,
    );

    const batchPromises = batches.map(async (batch, index) => {
      try {
        await uploadBatchSequentially(batch);
        state.batchProcessingPhase.processedBatches += 1;
        state.batchProcessingPhase.uploadedBatches += 1;

        console.log(`===== Batch ${index + 1} processed: ${batch.length} media items ======`);
      } catch (error) {
        state.batchProcessingPhase.failedBatches += 1;
        console.error(`===== Batch ${index + 1} failed: ${error.message} ======`);
      }
      if (index < batches.length - 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, state.batchProcessingConfig.uploadDelay);
        });
      }
    });

    await Promise.all(batchPromises);

    state.batchProcessingPhase.endTime = Date.now();

    return {
      success: state.batchProcessingPhase.failedBatches === 0,
      totalBatches: state.batchProcessingPhase.totalBatches,
      processedBatches: state.batchProcessingPhase.processedBatches,
      uploadedBatches: state.batchProcessingPhase.uploadedBatches,
      failedBatches: state.batchProcessingPhase.failedBatches,
      totalMedia: state.batchProcessingPhase.totalMedia,
    };
  }

  /**
   * Configure batch processing
   * @param {Object} batchConfig - Batch configuration
   */
  function configureBatchProcessing(batchConfig) {
    state.batchProcessingConfig = { ...state.batchProcessingConfig, ...batchConfig };
  }

  /**
   * Get batch processing configuration
   * @returns {Object}
   */
  function getBatchProcessingConfig() {
    return { ...state.batchProcessingConfig };
  }

  /**
   * Get batch processing phase status
   * @returns {Object}
   */
  function getBatchProcessingPhase() {
    return { ...state.batchProcessingPhase };
  }

  /**
   * Reset batch processing phase
   */
  function resetBatchProcessingPhase() {
    state.batchProcessingPhase = {
      status: 'pending',
      totalBatches: 0,
      processedBatches: 0,
      uploadedBatches: 0,
      failedBatches: 0,
      totalMedia: 0,
      startTime: null,
      endTime: null,
    };
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
    setCurrentSession,
    startBatchProcessingPhase,
    processAndUploadBatches,
    uploadBatchSequentially,
    configureBatchProcessing,
    getBatchProcessingConfig,
    getBatchProcessingPhase,
    resetBatchProcessingPhase,
    on,
    off,
    emit,
  };
}