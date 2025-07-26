/* eslint-disable no-use-before-define */
/**
 * Media Scan Worker - Processes pages from queue to extract media media
 * Works with document discovery worker for queue-based scanning
 */

import { createWorkerDaApi } from '../services/worker-utils.js';
import {
  isValidAltText,
  normalizeMediaSrc,
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
  try {
    config = workerConfig;
    daApi = createWorkerDaApi();
    await daApi.init(config);

    // Update state from config
    state.batchSize = config.batchSize || 10;
    state.processingInterval = config.processingInterval || 1000;

    // eslint-disable-next-line no-console
    console.log('[Media Scan Worker] 🔧 Initialized with scanning config:', {
      batchSize: state.batchSize,
      processingInterval: state.processingInterval,
      timestamp: new Date().toISOString(),
    });

    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Media Scan Worker] Failed to initialize:', error);
    throw error;
  }
}

/**
 * Validate if alt text is meaningful and not a URL or file path
 */

/**
 * Start processing pages from queue
 */
async function startQueueProcessing() {
  state.isRunning = true;

  const intervalId = setInterval(async () => {
    if (state.isRunning) {
      await processNextBatch();
    } else {
      clearInterval(intervalId);
    }
  }, state.processingInterval);

  postMessage({
    type: 'queueProcessingStarted',
    data: { interval: state.processingInterval },
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
    // eslint-disable-next-line no-console
    console.error('[Media Scan Worker] Error requesting batch:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });

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

  state.isProcessing = true;

  try {
    const scanPromises = pages.map((page) => scanPageForMedia(page));
    await Promise.all(scanPromises);

    postMessage({
      type: 'batchComplete',
      data: { processedCount: pages?.length || 0 },
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

    // Process media immediately for progressive loading
    if (media.length > 0) {
      // Send media to main thread for processing
      postMessage({
        type: 'mediaDiscovered',
        data: {
          media,
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
    // eslint-disable-next-line no-console
    console.error('[Media Scan Worker] Page scan error:', {
      path: page?.path || 'unknown',
      error: error?.message || 'unknown error',
      retryCount: page?.retryCount || 0,
      timestamp: new Date().toISOString(),
    });

    postMessage({
      type: 'pageScanError',
      data: {
        page: page?.path || '',
        error: error?.message || 'unknown error',
        retryCount: page?.retryCount || 0,
        sourceFile: page?.sourceFile || null,
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
  return daApi.fetchPageContent(path);
}

async function extractMediaFromHTML(html, sourcePath) {
  const mediaMap = new Map();
  await extractImgTags(html, mediaMap, sourcePath);
  await extractPictureImages(html, mediaMap, sourcePath);
  extractBackgroundImages(html, mediaMap, sourcePath);
  extractVideoSources(html, mediaMap, sourcePath);
  await extractMediaLinks(html, mediaMap, sourcePath);
  extractCSSBackgrounds(html, mediaMap, sourcePath);
  return Array.from(mediaMap.values());
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
      const ariaLabelMatch = imgTag.match(ATTRIBUTE_PATTERNS.ARIA_LABEL);
      const widthMatch = imgTag.match(ATTRIBUTE_PATTERNS.WIDTH);
      const heightMatch = imgTag.match(ATTRIBUTE_PATTERNS.HEIGHT);
      const srcsetMatch = imgTag.match(ATTRIBUTE_PATTERNS.SRCSET);
      const altText = altMatch ? altMatch[1] : '';
      const titleText = titleMatch ? titleMatch[1] : '';
      const ariaLabelText = ariaLabelMatch ? ariaLabelMatch[1] : '';
      const hasAltText = isValidAltText(altText);
      const normalizedSrc = normalizeMediaSrc(src);
      const occurrenceId = await generateOccurrenceId(sourcePath, normalizedSrc, occurrenceIndex);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText,
        hasAltText,
        occurrenceType: 'image',
        contextualText: getContextualText(html, match.index),
        context: 'img-tag',
      };
      if (mediaMap.has(normalizedSrc)) {
        const existing = mediaMap.get(normalizedSrc);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(normalizedSrc, {
          src: normalizedSrc,
          alt: altText,
          title: titleText,
          ariaLabel: ariaLabelText,
          type: 'image',
          usedIn: [sourcePath],
          dimensions: {
            width: widthMatch ? parseInt(widthMatch[1], 10) : null,
            height: heightMatch ? parseInt(heightMatch[1], 10) : null,
          },
          context: 'img-tag',
          occurrences: [occurrence],
        });
      }
      occurrenceIndex += 1;
      if (srcsetMatch) {
        const srcsetMedia = parseSrcset(srcsetMatch[1], sourcePath);
        srcsetMedia.forEach((item) => {
          if (mediaMap.has(item.src)) {
            const existing = mediaMap.get(item.src);
            existing.occurrences.push(item.occurrences[0]);
            existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
          } else {
            mediaMap.set(item.src, item);
          }
        });
      }
    }
  }));
}

async function extractPictureImages(html, mediaMap, sourcePath) {
  let occurrenceIndex = 0;
  const matches = Array.from(html.matchAll(HTML_PATTERNS.PICTURE_TAG));
  await Promise.all(matches.map(async (match) => {
    const pictureContent = match[0];
    const imgMatch = pictureContent.match(HTML_PATTERNS.IMG_TAG);
    if (imgMatch) {
      const src = imgMatch[1];
      if (src && isValidMediaSrc(src)) {
        const imgTag = imgMatch[0];
        const altMatch = imgTag.match(ATTRIBUTE_PATTERNS.ALT);
        const titleMatch = imgTag.match(ATTRIBUTE_PATTERNS.TITLE);
        const ariaLabelMatch = imgTag.match(ATTRIBUTE_PATTERNS.ARIA_LABEL);
        const widthMatch = imgTag.match(ATTRIBUTE_PATTERNS.WIDTH);
        const heightMatch = imgTag.match(ATTRIBUTE_PATTERNS.HEIGHT);
        const altText = altMatch ? altMatch[1] : '';
        const titleText = titleMatch ? titleMatch[1] : '';
        const ariaLabelText = ariaLabelMatch ? ariaLabelMatch[1] : '';
        const hasAltText = isValidAltText(altText);
        const normalizedSrc = normalizeMediaSrc(src);
        const occurrenceId = await generateOccurrenceId(sourcePath, normalizedSrc, occurrenceIndex);
        const occurrence = {
          occurrenceId,
          pagePath: sourcePath,
          altText,
          hasAltText,
          occurrenceType: 'image',
          contextualText: getContextualText(html, match.index),
          context: 'picture',
        };
        if (mediaMap.has(normalizedSrc)) {
          const existing = mediaMap.get(normalizedSrc);
          existing.occurrences.push(occurrence);
          existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
        } else {
          mediaMap.set(normalizedSrc, {
            src: normalizedSrc,
            alt: altText,
            title: titleText,
            ariaLabel: ariaLabelText,
            type: 'image',
            usedIn: [sourcePath],
            dimensions: {
              width: widthMatch ? parseInt(widthMatch[1], 10) : null,
              height: heightMatch ? parseInt(heightMatch[1], 10) : null,
            },
            context: 'picture',
            occurrences: [occurrence],
          });
        }
        occurrenceIndex += 1;
      }
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
        const normalizedSrc = normalizeMediaSrc(src);
        const occurrenceId = generateOccurrenceId(sourcePath, normalizedSrc, occurrenceIndex);
        const occurrence = {
          occurrenceId,
          pagePath: sourcePath,
          altText: '',
          hasAltText: false,
          occurrenceType: 'video',
          contextualText: getContextualText(html, videoMatch.index),
          context: 'video-source',
        };
        if (mediaMap.has(normalizedSrc)) {
          const existing = mediaMap.get(normalizedSrc);
          existing.occurrences.push(occurrence);
          existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
        } else {
          mediaMap.set(normalizedSrc, {
            src: normalizedSrc,
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
      const normalizedSrc = normalizeMediaSrc(href);
      const occurrenceId = await generateOccurrenceId(sourcePath, normalizedSrc, occurrenceIndex);
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
      if (mediaMap.has(normalizedSrc)) {
        const existing = mediaMap.get(normalizedSrc);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(normalizedSrc, {
          src: normalizedSrc,
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

function extractCSSBackgrounds(html, mediaMap, sourcePath) {
  let cssMatch;
  let occurrenceIndex = 0;
  cssMatch = CSS_PATTERNS.URL_FUNCTION.exec(html);
  while (cssMatch !== null) {
    const url = cssMatch[1];
    if (url && isMediaFile(url)) {
      const normalizedSrc = normalizeMediaSrc(url);
      const occurrenceId = generateOccurrenceId(sourcePath, normalizedSrc, occurrenceIndex);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText: '',
        hasAltText: false,
        occurrenceType: 'background',
        contextualText: getContextualText(html, cssMatch.index),
        context: 'css-background',
      };
      if (mediaMap.has(normalizedSrc)) {
        const existing = mediaMap.get(normalizedSrc);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(normalizedSrc, {
          src: normalizedSrc,
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
    cssMatch = CSS_PATTERNS.URL_FUNCTION.exec(html);
  }
}

function extractBgImagesFromStyle(style, mediaMap, sourcePath) {
  let bgMatch;
  let occurrenceIndex = 0;
  bgMatch = CSS_PATTERNS.BACKGROUND_IMAGE.exec(style);
  while (bgMatch !== null) {
    const url = bgMatch[1];
    if (url && isMediaFile(url)) {
      const normalizedSrc = normalizeMediaSrc(url);
      const occurrenceId = generateOccurrenceId(sourcePath, normalizedSrc, occurrenceIndex);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText: '',
        hasAltText: false,
        occurrenceType: 'background',
        contextualText: 'CSS background image',
        context: 'css-background',
      };
      if (mediaMap.has(normalizedSrc)) {
        const existing = mediaMap.get(normalizedSrc);
        existing.occurrences.push(occurrence);
        existing.usedIn = [...new Set([...existing.usedIn, sourcePath])];
      } else {
        mediaMap.set(normalizedSrc, {
          src: normalizedSrc,
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

function parseSrcset(srcset, sourcePath) {
  const mediaItems = [];
  let match;
  let occurrenceIndex = 0;
  match = CSS_PATTERNS.SRCSET_PARSE.exec(srcset);
  while (match !== null) {
    const src = match[1];
    const descriptor = match[2];
    if (src && isValidMediaSrc(src)) {
      const normalizedSrc = normalizeMediaSrc(src);
      const occurrenceId = generateOccurrenceId(sourcePath, normalizedSrc, occurrenceIndex);
      const occurrence = {
        occurrenceId,
        pagePath: sourcePath,
        altText: '',
        hasAltText: false,
        occurrenceType: 'image',
        contextualText: 'Responsive image source',
        context: 'srcset',
      };
      mediaItems.push({
        src: normalizedSrc,
        alt: '',
        title: '',
        type: 'image',
        usedIn: [sourcePath],
        dimensions: {
          width: null,
          height: null,
        },
        context: 'srcset',
        occurrences: [occurrence],
        metadata: {
          descriptor,
        },
      });
      occurrenceIndex += 1;
    }
    match = CSS_PATTERNS.SRCSET_PARSE.exec(srcset);
  }
  return mediaItems;
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

function stopQueueProcessing() {
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
        await startQueueProcessing();
        break;
      }

      case 'stopQueueProcessing': {
        stopQueueProcessing();
        break;
      }

      case 'processBatch': {
        await processBatch(data.pages);
        break;
      }

      default: {
        // eslint-disable-next-line no-console
        console.warn('[DA] media-scan-worker: Unknown message type', type);
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[DA] media-scan-worker: Error handling message', type, error);
    postMessage({
      type: 'error',
      data: { error: error.message, originalType: type },
    });
  }
});
