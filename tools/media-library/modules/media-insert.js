/* eslint-disable no-use-before-define */

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
   * Select and insert media (main entry point)
   */
  async function selectMedia(media) {
    await insertMedia(media);
    trackMediaUsage(media);
  }

  /**
   * Insert external media as link
   */
  async function insertMediaAsLink(media) {
    if (!state.actions) {
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
    if (!state.actions) {
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
      // eslint-disable-next-line no-console
      console.error('[Media Insertion] Error tracking media usage:', error);
    }
  }

  return insertion;
}
