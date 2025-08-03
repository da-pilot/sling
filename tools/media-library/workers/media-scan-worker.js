/* eslint-disable no-use-before-define */
/**
 * Media Scan Worker - Processes pages from queue to extract media media
 * Works with document discovery worker for queue-based scanning
 */

import { createWorkerDaApi } from '../services/worker-utils.js';
import {
  isValidAltText,
  isValidMediaSrc,
  isExternalMedia,
  isMediaFile,
  determineMediaType,
  generateOccurrenceId,
  getContextualText,
} from '../services/media-worker-utils.js';

const HTML_PATTERNS = {
  IMG_TAG: /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi,
  PICTURE_TAG: /<picture[^>]*>.*?<\/picture>/gis,
  VIDEO_TAG: /<video[^>]*>([\s\S]*?)<\/video>/gi,
  SOURCE_TAG: /<source[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi,
  LINK_TAG: /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi,
  STYLE_TAG: /<style[^>]*>([\s\S]*?)<\/style>/gi,
};

const ATTRIBUTE_PATTERNS = {
  ALT: /alt\s*=\s*["']([^"']*)["']/i,
  TITLE: /title\s*=\s*["']([^"']*)["']/i,
  ARIA_LABEL: /aria-label\s*=\s*["']([^"']*)["']/i,
  WIDTH: /width\s*=\s*["']?(\d+)["']?/i,
  HEIGHT: /height\s*=\s*["']?(\d+)["']?/i,
  SRCSET: /srcset\s*=\s*["']([^"']+)["']/i,
  TYPE: /type\s*=\s*["']([^"']*)["']/i,
  MEDIA: /media\s*=\s*["']([^"']*)["']/i,
};

const CSS_PATTERNS = {
  INLINE_STYLE: /style\s*=\s*["']([^"']*background[^"']*)["']/gi,
  URL_FUNCTION: /url\(['"]?([^'")\s]+)['"]?\)/gi,
  BACKGROUND_IMAGE: /background(?:-image)?\s*:\s*url\(['"]?([^'")\s]+)['"]?\)/gi,
  SRCSET_PARSE: /([^\s,]+)(?:\s+(\d+w|\d+\.?\d*x))?/g,
};

const CONTEXT_PATTERNS = {
  BEFORE_ELEMENTS: /<([^>]+)>([^<]{10,})[^<]*$/,
  AFTER_ELEMENTS: /^[^<]*([^<]{15,})</,
  TEXT_MATCHES: />([^<]{15,})</g,
  WHITESPACE: /\s+/g,
};

const state = {
  config: null,
  daApi: null,
  sheetUtils: null,
  isRunning: false,
  isProcessing: false,
  isWaitingForDiscovery: false,
  batchSize: 10,
  processingInterval: 1000,
  discoveryWaitInterval: 10000,
  mediaJsonInitialized: false,
  stats: {
    processedPages: 0,
    totalMedia: 0,
    errors: 0,
  },
};

let config = null;
let daApi = null;

/**
 * Generate hash for occurrence ID
 */

/**
 * Initialize worker with configuration
 */
async function init(workerConfig) {
  config = workerConfig;
  daApi = createWorkerDaApi();
  await daApi.init(config);

  state.batchSize = config.batchSize || 10;
  state.processingInterval = config.processingInterval || 1000;

  return true;
}

/**
 * Validate if alt text is meaningful and not a URL or file path
 */

/**
 * Start processing pages from queue
 */
async function startQueueProcessing(sessionData = null) {
  state.isRunning = true;

  if (sessionData) {
    state.sessionId = sessionData.sessionId;
    state.userId = sessionData.userId;
    state.browserId = sessionData.browserId;
  }

  const intervalId = setInterval(async () => {
    if (state.isRunning) {
      await processNextBatch();
    } else {
      clearInterval(intervalId);
    }
  }, state.processingInterval);

  postMessage({
    type: 'queueProcessingStarted',
    data: {
      interval: state.processingInterval,
      sessionId: state.sessionId,
    },
  });
}

/**
 * Process next batch of pages from queue
 */
async function processNextBatch() {
  try {
    postMessage({
      type: 'requestBatch',
      data: { batchSize: state.batchSize },
    });
  } catch (error) {
    console.error('[Media Scan Worker] ❌ Error requesting batch:', error);
    postMessage({
      type: 'batchError',
      data: { error: error.message },
    });
  }
}

/**
 * Process a batch of pages concurrently
 */
async function processBatch(pages) {
  if (!pages || pages.length === 0) {
    return;
  }

  const batchStartTime = Date.now();
  const batchNumber = Math.floor(batchStartTime / 100) % 10000; // More unique batch number

  state.isProcessing = true;

  try {
    const scanPromises = pages.map((page) => scanPageForMedia(page));
    await Promise.all(scanPromises);

    const batchDuration = Date.now() - batchStartTime;
    const durationMs = batchDuration;

    // Count total media items from all pages in this batch
    const totalMedia = pages.reduce((sum, page) => {
      if (page.media && Array.isArray(page.media)) {
        return sum + page.media.length;
      }
      return sum;
    }, 0);

    console.log(`===== Batch ${batchNumber} completed: ${pages.length} pages, ${totalMedia} media items, took ${durationMs} ms ======`);

    postMessage({
      type: 'batchComplete',
      data: {
        processedCount: pages?.length || 0,
        sessionId: state.sessionId,
        batchNumber,
        batchDuration,
        totalMedia,
      },
    });
  } finally {
    state.isProcessing = false;
  }
}

/**
 * Scan a single page for media
 */
async function scanPageForMedia(page) {
  const startTime = Date.now();

  try {
    const html = await getPageContent(page.path);
    const media = await extractMediaFromHTML(html, page.path);
    const scanTime = Date.now() - startTime;

    // Attach media to page object for batch counting
    page.media = media;

    if (media.length > 0) {
      postMessage({
        type: 'mediaDiscovered',
        data: {
          media,
          sessionId: state.sessionId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    postMessage({
      type: 'pageScanned',
      data: {
        page: page?.path || '',
        media,
        scanTime,
        mediaCount: media.length,
        lastModified: page?.lastModified || null,
        sourceFile: page?.sourceFile || null,
        sessionId: state.sessionId,
        file: {
          org: config?.org || 'unknown',
          repo: config?.repo || 'unknown',
          path: page?.path || '',
        },
      },
    });

    postMessage({
      type: 'markPageScanned',
      data: { path: page?.path || '' },
    });
  } catch (error) {
    console.error('[Media Scan Worker] ❌ Page scan error:', {
      page: page?.path || '',
      error: error?.message || 'unknown error',
      retryCount: page?.retryCount || 0,
    });

    postMessage({
      type: 'pageScanError',
      data: {
        page: page?.path || '',
        error: error?.message || 'unknown error',
        retryCount: page?.retryCount || 0,
        sourceFile: page?.sourceFile || null,
        sessionId: state.sessionId,
        file: {
          org: config?.org || 'unknown',
          repo: config?.repo || 'unknown',
          path: page?.path || '',
        },
      },
    });
  }
}

/**
 * Get page content from DA API
 */
async function getPageContent(path) {
  if (!daApi) {
    throw new Error('DA API service not initialized');
  }
  const response = await daApi.fetchPageContent(path);
  return response;
}

async function extractMediaFromHTML(html, sourcePath) {
  const mediaMap = new Map();
  await extractImgTags(html, mediaMap, sourcePath);
  await extractPictureImages(html, mediaMap, sourcePath);
  extractBackgroundImages(html, mediaMap, sourcePath);
  extractVideoSources(html, mediaMap, sourcePath);
  await extractMediaLinks(html, mediaMap, sourcePath);
  extractCSSBackgrounds(html, mediaMap, sourcePath);

  const mediaArray = Array.from(mediaMap.values());

  return mediaArray;
}

async function extractImgTags(html, mediaMap, sourcePath) {
  let occurrenceIndex = 0;
  const matches = Array.from(html.matchAll(HTML_PATTERNS.IMG_TAG));
  await Promise.all(matches.map(async (match) => {
    const src = match[1];
    if (src && isValidMediaSrc(src)) {
      const imgTag = match[0];
      const altMatch = imgTag.match(ATTRIBUTE_PATTERNS.ALT);
      const titleMatch = imgTag.match(ATTRIBUTE_PATTERNS.TITLE);
      const widthMatch = imgTag.match(ATTRIBUTE_PATTERNS.WIDTH);
      const heightMatch = imgTag.match(ATTRIBUTE_PATTERNS.HEIGHT);
      const altText = altMatch ? altMatch[1] : '';
      const titleText = titleMatch ? titleMatch[1] : '';
      const hasAltText = isValidAltText(altText);
      const occurrenceId = await generateOccurrenceId(sourcePath, src, occurrenceIndex);
      const isExternal = isExternalMedia(src, config.org, config.repo);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText,
        hasAltText,
        occurrenceType: 'image',
        contextualText: getContextualText(html, match.index),
        context: 'img-tag',
      };
      if (mediaMap.has(src)) {
        const existing = mediaMap.get(src);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(src, {
          src,
          alt: altText,
          title: titleText,
          type: determineMediaType(src),
          usedIn: [sourcePath],
          dimensions: {
            width: widthMatch ? parseInt(widthMatch[1], 10) : null,
            height: heightMatch ? parseInt(heightMatch[1], 10) : null,
          },
          context: 'img-tag',
          occurrences: [occurrence],
          isExternal,
        });
      }
      occurrenceIndex += 1;
    }
  }));
}

async function extractPictureImages(html, mediaMap, sourcePath) {
  let occurrenceIndex = 0;
  const pictureMatches = Array.from(html.matchAll(HTML_PATTERNS.PICTURE_TAG));
  await Promise.all(pictureMatches.map(async (match) => {
    const pictureTag = match[0];
    const imgMatch = pictureTag.match(/<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/i);
    if (imgMatch) {
      const src = imgMatch[1];
      const altMatch = pictureTag.match(ATTRIBUTE_PATTERNS.ALT);
      const titleMatch = pictureTag.match(ATTRIBUTE_PATTERNS.TITLE);
      const altText = altMatch ? altMatch[1] : '';
      const titleText = titleMatch ? titleMatch[1] : '';
      const hasAltText = isValidAltText(altText);
      const occurrenceId = await generateOccurrenceId(sourcePath, src, occurrenceIndex);
      const isExternal = isExternalMedia(src, config.org, config.repo);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText,
        hasAltText,
        occurrenceType: 'image',
        contextualText: getContextualText(html, match.index),
        context: 'picture',
      };
      if (mediaMap.has(src)) {
        const existing = mediaMap.get(src);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(src, {
          src,
          alt: altText,
          title: titleText,
          type: determineMediaType(src),
          usedIn: [sourcePath],
          dimensions: {
            width: null,
            height: null,
          },
          context: 'picture',
          occurrences: [occurrence],
          isExternal,
        });
      }
      occurrenceIndex += 1;
    }
  }));
}

function extractBackgroundImages(html, mediaMap, sourcePath) {
  const styleMatches = [];
  let styleMatch;
  styleMatch = HTML_PATTERNS.STYLE_TAG.exec(html);
  while (styleMatch !== null) {
    styleMatches.push(styleMatch);
    styleMatch = HTML_PATTERNS.STYLE_TAG.exec(html);
  }
  styleMatches.forEach((match) => {
    const styleContent = match[1];
    extractBgImagesFromStyle(styleContent, mediaMap, sourcePath);
  });
  const inlineMatches = [];
  let inlineMatch;
  inlineMatch = CSS_PATTERNS.INLINE_STYLE.exec(html);
  while (inlineMatch !== null) {
    inlineMatches.push(inlineMatch);
    inlineMatch = CSS_PATTERNS.INLINE_STYLE.exec(html);
  }
  inlineMatches.forEach((match) => {
    const inlineStyle = match[1];
    extractBgImagesFromStyle(inlineStyle, mediaMap, sourcePath);
  });
}

function extractVideoSources(html, mediaMap, sourcePath) {
  let videoMatch;
  let occurrenceIndex = 0;
  videoMatch = HTML_PATTERNS.VIDEO_TAG.exec(html);
  while (videoMatch !== null) {
    const videoContent = videoMatch[0];
    let sourceMatch;
    sourceMatch = HTML_PATTERNS.SOURCE_TAG.exec(videoContent);
    while (sourceMatch !== null) {
      const src = sourceMatch[1];
      if (src && isValidMediaSrc(src)) {
        const sourceTag = sourceMatch[0];
        const typeMatch = sourceTag.match(ATTRIBUTE_PATTERNS.TYPE);
        const mediaMatch = sourceTag.match(ATTRIBUTE_PATTERNS.MEDIA);
        const occurrenceId = generateOccurrenceId(sourcePath, src, occurrenceIndex);
        const occurrence = {
          occurrenceId,
          pagePath: sourcePath,
          altText: '',
          hasAltText: false,
          occurrenceType: 'video',
          contextualText: getContextualText(html, videoMatch.index),
          context: 'video-source',
        };
        if (mediaMap.has(src)) {
          const existing = mediaMap.get(src);
          existing.occurrences.push(occurrence);
          existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
        } else {
          mediaMap.set(src, {
            src,
            alt: '',
            title: '',
            type: 'video',
            usedIn: [sourcePath],
            dimensions: {
              width: null,
              height: null,
            },
            context: 'video-source',
            occurrences: [occurrence],
            metadata: {
              type: typeMatch ? typeMatch[1] : null,
              media: mediaMatch ? mediaMatch[1] : null,
            },
          });
        }
        occurrenceIndex += 1;
      }
      sourceMatch = HTML_PATTERNS.SOURCE_TAG.exec(videoContent);
    }
    videoMatch = HTML_PATTERNS.VIDEO_TAG.exec(html);
  }
}

async function extractMediaLinks(html, mediaMap, sourcePath) {
  let occurrenceIndex = 0;
  const matches = Array.from(html.matchAll(HTML_PATTERNS.LINK_TAG));
  await Promise.all(matches.map(async (match) => {
    const href = match[1];
    if (href && isMediaFile(href)) {
      const linkTag = match[0];
      const titleMatch = linkTag.match(ATTRIBUTE_PATTERNS.TITLE);
      const ariaLabelMatch = linkTag.match(ATTRIBUTE_PATTERNS.ARIA_LABEL);
      const titleText = titleMatch ? titleMatch[1] : '';
      const ariaLabelText = ariaLabelMatch ? ariaLabelMatch[1] : '';
      const hasAltText = isValidAltText(titleText) || isValidAltText(ariaLabelText);
      const occurrenceId = await generateOccurrenceId(sourcePath, href, occurrenceIndex);
      const isExternal = isExternalMedia(href, config.org, config.repo);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText: titleText || ariaLabelText,
        hasAltText,
        occurrenceType: 'link',
        contextualText: getContextualTextForLink(html, match.index, match.index + linkTag.length),
        context: isExternal ? 'external-link' : 'internal-link',
      };
      if (mediaMap.has(href)) {
        const existing = mediaMap.get(href);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(href, {
          src: href,
          alt: titleText || ariaLabelText,
          title: titleText,
          ariaLabel: ariaLabelText,
          type: determineMediaType(href),
          usedIn: [sourcePath],
          dimensions: {
            width: null,
            height: null,
          },
          context: isExternal ? 'external-link' : 'internal-link',
          occurrences: [occurrence],
          isExternal,
        });
      }
      occurrenceIndex += 1;
    }
  }));
}

async function extractCSSBackgrounds(html, mediaMap, sourcePath) {
  let occurrenceIndex = 0;
  const styleMatches = Array.from(html.matchAll(CSS_PATTERNS.INLINE_STYLE));
  await Promise.all(styleMatches.map(async (match) => {
    const styleContent = match[1];
    const urlMatches = Array.from(styleContent.matchAll(CSS_PATTERNS.URL_FUNCTION));
    await Promise.all(urlMatches.map(async (urlMatch) => {
      const url = urlMatch[1];
      if (url && isMediaFile(url)) {
        const occurrenceId = generateOccurrenceId(sourcePath, url, occurrenceIndex);
        const occurrence = {
          occurrenceId,
          pagePath: sourcePath,
          altText: '',
          hasAltText: false,
          occurrenceType: 'image',
          contextualText: 'CSS background image',
          context: 'css-background',
        };
        if (mediaMap.has(url)) {
          const existing = mediaMap.get(url);
          existing.occurrences.push(occurrence);
          existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
        } else {
          mediaMap.set(url, {
            src: url,
            alt: '',
            title: '',
            type: determineMediaType(url),
            usedIn: [sourcePath],
            dimensions: {
              width: null,
              height: null,
            },
            context: 'css-background',
            occurrences: [occurrence],
            isExternal: isExternalMedia(url, config.org, config.repo),
          });
        }
        occurrenceIndex += 1;
      }
    }));
  }));
  const backgroundMatches = Array.from(html.matchAll(CSS_PATTERNS.BACKGROUND_IMAGE));
  await Promise.all(backgroundMatches.map(async (match) => {
    const url = match[1];
    if (url && isMediaFile(url)) {
      const occurrenceId = generateOccurrenceId(sourcePath, url, occurrenceIndex);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText: '',
        hasAltText: false,
        occurrenceType: 'image',
        contextualText: 'CSS background image',
        context: 'css-background',
      };
      if (mediaMap.has(url)) {
        const existing = mediaMap.get(url);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(url, {
          src: url,
          alt: '',
          title: '',
          type: determineMediaType(url),
          usedIn: [sourcePath],
          dimensions: {
            width: null,
            height: null,
          },
          context: 'css-background',
          occurrences: [occurrence],
          isExternal: isExternalMedia(url, config.org, config.repo),
        });
      }
      occurrenceIndex += 1;
    }
  }));
}

function extractBgImagesFromStyle(style, mediaMap, sourcePath) {
  let bgMatch;
  let occurrenceIndex = 0;
  bgMatch = CSS_PATTERNS.BACKGROUND_IMAGE.exec(style);
  while (bgMatch !== null) {
    const url = bgMatch[1];
    if (url && isMediaFile(url)) {
      const occurrenceId = generateOccurrenceId(sourcePath, url, occurrenceIndex);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText: '',
        hasAltText: false,
        occurrenceType: 'background',
        contextualText: 'CSS background image',
        context: 'css-background',
      };
      if (mediaMap.has(url)) {
        const existing = mediaMap.get(url);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(url, {
          src: url,
          alt: '',
          title: '',
          type: determineMediaType(url),
          usedIn: [sourcePath],
          dimensions: {
            width: null,
            height: null,
          },
          context: 'css-background',
          occurrences: [occurrence],
        });
      }
      occurrenceIndex += 1;
    }
    bgMatch = CSS_PATTERNS.BACKGROUND_IMAGE.exec(style);
  }
}

function getContextualTextForLink(html, linkStartIndex, linkEndIndex, maxLength = 300) {
  const beforeText = html.substring(Math.max(0, linkStartIndex - maxLength), linkStartIndex);
  const afterText = html.substring(linkEndIndex, Math.min(html.length, linkEndIndex + maxLength));
  let contextualText = '';
  const beforeElements = beforeText.match(CONTEXT_PATTERNS.BEFORE_ELEMENTS);
  if (beforeElements && beforeElements[2]) {
    contextualText = beforeElements[2].trim();
  }
  if (!contextualText) {
    const afterElements = afterText.match(CONTEXT_PATTERNS.AFTER_ELEMENTS);
    if (afterElements && afterElements[1]) {
      contextualText = afterElements[1].trim();
    }
  }
  if (!contextualText) {
    const nearbyText = beforeText + afterText;
    const textMatches = nearbyText.match(CONTEXT_PATTERNS.TEXT_MATCHES);
    if (textMatches && textMatches.length > 0) {
      const lastMatch = textMatches[textMatches.length - 1];
      const textContent = lastMatch.match(CONTEXT_PATTERNS.TEXT_MATCHES);
      if (textContent && textContent[1]) {
        contextualText = textContent[1].trim();
      }
    }
  }
  contextualText = contextualText.replace(CONTEXT_PATTERNS.WHITESPACE, ' ').trim();
  return contextualText || 'No contextual text found';
}

/**
 * Discover documents in a folder
 * @param {string} folderPath - Path to the folder to discover
 * @param {string} discoveryType - Type of discovery to perform
 * @returns {Promise<void>}
 */
async function discoverFolder(folderPath, discoveryType) {
  // discoveryType parameter is intentionally unused in this implementation
  try {
    const items = await daApi.listPath(folderPath);
    const documents = items
      .filter((item) => item.ext && item.ext !== 'json' && item.ext !== 'md')
      .map((item) => ({
        path: item.path,
        name: item.name,
        ext: item.ext,
        size: item.size,
        lastModified: item.lastModified,
        discoveredAt: Date.now(),
      }));
    postMessage({
      type: 'folderDiscoveryComplete',
      data: {
        documents,
        documentCount: documents.length,
        folderPath,
      },
    });
  } catch (error) {
    postMessage({
      type: 'folderDiscoveryError',
      data: {
        error: error.message,
        folderPath,
      },
    });
  }
}

function stopQueueProcessing() {
  if (!state.isRunning) {
    return;
  }
  state.isRunning = false;
  postMessage({
    type: 'queueProcessingStopped',
    data: {},
  });
}

// eslint-disable-next-line no-restricted-globals
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  try {
    switch (type) {
      case 'init': {
        await init(data.apiConfig);
        postMessage({ type: 'initialized' });
        break;
      }

      case 'startQueueProcessing': {
        if (data?.documentsToScan && data.documentsToScan.length > 0) {
          console.log(`===== Scanning Started: ${data.documentsToScan.length} documents ======`);

          const batchSize = data.batchSize || 10;
          let totalProcessed = 0;

          for (let i = 0; i < data.documentsToScan.length; i += batchSize) {
            const batch = data.documentsToScan.slice(i, i + batchSize);
            await processBatch(batch);
            totalProcessed += batch.length;
          }

          console.log(`===== Scanning Completed: ${data.documentsToScan.length} documents processed ======`);

          postMessage({
            type: 'queueProcessingStopped',
            data: { reason: 'completed', processedCount: data.documentsToScan.length },
          });
        } else {
          await startQueueProcessing({
            sessionId: data?.sessionId,
            userId: data?.userId,
            browserId: data?.browserId,
          });
        }
        break;
      }

      case 'stopQueueProcessing': {
        if (state.isRunning) {
          stopQueueProcessing();
        }
        break;
      }

      case 'processBatch': {
        await processBatch(data.pages);
        break;
      }

      case 'discoverFolder': {
        await discoverFolder(data.folderPath, data.discoveryType);
        break;
      }

      case 'stopDiscovery': {
        stopQueueProcessing();
        break;
      }

      default: {
        console.warn('[Media Scan Worker] ⚠️ Unknown message type:', type);
      }
    }
  } catch (error) {
    console.error('[Media Scan Worker] ❌ Error handling message:', {
      type,
      error: error.message,
      stack: error.stack,
    });
    postMessage({
      type: 'error',
      data: { error: error.message, originalType: type },
    });
  }
});
