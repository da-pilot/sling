import { MEDIA_PROCESSING } from '../constants.js';

export function isValidAltText(altText) {
  if (!altText || typeof altText !== 'string') return false;
  const trimmed = altText.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length < 3) return false;
  if (trimmed.length > 125) return false;
  const hasMeaningfulContent = /[a-zA-Z]/.test(trimmed);
  const hasReasonableWords = trimmed.split(/\s+/).length >= 2;
  return hasMeaningfulContent && hasReasonableWords;
}

export function isProbablyUrl(str) {
  return str && typeof str === 'string' && (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('//'));
}

export function determineMediaType(url, options = {}) {
  const { defaultType = 'image' } = options;
  if (!url || typeof url !== 'string') return defaultType;
  const lowerUrl = url.toLowerCase();
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff'];
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv'];
  const documentExtensions = ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt'];
  const extension = lowerUrl.split('.').pop();
  if (imageExtensions.includes(`.${extension}`)) return 'image';
  if (videoExtensions.includes(`.${extension}`)) return 'video';
  if (documentExtensions.includes(`.${extension}`)) return 'document';
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('vimeo.com')) return 'video';
  return defaultType;
}

export function isMediaFile(url, options = {}) {
  const { includeLinks = true } = options;
  if (!url || typeof url !== 'string') return false;
  const lowerUrl = url.toLowerCase();
  const mediaExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff',
    '.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv',
    '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt',
  ];
  const extension = lowerUrl.split('.').pop();
  if (mediaExtensions.includes(`.${extension}`)) return true;
  if (includeLinks && (lowerUrl.includes('youtube.com') || lowerUrl.includes('vimeo.com'))) return true;
  return false;
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

export function extractFilenameFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return MEDIA_PROCESSING.UNTITLED_MEDIA;
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
    if (MEDIA_PROCESSING.GOOGLE_URLS.some((googleUrl) => url.includes(googleUrl))) {
      return MEDIA_PROCESSING.GOOGLE_DOCS_IMAGE;
    }
    const filename = pathname.split('/').pop();
    if (!filename) {
      return MEDIA_PROCESSING.UNTITLED_MEDIA;
    }
    if (MEDIA_PROCESSING.HASH_PATTERN.test(filename)) {
      return MEDIA_PROCESSING.SLING_LOGO_DEFAULT;
    }
    const nameWithoutExtension = filename.split('.')[0];
    const cleanName = nameWithoutExtension.replace(
      MEDIA_PROCESSING.UNDERSCORE_DASH_PATTERN,
      MEDIA_PROCESSING.SPACE_REPLACEMENT,
    );
    if (cleanName.startsWith(MEDIA_PROCESSING.MEDIA_PREFIX)) {
      return MEDIA_PROCESSING.UNTITLED_MEDIA;
    }
    return cleanName || MEDIA_PROCESSING.UNTITLED_MEDIA;
  } catch (error) {
    return MEDIA_PROCESSING.UNTITLED_MEDIA;
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

export function getContextualText(html, index) {
  const searchRadius = 800;
  const start = Math.max(0, index - searchRadius);
  const end = Math.min(html.length, index + searchRadius);
  const nearbyHtml = html.substring(start, end);

  const contentMatches = nearbyHtml.match(/>([^<]{30,})</g);
  if (contentMatches && contentMatches.length > 0) {
    const meaningfulMatches = contentMatches
      .map((match) => match.replace(/^>/, '').replace(/<$/, ''))
      .filter((text) => {
        const cleanText = text
          .replace(MEDIA_PROCESSING.WHITESPACE_PATTERN, MEDIA_PROCESSING.SPACE_REPLACEMENT)
          .trim();
        return cleanText.length > 20
          && !cleanText.includes('src=')
          && !cleanText.includes('alt=')
          && !cleanText.includes('media=')
          && !cleanText.includes('http')
          && !cleanText.includes('www');
      });

    if (meaningfulMatches.length > 0) {
      const bestMatch = meaningfulMatches.reduce((longest, current) => (current.length > longest.length ? current : longest));
      const cleanText = bestMatch
        .replace(MEDIA_PROCESSING.WHITESPACE_PATTERN, MEDIA_PROCESSING.SPACE_REPLACEMENT)
        .trim();

      if (cleanText.length > 10) {
        return cleanText.substring(0, 120);
      }
    }
  }

  return MEDIA_PROCESSING.NO_CONTEXT_AVAILABLE;
}