/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */

import { fetchSheetJson, CONTENT_DA_LIVE_BASE } from './sheet-utils.js';
import { updateSidebarCounts } from './sidebar.js';

let daContext = null;
let assetBrowser = null;
let stateManager = null;
let assets = [];

function setContext(context) {
  daContext = context;
}

function setAssetBrowser(browser) {
  assetBrowser = browser;
}

function setStateManager(manager) {
  stateManager = manager;
}

function setAssetsRef(ref) {
  assets = ref;
}

function getContext() {
  return daContext;
}

function getCurrentPageUrl() {
  if (daContext?.org && daContext?.repo && daContext?.path) {
    let pagePath = daContext.path;
    if (!pagePath.endsWith('.html')) {
      pagePath += '.html';
    }
    return `${CONTENT_DA_LIVE_BASE}/${daContext.org}/${daContext.repo}${pagePath}`;
  }
  return null;
}

/**
 * Extract a meaningful name from a URL, handling external URLs better
 * @param {string} src - The source URL
 * @returns {string} - A meaningful name for the asset
 */
function extractAssetNameFromUrl(src) {
  if (!src) return 'Untitled Asset';

  try {
    let cleanSrc = src;

    const [cleanSrcWithoutQuery] = cleanSrc.split('?');
    cleanSrc = cleanSrcWithoutQuery;

    const lastSlashIndex = cleanSrc.lastIndexOf('/');
    let filename = lastSlashIndex !== -1 ? cleanSrc.substring(lastSlashIndex + 1) : cleanSrc;
    if (/^media_[0-9a-fA-F]{8,}/.test(filename)) {
      return 'Untitled Asset';
    }

    if (filename) {
      filename = filename.replace(/\.(jpg|jpeg|png|gif|svg|webp|mp4|mov|avi|pdf|doc|docx)$/i, '');
      filename = filename.replace(/[-_]/g, ' ');
      filename = filename.replace(/\b\w/g, (l) => l.toUpperCase());
      filename = filename.trim();

      if (filename.length > 50) {
        filename = `${filename.substring(0, 47)}...`;
      }
    }

    return filename || 'Untitled Asset';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error extracting asset name from URL:', src, error);
    return 'Untitled Asset';
  }
}

function isProbablyUrl(str) {
  return typeof str === 'string' && /^@?https?:\/\//.test(str);
}

/**
 * Normalize usedIn field to always be an array
 */
function normalizeUsedIn(usedIn) {
  if (Array.isArray(usedIn)) return usedIn;
  if (typeof usedIn === 'string') {
    return usedIn.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Load assets from media.json using DA API (content.da.live)
 */
async function loadAssetsFromMediaJson({ force = false } = {}) {
  try {
    let initialAssets = null;
    let mediaJsonExists = false;

    if (stateManager && stateManager.state && stateManager.state.apiConfig) {
      const data = await fetchSheetJson(stateManager.state.apiConfig, 'media.json');
      if (data && data.data && data.data.length > 0) {
        mediaJsonExists = true;

        initialAssets = data.data.map((asset) => ({
          ...asset,
          type: asset.type || 'image',
          name: (!isProbablyUrl(asset.name) ? asset.name : '') || (!isProbablyUrl(asset.alt) ? asset.alt : '') || extractAssetNameFromUrl(asset.src),
          alt: asset.alt && !isProbablyUrl(asset.alt) ? asset.alt : '',
          usedIn: normalizeUsedIn(asset.usedIn),
        }));
        if (assetBrowser && assetBrowser.processExternalAssets) {
          const pageContext = {
            site: daContext?.site,
            org: daContext?.org,
          };
          initialAssets = assetBrowser.processExternalAssets(initialAssets, pageContext);
        }

        assets.length = 0;
        assets.push(...initialAssets);

        assets.forEach((asset, i) => {
          if (!asset.index) asset.index = i + 1;
        });

        assetBrowser?.setAssets(assets);
        updateSidebarCounts(assets, getCurrentPageUrl());

        if (stateManager && typeof stateManager.syncMediaData === 'function') {
          stateManager.syncMediaData(initialAssets).catch((error) => {
            // eslint-disable-next-line no-console
            console.warn('[MediaLoader] Background IndexedDB storage failed:', error);
          });
        }
      } else if (data) {
        mediaJsonExists = true;

        assets.length = 0;
        assetBrowser?.setAssets(assets);
        updateSidebarCounts(assets, getCurrentPageUrl());
      } else {

      }
      if (force) {
        setTimeout(async () => {
          const updatedData = await fetchSheetJson(stateManager.state.apiConfig, 'media.json');
          if (updatedData && updatedData.data && updatedData.data.length > 0) {
            const updatedAssets = updatedData.data.map((asset) => ({
              ...asset,
              type: asset.type || 'image',
              name: (!isProbablyUrl(asset.name) ? asset.name : '') || (!isProbablyUrl(asset.alt) ? asset.alt : '') || extractAssetNameFromUrl(asset.src),
              alt: asset.alt && !isProbablyUrl(asset.alt) ? asset.alt : '',
              isExternal: typeof asset.isExternal === 'boolean' ? asset.isExternal : false,
              usedIn: normalizeUsedIn(asset.usedIn),
            }));
            if (assetBrowser && assetBrowser.processExternalAssets) {
              const pageContext = {
                site: daContext?.site,
                org: daContext?.org,
              };
              const processedAssets = assetBrowser.processExternalAssets(updatedAssets, pageContext);

              assets.length = 0;
              assets.push(...processedAssets);
              assetBrowser?.setAssets(assets);
              updateSidebarCounts(assets, getCurrentPageUrl());

              if (stateManager && typeof stateManager.syncMediaData === 'function') {
                stateManager.syncMediaData(processedAssets).catch((error) => {
                  // eslint-disable-next-line no-console
                  console.warn('[MediaLoader] Background IndexedDB update failed:', error);
                });
              }
            } else {
              assets.length = 0;
              assets.push(...updatedAssets);
              assetBrowser?.setAssets(assets);
              updateSidebarCounts(assets, getCurrentPageUrl());

              if (stateManager && typeof stateManager.syncMediaData === 'function') {
                stateManager.syncMediaData(updatedAssets).catch((error) => {
                  // eslint-disable-next-line no-console
                  console.warn('[MediaLoader] Background IndexedDB update failed:', error);
                });
              }
            }
          }
        }, 1000);
      }
      return { mediaJsonExists, assets: initialAssets || [] };
    }
    const remoteUrl = `${CONTENT_DA_LIVE_BASE}/${daContext?.org}/${daContext?.repo}/.da/media.json`;
    try {
      const { loadSheetFile } = await import('./sheet-utils.js');
      const data = await loadSheetFile(remoteUrl, daContext?.token);

      if (data && Array.isArray(data.data) && data.data.length > 0) {
        mediaJsonExists = true;
        initialAssets = data.data.map((asset) => ({
          ...asset,
          type: asset.type || 'image',
          name: (!isProbablyUrl(asset.name) ? asset.name : '') || (!isProbablyUrl(asset.alt) ? asset.alt : '') || extractAssetNameFromUrl(asset.src),
          alt: asset.alt && !isProbablyUrl(asset.alt) ? asset.alt : '',
          usedIn: normalizeUsedIn(asset.usedIn),
        }));
        if (assetBrowser && assetBrowser.processExternalAssets) {
          const pageContext = {
            site: daContext?.site,
            org: daContext?.org,
          };
          initialAssets = assetBrowser.processExternalAssets(initialAssets, pageContext);
        }

        assets.length = 0;
        assets.push(...initialAssets);

        assets.forEach((asset, i) => {
          if (!asset.index) asset.index = i + 1;
        });
        assetBrowser?.setAssets(assets);
        updateSidebarCounts(assets, getCurrentPageUrl());

        if (stateManager && typeof stateManager.syncMediaData === 'function') {
          stateManager.syncMediaData(initialAssets).catch((error) => {
            // eslint-disable-next-line no-console
            console.warn('[MediaLoader] Background IndexedDB storage failed:', error);
          });
        }
      } else {
        assets.length = 0;
        assetBrowser?.setAssets(assets);
        updateSidebarCounts(assets, getCurrentPageUrl());
      }
      if (force) {
        setTimeout(async () => {
          const updatedData = await loadSheetFile(remoteUrl, daContext?.token);
          if (updatedData && Array.isArray(updatedData.data) && updatedData.data.length > 0) {
            const updatedAssets = updatedData.data.map((asset) => ({
              ...asset,
              type: asset.type || 'image',
              name: (!isProbablyUrl(asset.name) ? asset.name : '') || (!isProbablyUrl(asset.alt) ? asset.alt : '') || extractAssetNameFromUrl(asset.src),
              alt: asset.alt && !isProbablyUrl(asset.alt) ? asset.alt : '',
              isExternal: typeof asset.isExternal === 'boolean' ? asset.isExternal : false,
              usedIn: normalizeUsedIn(asset.usedIn),
            }));
            if (assetBrowser && assetBrowser.processExternalAssets) {
              const pageContext = {
                site: daContext?.site,
                org: daContext?.org,
              };
              const processedAssets = assetBrowser.processExternalAssets(updatedAssets, pageContext);

              assets.length = 0;
              assets.push(...processedAssets);
              assetBrowser?.setAssets(assets);
              updateSidebarCounts(assets, getCurrentPageUrl());

              if (stateManager && typeof stateManager.syncMediaData === 'function') {
                stateManager.syncMediaData(processedAssets).catch((error) => {
                  // eslint-disable-next-line no-console
                  console.warn('[MediaLoader] Background IndexedDB update failed:', error);
                });
              }
            } else {
              assets.length = 0;
              assets.push(...updatedAssets);
              assetBrowser?.setAssets(assets);
              updateSidebarCounts(assets, getCurrentPageUrl());

              if (stateManager && typeof stateManager.syncMediaData === 'function') {
                stateManager.syncMediaData(updatedAssets).catch((error) => {
                  // eslint-disable-next-line no-console
                  console.warn('[MediaLoader] Background IndexedDB update failed:', error);
                });
              }
            }
          }
        }, 1000);
      }
      return { mediaJsonExists, assets: initialAssets || [] };
    } catch (error) {
      if (error.message && error.message.includes('404')) {
        // eslint-disable-next-line no-console
        console.log('[MediaLoader] media.json not found (expected for first runs)');
      } else {
        // eslint-disable-next-line no-console
        console.error('[MediaLoader] Error loading assets:', error);
      }
      assets.length = 0;
      assetBrowser?.setAssets(assets);
      updateSidebarCounts(assets, getCurrentPageUrl());
      return { mediaJsonExists: false, assets: [] };
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error loading assets:', error);
    return { mediaJsonExists: false, assets: [] };
  }
}

export {
  loadAssetsFromMediaJson,
  setContext,
  setAssetBrowser,
  setStateManager,
  setAssetsRef,
  getContext,
  extractAssetNameFromUrl,
};
