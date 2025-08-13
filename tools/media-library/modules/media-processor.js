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

      state.stats.totalProcessed += 1;
      state.stats.totalMedia += processedMedia.length;
      state.stats.processingTime += Date.now() - startTime;

      if (processedMedia.length > 0) {
        await state.metadataManager.updateMetadata(processedMedia);
      }

      emit('mediaProcessed', {
        pageUrl,
        mediaCount: processedMedia.length,
        processingTime: Date.now() - startTime,
      });

      return processedMedia;
    } catch (error) {
      state.stats.totalErrors += 1;
      console.error('[Media Processor] ❌ Error processing media:', {
        pageUrl,
        error: error.message,
      });
      throw error;
    }
  }

  async function queueMediaForBatchProcessing(media) {
    if (!state.isInitialized) {
      console.error('[Media Processor] ❌ Media processor not initialized');
      throw new Error('Media processor not initialized');
    }

    if (!state.currentSessionId) {
      console.error('[Media Processor] ❌ No active session for batch processing');
      throw new Error('No active session for batch processing');
    }

    console.log('[Media Processor] 📦 Queueing media for batch processing:', {
      mediaCount: media.length,
      sessionId: state.currentSessionId,
      mediaTypes: media.map((m) => m.type || 'unknown'),
    });

    await state.persistenceManager.queueMediaForProcessing(media, state.currentSessionId);
    const queueItems = await state.persistenceManager.getProcessingQueue(state.currentSessionId);
    const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);

    console.log('[Media Processor] 📦 Media queued successfully:', {
      queued: media.length,
      totalQueued: totalQueuedItems,
      sessionId: state.currentSessionId,
    });

    // Removed media update callback to prevent browser crashes during scanning
    // Media browser will handle updates through its own polling mechanism

    processAndUploadQueuedMedia();

    return { queued: media.length, totalQueued: totalQueuedItems };
  }

  async function convertQueueToUploadBatches() {
    const queueItems = await state.persistenceManager.getProcessingQueue();
    const allRawMedia = queueItems.flatMap((item) => item.media || []);

    console.log('[Media Processor] 📦 Converting queue to batches:', {
      queueItems: queueItems.length,
      totalMedia: allRawMedia.length,
    });

    const batches = createBatches(allRawMedia, 20);

    console.log('[Media Processor] 📦 Created batches:', {
      batchCount: batches.length,
      batchSizes: batches.map((b) => b.length),
    });

    await Promise.all(
      batches.map(async (batch, i) => {
        const batchData = { batchNumber: i + 1, media: batch };
        await state.persistenceManager.createUploadBatch(batchData, state.currentSessionId);
      }),
    );
  }

  async function uploadAllBatchesToMediaJson() {
    const persistenceManager = createPersistenceManager();
    await persistenceManager.init();
    const pendingBatches = await persistenceManager.getPendingBatches();

    console.log('[Media Processor] 📤 Uploading batches to media.json:', {
      pendingBatches: pendingBatches.length,
    });

    if (pendingBatches.length === 0) {
      console.log('[Media Processor] 📤 No pending batches to upload');
      return;
    }

    const allBatchMedia = pendingBatches.flatMap((batch) => batch.media);

    console.log('[Media Processor] 📤 Processing batch media:', {
      totalMedia: allBatchMedia.length,
      mediaTypes: [...new Set(allBatchMedia.map((m) => m.type || 'unknown'))],
    });

    await state.metadataManager.init(state.config);
    const existingData = await state.metadataManager.getMetadata();

    console.log('[Media Processor] 📤 Existing media.json data:', {
      existingCount: existingData ? existingData.length : 0,
    });

    const { media: updatedMedia } = await mergeMediaWithDeduplication(
      existingData || [],
      allBatchMedia,
    );

    console.log('[Media Processor] 📤 Merged media data:', {
      updatedCount: updatedMedia.length,
      newMediaCount: allBatchMedia.length,
    });

    await state.metadataManager.saveMetadata(updatedMedia);
    state.mediaDataCache = null;
    state.mediaDataCacheTimestamp = null;

    console.log('[Media Processor] 📤 Successfully updated media.json with new data');

    // Removed media update callback to prevent browser crashes during scanning
    // Media browser will handle updates through its own polling mechanism

    const batchPromises = pendingBatches.map(async (batch) => {
      await persistenceManager.confirmBatchUpload(batch.id, { count: batch.media.length });
      const processedIds = batch.media.map((m) => m.id);
      await persistenceManager.removeMediaFromProcessingQueue(processedIds, batch.sessionId);
    });
    await Promise.all(batchPromises);

    console.log('[Media Processor] 📤 Cleaned up processing queue');
  }

  async function processAndUploadQueuedMedia() {
    console.log('[Media Processor] 🔄 Starting batch processing and upload...');
    setTimeout(async () => {
      try {
        console.log('[Media Processor] 🔄 Converting queue to upload batches...');
        await convertQueueToUploadBatches();
        console.log('[Media Processor] 🔄 Uploading batches to media.json...');
        await uploadAllBatchesToMediaJson();
        console.log('[Media Processor] ✅ Batch processing and upload completed');
      } catch (error) {
        console.error('[Media Processor] ❌ Error processing and uploading queued media:', error);
      }
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
      let name;
      if (media.alt && !isProbablyUrl(media.alt) && isValidAltText(media.alt)) {
        name = media.alt;
      } else if (media.title && !isProbablyUrl(media.title) && media.title.trim().length > 0) {
        name = media.title;
      } else {
        name = extractFilenameFromUrl(src);
      }
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
            altText: media.alt || '',
            hasAltText: Boolean(media.alt && media.alt.trim()),
            occurrenceType: determineMediaType(src),
            contextualText: media.contextualText || '',
            context: media.context || '',
          },
        ],
        metadata: {
          width: media.metadata?.width || media.dimensions?.width || null,
          height: media.metadata?.height || media.dimensions?.height || null,
          size: media.metadata?.size || null,
          format: media.metadata?.format || null,
        },
      };
      return normalizedMediaItem;
    });
    return Promise.all(normalizedMediaPromises);
  }

  /**
   * Extract image metadata
   */
  async function extractImageMetadata(src) {
    try {
      const img = new Image();
      return new Promise((resolve) => {
        img.onload = () => {
          resolve({
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        };
        img.onerror = () => {
          resolve({
            width: null,
            height: null,
          });
        };
        img.src = src;
      });
    } catch (error) {
      return {
        width: null,
        height: null,
      };
    }
  }

  /**
   * Enhance media with metadata
   */
  async function enhanceMediaWithMetadata(mediaArray) {
    const enhancedMedia = await Promise.all(
      mediaArray.map(async (media) => {
        if (media.type === 'image' && media.src) {
          const metadata = await extractImageMetadata(media.src);
          return {
            ...media,
            metadata: {
              ...media.metadata,
              ...metadata,
            },
          };
        }
        return media;
      }),
    );
    return enhancedMedia;
  }

  /**
   * Merge media arrays with deduplication
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

    console.log('[Media Processor] 🔍 Deduplication: Starting with', {
      existingCount: existingMedia.length,
      newCount: newMedia.length,
      cacheSize: state.deduplicationCache.size,
    });

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

    console.log('[Media Processor] 🔍 Deduplication: Processed media objects:', processedMedia.map(({ media, mediaId }) => ({
      src: media.src,
      id: mediaId,
      type: media.type,
      name: media.name,
      occurrences: media.occurrences?.length || 0,
    })));

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
    const imgElements = doc.querySelectorAll('img');
    return Array.from(imgElements).map((img) => {
      const src = img.src || img.getAttribute('src') || '';
      const alt = img.alt || img.getAttribute('alt') || '';
      const title = img.title || img.getAttribute('title') || '';
      const context = getElementContext(img);
      return {
        src,
        alt,
        title,
        context,
        type: 'image',
      };
    });
  }

  /**
   * Extract picture images from document
   */
  function extractPictureImages(doc) {
    const pictureElements = doc.querySelectorAll('picture');
    const pictureImages = [];
    pictureElements.forEach((picture) => {
      const img = picture.querySelector('img');
      if (img) {
        const src = img.src || img.getAttribute('src') || '';
        const alt = img.alt || img.getAttribute('alt') || '';
        const title = img.title || img.getAttribute('title') || '';
        const context = getElementContext(picture);
        pictureImages.push({
          src,
          alt,
          title,
          context,
          type: 'image',
        });
      }
    });
    return pictureImages;
  }

  /**
   * Extract video sources from document
   */
  function extractVideoSources(doc) {
    const videoElements = doc.querySelectorAll('video');
    const videoSources = [];
    videoElements.forEach((video) => {
      const sources = video.querySelectorAll('source');
      sources.forEach((source) => {
        const src = source.src || source.getAttribute('src') || '';
        if (src) {
          const context = getElementContext(video);
          videoSources.push({
            src,
            alt: video.alt || video.getAttribute('alt') || '',
            title: video.title || video.getAttribute('title') || '',
            context,
            type: 'video',
          });
        }
      });
      const videoSrc = video.src || video.getAttribute('src') || '';
      if (videoSrc) {
        const context = getElementContext(video);
        videoSources.push({
          src: videoSrc,
          alt: video.alt || video.getAttribute('alt') || '',
          title: video.title || video.getAttribute('title') || '',
          context,
          type: 'video',
        });
      }
    });
    return videoSources;
  }

  /**
   * Extract background images from document
   */
  function extractBackgroundImages(doc) {
    const backgroundImages = [];
    const elementsWithBackground = doc.querySelectorAll('*[style*="background"]');
    elementsWithBackground.forEach((element) => {
      const style = element.getAttribute('style') || '';
      const backgroundMatch = style.match(/background(?:-image)?\s*:\s*url\(['"]?([^'"]+)['"]?\)/i);
      if (backgroundMatch) {
        const src = backgroundMatch[1];
        const context = getElementContext(element);
        backgroundImages.push({
          src,
          alt: element.alt || element.getAttribute('alt') || '',
          title: element.title || element.getAttribute('title') || '',
          context,
          type: 'image',
        });
      }
    });
    return backgroundImages;
  }

  /**
   * Extract media links from document
   */
  function extractMediaLinks(doc) {
    const mediaLinks = [];
    const linkElements = doc.querySelectorAll('a[href]');
    linkElements.forEach((link) => {
      const href = link.href || link.getAttribute('href') || '';
      if (isMediaFile(href)) {
        const context = getElementContext(link);
        mediaLinks.push({
          src: href,
          alt: link.alt || link.getAttribute('alt') || '',
          title: link.title || link.getAttribute('title') || '',
          context,
          type: determineMediaType(href),
        });
      }
    });
    return mediaLinks;
  }

  /**
   * Extract CSS backgrounds from document
   */
  function extractCSSBackgrounds(doc) {
    const cssBackgrounds = [];
    const styleElements = doc.querySelectorAll('style');
    styleElements.forEach((style) => {
      const cssText = style.textContent || '';
      const backgroundMatches = cssText.match(/background(?:-image)?\s*:\s*url\(['"]?([^'"]+)['"]?\)/gi);
      if (backgroundMatches) {
        backgroundMatches.forEach((match) => {
          const urlMatch = match.match(/url\(['"]?([^'"]+)['"]?\)/i);
          if (urlMatch) {
            const src = urlMatch[1];
            const context = getElementContext(style);
            cssBackgrounds.push({
              src,
              alt: '',
              title: '',
              context,
              type: 'image',
            });
          }
        });
      }
    });
    return cssBackgrounds;
  }

  /**
   * Check if URL is a media file
   */
  function extractFormatFromUrl(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }
    const match = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    return match ? match[1].toLowerCase() : null;
  }
  function isMediaFile(url) {
    if (!url) return false;
    const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.webm', '.ogg', '.mp3', '.wav'];
    const lowerUrl = url.toLowerCase();
    return mediaExtensions.some((ext) => lowerUrl.includes(ext));
  }

  /**
   * Get element context
   */
  function getElementContext(element) {
    const context = [];
    let current = element;
    while (current && current !== element.ownerDocument.body) {
      if (current.tagName) {
        context.unshift(current.tagName.toLowerCase());
      }
      current = current.parentElement;
    }
    return context.join(' > ');
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
   * Initialize deduplication cache
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
   * Cleanup resources
   */
  function cleanup() {
    state.isInitialized = false;
    state.listeners.clear();
    state.onMediaUpdatedCallback = null;
    state.mediaDataCache = null;
    state.mediaDataCacheTimestamp = null;
    state.deduplicationCache.clear();
  }

  /**
   * Set media updated callback
   */
  function setOnMediaUpdated(callback) {
    state.onMediaUpdatedCallback = callback;
  }

  /**
   * Set current session
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
    const { media: mergedMedia } = await mergeMediaWithDeduplication(
      existingData || [],
      mediaData,
    );
    await state.metadataManager.saveMetadata(mergedMedia);
    state.mediaDataCache = mergedMedia;
    state.mediaDataCacheTimestamp = Date.now();
    // Removed media update callback to prevent browser crashes during scanning
    // Media browser will handle updates through its own polling mechanism
    return mergedMedia;
  }

  /**
   * Process media immediately
   * @param {Array} media - Media items to process
   * @param {string} sessionId - Session ID
   * @returns {Promise<void>}
   */
  async function processMediaImmediately(media, sessionId) {
    if (!state.isInitialized) {
      throw new Error('Media processor not initialized');
    }
    if (!media || !Array.isArray(media)) {
      return;
    }
    if (sessionId) {
      setCurrentSession(sessionId, state.currentUserId, state.currentBrowserId);
    }
    await syncMediaData(media);
  }

  /**
   * Check if media is available
   * @returns {Promise<boolean>}
   */
  async function checkMediaAvailable() {
    if (!state.isInitialized) {
      return false;
    }
    try {
      const mediaData = await getMediaData();
      return Array.isArray(mediaData) && mediaData.length > 0;
    } catch (error) {
      return false;
    }
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
    console.log('[Media Processor] 🔍 [CLEANUP] Starting cleanup for deleted documents:', {
      deletedCount: deletedDocumentPaths.length,
      deletedPaths: deletedDocumentPaths,
    });
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
        console.log('[Media Processor] 🔍 [CLEANUP] Removing entire media entry:', {
          mediaId: mediaEntry.id,
          usedIn: usedInPaths,
        });
        cleanedEntries += 1;
        return false;
      }
      const remainingPaths = usedInPaths.filter((path) => !deletedDocumentPaths.includes(path));
      const remainingOccurrences = mediaEntry.occurrences.filter(
        (occurrence) => !deletedDocumentPaths.includes(occurrence.pagePath),
      );
      mediaEntry.usedIn = remainingPaths.join(',');
      mediaEntry.occurrences = remainingOccurrences;
      console.log('[Media Processor] 🔍 [CLEANUP] Updated media entry:', {
        mediaId: mediaEntry.id,
        removedPaths: deletedPathsInEntry,
        remainingPaths,
      });
      removedPaths += deletedPathsInEntry.length;
      return true;
    });
    if (cleanedEntries > 0 || removedPaths > 0) {
      await state.metadataManager.saveMetadata(updatedMedia);
      state.mediaDataCache = updatedMedia;
      state.mediaDataCacheTimestamp = Date.now();
      console.log('[Media Processor] 🔍 [CLEANUP] Cleanup completed:', {
        cleanedEntries,
        removedPaths,
        remainingEntries: updatedMedia.length,
      });
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
        console.log('[Media Processor] 🔍 [UPDATE] Removing entire media entry (only used in updated docs):', {
          mediaId: mediaEntry.id,
          usedIn: usedInPaths,
        });
        cleanedEntries += 1;
        return false;
      }
      const remainingPaths = usedInPaths.filter((path) => !updatedDocumentPaths.includes(path));
      const remainingOccurrences = mediaEntry.occurrences.filter(
        (occurrence) => !updatedDocumentPaths.includes(occurrence.pagePath),
      );
      mediaEntry.usedIn = remainingPaths.join(',');
      mediaEntry.occurrences = remainingOccurrences;
      console.log('[Media Processor] 🔍 [UPDATE] Updated media entry:', {
        mediaId: mediaEntry.id,
        removedPaths: updatedPathsInEntry,
        remainingPaths,
      });
      removedPaths += updatedPathsInEntry.length;
      return true;
    });
    if (cleanedEntries > 0 || removedPaths > 0) {
      await state.metadataManager.saveMetadata(updatedMedia);
      state.mediaDataCache = updatedMedia;
      state.mediaDataCacheTimestamp = Date.now();
      console.log('[Media Processor] 🔍 [UPDATE] Cleanup completed:', {
        cleanedEntries,
        removedPaths,
        remainingEntries: updatedMedia.length,
      });
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
    processMediaImmediately,
    checkMediaAvailable,
    setOnMediaUpdated,
    setCurrentSession,
    getStats,
    cleanup,
    on,
    off,
    emit,
    mergeMediaWithDeduplication,
    cleanupMediaForDeletedDocuments,
    cleanupMediaForUpdatedDocuments,
  };
}