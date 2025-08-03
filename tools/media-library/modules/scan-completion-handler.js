import createScanStatusUpdater from './queue/scan-status-updater.js';
import createSiteAggregator from './discovery/site-aggregator.js';
import createPersistenceManager from '../services/persistence-manager.js';
import createDiscoveryFileManager from './queue/discovery-file-manager.js';

export default function createScanCompletionHandler() {
  const state = {
    scanStatusUpdater: null,
    siteAggregator: null,
    persistenceManager: null,
    config: null,
    daApi: null,
    processingStateManager: null,
  };

  async function init(config, daApi, processingStateManager) {
    state.config = config;
    state.daApi = daApi;
    state.processingStateManager = processingStateManager;
    state.scanStatusUpdater = createScanStatusUpdater();
    state.siteAggregator = createSiteAggregator();
    state.persistenceManager = createPersistenceManager();
    await state.persistenceManager.init();
    state.siteAggregator.init(config);
    state.siteAggregator.setDaApi(daApi);
  }

  async function updateAllDiscoveryFiles(discoveryFiles) {
    let files = discoveryFiles;
    if (!files || files.length === 0) {
      const discoveryFileManager = createDiscoveryFileManager();
      files = await discoveryFileManager.loadDiscoveryFilesWithChangeDetection(
        state.config,
        state.daApi,
        () => [],
      );
    }
    return state.scanStatusUpdater.updateAllDiscoveryFiles(
      state.config,
      state.daApi,
      state.persistenceManager,
      files,
    );
  }

  async function updateSiteStructureWithMediaCounts() {
    try {
      console.log('[Completion Handler] Reconstructing site structure from updated discovery files...');
      const newSiteStructure = await state.siteAggregator.createSiteStructure();
      if (newSiteStructure) {
        await state.processingStateManager.saveSiteStructureFile(newSiteStructure);
        console.log('[Completion Handler] Site structure reconstructed and saved from discovery files:', {
          totalFolders: newSiteStructure?.stats?.totalFolders || 0,
          totalFiles: newSiteStructure?.stats?.totalFiles || 0,
          totalMediaItems: newSiteStructure?.stats?.totalMediaItems || 0,
        });
      } else {
        console.error('[Completion Handler] Failed to create site structure');
      }
      try {
        await state.persistenceManager.clearMediaStore();
        console.log('[Completion Handler] Cleared media store to prevent stale data');
      } catch (error) {
        console.warn('[Completion Handler] Failed to clear media store:', error.message);
      }
    } catch (error) {
      console.error('[Completion Handler] Failed to reconstruct site structure:', error);
    }
  }

  async function updateDiscoveryFileScanStatus(
    fileName,
    pagePath,
    status,
    mediaCount = 0,
    error = null,
  ) {
    return state.scanStatusUpdater.updateDiscoveryFileScanStatus(
      state.config,
      state.daApi,
      state.processingStateManager,
      fileName,
      pagePath,
      status,
      mediaCount,
      error,
    );
  }

  async function updateSiteStructureMediaCount(pagePath, mediaCount) {
    return state.scanStatusUpdater.updateSiteStructureMediaCount(
      state.processingStateManager,
      pagePath,
      mediaCount,
    );
  }

  function updateFolderMediaCount(folder, pagePath, mediaCount) {
    return state.scanStatusUpdater.updateFolderMediaCount(folder, pagePath, mediaCount);
  }

  async function saveScanningCheckpoint(checkpointData) {
    if (state.processingStateManager && checkpointData.sessionId) {
      await state.processingStateManager.saveScanningCheckpointFile(checkpointData);
    }
  }

  async function processRemainingMedia(sessionId) {
    try {
      const queueItems = await state.persistenceManager.getProcessingQueue(sessionId);
      const totalQueuedItems = queueItems.reduce((sum, item) => sum + (item.media?.length || 0), 0);
      return { totalQueuedItems, queueItems };
    } catch (error) {
      console.error('[Completion Handler] Error processing remaining media:', error);
      return { totalQueuedItems: 0, queueItems: [] };
    }
  }

  return {
    init,
    updateAllDiscoveryFiles,
    updateSiteStructureWithMediaCounts,
    updateDiscoveryFileScanStatus,
    updateSiteStructureMediaCount,
    updateFolderMediaCount,
    saveScanningCheckpoint,
    processRemainingMedia,
  };
}