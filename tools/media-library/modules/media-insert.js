/* eslint-disable no-use-before-define */

import { showToast } from './toast.js';

/**
 * Media Insertion Module
 * Handles media insertion using DA SDK actions (following DA Live patterns)
 */
export default function createMediaInsertion() {
  const state = {
    actions: null,
    context: null,
  };

  const insertion = {
    init,
    insertMedia,
    selectMedia,
    insertMediaAsLink,
    trackMediaUsage,
  };

  /**
   * Initialize with DA SDK actions (from DA Live pattern)
   */
  function init(actions, context = null) {
    state.actions = actions;
    state.context = context;
  }

  /**
   * Copy text to clipboard with fallback
   */
  function copyToClipboard(text, customMessage = 'Media tag copied to clipboard!') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(customMessage, 'success');
      }).catch((error) => {
        console.error('[Media Insert] Modern clipboard API failed:', error);
        fallbackCopyToClipboard(text, customMessage);
      });
    } else {
      fallbackCopyToClipboard(text, customMessage);
    }
  }

  /**
   * Copy image data to clipboard
   */
  async function copyImageToClipboard(imageUrl, altText) {
    if (!navigator.clipboard || !navigator.clipboard.write) {
      copyToClipboard(`<img src="${imageUrl}" alt="${altText}" />`, 'Image Copied');
      return;
    }

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const blob = await response.blob();

      const clipboardItems = [
        new ClipboardItem({
          [blob.type]: blob,
          'text/html': new Blob([`<img src="${imageUrl}" alt="${altText}" />`], { type: 'text/html' }),
          'text/plain': new Blob([imageUrl], { type: 'text/plain' }),
        }),
      ];

      await navigator.clipboard.write(clipboardItems);
      showToast('Image Copied', 'success');
    } catch (error) {
      console.error('[Media Insert] Failed to copy image to clipboard:', error);
      copyToClipboard(`<img src="${imageUrl}" alt="${altText}" />`, 'Image Copied');
    }
  }

  /**
   * Copy media content to clipboard (handles different media types)
   */
  async function copyMediaToClipboard(media) {
    if (media.type === 'image') {
      const imageUrl = media.url || media.src;
      const altText = media.alt || media.name || 'Image';
      await copyImageToClipboard(imageUrl, altText);
    } else if (media.type === 'video') {
      const videoUrl = media.url || media.src;
      copyToClipboard(videoUrl, 'Link to Video Copied');
    } else if (media.type === 'document') {
      const docUrl = media.url || media.src;
      copyToClipboard(docUrl, 'Link to Document Copied');
    } else {
      const mediaContent = generateMediaContent(media);
      copyToClipboard(mediaContent);
    }
  }

  /**
   * Fallback clipboard copy method
   */
  function fallbackCopyToClipboard(text, customMessage = 'Media tag copied to clipboard!') {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        showToast(customMessage, 'success');
      } else {
        showToast('Copy to Clipboard Failed', 'error');
      }
    } catch (err) {
      console.error('[Media Insert] Fallback copy error:', err);
      showToast('Copy to Clipboard Failed', 'error');
    }

    document.body.removeChild(textArea);
  }

  /**
   * Select and insert media (main entry point)
   */
  async function selectMedia(media) {
    await insertMedia(media);
    trackMediaUsage(media);
  }

  /**
   * Check if we're in shell mode where DA actions might not work properly
   */
  function isShellMode() {
    const globalMode = window.mediaLibraryMode;
    return globalMode && globalMode.isShellMode;
  }

  /**
   * Check if actions are available and working (not in shell mode)
   */
  function areActionsWorking() {
    return state.actions && !isShellMode();
  }

  /**
   * Insert external media as link
   */
  async function insertMediaAsLink(media) {
    if (!areActionsWorking()) {
      const mediaUrl = media.url || media.src;
      const linkText = media.name || media.alt || extractFilenameFromUrl(mediaUrl);
      const titleText = media.title || media.name || media.alt || extractFilenameFromUrl(mediaUrl);
      const linkHTML = `<a href="${mediaUrl}" alt="${linkText}" title="${titleText}">${linkText}</a>`;
      copyToClipboard(linkHTML);
      return;
    }

    const mediaUrl = media.url || media.src;
    const linkText = media.name || media.alt || extractFilenameFromUrl(mediaUrl);
    const titleText = media.title || media.name || media.alt || extractFilenameFromUrl(mediaUrl);

    const linkHTML = `<a href="${mediaUrl}" alt="${linkText}" title="${titleText}">${linkText}</a>`;
    state.actions.sendHTML(linkHTML);

    state.actions.closeLibrary();
  }

  /**
   * Insert media using DA SDK actions (following DA Live patterns)
   */
  async function insertMedia(media) {
    if (!areActionsWorking()) {
      await copyMediaToClipboard(media);
      return;
    }

    if (media.type === 'image') {
      await insertImageMedia(media);
    } else if (media.type === 'video') {
      await insertVideoMedia(media);
    } else if (media.type === 'document') {
      await insertDocumentMedia(media);
    } else {
      const mediaUrl = media.url || media.src;
      state.actions.sendText(`[${media.name}](${mediaUrl})`);
    }

    state.actions.closeLibrary();
  }

  /**
   * Generate media content for clipboard when no actions available
   */
  function generateMediaContent(media) {
    if (media.type === 'image') {
      return generateImageContent(media);
    }
    if (media.type === 'video') {
      return generateVideoContent(media);
    }
    if (media.type === 'document') {
      return generateDocumentContent(media);
    }
    const mediaUrl = media.url || media.src;
    return `[${media.name}](${mediaUrl})`;
  }

  /**
   * Generate image content for clipboard
   */
  function generateImageContent(media) {
    const imageUrl = media.url || media.src;
    const altText = media.alt || media.name || 'Image';

    if (media.isExternal) {
      const content = `<img src="${imageUrl}" alt="${altText}" />`;
      return content;
    }

    const content = createOptimizedImageHTML(imageUrl, altText);
    return content;
  }

  /**
   * Generate video content for clipboard
   */
  function generateVideoContent(media) {
    const videoUrl = media.url || media.src;

    const content = videoUrl;
    return content;
  }

  /**
   * Generate document content for clipboard
   */
  function generateDocumentContent(media) {
    const docUrl = media.url || media.src;
    const content = docUrl;
    return content;
  }

  /**
   * Insert image media with optimized HTML (following DA Live patterns)
   */
  async function insertImageMedia(media) {
    const imageUrl = media.url || media.src;
    const altText = media.alt || media.name || 'Image';

    if (media.isExternal) {
      const imgHTML = `<img src="${imageUrl}" alt="${altText}" />`;
      state.actions.sendHTML(imgHTML);
      return;
    }

    const optimizedHTML = createOptimizedImageHTML(imageUrl, altText);
    state.actions.sendHTML(optimizedHTML);
  }

  /**
   * Insert video media
   */
  async function insertVideoMedia(media) {
    const videoUrl = media.url || media.src;

    if (media.isExternal) {
      state.actions.sendText(`[${media.name}](${videoUrl})`);
    } else {
      const videoHTML = `<video controls>
  <source src="${videoUrl}" type="${media.mimeType || 'video/mp4'}" />
  Your browser does not support the video tag.
</video>`;
      state.actions.sendHTML(videoHTML);
    }
  }

  /**
   * Insert document media
   */
  async function insertDocumentMedia(media) {
    const docUrl = media.url || media.src;
    state.actions.sendText(`[${media.name}](${docUrl})`);
  }

  /**
   * Create optimized image HTML (following DA Live patterns)
   */
  function createOptimizedImageHTML(imageUrl, altText) {
    const baseUrl = imageUrl.split('?')[0];

    return `<picture>
  <source media="(max-width: 600px)" srcset="${baseUrl}?width=600&format=webply&optimize=medium" />
  <source media="(max-width: 1200px)" srcset="${baseUrl}?width=1200&format=webply&optimize=medium" />
  <img src="${baseUrl}?width=1200&format=webply&optimize=medium" alt="${altText}" />
</picture>`;
  }

  /**
   * Extract filename from URL
   */
  function extractFilenameFromUrl() {
    return 'Untitled';
  }

  /**
   * Track media usage (following DA Live patterns)
   */
  function trackMediaUsage(media) {
    try {
      const usageKey = 'da_media_basic_usage';
      const existingUsage = JSON.parse(localStorage.getItem(usageKey) || '[]');
      const usageEntry = {
        mediaId: media.id,
        mediaName: media.name,
        mediaUrl: media.url || media.src,
        insertedAt: new Date().toISOString(),
        context: state.context,
      };

      existingUsage.push(usageEntry);

      const recentUsage = existingUsage.slice(-100);
      localStorage.setItem(usageKey, JSON.stringify(recentUsage));
    } catch (error) {
      console.error('[Media Insertion] Error tracking media usage:', error);
    }
  }

  return insertion;
}
