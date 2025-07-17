/**
 * Media Scan Worker - Processes pages from queue to extract media assets
 * Works with document discovery worker for queue-based scanning
 */

const state = {
  apiConfig: null,
  isRunning: false,
  batchSize: 5,
  concurrentScans: 3,
  processingInterval: 5000, // 5 seconds
};

/**
 * Validate if alt text is meaningful and not a URL or file path
 */
function isValidAltText(altText) {
  if (!altText || typeof altText !== 'string') return false;
  
  const trimmed = altText.trim();
  
  if (trimmed.length < 2) return false;
  
  if (trimmed.length > 200) return false;
  
  if (trimmed.includes('\n') || trimmed.includes('\r')) return false;
  
  if (/\s{3,}/.test(trimmed)) return false;
  
  if (/<[^>]*>/.test(trimmed)) return false;
  
  if (/https?:\/\/|www\./.test(trimmed)) return false;
  
  if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|doc|docx|txt)$/i.test(trimmed)) return false;
  
  return true;
}

/**
 * Initialize the media scan worker
 */
function init(config) {
  state.apiConfig = config;
  console.log('[Media Scan Worker] Initialized with config:', {
    baseUrl: config.baseUrl,
    org: config.org,
    repo: config.repo,
    batchSize: state.batchSize,
    concurrentScans: state.concurrentScans
  });
  
  // Add heartbeat to track background activity
  setInterval(() => {
    if (state.isRunning) {
      console.log('[Media Scan Worker] Background heartbeat - Running:', {
        timestamp: new Date().toISOString(),
        batchSize: state.batchSize,
        concurrentScans: state.concurrentScans
      });
    }
  }, 30000); // Every 30 seconds
}

/**
 * Start processing pages from queue
 */
async function startQueueProcessing() {
  state.isRunning = true;
  console.log('[Media Scan Worker] Starting queue processing:', {
    interval: state.processingInterval,
    batchSize: state.batchSize,
    concurrentScans: state.concurrentScans,
    timestamp: new Date().toISOString()
  });

  // Process queue periodically
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
    console.log('[Media Scan Worker] Requesting next batch:', {
      batchSize: state.batchSize,
      timestamp: new Date().toISOString()
    });
    
    // Request next batch from main thread (which communicates with listing worker)
    postMessage({
      type: 'requestBatch',
      data: { batchSize: state.batchSize },
    });

  } catch (error) {
    console.error('[Media Scan Worker] Error requesting batch:', {
      error: error.message,
      timestamp: new Date().toISOString()
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
    console.log('[Media Scan Worker] No pages to process in batch');
    return;
  }

  console.log('[Media Scan Worker] Processing batch:', {
    pageCount: pages.length,
    pages: pages.map(p => p.path),
    timestamp: new Date().toISOString()
  });

  // Process pages in smaller concurrent groups
  const concurrentGroups = createConcurrentGroups(pages, state.concurrentScans);

  for (const group of concurrentGroups) {
    const scanPromises = group.map((page) => scanPageForAssets(page));
    await Promise.all(scanPromises);
  }

  console.log('[Media Scan Worker] Batch complete:', {
    processedCount: pages.length,
    timestamp: new Date().toISOString()
  });

  postMessage({
    type: 'batchComplete',
    data: { processedCount: pages.length },
  });
}

/**
 * Scan a single page for assets
 */
async function scanPageForAssets(page) {
  const startTime = Date.now();

  console.log('[Media Scan Worker] Scanning page:', {
    path: page.path,
    timestamp: new Date().toISOString()
  });

  try {
    // Get page content
    const content = await getPageContent(page.path);

    // Extract assets from HTML
    const assets = extractAssetsFromHTML(content, page.path);

    const scanTime = Date.now() - startTime;

    console.log('[Media Scan Worker] Page scan complete:', {
      path: page.path,
      assetCount: assets.length,
      scanTime: `${scanTime}ms`,
      timestamp: new Date().toISOString()
    });

    postMessage({
      type: 'pageScanned',
      data: {
        page: page.path,
        assets,
        scanTime,
        assetCount: assets.length,
        lastModified: page.lastModified,
      },
    });

    // Mark page as scanned (remove from queue)
    postMessage({
      type: 'markPageScanned',
      data: { path: page.path },
    });

  } catch (error) {
    console.error('[Media Scan Worker] Page scan error:', {
      path: page.path,
      error: error.message,
      retryCount: page.retryCount || 0,
      timestamp: new Date().toISOString()
    });
    
    postMessage({
      type: 'pageScanError',
      data: {
        page: page.path,
        error: error.message,
        retryCount: page.retryCount || 0,
      },
    });
  }
}

/**
 * Get page content from DA API
 */
async function getPageContent(path) {
  // Use path as-is - it's the unique identifier
  const url = `${state.apiConfig.baseUrl}/source${path}`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${state.apiConfig.token}` },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Extract assets from HTML content
 */
function extractAssetsFromHTML(html, sourcePath) {
  const assets = [];

  // Extract different types of assets using regex patterns
  extractImgTags(html, assets, sourcePath);
  extractPictureImages(html, assets, sourcePath);
  extractPictureSources(html, assets, sourcePath);
  extractBackgroundImages(html, assets, sourcePath);
  extractVideoSources(html, assets, sourcePath);
  extractMediaLinks(html, assets, sourcePath);
  extractCSSBackgrounds(html, assets, sourcePath);

  // Deduplicate assets
  const deduplicated = deduplicateAssets(assets);
  return deduplicated;
}

/**
 * Extract img tags using regex
 */
function extractImgTags(html, assets, sourcePath) {
  // Match img tags with src attribute
  const imgRegex = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  let occurrenceIndex = 0;

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && isValidMediaSrc(src)) {
      // Extract additional attributes
      const imgTag = match[0];
      const altMatch = imgTag.match(/alt\s*=\s*["']([^"']*)["']/i);
      const widthMatch = imgTag.match(/width\s*=\s*["']?(\d+)["']?/i);
      const heightMatch = imgTag.match(/height\s*=\s*["']?(\d+)["']?/i);
      const srcsetMatch = imgTag.match(/srcset\s*=\s*["']([^"']+)["']/i);

      const altText = altMatch ? altMatch[1] : '';
      const hasAltText = isValidAltText(altText);

      assets.push({
        src: normalizeAssetSrc(src),
        alt: altText,
        type: 'image',
        usedIn: [sourcePath],
        dimensions: {
          width: widthMatch ? parseInt(widthMatch[1], 10) : null,
          height: heightMatch ? parseInt(heightMatch[1], 10) : null,
        },
        context: 'img-tag',
        occurrenceId: `${sourcePath}-img-${occurrenceIndex++}`,
        hasAltText,
        occurrenceType: 'image',
        contextualText: getContextualText(html, match.index),
      });

      // Handle srcset
      if (srcsetMatch) {
        const srcsetAssets = parseSrcset(srcsetMatch[1], sourcePath);
        assets.push(...srcsetAssets);
      }
    }
  }
}

/**
 * Extract images from picture elements
 */
function extractPictureImages(html, assets, sourcePath) {
  // Match picture elements and extract img tags within them
  const pictureRegex = /<picture[^>]*>.*?<\/picture>/gis;
  let pictureMatch;
  let occurrenceIndex = 0;

  while ((pictureMatch = pictureRegex.exec(html)) !== null) {
    const pictureContent = pictureMatch[0];
    
    // Extract img tag from within the picture element
    const imgMatch = pictureContent.match(/<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/i);
    
    if (imgMatch) {
      const src = imgMatch[1];
      if (src && isValidMediaSrc(src)) {
        // Extract additional attributes from the img tag
        const imgTag = imgMatch[0];
        const altMatch = imgTag.match(/alt\s*=\s*["']([^"']*)["']/i);
        const widthMatch = imgTag.match(/width\s*=\s*["']?(\d+)["']?/i);
        const heightMatch = imgTag.match(/height\s*=\s*["']?(\d+)["']?/i);

        const altText = altMatch ? altMatch[1] : '';
        const hasAltText = isValidAltText(altText);

        assets.push({
          src: normalizeAssetSrc(src),
          alt: altText,
          type: 'image',
          usedIn: [sourcePath],
          dimensions: {
            width: widthMatch ? parseInt(widthMatch[1], 10) : null,
            height: heightMatch ? parseInt(heightMatch[1], 10) : null,
          },
          context: 'picture-img',
          occurrenceId: `${sourcePath}-picture-img-${occurrenceIndex++}`,
          hasAltText,
          occurrenceType: 'image',
          contextualText: getContextualText(html, pictureMatch.index),
        });
      }
    }
  }
}

/**
 * Extract picture sources using regex
 */
function extractPictureSources(html, assets, sourcePath) {
  // Match picture source tags with srcset attribute
  const sourceRegex = /<source[^>]+srcset\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = sourceRegex.exec(html)) !== null) {
    const srcset = match[1];
    if (srcset) {
      const srcsetAssets = parseSrcset(srcset, sourcePath);
      assets.push(...srcsetAssets);
    }
  }
}

/**
 * Extract background images from style attributes using regex
 */
function extractBackgroundImages(html, assets, sourcePath) {
  // Match elements with style attributes containing background
  const styleRegex = /<[^>]+style\s*=\s*["'][^"']*background[^"']*["'][^>]*>/gi;
  let match;

  while ((match = styleRegex.exec(html)) !== null) {
    const element = match[0];
    const styleMatch = element.match(/style\s*=\s*["']([^"']+)["']/i);

    if (styleMatch) {
      const style = styleMatch[1];
      const bgAssets = extractBgImagesFromStyle(style, sourcePath);
      assets.push(...bgAssets);
    }
  }
}

/**
 * Extract video sources using regex
 */
function extractVideoSources(html, assets, sourcePath) {
  // Match video tags
  const videoRegex = /<video[^>]*>.*?<\/video>/gis;
  let videoMatch;

  while ((videoMatch = videoRegex.exec(html)) !== null) {
    const videoTag = videoMatch[0];

    // Extract poster attribute
    const posterMatch = videoTag.match(/poster\s*=\s*["']([^"']+)["']/i);
    if (posterMatch && isMediaUrl(posterMatch[1])) {
      assets.push({
        src: normalizeAssetSrc(posterMatch[1]),
        alt: '',
        type: 'image',
        usedIn: [sourcePath],
        dimensions: {},
        context: 'video-poster',
      });
    }

    // Extract src attribute
    const srcMatch = videoTag.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch && isMediaUrl(srcMatch[1])) {
      assets.push({
        src: normalizeAssetSrc(srcMatch[1]),
        alt: '',
        type: 'video',
        usedIn: [sourcePath],
        dimensions: {},
        context: 'video-src',
      });
    }

    // Extract source tags within video
    const sourceRegex = /<source[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let sourceMatch;
    while ((sourceMatch = sourceRegex.exec(videoTag)) !== null) {
      const src = sourceMatch[1];
      if (isMediaUrl(src)) {
        assets.push({
          src: normalizeAssetSrc(src),
          alt: '',
          type: 'video',
          usedIn: [sourcePath],
          dimensions: {},
          context: 'video-source',
        });
      }
    }
  }
}

/**
 * Extract media links using regex
 */
function extractMediaLinks(html, assets, sourcePath) {

  // More flexible regex to match anchor tags with href
  const linkRegex = /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  let occurrenceIndex = 0;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];

    if (href && isMediaUrl(href)) {
      // Extract title attribute if present
      const titleMatch = match[0].match(/title\s*=\s*["']([^"']*)["']/i);
      const title = titleMatch ? titleMatch[1] : '';

      // Extract link text (content between <a> and </a>)
      const fullMatch = match[0];
      const linkStart = match.index + fullMatch.length;
      const linkEnd = html.indexOf('</a>', linkStart);
      const linkText = linkEnd > linkStart ? html.substring(linkStart, linkEnd).trim() : '';

      // Check if this is an external image link
      const isExternal = isExternalAsset(href);

      const hasTitle = isValidAltText(title);
      const hasLinkText = isValidAltText(linkText);

      // Get contextual text specifically for links
      const contextualText = getContextualTextForLink(html, match.index, linkEnd);

      assets.push({
        src: href, // Store the original href as src for external assets
        alt: title || linkText || '',
        type: determineAssetTypeFromUrl(href),
        usedIn: [sourcePath],
        dimensions: {},
        context: isExternal ? 'external-link' : 'media-link',
        isExternal: isExternal,
        originalHref: href, // Keep original href for external assets
        occurrenceId: `${sourcePath}-link-${occurrenceIndex++}`,
        hasAltText: hasTitle || hasLinkText,
        occurrenceType: 'link',
        contextualText: contextualText,
      });

    }
  }

}

/**
 * Determine asset type from URL
 */
function determineAssetTypeFromUrl(url) {
  const lowerUrl = url.toLowerCase();

  // Image types
  if (lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
    return 'image';
  }

  // Video types
  if (lowerUrl.match(/\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv)$/)) {
    return 'video';
  }

  // Document types
  if (lowerUrl.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|odt|ods|odp)$/)) {
    return 'document';
  }

  // Default to image if no clear type
  return 'image';
}

/**
 * Extract CSS backgrounds from style elements using regex
 */
function extractCSSBackgrounds(html, assets, sourcePath) {
  // Match style elements
  const styleRegex = /<style[^>]*>(.*?)<\/style>/gis;
  let match;

  while ((match = styleRegex.exec(html)) !== null) {
    const cssText = match[1];
    if (cssText) {
      const bgAssets = extractBgImagesFromCSS(cssText, sourcePath);
      assets.push(...bgAssets);
    }
  }
}

/**
 * Extract background images from style attribute
 */
function extractBgImagesFromStyle(style, sourcePath) {
  const bgImageRegex = /background(?:-image)?:\s*url\(['"]?([^'")]+)['"]?\)/gi;
  const assets = [];
  let match;

  while ((match = bgImageRegex.exec(style)) !== null) {
    const src = match[1];
    if (isValidMediaSrc(src)) {
      assets.push({
        src: normalizeAssetSrc(src),
        alt: '',
        type: 'image',
        usedIn: [sourcePath],
        dimensions: {},
        context: 'bg-style',
      });
    }
  }

  return assets;
}

/**
 * Extract background images from CSS text
 */
function extractBgImagesFromCSS(cssText, sourcePath) {
  const bgImageRegex = /background(?:-image)?:\s*url\(['"]?([^'")]+)['"]?\)/gi;
  const assets = [];
  let match;

  while ((match = bgImageRegex.exec(cssText)) !== null) {
    const src = match[1];
    if (isValidMediaSrc(src)) {
      assets.push({
        src: normalizeAssetSrc(src),
        alt: '',
        type: 'image',
        usedIn: [sourcePath],
        dimensions: {},
        context: 'bg-css',
      });
    }
  }

  return assets;
}

/**
 * Normalize asset source URL
 */
function normalizeAssetSrc(src) {
  if (!src) return '';

  if (src.startsWith('/')) {
    return src;
  } if (src.startsWith('./')) {
    return src.substring(1);
  } if (!src.startsWith('http')) {
    return '/' + src;
  }

  return src;
}

/**
 * Check if source is valid media
 */
function isValidMediaSrc(src) {
  return src
         && typeof src === 'string'
         && src.trim() !== ''
         && !src.startsWith('data:')
         && !src.startsWith('#');
}

/**
 * Check if URL is media
 */
function isMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;

  // Check for common image extensions
  const imageExts = 'jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico';
  const videoExts = 'mp4|webm|ogg|avi|mov|wmv|flv';
  const docExts = 'pdf|doc|docx|xls|xlsx|ppt|pptx';
  const mediaExtensions = new RegExp(`\\.(${imageExts}|${videoExts}|${docExts})`, 'i');

  // Check for extensions in URL
  if (mediaExtensions.test(url)) return true;

  // Check for image service patterns (like scene7.com)
  const imageServicePatterns = [
    /scene7\.com.*\/is\/image/i,
    /cloudinary\.com/i,
    /imagekit\.io/i,
    /cdn\.shopify\.com/i,
    /images\.unsplash\.com/i,
    /amazonaws\.com.*\.(png|jpg|jpeg|gif|webp)/i,
  ];

  return imageServicePatterns.some((pattern) => pattern.test(url));
}

/**
 * Check if asset is external
 */
function isExternalAsset(src) {
  if (!src) return false;

  try {
    const url = new URL(src);
    const hostname = url.hostname;

    // Check for external patterns
    const externalPatterns = [
      'scene7.com', 'akamai.net', 'cloudfront.net', 's3.amazonaws.com',
      'cdn.', 'static.', 'media.', 'sling.com', 'dish.com',
    ];

    return externalPatterns.some((pattern) => hostname.includes(pattern));
  } catch {
    return false;
  }
}



/**
 * Parse srcset attribute
 */
function parseSrcset(srcset, sourcePath) {
  return srcset.split(',')
    .map((src) => src.trim().split(/\s+/)[0])
    .filter((src) => src && isValidMediaSrc(src))
    .map((src) => ({
      src: normalizeAssetSrc(src),
      alt: '',
      type: 'image',
      usedIn: [sourcePath],
      dimensions: {},
      context: 'srcset',
    }));
}

/**
 * Get contextual text around HTML index
 */
function getContextualText(html, index, maxLength = 200) {
  // Look for text before and after the element
  const beforeText = html.substring(Math.max(0, index - maxLength), index);
  const afterText = html.substring(index, Math.min(html.length, index + maxLength));
  
  // Look for meaningful text content (headers, paragraphs, captions, etc.)
  let contextualText = '';
  
  // Check for text in nearby elements before the image
  const beforeElements = beforeText.match(/<([^>]+)>([^<]{10,})[^<]*<\/\1>/g);
  if (beforeElements && beforeElements.length > 0) {
    const lastElement = beforeElements[beforeElements.length - 1];
    const textMatch = lastElement.match(/>([^<]{10,})[^<]*</);
    if (textMatch && textMatch[1]) {
      contextualText = textMatch[1].trim();
    }
  }
  
  // If no text found before, look for text after
  if (!contextualText) {
    const afterElements = afterText.match(/<([^>]+)>([^<]{10,})[^<]*<\/\1>/g);
    if (afterElements && afterElements.length > 0) {
      const firstElement = afterElements[0];
      const textMatch = firstElement.match(/>([^<]{10,})[^<]*</);
      if (textMatch && textMatch[1]) {
        contextualText = textMatch[1].trim();
      }
    }
  }
  
  // If still no text, look for any text content in the vicinity
  if (!contextualText) {
    const beforeMatch = beforeText.match(/>([^<]{10,})[^<]*$/);
    const afterMatch = afterText.match(/^[^<]*([^<]{10,})</);
    
    if (beforeMatch && beforeMatch[1]) {
      contextualText = beforeMatch[1].trim();
    } else if (afterMatch && afterMatch[1]) {
      contextualText = afterMatch[1].trim();
    }
  }
  
  // Clean up the text (remove extra whitespace, truncate)
  contextualText = contextualText.replace(/\s+/g, ' ').trim();
  if (contextualText.length > 80) {
    contextualText = contextualText.substring(0, 80) + '...';
  }
  
  return contextualText || 'No contextual text found';
}

/**
 * Get contextual text specifically for links
 * This function is optimized for finding text around anchor tags
 */
function getContextualTextForLink(html, linkStartIndex, linkEndIndex, maxLength = 300) {
  // Look for text before the link
  const beforeText = html.substring(Math.max(0, linkStartIndex - maxLength), linkStartIndex);
  const afterText = html.substring(linkEndIndex, Math.min(html.length, linkEndIndex + maxLength));
  
  let contextualText = '';
  
  // First, try to find text within the link itself (link text)
  const linkText = html.substring(linkStartIndex, linkEndIndex);
  const linkTextMatch = linkText.match(/>([^<]{5,})</);
  if (linkTextMatch && linkTextMatch[1]) {
    contextualText = linkTextMatch[1].trim();
  }
  
  // If no link text, look for surrounding text
  if (!contextualText) {
    // Look for text in parent elements or nearby elements
    const beforeElements = beforeText.match(/<([^>]+)>([^<]{10,})[^<]*$/);
    if (beforeElements && beforeElements[2]) {
      contextualText = beforeElements[2].trim();
    }
  }
  
  // If still no text, look for text after the link
  if (!contextualText) {
    const afterElements = afterText.match(/^[^<]*([^<]{10,})</);
    if (afterElements && afterElements[1]) {
      contextualText = afterElements[1].trim();
    }
  }
  
  // If still no text, try to find any meaningful text in the vicinity
  if (!contextualText) {
    // Look for text in nearby elements (headers, paragraphs, etc.)
    const nearbyText = beforeText + afterText;
    const textMatches = nearbyText.match(/>([^<]{15,})</g);
    if (textMatches && textMatches.length > 0) {
      // Take the last meaningful text found
      const lastMatch = textMatches[textMatches.length - 1];
      const textContent = lastMatch.match(/>([^<]{15,})</);
      if (textContent && textContent[1]) {
        contextualText = textContent[1].trim();
      }
    }
  }
  
  // Clean up the text (remove extra whitespace, but don't truncate for links)
  contextualText = contextualText.replace(/\s+/g, ' ').trim();
  
  return contextualText || 'No contextual text found';
}

/**
 * Deduplicate assets while preserving occurrence information
 */
function deduplicateAssets(assets) {
  const seen = new Map();
  const deduplicated = [];

  assets.forEach((asset) => {
    const key = asset.src;
    if (!seen.has(key)) {
      seen.set(key, asset);
      deduplicated.push(asset);
    } else {
      // Merge usedIn arrays and track occurrences
      const existing = seen.get(key);
      existing.usedIn = [...new Set([...existing.usedIn, ...asset.usedIn])];
      
      // Track individual occurrences for detailed alt text analysis
      if (!existing.occurrences) {
        existing.occurrences = [];
      }
      
      // Add current asset as an occurrence if it has occurrence data
      if (asset.occurrenceId) {
                 existing.occurrences.push({
           occurrenceId: asset.occurrenceId,
           pagePath: asset.usedIn[0],
           altText: asset.alt,
           hasAltText: asset.hasAltText,
           occurrenceType: asset.occurrenceType,
           contextualText: asset.contextualText,
           context: asset.context,
         });
      }
    }
  });

  return deduplicated;
}

/**
 * Create concurrent groups for processing
 */
function createConcurrentGroups(array, groupSize) {
  const groups = [];
  for (let i = 0; i < array.length; i += groupSize) {
    groups.push(array.slice(i, i + groupSize));
  }
  return groups;
}

/**
 * Stop queue processing
 */
function stopQueueProcessing() {
  state.isRunning = false;
  console.log('[Media Scan Worker] Queue processing stopped:', {
    timestamp: new Date().toISOString()
  });

  postMessage({
    type: 'queueProcessingStopped',
    data: {},
  });
}

// Message handler
// eslint-disable-next-line no-restricted-globals
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  try {
    switch (type) {
      case 'init': {
        init(data.apiConfig);
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
