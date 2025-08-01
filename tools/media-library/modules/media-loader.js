/* eslint-disable no-console */

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
 * Load media from media.json file
 */
export async function loadMediaFromMediaJson() {
  try {
    if (!contextRef) {
      throw new Error('Context not set. Call setContext() first.');
    }

    if (!docAuthoringServiceRef) {
      throw new Error('Document Authoring Service not set. Call setDocAuthoringService() first.');
    }

    console.log('[Media Loader] Loading media from media.json...');

    const metadataManager = createMetadataManager(docAuthoringServiceRef, '/.media/media.json');
    await metadataManager.init(contextRef);

    const metadata = await metadataManager.getMetadata();

    if (metadata && metadata.length > 0) {
      console.log('[Media Loader] Loaded', metadata.length, 'media from media.json');
      return {
        mediaJsonExists: true,
        media: metadata,
      };
    }

    console.log('[Media Loader] No media found in media.json, creating empty file...');
    try {
      await metadataManager.createMetadataFile();
      console.log('[Media Loader] Empty media.json created successfully');
    } catch (createError) {
      console.error('[Media Loader] Failed to create media.json:', createError);
    }

    return {
      mediaJsonExists: false,
      media: [],
    };
  } catch (error) {
    console.error('[Media Loader] Error loading media:', error);
    return {
      mediaJsonExists: false,
      media: [],
      error: error.message,
    };
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