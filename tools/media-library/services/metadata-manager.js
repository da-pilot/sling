/* eslint-disable no-use-before-define */
/**
 * Metadata Manager - Handles media metadata operations and persistence
 * Provides comprehensive metadata management for media library
 */

import {
  buildSingleSheet,
  saveSheetFile,
  loadDataSafe,
} from '../modules/sheet-utils.js';
import { CONTENT_DA_LIVE_BASE } from '../constants.js';

export default function createMetadataManager(docAuthoringService, metadataPath) {
  const state = {
    config: null,
    daApi: docAuthoringService,
    metadataPath: metadataPath || '/.media/media.json',
    fullMetadataPath: null,
    cache: new Map(),
    cacheTimeout: 5 * 60 * 1000,
  };

  async function init(config) {
    state.config = config;
    const daConfig = state.daApi.getConfig();
    state.fullMetadataPath = `/${daConfig.org}/${daConfig.repo}${state.metadataPath}`;
  }

  function validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return false;
    }
    if (!Array.isArray(metadata)) {
      return false;
    }
    return true;
  }

  async function getMetadata() {
    try {
      if (!state.daApi) {
        throw new Error('DA API not initialized');
      }

      const daConfig = state.daApi.getConfig();
      if (!daConfig || !daConfig.baseUrl) {
        throw new Error('Invalid configuration: baseUrl is missing from DA API');
      }
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${state.fullMetadataPath}`;
      const parsedData = await loadDataSafe(contentUrl, daConfig.token);

      if (parsedData.data && Array.isArray(parsedData.data)) {
        return parsedData.data;
      }

      if (parsedData.data && typeof parsedData.data === 'object' && parsedData.data.data && Array.isArray(parsedData.data.data)) {
        return parsedData.data.data;
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  async function saveMetadata(metadata) {
    try {
      if (!state.daApi) {
        throw new Error('DA API not initialized');
      }

      const daConfig = state.daApi.getConfig();
      if (!daConfig || !daConfig.baseUrl) {
        throw new Error('Invalid configuration: baseUrl is missing from DA API');
      }

      const mediaArray = metadata || [];
      const normalizedMediaArray = mediaArray.map((media) => {
        const normalized = { ...media };
        if (Array.isArray(media.usedIn)) {
          const filteredUsedIn = media.usedIn.filter((item) => item && typeof item === 'string' && item.trim().length > 0);
          normalized.usedIn = Array.from(new Set(filteredUsedIn)).join(',');
        }
        return normalized;
      });
      const sheetData = buildSingleSheet(normalizedMediaArray);
      const url = `${daConfig.baseUrl}/source${state.fullMetadataPath}`;
      await saveSheetFile(url, sheetData, daConfig.token);

      // Add small delay to ensure file is fully written before reading
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });

      return true;
    } catch (error) {
      console.error('[Metadata Manager] ❌ Failed to save metadata:', error);
      throw error;
    }
  }

  async function updateMetadata(newMediaItems) {
    try {
      const existingMedia = await getMetadata();

      const existingMediaIds = new Set(existingMedia.map((item) => item.id));
      const newItems = newMediaItems.filter((item) => !existingMediaIds.has(item.id));

      const updatedMedia = [...existingMedia, ...newItems];

      await saveMetadata(updatedMedia);
      return updatedMedia;
    } catch (error) {
      console.error('[Metadata Manager] ❌ Failed to update metadata:', error);
      throw error;
    }
  }

  async function clearMetadata() {
    try {
      await state.daApi.deleteFile(state.fullMetadataPath);

      const cacheKey = 'metadata_centralized';
      state.cache.delete(cacheKey);

      console.log('[Metadata Manager] ✅ Metadata cleared successfully:', state.fullMetadataPath);
      return true;
    } catch (error) {
      console.error('[Metadata Manager] ❌ Failed to clear metadata:', error);
      return false;
    }
  }

  async function importMetadata(fileContent) {
    try {
      const data = JSON.parse(fileContent);
      const validatedData = validateImportedData(data);

      await saveMetadata(validatedData);
      return validatedData;
    } catch (error) {
      console.error('[Metadata Manager] ❌ Failed to import metadata:', error);
      throw error;
    }
  }

  function validateImportedData(data) {
    if (!validateMetadata(data)) {
      throw new Error('Invalid metadata format');
    }

    const validatedData = {
      media: data.map((item) => ({
        id: item.id || generateId(),
        src: item.src || '',
        alt: item.alt || '',
        title: item.title || '',
        type: item.type || 'unknown',
        displayName: item.displayName || '',

        discoveredAt: item.discoveredAt || new Date().toISOString(),
        metadata: item.metadata || {},
      })),
      totalMedia: data.media.length,
      createdAt: data.createdAt || new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    return validatedData;
  }

  function generateId() {
    const part1 = Math.random().toString(36).substring(2, 15);
    const part2 = Math.random().toString(36).substring(2, 15);
    return `${part1}${part2}`;
  }

  async function createMetadataFile() {
    try {
      const defaultMetadata = [];
      await saveMetadata(defaultMetadata);
      return defaultMetadata;
    } catch (error) {
      console.error('[Metadata Manager] ❌ Failed to create metadata file:', error);
      throw error;
    }
  }

  function clearCache() {
    state.cache.clear();
    console.log('[Metadata Manager] 🗑️ Cache cleared');
  }

  return {
    init,
    getMetadata,
    saveMetadata,
    updateMetadata,
    clearMetadata,
    importMetadata,
    createMetadataFile,
    clearCache,
  };
}
