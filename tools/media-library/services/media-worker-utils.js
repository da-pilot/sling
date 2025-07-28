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
  return str && typeof str === 'string' && (str.startsWith('http') || str.startsWith('//'));
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
  const { beforeChars = 50, afterChars = 50 } = options;
  const start = Math.max(0, index - beforeChars);
  const end = Math.min(html.length, index + afterChars);
  return html.substring(start, end).replace(/\s+/g, ' ').trim();
}