/**
 * Discovery engine
 * Main workflow coordinator for the discovery process
 */

import createDiscoveryEvents from './discovery-events.js';
import createStatsTracker from './stats-tracker.js';
import createDiscoveryPersistenceManager from './persistence-manager.js';
import createParallelProcessor from './parallel-processor.js';
import createDocumentScanner from './document-scanner.js';
import createSiteAggregator from './site-aggregator.js';

export default function createDiscoveryEngine() {
  const eventEmitter = createDiscoveryEvents();
  const statsTracker = createStatsTracker();
  const persistenceManager = createDiscoveryPersistenceManager();
  const parallelProcessor = createParallelProcessor();
  const documentScanner = createDocumentScanner();
  const siteAggregator = createSiteAggregator();
  const state = {
    discoveryStartTime: null,
    discoveryType: 'full',
    isRunning: false,
  };

  async function init(docAuthoringService, sessionManagerInstance, processingStateManagerInstance) {
    const apiConfig = docAuthoringService.getConfig();
    const daApi = docAuthoringService;
    await persistenceManager.init(apiConfig, processingStateManagerInstance, daApi);
    await documentScanner.init(apiConfig, daApi);
    await siteAggregator.init(apiConfig);
    siteAggregator.setDaApi(daApi);
  }

  async function triggerDiscoveryComplete() {
    try {
      const progress = statsTracker.getProgress();
      const finalCheckpoint = {
        totalFolders: progress.totalFolders,
        completedFolders: progress.completedFolders,
        totalDocuments: progress.totalDocuments,
        status: 'completed',
        lastUpdated: Date.now(),
      };
      await persistenceManager.saveDiscoveryCheckpointFile(finalCheckpoint);
      const siteStructure = await siteAggregator.createSiteStructure();
      if (siteStructure) {
        await siteAggregator.saveSiteStructure(siteStructure);
      }
      const discoveryDuration = Date.now() - state.discoveryStartTime;
      eventEmitter.emitDiscoveryComplete({
        totalFolders: progress.totalFolders,
        completedFolders: progress.completedFolders,
        totalDocuments: progress.totalDocuments,
        discoveryDuration,
        siteStructure,
      });
    } catch (error) {
      console.error('[Discovery Engine] ❌ Failed to complete discovery:', error);
    }
  }
  async function resetDiscoveryState() {
    try {
      state.isRunning = false;
      state.discoveryStartTime = null;
      state.discoveryType = 'full';
      parallelProcessor.cleanupAll();
      statsTracker.resetProgress();
      localStorage.removeItem('discovery-folder-status');
      localStorage.removeItem('discovery-excluded-data');
      localStorage.removeItem('media-discovery-checkpoint');
      localStorage.removeItem('media-discovery-progress');
      localStorage.removeItem('media-scanning-checkpoint');
      console.log('[Discovery Engine] 🧹 Cleared all localStorage discovery data');
      try {
        await persistenceManager.ensureRequiredFolders();
        const defaultCheckpoint = {
          totalFolders: 0,
          completedFolders: 0,
          totalDocuments: 0,
          status: 'idle',
          lastUpdated: Date.now(),
        };
        await persistenceManager.saveDiscoveryCheckpointFile(defaultCheckpoint);
        console.log('[Discovery Engine] 🗄️ Cleared all persistence data');
      } catch (error) {
        console.warn('[Discovery Engine] ⚠️ Failed to clear persistence data:', error.message);
      }
    } catch (error) {
      console.error('[Discovery Engine] ❌ Failed to reset discovery state:', error);
    }
  }
  async function processFoldersInParallel(folders) {
    const promises = folders.map((folder) => documentScanner.processFolder(
      folder,
      state.discoveryType,
      parallelProcessor,
      statsTracker,
      eventEmitter,
    ));
    await Promise.all(promises);
    await triggerDiscoveryComplete();
  }
  async function startDiscoveryWithSession() {
    try {
      state.discoveryStartTime = Date.now();
      console.log('[Discovery Engine] 🚀 Discovery started at:', new Date().toISOString());
      state.isRunning = true;
      const checkpoint = await persistenceManager.loadDiscoveryCheckpoint();
      state.discoveryType = checkpoint.discoveryType || 'full';
      await resetDiscoveryState();
      const { folders, files } = await documentScanner.getTopLevelItems();
      const totalWork = folders.length + (files.length > 0 ? 1 : 0);
      statsTracker.setTotalFolders(totalWork);
      if (files.length > 0) {
        await documentScanner.processRootFiles(files, statsTracker, eventEmitter);
      }
      if (folders.length > 0) {
        await processFoldersInParallel(folders);
      } else {
        await triggerDiscoveryComplete();
      }
    } catch (error) {
      console.error('[Discovery Engine] ❌ Discovery failed:', error);
      state.isRunning = false;
    } finally {
      state.isRunning = false;
    }
  }

  async function stopDiscovery() {
    state.isRunning = false;
    parallelProcessor.cleanupAll();
  }

  async function pauseDiscovery() {
    state.isRunning = false;
    parallelProcessor.broadcastToWorkers({ type: 'stopDiscovery' });
  }

  async function resumeDiscovery() {
    state.isRunning = true;
  }

  function on(event, callback) {
    return eventEmitter.on(event, callback);
  }

  function off(event, callback) {
    return eventEmitter.off(event, callback);
  }

  function getProgress() {
    return statsTracker.getProgress();
  }

  function getProgressSummary() {
    return statsTracker.getProgressSummary();
  }
  async function buildSiteStructureFromDiscoveryFiles() {
    return siteAggregator.buildSiteStructureFromDiscoveryFiles();
  }
  async function clearQueue() {
    parallelProcessor.cleanupAll();
    statsTracker.resetProgress();
  }
  return {
    init,
    startDiscoveryWithSession,
    stopDiscovery,
    pauseDiscovery,
    resumeDiscovery,
    resetDiscoveryState,
    on,
    off,
    getProgress,
    getProgressSummary,
    buildSiteStructureFromDiscoveryFiles,
    clearQueue,
  };
}