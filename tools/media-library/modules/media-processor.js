/* eslint-disable no-use-before-define */
/**
 * Media Processor - Handles media extraction, normalization, and processing
 * Provides comprehensive media processing capabilities for HTML content
 */

import createMetadataManager from '../services/metadata-manager.js';
import createPersistenceManager from '../services/persistence-manager.js';

import {
  isValidAltText,
  isProbablyUrl,
  determineMediaType,
  extractFilenameFromUrl,
  generateHashFromSrc,
  generateOccurrenceId,
} from '../services/media-worker-utils.js';

export default function createMediaProcessor() {
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
    onMediaUpdatedCallback: null,
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
  async function init(docAuthoringService) {
    state.config = docAuthoringService.getConfig();
    state.metadataManager = createMetadataManager(docAuthoringService, '/.media/media.json');
    state.persistenceManager = createPersistenceManager();
    await state.metadataManager.init(state.config);
    await state.persistenceManager.init();
    await initializeDeduplicationCache();
    state.isInitialized = true;
    return true;
  }

  /**
   * Process media from HTML content
   */
  async function processMediaFromHTML(htmlContent, pageUrl) {
    if (!state.isInitialized) {
      throw new Error('Media processor not initialized');
    }

    try {
      const startTime = Date.now();
      const extractedMedia = extractMediaFromHTML(htmlContent);
      const normalizedMedia = await normalizeMediaArray(extractedMedia, pageUrl);
      const processedMedia = await enhanceMediaWithMetadata(normalizedMedia);

      // Update stats
      state.stats.totalProcessed += 1;
      state.stats.totalMedia += processedMedia.length;
      state.stats.processingTime += Date.now() - startTime;

      if (processedMedia.length > 0) {
        await state.metadataManager.updateMetadata(processedMedia);
      }

      if (state.onMediaUpdatedCallback && processedMedia.length > 0) {
        const allMedia = await getMediaData();
        state.onMediaUpdatedCallback(allMedia);
      }

      emit('mediaProcessed', {
        pageUrl,
        mediaCount: processedMedia.length,
        processingTime: Date.now() - startTime,
      });

      return processedMedia;
    } catch (error) {
      state.stats.totalErrors += 1;
      // eslint-disable-next-line no-console
      console.error('[Media Processor] ❌ Error processing media:', error);
      throw error;
    }
  }

  async function queueMediaForBatchProcessing(media) {
    if (!state.isInitialized) {
      throw new Error('Media processor not initialized');
    }

    if (!state.currentSessionId) {
      throw new Error('No active session for batch processing');
    }

    await state.persistenceManager.queueMediaForProcessing(media, state.currentSessionId);
    const queueItems = await state.persistenceManager.getProcessingQueue(state.currentSessionId);
    const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);

    if (state.onMediaUpdatedCallback) {
      const allMedia = await getMediaData();
      state.onMediaUpdatedCallback(allMedia);
    }
    return { queued: media.length, totalQueued: totalQueuedItems };
  }

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

  async function uploadAllBatchesToMediaJson() {
    const persistenceManager = createPersistenceManager();
    await persistenceManager.init();
    const pendingBatches = await persistenceManager.getPendingBatches();
    if (pendingBatches.length === 0) {
      return;
    }
    const allBatchMedia = pendingBatches.flatMap((batch) => batch.media);
    await state.metadataManager.init(state.config);
    const existingData = await state.metadataManager.getMetadata();
    const updatedMedia = await mergeMediaWithDeduplication(existingData || [], allBatchMedia);
    await state.metadataManager.saveMetadata(updatedMedia);
    state.mediaDataCache = null;
    state.mediaDataCacheTimestamp = null;
    if (state.onMediaUpdatedCallback) {
      state.onMediaUpdatedCallback(updatedMedia);
    }
    const batchPromises = pendingBatches.map(async (batch) => {
      await persistenceManager.confirmBatchUpload(batch.id, { count: batch.media.length });
      const processedIds = batch.media.map((m) => m.id);
      await persistenceManager.removeMediaFromProcessingQueue(processedIds, batch.sessionId);
    });
    await Promise.all(batchPromises);
  }

  async function processAndUploadQueuedMedia() {
    setTimeout(async () => {
      await convertQueueToUploadBatches();
      await uploadAllBatchesToMediaJson();
    }, 0);
  }

  function createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Extract media from HTML content
   */
  function extractMediaFromHTML(htmlContent) {
    const media = [];
    const extractedSrcs = new Set();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const imgMedia = extractImgTags(doc);
    const pictureMedia = extractPictureImages(doc);
    const videoMedia = extractVideoSources(doc);
    const backgroundMedia = extractBackgroundImages(doc);
    const linkMedia = extractMediaLinks(doc);
    const cssMedia = extractCSSBackgrounds(doc);
    const addMediaWithoutDuplicates = (mediaArray) => {
      mediaArray.forEach((item) => {
        const src = item.src || item.url;
        if (!extractedSrcs.has(src)) {
          extractedSrcs.add(src);
          media.push(item);
        }
      });
    };
    addMediaWithoutDuplicates(imgMedia);
    addMediaWithoutDuplicates(pictureMedia);
    addMediaWithoutDuplicates(videoMedia);
    addMediaWithoutDuplicates(backgroundMedia);
    addMediaWithoutDuplicates(linkMedia);
    addMediaWithoutDuplicates(cssMedia);
    return media;
  }

  /**
   * Normalize media array with consistent structure
   */
  async function normalizeMediaArray(mediaArray, pageUrl) {
    const normalizedMediaPromises = mediaArray.map(async (media, index) => {
      const src = media.src || media.url;
      const isExternal = media.isExternal !== undefined ? media.isExternal : false;
      const name = media.alt && !isProbablyUrl(media.alt) && isValidAltText(media.alt)
        ? media.alt
        : extractFilenameFromUrl(src);
      const id = await generateHashFromSrc(src);
      const occurrenceId = await generateOccurrenceId(pageUrl, src, index + 1);
      const normalizedMediaItem = {
        id,
        src,
        name,
        alt: media.alt || '',
        title: media.title || '',
        type: determineMediaType(src),
        context: media.context || '',
        pageUrl,
        discoveredAt: new Date().toISOString(),
        usedIn: [pageUrl],
        isExternal,
        occurrences: [
          {
            occurrenceId,
            pagePath: pageUrl,
            altText: media.alt,
            hasAltText: media.hasAltText || !!(media.alt && media.alt.trim()),
            occurrenceType: media.occurrenceType || media.type,
            contextualText: media.contextualText || '',
            context: media.context || '',
          },
        ],
        metadata: {
          width: media.dimensions?.width || media.width || null,
          height: media.dimensions?.height || media.height || null,
          size: media.size || null,
          format: media.format || null,
        },
      };
      return normalizedMediaItem;
    });
    return Promise.all(normalizedMediaPromises);
  }

  /**
   * Enhance media with additional metadata
   */
  async function extractImageMetadata(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
          size: null,
          format: src.split('.').pop() || 'unknown',
        });
      };
      img.onerror = () => {
        resolve({
          width: null,
          height: null,
          size: null,
          format: src.split('.').pop() || 'unknown',
        });
      };
      img.src = src;
    });
  }

  /**
     * Enhance media array with extracted image metadata.
     * Uses Promise.all to avoid await-in-loop and generator usage.
     */
  async function enhanceMediaWithMetadata(mediaArray) {
    if (!Array.isArray(mediaArray) || !mediaArray.length) return [];
    const enhancements = await Promise.all(
      mediaArray.map(async (media) => {
        try {
          const metadata = await extractImageMetadata(media.src);
          return {
            ...media,
            metadata: {
              width: metadata.width,
              height: metadata.height,
              size: metadata.size,
              format: metadata.format,
            },
          };
        } catch (error) {
          return media;
        }
      }),
    );
    return enhancements;
  }

  /**
   * Merge media arrays with deduplication
   */
  async function mergeMediaWithDeduplication(existingMedia, newMedia) {
    const mediaMap = new Map();
    existingMedia.forEach((media) => {
      mediaMap.set(media.id, media);
      state.deduplicationCache.set(media.src, media.id);
    });
    const processedMedia = await Promise.all(
      newMedia.map(async (media) => {
        const normalizedSrc = media.src;
        const mediaId = media.id || await generateHashFromSrc(normalizedSrc);
        return { media: { ...media, src: normalizedSrc }, mediaId };
      }),
    );
    processedMedia.forEach(({ media, mediaId }) => {
      const existingId = state.deduplicationCache.get(media.src);
      if (existingId && mediaMap.has(existingId)) {
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
        const merged = {
          ...existing,
          usedIn: mergedUsedIn,
          occurrences: Array.from(occurrenceMap.values()),
        };
        mediaMap.set(existingId, merged);
      } else {
        const normalizedMedia = validateAndCleanMedia({
          ...media,
          id: mediaId,
        });
        mediaMap.set(mediaId, normalizedMedia);
        state.deduplicationCache.set(media.src, mediaId);
      }
    });
    const result = Array.from(mediaMap.values());
    return result;
  }

  /**
   * Validate and clean media data structure
   */
  function validateAndCleanMedia(media) {
    return {
      id: media.id || null,
      src: media.src || '',
      name: media.name || media.alt || extractFilenameFromUrl(media.src),
      alt: media.alt || '',
      title: media.title || '',
      type: media.type || determineMediaType(media.src),
      context: media.context || '',
      pageUrl: media.pageUrl || '',
      discoveredAt: media.discoveredAt || new Date().toISOString(),
      usedIn: Array.isArray(media.usedIn) ? media.usedIn : [],
      isExternal: media.isExternal !== undefined ? media.isExternal : false,
      occurrences: Array.isArray(media.occurrences) ? media.occurrences.map(cleanOccurrence) : [],
      metadata: {
        width: media.metadata?.width || media.dimensions?.width || null,
        height: media.metadata?.height || media.dimensions?.height || null,
        size: media.metadata?.size || null,
        format: media.metadata?.format || null,
      },
    };
  }

  /**
   * Clean occurrence data structure
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
   * Extract img tags from document
   */
  function extractImgTags(doc) {
    const images = doc.querySelectorAll('img');
    const media = [];

    images.forEach((img) => {
      const src = img.getAttribute('src');
      if (src) {
        media.push({
          src,
          alt: img.getAttribute('alt') || '',
          title: img.getAttribute('title') || '',
          width: img.getAttribute('width'),
          height: img.getAttribute('height'),
          context: getElementContext(img),
        });
      }
    });

    return media;
  }

  /**
   * Extract picture images from document
   */
  function extractPictureImages(doc) {
    const pictures = doc.querySelectorAll('picture');
    const media = [];

    pictures.forEach((picture) => {
      const img = picture.querySelector('img');
      if (img) {
        const src = img.getAttribute('src');
        if (src) {
          media.push({
            src,
            alt: img.getAttribute('alt') || '',
            title: img.getAttribute('title') || '',
            width: img.getAttribute('width'),
            height: img.getAttribute('height'),
            context: getElementContext(picture),
          });
        }
      }
    });

    return media;
  }

  /**
   * Extract video sources from document
   */
  function extractVideoSources(doc) {
    const videos = doc.querySelectorAll('video');
    const media = [];

    videos.forEach((video) => {
      const sources = video.querySelectorAll('source');
      sources.forEach((source) => {
        const src = source.getAttribute('src');
        if (src) {
          media.push({
            src,
            alt: video.getAttribute('alt') || '',
            title: video.getAttribute('title') || '',
            context: getElementContext(video),
          });
        }
      });
    });
    return media;
  }

  /**
   * Extract background images from document
   */
  function extractBackgroundImages(doc) {
    const elements = doc.querySelectorAll('*');
    const media = [];

    elements.forEach((element) => {
      const { style } = element;
      if (style.backgroundImage && style.backgroundImage !== 'none') {
        const matches = style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/g);
        if (matches) {
          matches.forEach((match) => {
            const src = match.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
            if (src) {
              media.push({
                src,
                context: getElementContext(element),
              });
            }
          });
        }
      }
    });

    return media;
  }

  /**
   * Extract media links from document
   */
  function extractMediaLinks(doc) {
    const links = doc.querySelectorAll('a[href]');
    const media = [];

    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && isMediaFile(href)) {
        media.push({
          src: href,
          alt: link.getAttribute('alt') || '',
          title: link.getAttribute('title') || '',
          context: getElementContext(link),
        });
      }
    });

    return media;
  }

  /**
   * Extract CSS backgrounds from document
   */
  function extractCSSBackgrounds(doc) {
    const styleSheets = doc.querySelectorAll('style');
    const media = [];

    styleSheets.forEach((style) => {
      const { textContent } = style;
      const urlMatches = textContent.match(/url\(['"]?([^'"]+)['"]?\)/g);

      if (urlMatches) {
        urlMatches.forEach((match) => {
          const src = match.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
          if (src && isMediaFile(src)) {
            media.push({
              src,
              context: 'CSS background',
            });
          }
        });
      }
    });

    return media;
  }

  /**
   * Check if URL points to a media file
   */
  function isMediaFile(url) {
    const mediaExtensions = [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp',
      'mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv',
      'mp3', 'wav', 'ogg', 'aac', 'flac',
    ];

    const extension = url.split('.').pop()?.toLowerCase();
    return mediaExtensions.includes(extension);
  }

  /**
   * Get context information for an element
   */
  function getElementContext(element) {
    const context = [];

    // Get parent heading
    const heading = element.closest('h1, h2, h3, h4, h5, h6');
    if (heading) {
      context.push(heading.textContent.trim().substring(0, 30));
    }

    // Get parent section or article
    const section = element.closest('section, article, div[class*="content"]');
    if (section) {
      const sectionText = section.textContent.trim().substring(0, 50);
      if (sectionText) {
        context.push(sectionText);
      }
    }

    return context.join(' - ');
  }

  /**
   * Add event listener
   */
  function on(event, callback) {
    if (!state.listeners.has(event)) {
      state.listeners.set(event, []);
    }
    state.listeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   */
  function off(event, callback) {
    const callbacks = state.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to listeners
   */
  function emit(event, data) {
    const callbacks = state.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  /**
   * Get processing statistics
   */
  function getStats() {
    return { ...state.stats };
  }

  async function initializeDeduplicationCache() {
    try {
      const existingData = await state.metadataManager.getMetadata();
      if (existingData && Array.isArray(existingData)) {
        existingData.forEach((media) => {
          if (media.src && media.id) {
            state.deduplicationCache.set(media.src, media.id);
          }
        });
      }
    } catch (error) {
      state.deduplicationCache.clear();
    }
  }
  function cleanup() {
    state.isInitialized = false;
    state.listeners.clear();
    state.onMediaUpdatedCallback = null;
    state.mediaDataCache = null;
    state.mediaDataCacheTimestamp = null;
    state.deduplicationCache.clear();
  }

  /**
   * Set callback for media updates
   */
  function setOnMediaUpdated(callback) {
    state.onMediaUpdatedCallback = callback;
  }

  /**
   * Set current session context
   */
  function setCurrentSession(sessionId, userId, browserId) {
    state.currentSessionId = sessionId;
    state.currentUserId = userId;
    state.currentBrowserId = browserId;
  }

  /**
   * Get all media data from metadata manager
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
   */
  async function syncMediaData(mediaData) {
    if (!state.isInitialized) {
      throw new Error('Media processor not initialized');
    }
    const existingData = await state.metadataManager.getMetadata();
    const mergedMedia = await mergeMediaWithDeduplication(existingData || [], mediaData);
    await state.metadataManager.saveMetadata(mergedMedia);
    state.mediaDataCache = mergedMedia;
    state.mediaDataCacheTimestamp = Date.now();
    if (state.onMediaUpdatedCallback) {
      state.onMediaUpdatedCallback(mergedMedia);
    }
    return mergedMedia;
  }

  return {
    init,
    processMediaFromHTML,
    queueMediaForBatchProcessing,
    convertQueueToUploadBatches,
    uploadAllBatchesToMediaJson,
    processAndUploadQueuedMedia,
    getMediaData,
    syncMediaData,
    setOnMediaUpdated,
    setCurrentSession,
    getStats,
    cleanup,
    on,
    off,
    emit,
    mergeMediaWithDeduplication,
  };
}