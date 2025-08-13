/* eslint-disable no-console */

import { DA_PATHS, LOCALSTORAGE_KEYS } from '../constants.js';
import createMetadataManager from '../services/metadata-manager.js';
import createPersistenceManager from '../services/persistence-manager.js';

/**
 * Media Loader Module
 * Handles loading media from media.json and managing media browser references
 */

let contextRef = null;
let docAuthoringServiceRef = null;
let mediaBrowserRef = null;

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
    if (!contextRef || !docAuthoringServiceRef) {
      return { hasChanges: false, mediaJsonExists: false };
    }
    const fullPath = DA_PATHS.getMediaDataFile(contextRef.org, contextRef.repo);
    const storageDir = DA_PATHS.getStorageDir(contextRef.org, contextRef.repo);
    const files = await docAuthoringServiceRef.listPath(storageDir);
    const mediaJsonFile = files.find((f) => f.path === fullPath);
    if (!mediaJsonFile) {
      return { hasChanges: false, mediaJsonExists: false };
    }
    const storageKey = `${LOCALSTORAGE_KEYS.MEDIA_JSON_LASTMODIFIED}_${contextRef.org}_${contextRef.repo}`;
    const storedLastModified = localStorage.getItem(storageKey);
    const hasChanges = !storedLastModified
      || parseInt(storedLastModified, 10) !== mediaJsonFile.lastModified;
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

export async function loadMediaFromIndexedDB() {
  try {
    if (!contextRef || !docAuthoringServiceRef) {
      console.warn('[Media Loader] Context or DocAuthoringService not set, skipping IndexedDB load');
      return { mediaCount: 0, isLoaded: false };
    }

    console.log('[Media Loader] Loading media from IndexedDB...');

    const metadataManager = createMetadataManager(docAuthoringServiceRef, '/.media/media.json');
    await metadataManager.init(contextRef);

    const metadata = await metadataManager.getMetadata();
    const mediaCount = metadata ? metadata.length : 0;

    console.log('[Media Loader] Loaded', mediaCount, 'media items from IndexedDB');

    if (mediaBrowserRef && metadata) {
      mediaBrowserRef.setMedia(metadata);
    }

    return {
      mediaCount,
      isLoaded: true,
      media: metadata || [],
    };
  } catch (error) {
    console.error('[Media Loader] Failed to load media from IndexedDB:', error);
    return {
      mediaCount: 0,
      isLoaded: false,
      media: [],
    };
  }
}

export async function checkIndexedDBStatus() {
  try {
    if (!contextRef || !docAuthoringServiceRef) {
      console.warn('[Media Loader] Context or DocAuthoringService not set, skipping IndexedDB check');
      return { hasData: false, queueCount: 0, totalItems: 0 };
    }

    console.log('[Media Loader] Checking IndexedDB status...');

    const persistenceManager = createPersistenceManager();
    await persistenceManager.init();

    const queueItems = await persistenceManager.getProcessingQueue();
    const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);

    const stats = await persistenceManager.getStats();
    console.log('[Media Loader] IndexedDB stats:', stats);

    const hasData = totalQueuedItems > 0;
    console.log('[Media Loader] IndexedDB status:', {
      hasData,
      queueCount: queueItems.length,
      totalItems: totalQueuedItems,
      stats,
    });

    return {
      hasData,
      queueCount: queueItems.length,
      totalItems: totalQueuedItems,
      stats,
    };
  } catch (error) {
    console.error('[Media Loader] Error checking IndexedDB status:', error);
    return {
      hasData: false,
      queueCount: 0,
      totalItems: 0,
      error: error.message,
    };
  }
}

/**
 * Set media browser reference
 */
export function setMediaBrowser(browser) {
  mediaBrowserRef = browser;
}

/**
 * Set context reference
 */
export function setContext(context) {
  contextRef = context;
}

/**
 * Set Document Authoring Service reference
 */
export function setDocAuthoringService(docAuthoringService) {
  docAuthoringServiceRef = docAuthoringService;
}

let pollingInterval = null;

/**
 * Stop polling for media.json updates
 */
export function stopMediaPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Start polling for media.json updates
 * @param {Function} onUpdate - Callback function when updates are detected
 * @param {number} intervalMs - Polling interval in milliseconds (default: 30000)
 */
export function startMediaPolling(onUpdate, intervalMs = 30000) {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  pollingInterval = setInterval(async () => {
    try {
      if (!contextRef || !docAuthoringServiceRef) {
        return;
      }
      const changeCheck = await checkMediaJsonChanges();
      if (changeCheck.authError) {
        stopMediaPolling();
        const { showToast } = await import('./toast.js');
        showToast('Authentication expired. Please refresh the page to continue.', 'error');
        return;
      }
      if (changeCheck.hasChanges && onUpdate && typeof onUpdate === 'function') {
        const { media, lastModified } = await loadMediaFromMediaJson();
        onUpdate(media, lastModified);
      }
    } catch (error) {
      console.error('[Media Loader] Polling error:', error);
    }
  }, intervalMs);
}