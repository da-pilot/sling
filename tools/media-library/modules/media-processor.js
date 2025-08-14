/* eslint-disable no-use-before-define */
/**
 * Media Processor - Handles media processing and metadata management
 * Provides media processing capabilities for batch operations and metadata management
 */

import createMetadataManager from '../services/metadata-manager.js';
import createPersistenceManager from '../services/persistence-manager.js';
import createEventEmitter from '../shared/event-emitter.js';

import {
  determineMediaType,
  extractFilenameFromUrl,
  generateHashFromSrc,
} from '../services/media-worker-utils.js';

export default function createMediaProcessor() {
  const eventEmitter = createEventEmitter('Media Processor');
  const state = {
    metadataManager: null,
    persistenceManager: null,
    config: null,
    isInitialized: false,
    processingQueue: [],
    isProcessing: false,
    currentSessionId: null,
    currentUserId: null,
    currentBrowserId: null,
    mediaDataCache: null,
    mediaDataCacheTimestamp: null,
    deduplicationCache: new Map(),
    stats: {
      totalProcessed: 0,
      totalMedia: 0,
      totalErrors: 0,
      processingTime: 0,
    },
    listeners: new Map(),
  };

  /**
   * Initialize media processor with dependencies
   */
  async function init(docAuthoringService, sessionManager, processingStateManager) {
    state.config = docAuthoringService.getConfig();
    state.metadataManager = createMetadataManager(docAuthoringService, '/.media/media.json');
    state.persistenceManager = createPersistenceManager();
    state.sessionManager = sessionManager;
    state.processingStateManager = processingStateManager;
    await state.metadataManager.init(state.config);
    await state.persistenceManager.init();
    await initializeDeduplicationCache();
    state.isInitialized = true;
    return true;
  }

  /**
   * Queue media items for batch processing
   * @param {Array} media - Array of media items to queue
   * @returns {Promise<Object>} Queue status with queued and total counts
   */
  async function queueMediaForBatchProcessing(media) {
    if (!media || media.length === 0) {
      return { queued: 0, totalQueued: 0 };
    }
    const mediaWithIds = await Promise.all(
      media.map(async (item) => {
        if (item.id) {
          return item;
        }
        const mediaId = await generateHashFromSrc(item.src);
        return { ...item, id: mediaId };
      }),
    );
    await state.persistenceManager.queueMediaForProcessing(mediaWithIds, state.currentSessionId);
    const queueItems = await state.persistenceManager.getProcessingQueue(state.currentSessionId);
    const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);
    processAndUploadQueuedMedia();
    return { queued: mediaWithIds.length, totalQueued: totalQueuedItems };
  }

  /**
   * Convert processing queue to upload batches
   * @returns {Promise<void>}
   */
  async function convertQueueToUploadBatches() {
    const queueItems = await state.persistenceManager.getProcessingQueue();
    const allRawMedia = queueItems.flatMap((item) => item.media || []);
    const batches = createBatches(allRawMedia, 20);
    await Promise.all(
      batches.map(async (batch, i) => {
        const batchData = { batchNumber: i + 1, media: batch };
        await state.persistenceManager.createUploadBatch(batchData);
      }),
    );
  }

  /**
   * Upload all pending batches to media.json sequentially
   * @returns {Promise<void>}
   */
  async function uploadAllBatchesToMediaJson() {
    let existingMedia = await state.metadataManager.getMetadata();
    const pendingBatches = await state.persistenceManager.getPendingBatches();
    const batchCount = pendingBatches.length;
    for (let i = 0; i < batchCount; i += 1) {
      const batch = pendingBatches[i];
      // eslint-disable-next-line no-await-in-loop
      const { media: mergedMedia } = await mergeMediaWithDeduplication(existingMedia, batch.media);
      // eslint-disable-next-line no-await-in-loop
      await state.metadataManager.saveMetadata(mergedMedia);
      existingMedia = mergedMedia;
      state.stats.totalProcessed += batch.media.length;
      state.stats.totalMedia = mergedMedia.length;
      // eslint-disable-next-line no-await-in-loop
      await state.persistenceManager.removeBatch(batch.id);
    }
  }

  /**
   * Process and upload queued media with processing lock
   * @returns {Promise<void>}
   */
  function processAndUploadQueuedMedia() {
    if (state.isProcessing) {
      return;
    }
    state.isProcessing = true;
    setTimeout(async () => {
      try {
        let stableCount = 0;
        const maxStableChecks = 3;
        let previousLength = 0;
        while (stableCount < maxStableChecks) {
          // eslint-disable-next-line no-await-in-loop
          const queueItems = await state.persistenceManager.getProcessingQueue();
          const currentLength = queueItems.reduce(
            (sum, item) => sum + (item.media?.length || 0),
            0,
          );
          if (currentLength === previousLength) {
            stableCount += 1;
          } else {
            stableCount = 0;
          }
          previousLength = currentLength;
          if (stableCount < maxStableChecks) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
              setTimeout(resolve, 1000);
            });
          }
        }
        await convertQueueToUploadBatches();
        const pendingBatches = await state.persistenceManager.getPendingBatches();
        if (pendingBatches.length > 0) {
          await uploadAllBatchesToMediaJson();
        }
      } catch (error) {
        console.error('[Media Processor] ❌ Error processing and uploading queued media:', error);
        console.error('[Media Processor] ❌ Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
        });
      } finally {
        state.isProcessing = false;
        console.log('[Media Processor] ✅ Media processing and upload completed');
        eventEmitter.emit('mediaProcessingCompleted', {
          timestamp: Date.now(),
          sessionId: state.currentSessionId,
          stats: { ...state.stats },
        });
      }
    }, 0);
  }

  /**
   * Create batches from array with specified batch size
   * @param {Array} array - Array to split into batches
   * @param {number} batchSize - Size of each batch
   * @returns {Array<Array>} Array of batches
   */
  function createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Merge media arrays with deduplication
   * @param {Array} existingMedia - Existing media array
   * @param {Array} newMedia - New media array to merge
   * @returns {Promise<Object>} Merged media array and statistics
   */
  async function mergeMediaWithDeduplication(existingMedia, newMedia) {
    const mediaMap = new Map();
    const stats = {
      totalNew: newMedia.length,
      totalExisting: existingMedia.length,
      merged: 0,
      added: 0,
      duplicates: 0,
    };
    existingMedia.forEach((media) => {
      mediaMap.set(media.id, media);
      state.deduplicationCache.set(media.src, media.id);
    });
    const processedMedia = newMedia.map((media) => {
      const normalizedSrc = media.src;
      if (!media.id) {
        console.warn('[Media Processor] ⚠️ Media item missing ID:', media.src);
      }
      return { media: { ...media, src: normalizedSrc }, mediaId: media.id };
    });
    processedMedia.forEach(({ media, mediaId }) => {
      const existingId = state.deduplicationCache.get(media.src);
      if (existingId && mediaMap.has(existingId)) {
        stats.merged += 1;
        stats.duplicates += 1;
        const existing = mediaMap.get(existingId);
        const existingUsedIn = Array.isArray(existing.usedIn) ? existing.usedIn : [];
        const newUsedIn = Array.isArray(media.usedIn) ? media.usedIn : [];
        const mergedUsedIn = [...new Set([...existingUsedIn, ...newUsedIn])];
        const existingOccurrences = existing.occurrences || [];
        const newOccurrences = media.occurrences || [];
        const allOccurrences = [...existingOccurrences, ...newOccurrences];
        const occurrenceMap = new Map();
        allOccurrences.forEach((occurrence) => {
          const cleanOccurrenceData = {
            occurrenceId: occurrence.occurrenceId || null,
            pagePath: occurrence.pagePath || '',
            altText: occurrence.altText || '',
            hasAltText: Boolean(occurrence.altText && occurrence.altText.trim()),
            occurrenceType: occurrence.occurrenceType || 'image',
            contextualText: occurrence.contextualText || '',
            context: occurrence.context || '',
          };
          const key = cleanOccurrenceData.occurrenceId
            || `${cleanOccurrenceData.pagePath}-${cleanOccurrenceData.context}-${cleanOccurrenceData.altText}`;
          occurrenceMap.set(key, cleanOccurrenceData);
        });
        const mergedOccurrences = Array.from(occurrenceMap.values());
        const merged = {
          ...existing,
          usedIn: mergedUsedIn,
          occurrences: mergedOccurrences,
          occurrenceCount: mergedOccurrences.length,
          pageCount: mergedUsedIn.length,
          missingAltCount: mergedOccurrences.filter((o) => !o.hasAltText).length,
          hasMissingAlt: mergedOccurrences.some((o) => !o.hasAltText),
          isMultiPage: mergedUsedIn.length > 1,
          isMultiOccurrence: mergedOccurrences.length > 1,
          usageScore: mergedOccurrences.length * mergedUsedIn.length,
        };
        mediaMap.set(existingId, merged);
      } else {
        stats.added += 1;
        const normalizedMedia = validateAndCleanMedia({
          ...media,
          id: mediaId,
        });
        mediaMap.set(mediaId, normalizedMedia);
        state.deduplicationCache.set(media.src, mediaId);
      }
    });
    const result = Array.from(mediaMap.values());
    stats.final = result.length;
    return { media: result, stats };
  }

  /**
   * Validate and clean media data structure
   * @param {Object} media - Media object to validate and clean
   * @returns {Object} Cleaned and validated media object
   */
  function validateAndCleanMedia(media) {
    const occurrences = Array.isArray(media.occurrences)
      ? media.occurrences.map(cleanOccurrence)
      : [];
    const usedIn = Array.isArray(media.usedIn) ? media.usedIn : [];
    const occurrenceCount = occurrences.length;
    const pageCount = usedIn.length;
    const missingAltCount = occurrences.filter((o) => !o.hasAltText).length;
    const format = extractFormatFromUrl(media.src);
    const filename = extractFilenameFromUrl(media.src);
    return {
      id: media.id || null,
      src: media.src || '',
      name: media.name || media.alt || filename,
      alt: media.alt || '',
      title: media.title || '',
      type: media.type || determineMediaType(media.src),
      context: media.context || '',
      pageUrl: media.pageUrl || '',
      discoveredAt: media.discoveredAt || new Date().toISOString(),
      usedIn,
      isExternal: media.isExternal !== undefined ? media.isExternal : false,
      occurrences,
      occurrenceCount,
      pageCount,
      missingAltCount,
      hasMissingAlt: missingAltCount > 0,
      isMultiPage: pageCount > 1,
      isMultiOccurrence: occurrenceCount > 1,
      usageScore: occurrenceCount * pageCount,
      format,
      metadata: {
        width: media.metadata?.width || media.dimensions?.width || null,
        height: media.metadata?.height || media.dimensions?.height || null,
        size: media.metadata?.size || null,
        format: media.metadata?.format || format,
      },
    };
  }

  /**
   * Clean occurrence data structure
   * @param {Object} occurrence - Occurrence object to clean
   * @returns {Object} Cleaned occurrence object
   */
  function cleanOccurrence(occurrence) {
    return {
      occurrenceId: occurrence.occurrenceId || null,
      pagePath: occurrence.pagePath || '',
      altText: occurrence.altText || '',
      hasAltText: Boolean(occurrence.altText && occurrence.altText.trim()),
      occurrenceType: occurrence.occurrenceType || 'image',
      contextualText: occurrence.contextualText || '',
      context: occurrence.context || '',
    };
  }

  /**
   * Extract file format from URL
   * @param {string} url - URL to extract format from
   * @returns {string|null} File format or null if not found
   */
  function extractFormatFromUrl(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }
    const match = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Get processing statistics
   * @returns {Object} Processing statistics
   */
  function getStats() {
    return { ...state.stats };
  }

  /**
   * Initialize deduplication cache from existing metadata
   * @returns {Promise<void>}
   */
  async function initializeDeduplicationCache() {
    try {
      const existingData = await state.metadataManager.getMetadata();
      if (existingData && Array.isArray(existingData)) {
        existingData.forEach((media) => {
          state.deduplicationCache.set(media.src, media.id);
        });
      }
    } catch (error) {
      console.error('[Media Processor] ❌ Failed to initialize deduplication cache:', error);
    }
  }

  /**
   * Cleanup resources and reset state
   */
  function cleanup() {
    state.isInitialized = false;
    state.listeners.clear();
    state.mediaDataCache = null;
    state.mediaDataCacheTimestamp = null;
    state.deduplicationCache.clear();
  }

  /**
   * Set current session information
   * @param {string} sessionId - Session ID
   * @param {string} userId - User ID
   * @param {string} browserId - Browser ID
   */
  function setCurrentSession(sessionId, userId, browserId) {
    state.currentSessionId = sessionId;
    state.currentUserId = userId;
    state.currentBrowserId = browserId;
  }

  /**
   * Get all media data from metadata manager with caching
   * @returns {Promise<Array>} Media data array
   */
  async function getMediaData() {
    if (!state.isInitialized) {
      throw new Error('Media processor not initialized');
    }
    try {
      const cacheAge = Date.now() - (state.mediaDataCacheTimestamp || 0);
      if (state.mediaDataCache && cacheAge < 5 * 60 * 1000) {
        return state.mediaDataCache;
      }
      const mediaData = await state.metadataManager.getMetadata();
      state.mediaDataCache = mediaData;
      state.mediaDataCacheTimestamp = Date.now();
      return mediaData;
    } catch (error) {
      return [];
    }
  }

  /**
   * Synchronize external media data with internal state
   * @param {Array} mediaData - External media data to sync
   * @returns {Promise<Array>} Merged media data
   */
  async function syncMediaData(mediaData) {
    if (!state.isInitialized) {
      throw new Error('Media processor not initialized');
    }
    const existingData = await state.metadataManager.getMetadata();
    const { media: mergedMedia } = await mergeMediaWithDeduplication(
      existingData || [],
      mediaData,
    );
    await state.metadataManager.saveMetadata(mergedMedia);
    state.mediaDataCache = mergedMedia;
    state.mediaDataCacheTimestamp = Date.now();
    return mergedMedia;
  }

  /**
   * Clean up media entries for deleted documents
   * @param {Array} deletedDocumentPaths - Array of deleted document paths
   * @returns {Promise<void>}
   */
  async function cleanupMediaForDeletedDocuments(deletedDocumentPaths) {
    if (!state.isInitialized) {
      throw new Error('Media processor not initialized');
    }
    if (!deletedDocumentPaths || deletedDocumentPaths.length === 0) {
      return;
    }

    const mediaData = await getMediaData();
    if (!Array.isArray(mediaData) || mediaData.length === 0) {
      return;
    }
    let cleanedEntries = 0;
    let removedPaths = 0;
    const updatedMedia = mediaData.filter((mediaEntry) => {
      if (!mediaEntry.usedIn || !mediaEntry.occurrences) {
        return true;
      }
      const usedInPaths = mediaEntry.usedIn.split(',').map((path) => path.trim());
      const deletedPathsInEntry = usedInPaths.filter((path) => deletedDocumentPaths.includes(path));
      if (deletedPathsInEntry.length === 0) {
        return true;
      }
      if (deletedPathsInEntry.length === usedInPaths.length) {
        cleanedEntries += 1;
        return false;
      }
      const remainingPaths = usedInPaths.filter((path) => !deletedDocumentPaths.includes(path));
      const remainingOccurrences = mediaEntry.occurrences.filter(
        (occurrence) => !deletedDocumentPaths.includes(occurrence.pagePath),
      );
      mediaEntry.usedIn = remainingPaths.join(',');
      mediaEntry.occurrences = remainingOccurrences;

      removedPaths += deletedPathsInEntry.length;
      return true;
    });
    if (cleanedEntries > 0 || removedPaths > 0) {
      await state.metadataManager.saveMetadata(updatedMedia);
      state.mediaDataCache = updatedMedia;
      state.mediaDataCacheTimestamp = Date.now();
    }
  }

  /**
   * Clean up media entries for updated documents and prepare for new media
   * @param {Array} updatedDocumentPaths - Array of updated document paths
   * @returns {Promise<void>}
   */
  async function cleanupMediaForUpdatedDocuments(updatedDocumentPaths) {
    if (!state.isInitialized) {
      throw new Error('Media processor not initialized');
    }
    if (!updatedDocumentPaths || updatedDocumentPaths.length === 0) {
      return;
    }
    const mediaData = await getMediaData();
    if (!Array.isArray(mediaData) || mediaData.length === 0) {
      return;
    }
    let cleanedEntries = 0;
    let removedPaths = 0;
    const updatedMedia = mediaData.filter((mediaEntry) => {
      if (!mediaEntry.usedIn || !mediaEntry.occurrences) {
        return true;
      }
      const usedInPaths = mediaEntry.usedIn.split(',').map((path) => path.trim());
      const updatedPathsInEntry = usedInPaths.filter((path) => updatedDocumentPaths.includes(path));
      if (updatedPathsInEntry.length === 0) {
        return true;
      }
      if (updatedPathsInEntry.length === usedInPaths.length) {
        cleanedEntries += 1;
        return false;
      }
      const remainingPaths = usedInPaths.filter((path) => !updatedDocumentPaths.includes(path));
      const remainingOccurrences = mediaEntry.occurrences.filter(
        (occurrence) => !updatedDocumentPaths.includes(occurrence.pagePath),
      );
      mediaEntry.usedIn = remainingPaths.join(',');
      mediaEntry.occurrences = remainingOccurrences;
      removedPaths += updatedPathsInEntry.length;
      return true;
    });
    if (cleanedEntries > 0 || removedPaths > 0) {
      await state.metadataManager.saveMetadata(updatedMedia);
      state.mediaDataCache = updatedMedia;
      state.mediaDataCacheTimestamp = Date.now();
    }
  }

  return {
    init,
    queueMediaForBatchProcessing,
    convertQueueToUploadBatches,
    uploadAllBatchesToMediaJson,
    processAndUploadQueuedMedia,
    getMediaData,
    syncMediaData,

    setCurrentSession,
    getStats,
    cleanup,
    on: eventEmitter.on.bind(eventEmitter),
    off: eventEmitter.off.bind(eventEmitter),
    emit: eventEmitter.emit.bind(eventEmitter),
    getEventEmitter: () => eventEmitter,
    mergeMediaWithDeduplication,
    cleanupMediaForDeletedDocuments,
    cleanupMediaForUpdatedDocuments,
  };
}