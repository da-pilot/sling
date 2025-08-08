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
import { loadData, saveData } from '../sheet-utils.js';

export default function createDiscoveryEngine() {
  const eventEmitter = createDiscoveryEvents();
  const statsTracker = createStatsTracker();
  const persistenceManager = createDiscoveryPersistenceManager();
  const parallelProcessor = createParallelProcessor();
  const documentScanner = createDocumentScanner();
  const siteAggregator = createSiteAggregator();
  const state = {
    isRunning: false,
    discoveryStartTime: null,
    discoveryType: 'full',
    incrementalChanges: null,
    apiConfig: null,
    mediaProcessor: null,
    daApi: null,
  };

  async function removeDeletedFolderFiles(deletedFolders) {
    try {
      const promises = deletedFolders.map(async (folderName) => {
        const fileName = `${folderName}.json`;
        const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
        try {
          const success = await state.daApi.deleteFile(filePath);
          if (!success) {
            console.warn('[Discovery Engine] ⚠️ Failed to remove discovery file:', fileName);
          }
        } catch (error) {
          console.warn('[Discovery Engine] ⚠️ Could not remove discovery file:', {
            fileName,
            error: error.message,
          });
        }
      });
      await Promise.all(promises);
    } catch (error) {
      console.error('[Discovery Engine] ❌ Error removing deleted folder files:', error);
    }
  }

  async function buildSiteStructureFromDiscoveryFiles() {
    return siteAggregator.buildSiteStructureFromDiscoveryFiles();
  }

  async function markDeletedFolders(deletedFolders) {
    try {
      const promises = deletedFolders.map(async (folderName) => {
        const fileName = `${folderName}.json`;
        const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.media/.pages/${fileName}`;
        const url = `${state.apiConfig.baseUrl}/source${filePath}`;

        try {
          const existingData = await loadData(url, state.apiConfig.token);

          const documents = existingData?.data || [];

          if (documents.length > 0) {
            const updatedDocuments = documents.map((doc) => ({
              ...doc,
              entryStatus: 'deleted',
              scanStatus: 'deleted',
              scanComplete: false,
              needsRescan: false,
              lastScannedAt: new Date().toISOString(),
            }));

            await saveData(url, updatedDocuments, state.apiConfig.token);
            return updatedDocuments.map((doc) => doc.path);
          }
          return [];
        } catch (error) {
          console.warn('[Discovery Engine] ⚠️ Could not update deleted folder:', {
            folderName,
            error: error.message,
          });
          return [];
        }
      });

      const deletedDocumentPaths = await Promise.all(promises);
      const allDeletedPaths = deletedDocumentPaths.flat();
      if (allDeletedPaths.length > 0 && state.mediaProcessor) {
        await state.mediaProcessor.cleanupMediaForDeletedDocuments(allDeletedPaths);
      }
      await removeDeletedFolderFiles(deletedFolders);
      if (deletedFolders.length > 0) {
        await buildSiteStructureFromDiscoveryFiles();
      }
    } catch (error) {
      console.error('[Discovery Engine] ❌ Error marking deleted folders:', error);
    }
  }

  async function init(docAuthoringService, sessionManagerInstance, processingStateManagerInstance) {
    const apiConfig = docAuthoringService.getConfig();
    const daApi = docAuthoringService;
    await persistenceManager.init(apiConfig, processingStateManagerInstance, daApi);
    await documentScanner.init(apiConfig, daApi);
    await siteAggregator.init(apiConfig);
    siteAggregator.setDaApi(daApi);
    state.apiConfig = apiConfig;
    state.daApi = daApi;
  }

  /**
   * Trigger discovery completion
   * @returns {Promise<void>}
   */
  async function triggerDiscoveryComplete() {
    try {
      const progress = statsTracker.getProgress();
      const finalCheckpoint = {
        totalFolders: progress.totalFolders,
        completedFolders: progress.completedFolders,
        totalDocuments: progress.totalDocuments,
        status: 'completed',
        discoveryStartTime: state.discoveryStartTime,
        discoveryEndTime: Date.now(),
        discoveryType: state.discoveryType,
        lastUpdated: Date.now(),
      };
      await persistenceManager.saveDiscoveryCheckpointFile(finalCheckpoint);
      const siteStructure = await siteAggregator.createSiteStructure();
      if (siteStructure) {
        await siteAggregator.saveSiteStructure(siteStructure);
      }
      const discoveryDuration = Date.now() - (state.discoveryStartTime || Date.now());
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

  /**
   * Reset discovery state
   * @returns {Promise<void>}
   */
  async function resetDiscoveryState() {
    try {
      state.isRunning = false;
      state.discoveryType = 'full';
      parallelProcessor.cleanupAll();
      statsTracker.resetProgress();
      localStorage.removeItem('discovery-folder-status');
      localStorage.removeItem('discovery-excluded-data');
      localStorage.removeItem('media-discovery-checkpoint');
      localStorage.removeItem('media-discovery-progress');
      localStorage.removeItem('media-scanning-checkpoint');
      try {
        await persistenceManager.ensureRequiredFolders();
      } catch (error) {
        console.warn('[Discovery Engine] ⚠️ Failed to clear persistence data:', error.message);
      }
    } catch (error) {
      console.error('[Discovery Engine] ❌ Failed to reset discovery state:', error);
    }
  }
  async function processFoldersInParallel(folders) {
    const promises = folders.map((folder) => {
      const { incrementalChanges } = state;
      return documentScanner.processFolder(
        folder,
        state.discoveryType,
        parallelProcessor,
        statsTracker,
        eventEmitter,
        incrementalChanges,
      );
    });
    await Promise.all(promises);
    await triggerDiscoveryComplete();
  }

  /**
   * Start discovery with session
   * @param {string} sessionId - Session ID
   * @param {string} discoveryType - Discovery type ('full' or 'incremental')
   * @returns {Promise<Object>} Discovery result
   */
  async function startDiscoveryWithSession(sessionId, discoveryType) {
    try {
      state.discoveryStartTime = Date.now();
      state.discoveryType = discoveryType;
      if (discoveryType === 'full') {
        await resetDiscoveryState();
      } else {
        state.isRunning = false;
        parallelProcessor.cleanupAll();
        statsTracker.resetProgress();
      }

      const initialCheckpoint = {
        totalFolders: 0,
        completedFolders: 0,
        totalDocuments: 0,
        status: 'running',
        discoveryStartTime: state.discoveryStartTime,
        discoveryType,
        lastUpdated: Date.now(),
      };
      await persistenceManager.saveDiscoveryCheckpointFile(initialCheckpoint);
      const { folders, files } = await documentScanner.getTopLevelItems();
      const totalWork = folders.length + (files.length > 0 ? 1 : 0);
      if (discoveryType === 'incremental') {
        const existingFiles = await persistenceManager.loadAllDiscoveryFiles();
        const allExistingFolderNames = existingFiles.map((file) => file.name.replace('.json', ''));
        const existingFolderNames = allExistingFolderNames.filter((name) => name !== 'root');
        const currentFolderNames = folders.map((folder) => (
          folder.path === '/' ? 'root' : folder.path.split('/').pop()
        ));
        const newFolders = folders.filter((folder) => {
          const folderName = folder.path === '/' ? 'root' : folder.path.split('/').pop();
          return !existingFolderNames.includes(folderName);
        });
        const deletedFolders = existingFolderNames.filter(
          (name) => !currentFolderNames.includes(name),
        );
        state.incrementalChanges = {
          newFolders,
          deletedFolders,
          existingFiles,
        };
      }
      state.isRunning = true;
      state.hasFileChanges = false;
      statsTracker.setTotalFolders(totalWork);
      if (discoveryType === 'incremental' && state.incrementalChanges) {
        if (state.incrementalChanges.newFolders.length > 0) {
          await processFoldersInParallel(state.incrementalChanges.newFolders);
        }
        if (state.incrementalChanges.deletedFolders.length > 0) {
          await markDeletedFolders(state.incrementalChanges.deletedFolders);
        }
      }
      if (files.length > 0) {
        if (discoveryType === 'incremental' && state.incrementalChanges) {
          const existingRootDocs = state.incrementalChanges.existingFiles.find((file) => file.name === 'root')?.data || [];
          const documentsToScan = await documentScanner.processDocumentsIncremental(files, 'root', existingRootDocs, discoveryType, eventEmitter);
          if (documentsToScan && documentsToScan.length > 0) {
            state.hasFileChanges = true;
          }
        } else {
          await documentScanner.processRootFiles(files, statsTracker, eventEmitter);
        }
      }
      if (folders.length > 0) {
        if (discoveryType === 'incremental' && state.incrementalChanges) {
          await processFoldersInParallel(folders);
        } else {
          await processFoldersInParallel(folders);
        }
      } else {
        await triggerDiscoveryComplete();
      }
    } catch (error) {
      state.isRunning = false;
    } finally {
      state.isRunning = false;
    }
    if (discoveryType === 'incremental' && state.incrementalChanges) {
      const hasChanges = state.incrementalChanges.newFolders.length > 0
        || state.incrementalChanges.deletedFolders.length > 0
        || state.hasFileChanges;
      return {
        hasChanges,
        incrementalChanges: state.incrementalChanges,
      };
    }
    return { hasChanges: false };
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
  async function clearQueue() {
    parallelProcessor.cleanupAll();
    statsTracker.resetProgress();
  }

  function setMediaProcessor(mediaProcessor) {
    state.mediaProcessor = mediaProcessor;
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
    setMediaProcessor,
  };
}