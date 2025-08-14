/* eslint-disable no-console */

import { DA_PATHS, LOCALSTORAGE_KEYS } from '../constants.js';
import createMetadataManager from '../services/metadata-manager.js';

/**
 * Media Loader Module
 * Handles loading media from media.json and managing media browser references
 */

let contextRef = null;
let docAuthoringServiceRef = null;

/**
 * Ensure media.json is properly synchronized
 */
export async function ensureMediaJsonSync() {
  try {
    if (!contextRef || !docAuthoringServiceRef) {
      console.warn('[Media Loader] Context or DocAuthoringService not set, skipping sync');
      return {
        mediaCount: 0,
        isSynchronized: false,
      };
    }

    console.log('[Media Loader] Ensuring media.json synchronization...');

    const metadataManager = createMetadataManager(docAuthoringServiceRef, '/.media/media.json');
    await metadataManager.init(contextRef);

    const metadata = await metadataManager.getMetadata();
    const mediaCount = metadata ? metadata.length : 0;

    console.log('[Media Loader] Current media.json contains', mediaCount, 'items');

    return {
      mediaCount,
      isSynchronized: true,
    };
  } catch (error) {
    console.error('[Media Loader] Failed to ensure media.json sync:', error);
    return {
      mediaCount: 0,
      isSynchronized: false,
      error: error.message,
    };
  }
}

/**
 * Check for changes in media.json file
 * @returns {Promise<{hasChanges: boolean, lastModified?: number,
 * mediaJsonExists: boolean, authError?: boolean}>}
 */
export async function checkMediaJsonChanges() {
  try {
    console.log('[Media Loader] Checking for media.json changes');
    if (!contextRef || !docAuthoringServiceRef) {
      console.log('[Media Loader] Context or service not available for change check');
      return { hasChanges: false, mediaJsonExists: false };
    }
    const fullPath = DA_PATHS.getMediaDataFile(contextRef.org, contextRef.repo);
    const storageDir = DA_PATHS.getStorageDir(contextRef.org, contextRef.repo);
    console.log('[Media Loader] Checking path:', fullPath);
    const files = await docAuthoringServiceRef.listPath(storageDir);
    const mediaJsonFile = files.find((f) => f.path === fullPath);
    if (!mediaJsonFile) {
      console.log('[Media Loader] media.json file not found');
      return { hasChanges: false, mediaJsonExists: false };
    }
    const storageKey = `${LOCALSTORAGE_KEYS.MEDIA_JSON_LASTMODIFIED}_${contextRef.org}_${contextRef.repo}`;
    const storedLastModified = localStorage.getItem(storageKey);
    const hasChanges = !storedLastModified
      || parseInt(storedLastModified, 10) !== mediaJsonFile.lastModified;
    console.log('[Media Loader] Change check:', {
      storedLastModified,
      currentLastModified: mediaJsonFile.lastModified,
      hasChanges,
    });
    return {
      hasChanges,
      lastModified: mediaJsonFile.lastModified,
      mediaJsonExists: true,
    };
  } catch (error) {
    console.error('[Media Loader] Error checking media changes:', error);
    const isAuthError = error.message && error.message.includes('HTTP 401');
    return {
      hasChanges: false,
      mediaJsonExists: false,
      authError: isAuthError,
    };
  }
}

/**
 * Load media from media.json file with change detection
 */
export async function loadMediaFromMediaJson() {
  try {
    if (!contextRef) {
      throw new Error('Context not set. Call setContext() first.');
    }
    if (!docAuthoringServiceRef) {
      throw new Error('Document Authoring Service not set. Call setDocAuthoringService() first.');
    }
    const changeCheck = await checkMediaJsonChanges();
    if (!changeCheck.mediaJsonExists) {
      return { mediaJsonExists: false, media: [] };
    }
    const fullPath = DA_PATHS.getMediaDataFile(contextRef.org, contextRef.repo);
    const relativePath = fullPath.replace(`/${contextRef.org}/${contextRef.repo}`, '');
    const metadataManager = createMetadataManager(docAuthoringServiceRef, relativePath);
    await metadataManager.init(contextRef);
    const metadata = await metadataManager.getMetadata();
    console.log('[Media Loader] Metadata Length:', metadata.length);
    const storageKey = `${LOCALSTORAGE_KEYS.MEDIA_JSON_LASTMODIFIED}_${contextRef.org}_${contextRef.repo}`;
    if (changeCheck.hasChanges) {
      localStorage.setItem(storageKey, changeCheck.lastModified.toString());
    }
    return {
      mediaJsonExists: true,
      media: metadata || [],
      lastModified: changeCheck.lastModified,
      hasChanges: changeCheck.hasChanges,
    };
  } catch (error) {
    console.error('[Media Loader] Error loading media:', error);
    return { mediaJsonExists: false, media: [], error: error.message };
  }
}

/**
 * Set context reference
 */
export function setContext(context) {
  console.log('[Media Loader] Setting context:', { org: context.org, repo: context.repo });
  contextRef = context;
}

/**
 * Set Document Authoring Service reference
 */
export function setDocAuthoringService(docAuthoringService) {
  console.log('[Media Loader] Setting docAuthoringService');
  docAuthoringServiceRef = docAuthoringService;
}

let pollingInterval = null;

/**
 * Stop polling for media.json updates
 */
export function stopMediaPolling() {
  console.log('[Media Loader] Stopping polling');
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[Media Loader] Polling stopped successfully');
  } else {
    console.log('[Media Loader] No polling interval to stop');
  }
}

/**
 * Start polling for media.json updates
 * @param {Function} onUpdate - Callback function when updates are detected
 * @param {number} intervalMs - Polling interval in milliseconds (default: 30000)
 */
export function startMediaPolling(onUpdate, intervalMs = 30000) {
  console.log('[Media Loader] Starting polling with interval:', intervalMs);
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  pollingInterval = setInterval(async () => {
    try {
      console.log('[Media Loader] Polling check started');
      if (!contextRef || !docAuthoringServiceRef) {
        console.log('[Media Loader] Context or service not available, skipping poll');
        return;
      }
      const changeCheck = await checkMediaJsonChanges();
      console.log('[Media Loader] Change check result:', changeCheck);
      if (changeCheck.authError) {
        console.log('[Media Loader] Auth error detected, stopping polling');
        stopMediaPolling();
        const { showToast } = await import('./toast.js');
        showToast('Authentication expired. Please refresh the page to continue.', 'error');
        return;
      }
      if (changeCheck.hasChanges && onUpdate && typeof onUpdate === 'function') {
        console.log('[Media Loader] Changes detected, loading updated media');
        const { media, lastModified } = await loadMediaFromMediaJson();
        onUpdate(media, lastModified);
      } else {
        console.log('[Media Loader] No changes detected or no update callback');
      }
    } catch (error) {
      console.error('[Media Loader] Polling error:', error);
    }
  }, intervalMs);
  console.log('[Media Loader] Polling interval set successfully');
}