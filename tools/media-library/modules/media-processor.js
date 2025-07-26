/* eslint-disable no-use-before-define */
/**
 * Media Processor - Handles media extraction, normalization, and processing
 * Provides comprehensive media processing capabilities for HTML content
 */

import createMetadataManager from '../services/metadata-manager.js';
import createPersistenceManager from '../services/persistence-manager.js';
import isExternalMedia from './external-media.js';
import {
  isValidAltText,
  isProbablyUrl,
  determineMediaType,
  normalizeMediaSrc,
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
    try {
      state.config = docAuthoringService.getConfig();
      state.metadataManager = createMetadataManager(docAuthoringService, '/.media/media.json');
      state.persistenceManager = createPersistenceManager();

      await state.metadataManager.init(state.config);
      await state.persistenceManager.init();

      state.isInitialized = true;

      console.log('[Media Processor] ✅ Initialized successfully');
      return true;
    } catch (error) {
      console.error('[Media Processor] ❌ Initialization failed:', error);
      throw error;
    }
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

    console.log('[Media Processor] 📥 Queueing', media.length, 'media items for batch processing');
    await state.persistenceManager.queueMediaForProcessing(media, state.currentSessionId);
    const queueItems = await state.persistenceManager.getProcessingQueue(state.currentSessionId);
    const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);
    console.log('[Media Processor] 📊 Total queued items:', totalQueuedItems);

    if (state.onMediaUpdatedCallback) {
      const allMedia = await getMediaData();
      state.onMediaUpdatedCallback(allMedia);
    }
    return { queued: media.length, totalQueued: totalQueuedItems };
  }

  async function convertQueueToUploadBatches() {
    console.log('[Media Processor] 🔄 Converting queue to upload batches...');
    const queueItems = await state.persistenceManager.getProcessingQueue();
    console.log('[Media Processor] 📋 Found', queueItems.length, 'items in processing queue');

    const allRawMedia = queueItems.flatMap((item) => item.media || []);
    console.log('[Media Processor] 🎬 Total raw media items:', allRawMedia.length);

    // Check for duplicate sources in raw media
    const uniqueSrcs = new Set(allRawMedia.map((m) => m.src));
    console.log('[Media Processor] 🔍 Unique sources in raw media:', uniqueSrcs.size);

    // ✅ FIXED: Don't merge here, just create batches from raw media
    // The merging will happen in uploadAllBatchesToMediaJson
    const batches = createBatches(allRawMedia, 20);
    console.log('[Media Processor] 📦 Created', batches.length, 'batches');

    await Promise.all(
      batches.map(async (batch, i) => {
        const batchData = { batchNumber: i + 1, media: batch };
        console.log('[Media Processor] 💾 Creating batch', i + 1, 'with', batch.length, 'items');
        await state.persistenceManager.createUploadBatch(batchData);
      }),
    );
    console.log('[Media Processor] ✅ All batches created successfully');
  }

  async function uploadAllBatchesToMediaJson() {
    console.log('[Media Processor] 🚚 Starting batch upload to media.json...');
    const persistenceManager = createPersistenceManager();
    await persistenceManager.init();

    const pendingBatches = await persistenceManager.getPendingBatches();
    console.log('[Media Processor] 📦 Found', pendingBatches.length, 'pending batches to upload');

    if (pendingBatches.length === 0) {
      console.log('[Media Processor] ⚠️ No pending batches found - nothing to upload');
      return;
    }

    // ✅ FIXED: Collect all media from all batches first, then process in one go
    let allBatchMedia = [];
    for (let i = 0; i < pendingBatches.length; i += 1) {
      const batch = pendingBatches[i];
      allBatchMedia = [...allBatchMedia, ...batch.media];
    }

    console.log('[Media Processor] 📊 Total media items from all batches:', allBatchMedia.length);

    // Process all media in one operation
    await state.metadataManager.init(state.config);
    const existingData = await state.metadataManager.getMetadata();
    console.log('[Media Processor] 📊 Existing data from metadata manager:', existingData?.length || 0, 'items');
    console.log('[Media Processor] 📊 All batch media to merge:', allBatchMedia.length, 'items');

    const updatedMedia = await mergeMediaWithDeduplication(existingData || [], allBatchMedia);

    await state.metadataManager.saveMetadata(updatedMedia);
    console.log('[Media Processor] ✅ Successfully saved all batches to media.json');

    // Clear cache to ensure fresh data on next getMediaData call
    state.mediaDataCache = null;
    state.mediaDataCacheTimestamp = null;

    if (state.onMediaUpdatedCallback) {
      state.onMediaUpdatedCallback(updatedMedia);
      console.log('[Media Processor] 📱 UI updated with', updatedMedia.length, 'media items');
    }

    // Confirm all batches and clean up
    for (let i = 0; i < pendingBatches.length; i += 1) {
      const batch = pendingBatches[i];
      // eslint-disable-next-line no-await-in-loop
      await persistenceManager.confirmBatchUpload(batch.id, { count: batch.media.length });
      console.log('[Media Processor] ✅ Confirmed batch', i + 1, 'upload');

      // Remove processed media from the processing queue
      const processedIds = batch.media.map((m) => m.id);
      // eslint-disable-next-line no-await-in-loop
      await persistenceManager.removeMediaFromProcessingQueue(processedIds, batch.sessionId);
    }

    console.log('[Media Processor] 🎉 All batches uploaded successfully');
  }

  async function processAndUploadQueuedMedia() {
    console.log('[Media Processor] 🚀 Starting process and upload of queued media...');
    await convertQueueToUploadBatches();
    await uploadAllBatchesToMediaJson();
    console.log('[Media Processor] ✅ Process and upload completed successfully');
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
    const extractedSrcs = new Set(); // Track already extracted sources
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Extract different types of media
    const imgMedia = extractImgTags(doc);
    const pictureMedia = extractPictureImages(doc);
    const videoMedia = extractVideoSources(doc);
    const backgroundMedia = extractBackgroundImages(doc);
    const linkMedia = extractMediaLinks(doc);
    const cssMedia = extractCSSBackgrounds(doc);

    // Helper function to add media without duplicates
    const addMediaWithoutDuplicates = (mediaArray) => {
      mediaArray.forEach((item) => {
        const normalizedSrc = normalizeMediaSrc(item.src || item.url, '');
        if (!extractedSrcs.has(normalizedSrc)) {
          extractedSrcs.add(normalizedSrc);
          media.push(item);
        } else {
          console.log('[Media Processor] 🔄 Skipping duplicate media:', normalizedSrc);
        }
      });
    };

    // Add media in order of priority (img tags first, then others)
    addMediaWithoutDuplicates(imgMedia);
    addMediaWithoutDuplicates(pictureMedia);
    addMediaWithoutDuplicates(videoMedia);
    addMediaWithoutDuplicates(backgroundMedia);
    addMediaWithoutDuplicates(linkMedia);
    addMediaWithoutDuplicates(cssMedia);

    console.log('[Media Processor] 📊 Extracted', media.length, 'unique media items from HTML');
    return media;
  }

  /**
   * Normalize media array with consistent structure
   */
  async function normalizeMediaArray(mediaArray, pageUrl) {
    const normalizedMediaPromises = mediaArray.map(async (media, index) => {
      const src = normalizeMediaSrc(media.src || media.url, pageUrl);
      const isExternal = isExternalMedia(src);
      const name = media.alt && !isProbablyUrl(media.alt) && isValidAltText(media.alt)
        ? media.alt
        : extractFilenameFromUrl(src);

      // Debug: Log name generation for external media
      if (isExternal) {
        console.log('[Media Processor] 🏷️ Generated name for external media:', {
          src,
          alt: media.alt,
          generatedName: name,
        });
      }
      const id = await generateHashFromSrc(src);
      // Create unique occurrenceId using hash of pageUrl + src + index
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
          console.warn('[Media Processor] ⚠️ Error enhancing media:', error);
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
    console.log('[Media Processor] 🔄 Starting merge with deduplication:', {
      existingCount: existingMedia.length,
      newCount: newMedia.length,
    });
    const mediaMap = new Map();
    existingMedia.forEach((media) => {
      mediaMap.set(media.id, media);
    });
    console.log('[Media Processor] 📊 Existing media map size:', mediaMap.size);
    const processedMedia = await Promise.all(
      newMedia.map(async (media) => {
        const normalizedSrc = normalizeMediaSrc(media.src, media.pageUrl || '');
        const mediaId = media.id || await generateHashFromSrc(normalizedSrc);
        if (media.src !== normalizedSrc) {
          console.log('[Media Processor] 🔄 Normalized source URL:', {
            original: media.src,
            normalized: normalizedSrc,
            mediaId,
          });
        }
        return { media: { ...media, src: normalizedSrc }, mediaId };
      }),
    );
    let duplicatesFound = 0;
    let newItemsAdded = 0;
    processedMedia.forEach(({ media, mediaId }) => {
      if (mediaMap.has(mediaId)) {
        duplicatesFound += 1;
        const existing = mediaMap.get(mediaId);
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
        mediaMap.set(mediaId, merged);
      } else {
        newItemsAdded += 1;
        const normalizedMedia = validateAndCleanMedia({
          ...media,
          id: mediaId,
        });
        mediaMap.set(mediaId, normalizedMedia);
      }
    });
    const result = Array.from(mediaMap.values());
    console.log('[Media Processor] ✅ Merge completed:', {
      duplicatesFound,
      newItemsAdded,
      finalCount: result.length,
    });
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
      isExternal: media.isExternal !== undefined ? media.isExternal : isExternalMedia(media.src),
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

  /**
   * Cleanup resources
   */
  function cleanup() {
    state.isInitialized = false;
    state.listeners.clear();
    state.onMediaUpdatedCallback = null;
    state.mediaDataCache = null;
    state.mediaDataCacheTimestamp = null;
  }

  /**
   * Set callback for media updates
   */
  function setOnMediaUpdated(callback) {
    state.onMediaUpdatedCallback = callback;
    // eslint-disable-next-line no-console
    console.log('[Media Processor] 📱 Media update callback set');
  }

  /**
   * Set current session context
   */
  function setCurrentSession(sessionId, userId, browserId) {
    state.currentSessionId = sessionId;
    state.currentUserId = userId;
    state.currentBrowserId = browserId;

    // eslint-disable-next-line no-console
    console.log('[Media Processor] 🔄 Session set:', {
      sessionId,
      userId,
      browserId,
      timestamp: new Date().toISOString(),
    });
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
        console.log('[Media Processor] 📊 Returning cached media data:', state.mediaDataCache.length, 'items');
        return state.mediaDataCache;
      }

      const mediaData = await state.metadataManager.getMetadata();

      state.mediaDataCache = mediaData;
      state.mediaDataCacheTimestamp = Date.now();

      // eslint-disable-next-line no-console
      console.log('[Media Processor] 📊 Retrieved', mediaData.length, 'media items from metadata manager');
      return mediaData;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Media Processor] ❌ Error getting media data:', error);
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

    try {
      // eslint-disable-next-line no-console
      console.log('[Media Processor] 🔄 Syncing', mediaData.length, 'media items');

      const existingData = await state.metadataManager.getMetadata();
      const mergedMedia = await mergeMediaWithDeduplication(existingData || [], mediaData);

      await state.metadataManager.saveMetadata(mergedMedia);

      state.mediaDataCache = mergedMedia;
      state.mediaDataCacheTimestamp = Date.now();

      if (state.onMediaUpdatedCallback) {
        state.onMediaUpdatedCallback(mergedMedia);
      }

      // eslint-disable-next-line no-console
      console.log('[Media Processor] ✅ Media data synced successfully');
      return mergedMedia;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Media Processor] ❌ Error syncing media data:', error);
      throw error;
    }
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