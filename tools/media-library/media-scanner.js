// tools/media-library/media-scanner.js
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import createDocAuthoringService from './services/doc-authoring-service.js';
import createSessionManager from './services/session-manager.js';
import createProcessingStateManager from './services/processing-state-manager.js';
import createPersistenceManager from './services/persistence-manager.js';
import createMediaProcessor from './modules/media-processor.js';
import createQueueOrchestrator from './modules/queue/queue-orchestrator.js';
import createDiscoveryCoordinator from './modules/discovery-coordinator.js';
import createScanCompletionHandler from './modules/scan-completion-handler.js';

let daContext = null;
// eslint-disable-next-line no-unused-vars
let unusedDaActions = null;
let docAuthoringService = null;
let sessionManager = null;
let processingStateManager = null;
let persistenceManager = null;
let mediaProcessor = null;
let queueOrchestrator = null;
let discoveryCoordinator = null;
let scanCompletionHandler = null;
let isScanning = false;
let progressUpdateInterval = null;
let currentSessionId = null;
let currentUserId = null;
let currentBrowserId = null;
const scanStateManager = null;
const ui = {
  pathInput: null,
  startScanBtn: null,
  statusSection: null,
  foldersValue: null,
  pagesValue: null,
  scannedValue: null,
  mediaValue: null,
  completionIndicator: null,
};

function updateMetrics(folders = 0, pages = 0, scanned = 0, media = 0) {
  if (ui.foldersValue) ui.foldersValue.textContent = folders;
  if (ui.pagesValue) ui.pagesValue.textContent = pages;
  if (ui.scannedValue) ui.scannedValue.textContent = scanned;
  if (ui.mediaValue) ui.mediaValue.textContent = media;
}

function showCompletionIndicator() {
  if (ui.completionIndicator) {
    ui.completionIndicator.style.display = 'block';
  }
}

function hideCompletionIndicator() {
  if (ui.completionIndicator) {
    ui.completionIndicator.style.display = 'none';
  }
}
function parsePath(path) {
  const match = path.match(/^\/([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error('Invalid path format. Use /{org}/{repo}');
  }
  return { org: match[1], repo: match[2] };
}
async function updateProgressFromCheckpoints() {
  try {
    console.log('[Media Scanner] 🔍 Checking checkpoints...');
    const discoveryCheckpoint = await processingStateManager.loadDiscoveryCheckpoint();
    console.log('[Media Scanner] 📊 Discovery checkpoint:', discoveryCheckpoint);
    let scanningCheckpoint = null;
    try {
      scanningCheckpoint = await processingStateManager.loadScanningCheckpoint();
      console.log('[Media Scanner] 📊 Scanning checkpoint:', scanningCheckpoint);
    } catch (error) {
      console.log('[Media Scanner] ⚠️ No scanning checkpoint yet:', error.message);
    }
    let folders = 0;
    let pages = 0;
    let scanned = 0;
    let media = 0;
    if (discoveryCheckpoint) {
      folders = discoveryCheckpoint.totalFolders || 0;
      if (discoveryCheckpoint.status === 'running') {
        const total = discoveryCheckpoint.totalFolders || 1;
        const completed = discoveryCheckpoint.completedFolders || 0;
        console.log('[Media Scanner] 🔄 Discovery running:', { completed, total });
      } else if (discoveryCheckpoint.status === 'completed') {
        console.log('[Media Scanner] ✅ Discovery completed, scanning should be handled by queue orchestrator...');
      }
    }
    if (scanningCheckpoint) {
      pages = scanningCheckpoint.totalPages || 0;
      scanned = scanningCheckpoint.scannedPages || 0;
      media = scanningCheckpoint.totalMedia || 0;
      if (scanningCheckpoint.status === 'running') {
        const total = scanningCheckpoint.totalPages || 1;
        const scannedPages = scanningCheckpoint.scannedPages || 0;
        console.log('[Media Scanner] 🔄 Scanning running:', {
          scannedPages, total, media,
        });
      } else if (scanningCheckpoint.status === 'completed') {
        console.log('[Media Scanner] 🎉 Scan completed!', { pages, scanned, media });
        isScanning = false;
        ui.startScanBtn.disabled = false;
      }
    }
    console.log('[Media Scanner] 📈 Updating UI:', {
      folders, pages, scanned, media,
    });
    updateMetrics(folders, pages, scanned, media);
  } catch (error) {
    if (!error.message.includes('404')) {
      console.error('[Media Scanner] ❌ Progress error:', error);
    }
  }
}
function startProgressUpdates() {
  if (progressUpdateInterval) {
    clearInterval(progressUpdateInterval);
  }
  // Use longer interval since we have real-time events for UI updates
  progressUpdateInterval = setInterval(updateProgressFromCheckpoints, 10000);
}

function stopProgressUpdates() {
  if (progressUpdateInterval) {
    clearInterval(progressUpdateInterval);
    progressUpdateInterval = null;
    console.log('[Media Scanner] ✅ Progress updates stopped');
  }
}
async function initializeServices() {
  try {
    console.log('[Media Scanner] 🔧 Initializing services...');
    const path = ui.pathInput.value.trim();
    parsePath(path);
    const { context, actions, token } = await DA_SDK;
    daContext = { ...context, token };
    unusedDaActions = actions;
    docAuthoringService = createDocAuthoringService();
    await docAuthoringService.init(daContext);
    sessionManager = createSessionManager();
    processingStateManager = createProcessingStateManager();
    persistenceManager = createPersistenceManager();
    mediaProcessor = createMediaProcessor();
    queueOrchestrator = createQueueOrchestrator();
    discoveryCoordinator = createDiscoveryCoordinator();
    scanCompletionHandler = createScanCompletionHandler();
    await sessionManager.init(docAuthoringService);
    await processingStateManager.init({ daApi: docAuthoringService });
    await persistenceManager.init();
    await persistenceManager.clearIndexDBExceptCheckpoints();
    await mediaProcessor.init(docAuthoringService, sessionManager, processingStateManager);
    await discoveryCoordinator.init(
      docAuthoringService.getConfig(),
      docAuthoringService,
      sessionManager,
      processingStateManager,
    );
    discoveryCoordinator.setMediaProcessor(mediaProcessor);
    await scanCompletionHandler.init(
      docAuthoringService.getConfig(),
      docAuthoringService,
      processingStateManager,
      discoveryCoordinator,
      sessionManager,
    );
    await queueOrchestrator.init(
      docAuthoringService.getConfig(),
      docAuthoringService,
      sessionManager,
      processingStateManager,
      mediaProcessor,
      scanStateManager,
      discoveryCoordinator,
      scanCompletionHandler,
      persistenceManager || null,
    );
    queueOrchestrator.on('scanningStopped', async (_data) => {
      isScanning = false;
      ui.startScanBtn.disabled = false;
      stopProgressUpdates();
      showCompletionIndicator();
    });
    queueOrchestrator.on('scanningStarted', (_data) => {
    });
    queueOrchestrator.on('siteStructureUpdated', (data) => {
      isScanning = false;
      ui.startScanBtn.disabled = false;
      updateMetrics(
        data.totalFolders || 0,
        data.totalFiles || 0,
        data.totalFiles || 0, // scanned = total files when completed
        data.totalMediaItems || 0,
      );
      stopProgressUpdates();
      showCompletionIndicator();
    });
    queueOrchestrator.on('scanningProgress', (data) => {
      updateMetrics(0, data.totalPages, data.scannedPages, data.totalMedia || 0);
    });
    queueOrchestrator.on('pageProgress', (data) => {
      updateMetrics(0, data.totalPages, data.scannedPages, data.totalMedia || 0);
    });
    queueOrchestrator.on('batchComplete', (data) => {
      console.log('[Media Scanner] 📦 Batch completed:', {
        processedCount: data.processedCount,
        totalMedia: data.totalMedia,
      });
    });
    queueOrchestrator.on('batchProcessingStarted', (_data) => {
    });
    queueOrchestrator.on('batchUploaded', (_data) => {
    });
    queueOrchestrator.on('batchProcessingComplete', (_data) => {
    });
    queueOrchestrator.on('batchProcessingFailed', (data) => {
      console.error('[Media Scanner] ❌ Received batchProcessingFailed event:', data);
    });
    queueOrchestrator.on('error', (data) => {
      console.error('[Media Scanner] ❌ Received error event:', data);
    });
    if (mediaProcessor && typeof mediaProcessor.on === 'function') {
      mediaProcessor.on('mediaItemUploaded', (data) => {
        const currentMetrics = {
          folders: ui.foldersValue ? parseInt(ui.foldersValue.textContent, 10) || 0 : 0,
          pages: ui.pagesValue ? parseInt(ui.pagesValue.textContent, 10) || 0 : 0,
          scanned: ui.scannedValue ? parseInt(ui.scannedValue.textContent, 10) || 0 : 0,
          media: data.totalMedia || 0,
        };
        updateMetrics(
          currentMetrics.folders,
          currentMetrics.pages,
          currentMetrics.scanned,
          currentMetrics.media,
        );
      });
      mediaProcessor.on('mediaProcessingCompleted', (data) => {
        console.log('[Media Scanner] 📡 Media processing completed:', data);
        const currentMetrics = {
          folders: ui.foldersValue ? parseInt(ui.foldersValue.textContent, 10) || 0 : 0,
          pages: ui.pagesValue ? parseInt(ui.pagesValue.textContent, 10) || 0 : 0,
          scanned: ui.scannedValue ? parseInt(ui.scannedValue.textContent, 10) || 0 : 0,
          media: data.stats?.totalMedia || 0,
        };
        updateMetrics(
          currentMetrics.folders,
          currentMetrics.pages,
          currentMetrics.scanned,
          currentMetrics.media,
        );
      });
    }
    return true;
  } catch (error) {
    console.error('[Media Scanner] ❌ Failed to initialize services:', error);
    return false;
  }
}
async function startFullScan() {
  if (isScanning) return;
  console.log('[Media Scanner] 🚀 Starting full scan...');
  console.log('[Media Scanner] 🔧 Initializing services...');
  const initialized = await initializeServices();
  console.log('[Media Scanner] 🔧 Services initialized:', initialized);
  if (!initialized) {
    console.error('[Media Scanner] ❌ Service initialization failed');
    return;
  }
  try {
    isScanning = true;
    ui.startScanBtn.disabled = true;
    ui.statusSection.style.display = 'block';
    hideCompletionIndicator();
    // Generate user and browser IDs for session management
    currentUserId = `scanner-${Date.now()}`;
    currentBrowserId = `browser-${Date.now()}`;
    console.log('[Media Scanner] 📋 Creating session...');
    const sessionId = await sessionManager.createSession(currentUserId, currentBrowserId, 'full');
    currentSessionId = sessionId;
    console.log('[Media Scanner] ✅ Session created:', sessionId);
    // Set up media processor with session data
    if (mediaProcessor) {
      mediaProcessor.setCurrentSession(sessionId, currentUserId, currentBrowserId);
    }
    console.log('[Media Scanner] 🔍 Starting queue scanning...');
    // Use queue orchestrator to start the full scanning process
    await queueOrchestrator.startQueueScanning(
      true, // forceRescan
      currentSessionId,
      currentUserId,
      currentBrowserId,
    );
    console.log('[Media Scanner] ✅ Queue scanning started successfully');
    startProgressUpdates();
  } catch (error) {
    console.error('[Media Scanner] ❌ Failed to start scan:', error);
    isScanning = false;
    ui.startScanBtn.disabled = false;
  }
}
function initializeUI() {
  ui.pathInput = document.getElementById('pathInput');
  ui.startScanBtn = document.getElementById('startScanBtn');
  ui.statusSection = document.getElementById('statusSection');
  ui.foldersValue = document.getElementById('foldersValue');
  ui.pagesValue = document.getElementById('pagesValue');
  ui.scannedValue = document.getElementById('scannedValue');
  ui.mediaValue = document.getElementById('mediaValue');
  ui.completionIndicator = document.getElementById('completionIndicator');
  ui.startScanBtn.addEventListener('click', startFullScan);
}
document.addEventListener('DOMContentLoaded', () => {
  initializeUI();
});
