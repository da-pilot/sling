export function isValidAltText(altText) {
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

export function isProbablyUrl(str) {
  return typeof str === 'string' && /^https?:\/\//.test(str);
}

export function determineMediaType(url, options = {}) {
  const { includeDocuments = true, defaultType = 'image' } = options;
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
    return 'image';
  }

  if (lowerUrl.match(/\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv)$/)) {
    return 'video';
  }

  if (includeDocuments && lowerUrl.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|odt|ods|odp)$/)) {
    return 'document';
  }

  return defaultType;
}

export function isMediaFile(url, options = {}) {
  const { includeImageServices = true } = options;

  if (!url || typeof url !== 'string') return false;

  const imageExts = 'jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico';
  const videoExts = 'mp4|webm|ogg|avi|mov|wmv|flv';
  const docExts = 'pdf|doc|docx|xls|xlsx|ppt|pptx';
  const mediaExtensions = new RegExp(`\\.(${imageExts}|${videoExts}|${docExts})`, 'i');

  if (mediaExtensions.test(url)) return true;

  if (includeImageServices) {
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

  return false;
}

export function normalizeMediaSrc(src, pageUrl = null, options = {}) {
  const { absolute = false } = options;

  if (!src) return '';

  if (absolute && pageUrl) {
    try {
      if (src.startsWith('/')) {
        const urlObj = new URL(pageUrl);
        return `${urlObj.protocol}//${urlObj.host}${src}`;
      }
      if (src.startsWith('//')) {
        const urlObj = new URL(pageUrl);
        return `${urlObj.protocol}${src}`;
      }

      if (src.startsWith('http://') || src.startsWith('https://')) {
        return src;
      }

      const urlObj = new URL(pageUrl);
      const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
      return `${urlObj.protocol}//${urlObj.host}${basePath}${src}`;
    } catch (error) {
      return src;
    }
  } else {
    if (src.startsWith('/')) {
      return src;
    }
    if (src.startsWith('./')) {
      return src.substring(1);
    }
    if (!src.startsWith('http')) {
      return `/${src}`;
    }

    return src;
  }
}

export function isValidMediaSrc(src) {
  return src
         && typeof src === 'string'
         && src.trim() !== ''
         && !src.startsWith('data:')
         && !src.startsWith('#');
}

export function isExternalMedia(src, org = null, repo = null) {
  if (!src) return false;

  try {
    const url = new URL(src);
    const { hostname } = url;

    if (org && repo) {
      const internalAemPattern = new RegExp(`-${repo}-${org}-aem\\.`);
      if (internalAemPattern.test(hostname)) {
        return false;
      }
    }

    const externalPatterns = [
      'scene7.com', 'akamai.net', 'cloudfront.net', 's3.amazonaws.com',
      'cdn.', 'static.', 'media.', 'sling.com', 'dish.com',
    ];

    return externalPatterns.some((pattern) => hostname.includes(pattern));
  } catch {
    return false;
  }
}

const UNTITLED_MEDIA = 'Untitled Media';

export function extractFilenameFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return UNTITLED_MEDIA;
  }
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    let pathname;
    if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
      const urlObj = new URL(cleanUrl);
      pathname = urlObj.pathname;
    } else {
      pathname = cleanUrl;
    }
    const filename = pathname.split('/').pop();
    if (!filename) {
      return UNTITLED_MEDIA;
    }
    const nameWithoutExtension = filename.split('.')[0];
    const cleanName = nameWithoutExtension.replace(/[_-]/g, ' ');
    if (cleanName.startsWith('media ')) {
      return UNTITLED_MEDIA;
    }
    return cleanName || UNTITLED_MEDIA;
  } catch (error) {
    return UNTITLED_MEDIA;
  }
}

export async function generateHashFromSrc(src) {
  const encoder = new TextEncoder();
  const data = encoder.encode(src);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function generateOccurrenceId(pagePath, src, index) {
  const occurrenceString = `${pagePath}-${src}-${index}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(occurrenceString);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getContextualText(html, index, options = {}) {
  const { maxLength = 200, useRegex = true } = options;

  if (useRegex) {
    const beforeText = html.substring(Math.max(0, index - maxLength), index);
    const afterText = html.substring(index, Math.min(html.length, index + maxLength));

    let contextualText = '';

    const beforeElements = beforeText.match(/<([^>]+)>([^<]{10,})[^<]*<\/\1>/g);
    if (beforeElements && beforeElements.length > 0) {
      const lastElement = beforeElements[beforeElements.length - 1];
      const textMatch = lastElement.match(/>([^<]{10,})[^<]*</);
      if (textMatch && textMatch[1]) {
        contextualText = textMatch[1].trim();
      }
    }

    if (!contextualText) {
      const afterElements = afterText.match(/<([^>]+)>([^<]{10,})[^<]*<\/\1>/g);
      if (afterElements && afterElements.length > 0) {
        const firstElement = afterElements[0];
        const textMatch = firstElement.match(/>([^<]{10,})</);
        if (textMatch && textMatch[1]) {
          contextualText = textMatch[1].trim();
        }
      }
    }

    if (!contextualText) {
      const beforeMatch = beforeText.match(/>([^<]{10,})[^<]*$/);
      const afterMatch = afterText.match(/^[^<]*([^<]{10,})</);

      if (beforeMatch && beforeMatch[1]) {
        contextualText = beforeMatch[1].trim();
      }
      if (afterMatch && afterMatch[1]) {
        contextualText = afterMatch[1].trim();
      }
    }

    contextualText = contextualText.replace(/\s+/g, ' ').trim();
    if (contextualText.length > 80) {
      contextualText = `${contextualText.substring(0, 80)}...`;
    }

    return contextualText || 'No contextual text found';
  }
  return 'No contextual text found';
}