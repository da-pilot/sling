/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Asset Insertion Module
 * Handles asset insertion using DA SDK actions (following DA Live patterns)
 */
function createAssetInsertion() {
  const state = {
    actions: null,
    context: null,
  };

  const insertion = {
    init,
    insertAsset,
    selectAsset,
    insertAssetAsLink,
    trackAssetUsage,
  };

  /**
   * Initialize with DA SDK actions (from DA Live pattern)
   */
  function init(actions, context = null) {
    state.actions = actions;
    state.context = context;
  }

  /**
   * Select and insert asset (main entry point)
   */
  async function selectAsset(asset) {
    try {
      await insertAsset(asset);
      trackAssetUsage(asset);
    } catch (error) {
      // Failed to insert asset
      throw error;
    }
  }

  /**
   * Insert external asset as link
   */
  async function insertAssetAsLink(asset) {
    try {
      if (!state.actions) {
        // DA SDK not available - would insert asset as link
        return;
      }

      // For external assets, insert as HTML anchor tag
      const assetUrl = asset.url || asset.src;
      const linkText = asset.name || asset.alt || extractFilenameFromUrl(assetUrl);
      const titleText = asset.title || asset.name || asset.alt || extractFilenameFromUrl(assetUrl);

      const linkHTML = `<a href="${assetUrl}" alt="${linkText}" title="${titleText}">${linkText}</a>`;
      state.actions.sendHTML(linkHTML);

      // Close library after successful insertion
      state.actions.closeLibrary();

    } catch (error) {
      // Asset insertion failed
      throw error;
    }
  }

  /**
   * Insert asset using DA SDK actions (following DA Live patterns)
   */
  async function insertAsset(asset) {
    try {
      if (!state.actions) {
        // DA SDK not available - would insert asset
        return;
      }

      // Handle different asset types following DA Live patterns
      if (asset.type === 'image') {
        await insertImageAsset(asset);
      } else if (asset.type === 'video') {
        await insertVideoAsset(asset);
      } else if (asset.type === 'document') {
        await insertDocumentAsset(asset);
      } else {
        // Generic asset insertion
        const assetUrl = asset.url || asset.src;
        state.actions.sendText(`[${asset.name}](${assetUrl})`);
      }

      // Close library after successful insertion (DA Live pattern)
      state.actions.closeLibrary();

    } catch (error) {
      // Asset insertion failed
      throw error;
    }
  }

  /**
   * Insert image asset with optimized HTML (following DA Live patterns)
   */
  async function insertImageAsset(asset) {
    const imageUrl = asset.url || asset.src;
    const altText = asset.alt || asset.name || 'Image';

    // For external images, use simple img tag
    if (asset.isExternal) {
      const imgHTML = `<img src="${imageUrl}" alt="${altText}" />`;
      state.actions.sendHTML(imgHTML);
      return;
    }

    // For internal images, use optimized picture element (DA Live pattern)
    const optimizedHTML = createOptimizedImageHTML(imageUrl, altText);
    state.actions.sendHTML(optimizedHTML);
  }

  /**
   * Insert video asset
   */
  async function insertVideoAsset(asset) {
    const videoUrl = asset.url || asset.src;

    if (asset.isExternal) {
      // External video as link
      state.actions.sendText(`[${asset.name}](${videoUrl})`);
    } else {
      // Internal video with video tag
      const videoHTML = `<video controls>
  <source src="${videoUrl}" type="${asset.mimeType || 'video/mp4'}" />
  Your browser does not support the video tag.
</video>`;
      state.actions.sendHTML(videoHTML);
    }
  }

  /**
   * Insert document asset
   */
  async function insertDocumentAsset(asset) {
    const docUrl = asset.url || asset.src;
    state.actions.sendText(`[${asset.name}](${docUrl})`);
  }

  /**
   * Create optimized image HTML (following DA Live patterns)
   */
  function createOptimizedImageHTML(imageUrl, altText) {
    // Extract base URL without query parameters
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
  function extractFilenameFromUrl(_url) {
    return 'Untitled';
  }

  /**
   * Track asset usage (following DA Live patterns)
   */
  function trackAssetUsage(asset) {
    try {
      // Track usage in localStorage for analytics
      const usageKey = 'da_media_basic_usage';
      const existingUsage = JSON.parse(localStorage.getItem(usageKey) || '[]');

      const usageEntry = {
        assetId: asset.id,
        assetName: asset.name,
        assetUrl: asset.url || asset.src,
        insertedAt: new Date().toISOString(),
        context: state.context,
      };

      existingUsage.push(usageEntry);

      // Keep only last 100 usage entries
      const recentUsage = existingUsage.slice(-100);
      localStorage.setItem(usageKey, JSON.stringify(recentUsage));

      // Asset usage tracked
    } catch (error) {
      // Failed to track asset usage
    }
  }

  return insertion;
}

export { createAssetInsertion };
