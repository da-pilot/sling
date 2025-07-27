/**
 * Media Library Utilities
 * Common utility functions inspired by DA Live patterns
 */

import { loadSheetFile, parseSheet } from './sheet-utils.js';

const AEM_PREVIEW_REQUEST_URL = 'https://admin.hlx.page/preview';

/**
 * Preview a file using AEM Admin API
 * @param {string} filePath - Relative path to the file
 * @param {string} token - API token
 * @param {string} org - Organization name
 * @param {string} site - Site ID
 * @param {string} ref - Repository reference
 * @returns {Promise<boolean>} - Success status
 */
async function previewFile(filePath, token, org = 'da-pilot', site = 'sling', ref = 'main') {
  const cleanPath = filePath.replace(`/${org}/${site}`, '');
  const previewUrl = `${AEM_PREVIEW_REQUEST_URL}/${org}/${site}/${ref}${cleanPath}`;
  const opts = {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  };
  try {
    const resp = await fetch(previewUrl, opts);
    return resp.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Load file with fallback to preview URL
 * @param {string} primaryUrl - Primary content.da.live URL
 * @param {string} token - API token
 * @param {string} filePath - File path for fallback
 * @param {string} org - Organization name
 * @param {string} site - Site ID
 * @returns {Promise<Object>} - Parsed data or empty object
 */
async function loadFileWithFallback(primaryUrl, token, filePath, org = 'da-pilot', site = 'sling') {
  try {
    const rawData = await loadSheetFile(primaryUrl, token);
    return parseSheet(rawData);
  } catch (error) {
    if (error.message.includes('404')) {
      try {
        const cleanPath = filePath.replace(`/${org}/${site}`, '');
        const fallbackUrl = `https://main--${site}--${org}.aem.page${cleanPath}`;
        const rawData = await loadSheetFile(fallbackUrl, token);
        return parseSheet(rawData);
      } catch (fallbackError) {
        return { data: [] };
      }
    }
    return { data: [] };
  }
}

/**
 * Debounce function calls (from DA Live Utils)
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a promise that resolves after specified delay
 */
function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Create utils module with only used functions
 */
function createUtils() {
  return {
    debounce,
    delay,
    previewFile,
    loadFileWithFallback,
  };
}

export default createUtils;

export function getOrgRepo(context) {
  if (context?.org && context?.repo) {
    return { org: context.org, repo: context.repo };
  }
  try {
    const { hostname } = window.location;
    if (hostname.includes('aem.page') || hostname.includes('aem.live')) {
      const parts = hostname.split('--');
      if (parts.length >= 3) {
        const org = parts[2].split('.')[0];
        const repo = parts[1];
        if (org && repo) {
          return { org, repo };
        }
      }
    }
  } catch (e) {
    console.error('[Utils] Error getting org and repo:', e);
  }
  throw new Error('Unable to determine org and repo');
}
