/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */

/* eslint-disable no-use-before-define */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { createDAApiService } from './services/da-api.js';
import { createMetadataManager } from './services/metadata-manager.js';
import { createAssetBrowser } from './modules/media-browser.js';
import { createAssetInsertion } from './modules/media-insert.js';
import { createQueueManager } from './modules/queue-manager.js';
import { initSelectiveRescan } from './modules/rescan.js';
import { createStateManager } from './services/state-manager.js';
import {
  fetchSheetJson, buildMultiSheet, saveSheetFile, CONTENT_DA_LIVE_BASE,
} from './modules/sheet-utils.js';
import {
  DA_PATHS, SCAN_CONFIG, UI_CONFIG, ERROR_MESSAGES,
} from './constants.js';
import {
  loadAssetsFromMediaJson,
  setAssetBrowser as setAssetLoaderAssetBrowser,
  setAssetsRef as setAssetLoaderAssetsRef,
  setContext as setAssetLoaderContext,
  setStateManager as setAssetLoaderStateManager,
} from './modules/media-loader.js';
import { initUIEvents } from './modules/ui-events.js';
import { updateSidebarCounts } from './modules/sidebar.js';
import { showToast, showError } from './modules/toast.js';
import { processScanResults } from './modules/media-processor.js';
import { showMediaInfoModal, closeMediaInfoModal } from './modules/media-info-modal.js';
import {
  handleDiscoveryComplete,
  handlePageScanned,
  handleScanningStarted,
  handleScanningStopped,
  handleQueueSizeUpdate,
  handleWorkerError,
  handleResumingFromQueue,
  handleDocumentsSkipped,
} from './modules/event-handlers.js';
import { initHierarchyBrowser, toggleHierarchyView, returnToAllAssets } from './modules/hierarchy-browser.js';

window.loadAssetsFromMediaJson = loadAssetsFromMediaJson;

window.stopScanning = async () => {
  if (queueManager) {
    await queueManager.stopQueueScanning();
    showToast('Scanning stopped', 'info');
  }
};

window.isScanning = () => isScanning;

window.triggerRescan = async () => {
  try {
    if (queueManager) {
      await queueManager.startQueueScanning();
      showToast('Rescan started', 'info');
    } else {
      showToast('Queue manager not available', 'error');
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to trigger rescan:', error);
    showToast('Failed to start rescan', 'error');
  }
};

window.testDiscovery = async () => {
  try {
    if (queueManager && queueManager.discoveryManager) {
      // eslint-disable-next-line no-console
      console.log('[TEST] Starting discovery test...');
      await queueManager.discoveryManager.startDiscovery();
      showToast('Discovery test started', 'info');
    } else {
      showToast('Discovery manager not available', 'error');
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to test discovery:', error);
    showToast('Failed to test discovery', 'error');
  }
};

const { POLLING_INTERVAL } = SCAN_CONFIG;
const { ASSET_POLLING_INTERVAL } = SCAN_CONFIG;
const { PLACEHOLDER_COUNT } = UI_CONFIG;
const { HOURS_IN_DAY } = UI_CONFIG;

let daContext = null;
let daActions = null;
let daApi = null;
let metadataManager = null;
let assetBrowser = null;
let assetInsertion = null;
let queueManager = null;
const assets = [];

if (typeof setAssetLoaderAssetsRef === 'function') setAssetLoaderAssetsRef(assets);

let isScanning = false;
const useQueueBasedScanning = true;
let elements = {};
let stateManager = null;
let mediaPollingInterval = null;

const handleDiscoveryCompleteWrapper = (data) => handleDiscoveryComplete(data, updateLoadingText);
const handlePageScannedWrapper = (data) => handlePageScanned(
  data,
  assets,
  assetBrowser,
  metadataManager,
  processScanResults,
  updateLoadingText,
  updateScanProgressHeader,
);
const handleScanningStartedWrapper = (data) => {
  handleScanningStarted(
    data,
    isScanning,
    showScanProgress,
    updateLoadingText,
    updateScanProgressHeader,
  );
};
const handleScanningStoppedWrapper = (data) => {
  handleScanningStopped(data, assets, isScanning, hideScanProgress);
  if (typeof window.hideScanIndicator === 'function') {
    window.hideScanIndicator();
  } else {
    try {
      import('./modules/scan-indicator.js').then((mod) => mod.hideScanIndicator());
    } catch (e) { /* intentionally empty: scan indicator is non-critical */ }
  }
};
const handleQueueSizeUpdateWrapper = (data) => handleQueueSizeUpdate(data, updateScanProgressHeader);
const handleResumingFromQueueWrapper = (data) => handleResumingFromQueue(data, updateLoadingText);

const STATUS_TEXT_MAP = {
  connected: 'Connected',
  error: 'Connection Error',
  'local-dev': 'Local Development',
  'local-dev-connected': 'Local Development (Connected)',
  default: 'Connecting...',
};

/**
   * Initialize the media library
   */
async function init() {
  try {
    // eslint-disable-next-line no-console
    console.log('🔧 [INIT] Initializing Media Library...');
    initializeElements();
    showInitialLoadingState();
    updateLoadingProgress(0, 'Initializing DA SDK...');

    if (typeof DA_SDK === 'undefined') {
      throw new Error(ERROR_MESSAGES.DA_SDK_MISSING);
    }

    const { context, actions, token } = await DA_SDK;
    if (!context || !actions || !token) {
      throw new Error(ERROR_MESSAGES.CONTEXT_MISSING);
    }

    daContext = { ...context, token };
    daActions = actions;

    updateConnectionStatus('connected');
    updateLoadingProgress(1, 'Setting up core services...');

    await initializeCoreServices();

    updateLoadingProgress(2, 'Loading existing assets...');
    await loadAndRenderAssets();

    updateLoadingProgress(3, 'Setting up scanning system...');
    await initializeScanning();

    updateLoadingProgress(4, 'Media Library ready!');

    showToast('Media Library loaded successfully', 'success');
    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
    setInterval(checkScanAndStartPolling, POLLING_INTERVAL);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize:', error);
    updateConnectionStatus('error');
    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
    showError(ERROR_MESSAGES.INITIALIZATION_FAILED, error);
  }
}

async function initializeCoreServices() {
  updateLoadingProgress(1, 'Setting up core services...');

  daApi = createDAApiService();
  await daApi.init(daContext);

  if (typeof setAssetLoaderContext === 'function') {
    setAssetLoaderContext(daContext);
  }

  const metadataPath = DA_PATHS.getMediaDataFile(daContext.org, daContext.repo);
  metadataManager = createMetadataManager(daApi, metadataPath);

  assetBrowser = createAssetBrowser(elements.assetsGrid);
  assetBrowser.setView('grid');
  assetBrowser.on('assetSelected', handleAssetSelection);
  assetBrowser.on('assetInfo', handleAssetInfo);
  assetBrowser.on('assetInsertAsLink', handleAssetInsertAsLink);
  assetBrowser.on('assetLinkCopied', handleAssetLinkCopied);

  window.assetBrowser = assetBrowser;

  if (typeof setAssetLoaderAssetBrowser === 'function') {
    setAssetLoaderAssetBrowser(assetBrowser);
  }

  assetInsertion = createAssetInsertion();
  assetInsertion.init(daActions, daContext);

  stateManager = createStateManager();
  await stateManager.init(daApi.getConfig());

  if (typeof setAssetLoaderStateManager === 'function') {
    setAssetLoaderStateManager(stateManager);
  }

  window.stateManager = stateManager;

  window.stopScanning = () => {
    if (queueManager) {
      return queueManager.stopQueueScanning();
    }
  };

  window.getScanStatus = () => {
    if (queueManager) {
      return queueManager.isScanActive();
    }
    return false;
  };

  window.getBackgroundActivityStatus = async () => {
    if (!queueManager) {
      return { error: 'Queue manager not initialized' };
    }

    try {
      const [isActive, stats, persistentStats] = await Promise.all([
        /* eslint-disable-next-line no-use-before-define */
        queueManager.isScanActive(),
        /* eslint-disable-next-line no-use-before-define */
        queueManager.getStats(),
        /* eslint-disable-next-line no-use-before-define */
        queueManager.getPersistentStats(),
      ]);

      return {
        isActive,
        currentStats: stats,
        persistentStats,
        timestamp: new Date().toISOString(),
        serviceWorkers: {
          discoveryWorker: 'Running (if scanning)',
          scanWorker: 'Running (if scanning)',
        },
      };
    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  };

  window.logBackgroundActivity = () => {
    // eslint-disable-next-line no-console
    console.log('=== BACKGROUND ACTIVITY STATUS ===');

    // eslint-disable-next-line no-console
    console.log('Timestamp:', new Date().toISOString());

    // eslint-disable-next-line no-console
    console.log('Queue Manager:', queueManager ? 'Initialized' : 'Not initialized');

    if (queueManager) {
      /* eslint-disable-next-line no-use-before-define */
      queueManager.getStats().then((stats) => {
        // eslint-disable-next-line no-console
        console.log('Current Stats:', stats);
      });

      /* eslint-disable-next-line no-use-before-define */
      queueManager.isScanActive().then((isActive) => {
        // eslint-disable-next-line no-console
        console.log('Scan Active:', isActive);
      });
    }

    // eslint-disable-next-line no-console
    console.log('Service Workers: Check browser dev tools for worker status');

    // eslint-disable-next-line no-console
    console.log('=====================================');
  };

  await initHierarchyBrowser();

  initUIEvents({
    assetBrowser,
    handleSearch,
    handleViewChange,
    handleAssetSelection,
  });
}

/**
 * Register standalone service worker for background scanning
 */

async function loadAndRenderAssets() {
  updateLoadingProgress(2, 'Loading existing assets...');

  try {
    const { mediaJsonExists, assets: loadedAssets } = await loadAssetsFromMediaJson();

    if (mediaJsonExists) {
      updateLoadingProgress(2, 'Loading assets...');
      showPlaceholderCards();

      if (loadedAssets.length === 0) {
        updateLoadingProgress(2, 'No assets found in media.json');
      } else {
        updateLoadingProgress(2, `Loaded ${loadedAssets.length} assets`);
      }
    } else {
      updateLoadingProgress(2, 'No existing assets found. Setting up first scan...');
    }

    renderAssets(assets);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to load assets:', error);
    updateLoadingProgress(2, 'No existing assets found. Setting up first scan...');
    renderAssets(assets);
  }
}

async function initializeScanning() {
  // eslint-disable-next-line no-console
  console.log('🔧 [SCAN-INIT] initializeScanning() called');

  // eslint-disable-next-line no-console
  console.log('📊 [SCAN-INIT] isScanning before scan start:', isScanning);

  updateLoadingProgress(3, 'Setting up scanning system...');

  try {
    // eslint-disable-next-line no-console
    console.log('💾 [SCAN-INIT] Initializing state persistence...');
    await stateManager?.initializeStatePersistence();

    // eslint-disable-next-line no-console
    console.log('✅ [SCAN-INIT] State persistence initialized');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('❌ [SCAN-INIT] Failed to initialize state persistence, continuing:', error);
  }

  if (useQueueBasedScanning) {
    await initializeQueueManager();
  }

  if (queueManager?.getConfig) {
    const queueConfig = queueManager.getConfig();
    await initSelectiveRescan(queueConfig, queueManager, metadataManager);
  }

  try {
    await checkScanStatus();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to check scan status, continuing:', error);
  }

  try {
    await stateManager?.forceClearStaleScanLock();
    await stateManager?.forceClearAllScanLocks();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to clear scan lock, continuing:', error);
  }

  try {
    await startFullScan();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to start full scan, continuing:', error);
  }
}

async function initializeQueueManager() {
  try {
    updateLoadingText('Initializing queue-based scanning system...');

    /* eslint-disable-next-line no-use-before-define */
    queueManager = createQueueManager();

    const eventHandlers = {
      discoveryComplete: handleDiscoveryCompleteWrapper,
      pageScanned: handlePageScannedWrapper,
      scanningStarted: handleScanningStartedWrapper,
      scanningStopped: handleScanningStoppedWrapper,
      queueSizeUpdate: handleQueueSizeUpdateWrapper,
      workerError: handleWorkerError,
      resumingFromQueue: handleResumingFromQueueWrapper,
      documentsSkipped: (data) => handleDocumentsSkipped(data, updateLoadingText),
    };

    Object.entries(eventHandlers).forEach(([event, handler]) => {
      /* eslint-disable-next-line no-use-before-define */
      queueManager.on(event, handler);
    });

    const apiConfig = daApi.getConfig();
    await queueManager.init(apiConfig);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize queue manager:', error);
    throw new Error(`Queue Manager initialization failed: ${error.message}`);
  }
}

async function checkScanStatus() {
  if (!useQueueBasedScanning || !queueManager) return;

  try {
    const [isActive, persistentStats] = await Promise.all([
      /* eslint-disable-next-line no-use-before-define */
      queueManager.isScanActive(),
      /* eslint-disable-next-line no-use-before-define */
      queueManager.getPersistentStats(),
    ]);

    if (isActive && !persistentStats?.currentSession) {
      updateLoadingText('Scan in progress by another user. Please wait...');

      if (persistentStats?.lastScanTime) {
        const lastScanDate = new Date(persistentStats.lastScanTime).toLocaleString();
        updateLoadingText(`Last scan: ${lastScanDate}. Another user is scanning...`);
      }
      return;
    }

    if (persistentStats?.lastScanTime) {
      const lastScanDate = new Date(persistentStats.lastScanTime).toLocaleString();
      const timeSinceLastScan = Date.now() - persistentStats.lastScanTime;
      const hoursSinceLastScan = Math.floor(timeSinceLastScan / (1000 * 60 * 60));

      if (hoursSinceLastScan < HOURS_IN_DAY) {
        updateLoadingText(`Last scan: ${lastScanDate} (${hoursSinceLastScan}h ago)`);
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to check scan status:', error);
  }
}

/**
   * Start full content scan
   */
async function startFullScan(forceRescan = false) {
  try {
    isScanning = true;

    // eslint-disable-next-line no-console
    console.log('🚀 [FULL SCAN] Starting full content scan...', {
      forceRescan,
      timestamp: new Date().toISOString(),
    });

    showScanProgress();
    updateLoadingText('Starting full content scan...');

    await queueManager.startQueueScanning(forceRescan);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Full scan failed:', error);
    showError('Full scan failed', error);
    isScanning = false;
    hideScanProgress();
  }
}

const handleAssetSelection = async (asset) => {
  try {
    await assetInsertion.selectAsset(asset);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to insert asset:', error);
  }
};

const handleAssetInsertAsLink = async (asset) => {
  try {
    await assetInsertion.insertAssetAsLink(asset);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to insert asset as link:', error);
  }
};

const handleAssetLinkCopied = async (asset) => {
  try {
    const assetUrl = asset.url || asset.src;
    window.open(assetUrl, '_blank');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to open link:', error);
    showError('Failed to open link', error);
  }
};

const handleAssetInfo = (asset) => {
  try {
    showMediaInfoModal(asset);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to show media info modal:', error);
    showError('Failed to show asset details', error);
  }
};

document.addEventListener('insertAsset', (event) => {
  insertAsset(event.detail.assetId);
});

document.addEventListener('insertAssetAsLink', (event) => {
  const asset = assets.find((a) => a.id === event.detail.assetId);
  if (asset) {
    handleAssetInsertAsLink(asset);
  }
});

function initializeElements() {
  const elementIds = [
    'connectionStatus', 'refreshBtn', 'searchInput', 'assetsGrid', 'loadingState',
    'emptyState', 'toastContainer', 'loadingText', 'loadingSteps', 'scanProgress',
    'backgroundScanToggle', 'backgroundScanStatus',
  ];

  elements = Object.fromEntries(
    elementIds.map((id) => [id, document.getElementById(id)]),
  );
}

function updateConnectionStatus(status) {
  if (!elements.connectionStatus) return;

  const [statusDot, statusText] = [
    elements.connectionStatus.querySelector('.status-dot'),
    elements.connectionStatus.querySelector('.status-text'),
  ];

  if (statusDot) statusDot.className = `status-dot ${status}`;
  if (statusText) statusText.textContent = STATUS_TEXT_MAP[status] || STATUS_TEXT_MAP.default;
}

function updateLoadingText(text) {
  if (elements.loadingText) elements.loadingText.textContent = text;

  const loadingMessage = document.getElementById('assetsLoadingMessage');
  if (loadingMessage) {
    const loadingText = loadingMessage.querySelector('.loading-text h3');
    if (loadingText) {
      loadingText.textContent = text;
    }
  }
}

function updateLoadingStep(stepName, status) {
  if (!elements.loadingSteps) return;

  const stepElement = elements.loadingSteps.querySelector(`[data-step="${stepName}"]`);
  if (stepElement) stepElement.className = `step-item ${status}`;
}

function updateLoadingSteps(stepIndex, status = 'active') {
  const loadingMessage = document.getElementById('assetsLoadingMessage');
  if (!loadingMessage) return;

  const steps = loadingMessage.querySelectorAll('.loading-step');
  if (steps.length === 0) return;

  steps.forEach((step, index) => {
    step.className = 'loading-step';
    if (index < stepIndex) {
      step.classList.add('completed');
    } else if (index === stepIndex) {
      step.classList.add(status);
    }
  });
}

function showInitialLoadingState() {
  const loadingMessage = document.getElementById('assetsLoadingMessage');
  if (loadingMessage) {
    loadingMessage.style.display = 'flex';
    updateLoadingSteps(0, 'active');
  }
}

function updateLoadingProgress(step, description) {
  const loadingMessage = document.getElementById('assetsLoadingMessage');
  if (!loadingMessage) return;

  const loadingText = loadingMessage.querySelector('.loading-text h3');
  const loadingSteps = loadingMessage.querySelectorAll('.loading-step');

  if (loadingText) {
    loadingText.textContent = description || 'Processing...';
  }

  if (loadingSteps.length > 0 && step >= 0 && step < loadingSteps.length) {
    updateLoadingSteps(step, 'active');
  }
}

function handleSearch(query) {
  const queryLower = query.toLowerCase();
  const filteredAssets = assets.filter((asset) => asset.name.toLowerCase().includes(queryLower)
    || asset.alt.toLowerCase().includes(queryLower));
  renderAssets(filteredAssets);
}

function showPlaceholderCards() {
  const grid = document.getElementById('assetsGrid');
  const loadingMsg = document.getElementById('assetsLoadingMessage');

  if (grid) {
    grid.style.display = '';
    grid.innerHTML = '';

    const placeholderTemplate = `
      <div class="asset-placeholder">
        <div class="placeholder-preview"></div>
        <div class="placeholder-info">
          <div class="placeholder-name"></div>
          <div class="placeholder-pills">
            <div class="placeholder-pill"></div>
            <div class="placeholder-pill"></div>
          </div>
        </div>
        <div class="placeholder-actions">
          <div class="placeholder-action"></div>
          <div class="placeholder-action"></div>
          <div class="placeholder-action"></div>
        </div>
      </div>
    `;

    Array.from({ length: PLACEHOLDER_COUNT }, (_, _i) => {
      const placeholder = document.createElement('div');
      placeholder.className = 'asset-placeholder';
      placeholder.innerHTML = placeholderTemplate;
      grid.appendChild(placeholder);
      return placeholder;
    });
  }

  if (loadingMsg) loadingMsg.style.display = 'none';

  if (assetBrowser && typeof assetBrowser.markInitialLoadComplete === 'function') {
    assetBrowser.markInitialLoadComplete();
  }
}

function renderAssets(assetsToRender = assets) {
  if (assetBrowser) assetBrowser.setAssets(assetsToRender);

  const grid = document.getElementById('assetsGrid');
  const loadingMsg = document.getElementById('assetsLoadingMessage');

  if (assetsToRender?.length > 0) {
    if (grid) grid.style.display = '';
    if (loadingMsg) loadingMsg.style.display = 'none';

    const placeholders = grid?.querySelectorAll('.asset-placeholder');
    placeholders?.forEach((p) => p.remove());

    const emptyState = grid?.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    return;
  }

  if (grid) {
    grid.style.display = '';
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📁</div>
        <h3 class="empty-state__title">No assets found</h3>
        <p class="empty-state__description">
          No media assets have been discovered yet. The system is scanning your content 
          for images, videos, and documents.
        </p>
        <div class="empty-state__actions">
          <button class="btn btn--primary" onclick="loadAssetsFromMediaJson({ force: true })">
            Refresh Assets
          </button>
        </div>
      </div>
    `;
  }

  const placeholders = grid?.querySelectorAll('.asset-placeholder');
  if (placeholders && placeholders.length > 0) {
    if (loadingMsg) loadingMsg.style.display = 'none';
  } else {
    setTimeout(() => {
      if (loadingMsg) loadingMsg.style.display = 'none';
    }, 1000);
  }
}

window.renderAssets = renderAssets;

function insertAsset(assetId) {
  const asset = assets.find((a) => a.id === assetId);
  if (asset) handleAssetSelection(asset);
}

function handleViewChange(view) {
  const viewBtns = document.querySelectorAll('.view-btn');
  viewBtns.forEach((btn) => btn.classList.remove('active'));

  const activeBtn = document.querySelector(`[data-view="${view}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (assetBrowser) assetBrowser.setView(view);

  const hierarchyContainer = document.getElementById('hierarchyContainer');
  const isInFolderView = hierarchyContainer && hierarchyContainer.style.display !== 'none';
  if (!isInFolderView) {
    document.getElementById('hierarchyToggle')?.classList.remove('active');
  }
}

window.handleViewChange = handleViewChange;

async function checkScanAndStartPolling() {
  if (!stateManager?.state?.apiConfig) return;

  const data = await fetchSheetJson(
    stateManager.state.apiConfig,
    'media-scan-state.json',
  );
  const isActive = data?.state?.data?.[0]?.isActive === 'true'
    || data?.state?.data?.[0]?.isActive === true;

  if (isActive) {
    if (!mediaPollingInterval) {
      mediaPollingInterval = setInterval(loadAssetsFromMediaJson, ASSET_POLLING_INTERVAL);
    }
    return;
  }

  if (mediaPollingInterval) {
    clearInterval(mediaPollingInterval);
    mediaPollingInterval = null;
  }

  loadAssetsFromMediaJson();
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

window.insertAsset = insertAsset;

function showScanProgress() {
  const progressContainer = document.getElementById('scanProgress');
  if (progressContainer) progressContainer.style.display = 'block';
  if (typeof window.showScanIndicator === 'function') {
    window.showScanIndicator();
  } else {
    try {
      import('./modules/scan-indicator.js').then((mod) => mod.showScanIndicator());
    } catch (e) { /* intentionally empty: scan indicator is non-critical */ }
  }
}

function hideScanProgress() {
  const progressContainer = document.getElementById('scanProgress');
  if (progressContainer) progressContainer.style.display = 'none';
  if (typeof window.hideScanIndicator === 'function') {
    window.hideScanIndicator();
  } else {
    try {
      import('./modules/scan-indicator.js').then((mod) => mod.hideScanIndicator());
    } catch (e) { /* intentionally empty: scan indicator is non-critical */ }
  }
}

function updateScanProgressHeader(_scanned, _total) {
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.style.opacity = '1';
  document.body.classList.add('loaded');
  showPlaceholderCards();
  if (typeof window.showScanIndicator === 'function') {
    window.showScanIndicator();
  } else {
    try {
      import('./modules/scan-indicator.js').then((mod) => mod.showScanIndicator());
    } catch (e) { /* intentionally empty: scan indicator is non-critical */ }
  }

  window.testBeforeUnload = () => {
    // eslint-disable-next-line no-console
    console.log('🧪 [TEST] Testing beforeunload manually...');
    const event = new Event('beforeunload');
    window.dispatchEvent(event);

    // eslint-disable-next-line no-console
    console.log('🧪 [TEST] beforeunload event dispatched');
  };

  window.addEventListener('beforeunload', async (event) => {
    // eslint-disable-next-line no-console
    console.log('🔄 [BEFOREUNLOAD] Event triggered:', {
      isScanning,
      hasQueueManager: !!queueManager,
      hasStateManager: !!stateManager,
      timestamp: new Date().toISOString(),
      event: event.type,
    });

    if (isScanning) {
      // eslint-disable-next-line no-console
      console.log('🔄 [BEFOREUNLOAD] Scan is active, attempting to save state...');

      try {
        if (queueManager) {
          // eslint-disable-next-line no-console
          console.log('🔄 [BEFOREUNLOAD] Calling stopQueueScanning...');
          await queueManager.stopQueueScanning(true, 'interrupted');

          if (queueManager.stateManager) {
            // eslint-disable-next-line no-console
            console.log('🔄 [BEFOREUNLOAD] Setting scan status to interrupted...');
            await queueManager.stateManager.setScanStatus('interrupted');
          }
        }

        // eslint-disable-next-line no-console
        console.log('✅ [BEFOREUNLOAD] State saved successfully');
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('❌ [BEFOREUNLOAD] Failed to save state on iframe close:', error);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log('ℹ️ [BEFOREUNLOAD] No active scan, nothing to save');
    }
  });

  document.querySelectorAll('.view-btn:not(#hierarchyToggle)').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const view = btn.getAttribute('data-view');
      if (view) {
        handleViewChange(view);
      }
    });
  });

  const folderBtn = document.getElementById('hierarchyToggle');
  if (folderBtn) {
    folderBtn.onclick = toggleHierarchyView;
  }

  document.querySelectorAll('.folder-item[data-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      const filter = el.getAttribute('data-filter');

      if (filter === 'all') {
        returnToAllAssets();
        return;
      }

      const defaultFilter = {
        types: ['image', 'video', 'document'],
        isExternal: undefined,
        usedOnPage: false,
        missingAlt: undefined,
        search: '',
      };
      let filterObj = {};
      switch (filter) {
        case 'internal':
          filterObj = { isExternal: false, types: ['image', 'video', 'document'], usedOnPage: false };
          break;
        case 'external':
          filterObj = { isExternal: true, types: ['image', 'video', 'document'], usedOnPage: false };
          break;
        case 'image':
          filterObj = { types: ['image'], isExternal: undefined, usedOnPage: false };
          break;
        case 'video':
          filterObj = { types: ['video'], isExternal: undefined, usedOnPage: false };
          break;
        case 'document':
          filterObj = { types: ['document'], isExternal: undefined, usedOnPage: false };
          break;
        case 'used-on-page':
          filterObj = { usedOnPage: true, isExternal: undefined, types: ['image', 'video', 'document'] };
          break;
        case 'used-internal':
          filterObj = { usedOnPage: true, isExternal: false, types: ['image', 'video', 'document'] };
          break;
        case 'used-external':
          filterObj = { usedOnPage: true, isExternal: true, types: ['image', 'video', 'document'] };
          break;
        case 'missing-alt':
          filterObj = { missingAlt: true };
          break;
        case 'used-missing-alt':
          filterObj = { usedOnPage: true, missingAlt: true };
          break;
        default:
          filterObj = { types: ['image', 'video', 'document'], isExternal: undefined, usedOnPage: false };
      }
      assetBrowser.setFilter({
        ...defaultFilter,
        ...filterObj,
      });
      document.querySelectorAll('.folder-item').forEach((item) => item.classList.remove('active'));
      el.classList.add('active');
    });
  });

  function addSectionSyncIcon(sectionSelector, iconId, tooltip, onClick) {
    const sectionHeader = document.querySelector(sectionSelector);
    if (sectionHeader && !document.getElementById(iconId)) {
      const syncIcon = document.createElement('span');
      syncIcon.id = iconId;
      syncIcon.className = 'sidebar-action';
      syncIcon.title = tooltip;
      syncIcon.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 512 512" fill="currentColor" style="vertical-align:middle;">
          <path d="M370.9 133.3C346.6 110.1 311.7 96 272 96c-79.5 0-144 64.5-144 144h48l-80 80-80-80h48c0-114.9 93.1-208 208-208
          54.5 0 104.1 20.9 142.1 55.1l-53.2 53.2zM464 256c0 79.5-64.5 144-144 144-39.7 0-74.6-14.1-98.9-37.3l53.2-53.2C217.9 401.1
          272 416 320 416c79.5 0 144-64.5 144-144h-48l80-80 80 80h-48z"/>
        </svg>
      `;
      syncIcon.style.cursor = 'pointer';
      syncIcon.style.marginLeft = '8px';
      syncIcon.addEventListener('click', onClick);
      sectionHeader.appendChild(syncIcon);
    }
  }

  const oldSyncIcon = document.getElementById('sync-current-page');
  if (oldSyncIcon && oldSyncIcon.parentNode) {
    oldSyncIcon.parentNode.removeChild(oldSyncIcon);
  }

  addSectionSyncIcon(
    '#all-assets-header',
    'sync-full-scan',
    'Full Scan',
    async (e) => {
      e.stopPropagation();
      try {
        if (typeof forceRescan === 'function') {
          forceRescan();
          if (window.showToast) window.showToast('Full scan started.', 'info');
        } else {
          alert('Full scan function not found.');
        }
      } catch (err) {
        if (window.showToast) window.showToast('Full scan failed.', 'error');
      }
    },
  );

  addSectionSyncIcon(
    '#used-on-page-header',
    'sync-current-page',
    'Sync Current Page',
    async (e) => {
      e.stopPropagation();
      let pagePath = daContext && daContext.path;
      if (pagePath && !pagePath.endsWith('.html')) {
        pagePath += '.html';
      }
      if (!pagePath) {
        if (window.showToast) window.showToast('Current page path not found in context.', 'error');

        // eslint-disable-next-line no-console
        console.error('Sync Current Page: daContext.path not found', daContext);
        return;
      }
      try {
        const { handleSelectiveRescan } = await import('./modules/rescan.js');
        await handleSelectiveRescan('rescanPage', { pagePath });
        if (window.showToast) window.showToast('Scan complete for current page.', 'success');
      } catch (err) {
        if (window.showToast) window.showToast('Scan failed for current page.', 'error');
      }
    },
  );

  init().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Initialization failed:', error);
  });
});

window.checkScanState = async () => {
  if (!queueManager || !queueManager.stateManager) {
    return;
  }

  try {
    const scanState = await queueManager.stateManager.getScanState();
    const isActive = await queueManager.stateManager.isScanActive();
    return { scanState, isActive };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to check scan state:', error);
  }
};

/**
   * Stop the current scan
   */
async function stopFullScan() {
  try {
    // eslint-disable-next-line no-console
    console.log('⏹️ [STOP SCAN] Stopping full content scan...');

    if (stateManager) {
      await stateManager.setScanStatus('stopped');
    }

    // Update UI
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');

    if (startBtn) startBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';

    // eslint-disable-next-line no-console
    console.log('✅ [STOP SCAN] Scan stopped successfully');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ [STOP SCAN] Error stopping scan:', error);
  }
}

/**
   * Cleanup all scan files to start fresh
   */
async function cleanupScanFiles() {
  try {
    // eslint-disable-next-line no-console
    console.log('🧹 Starting cleanup of scan files...');

    const { listPath } = await import('./services/da-api.js');
    const { DA_STORAGE } = await import('./constants.js');
    const items = await listPath(DA_STORAGE.PAGES_DIR);

    // eslint-disable-next-line no-console
    console.log(`📋 Found ${items.length} files in ${DA_STORAGE.PAGES_DIR}/`);

    // Filter for scan-related files (JSON files with specific patterns)
    const scanFiles = items.filter((item) => item.name && item.ext === 'json' && (
      item.name.startsWith('root-')
          || item.name.startsWith('rewards-')
          || item.name.startsWith('value-')
          || item.name.startsWith('mp4s-')
          || item.name.startsWith('deals-')
          || item.name.startsWith('latino-es-')
          || item.name.startsWith('programming-')
          || item.name.startsWith('drafts-')
          || item.name.startsWith('supported-devices-')
          || item.name.startsWith('library-')
          || item.name.startsWith('pm-')
          || item.name.startsWith('eds-')
          || item.name.startsWith('international-')
          || item.name.startsWith('service-')
          || item.name.startsWith('icons-')
          || item.name.startsWith('sports-')
          || item.name.startsWith('latino-')
          || item.name.includes('175286') // Session ID pattern
    ));

    // eslint-disable-next-line no-console
    console.log(`🗑️ Found ${scanFiles.length} scan files to delete:`);
    scanFiles.forEach((file) => {
      // eslint-disable-next-line no-console
      console.log(`   - ${file.name}`);
    });

    if (scanFiles.length === 0) {
      // eslint-disable-next-line no-console
      console.log('✅ No scan files found to delete');
      return;
    }

    // Delete each file
    const { getSource } = await import('./services/da-api.js');
    let deletedCount = 0;

    await Promise.all(scanFiles.map(async (file) => {
      try {
        const deleteUrl = `${stateManager.state.apiConfig.baseUrl}/source/${stateManager.state.apiConfig.org}/${stateManager.state.apiConfig.repo}/${DA_STORAGE.PAGES_DIR}/${file.name}`;
        const response = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${stateManager.state.apiConfig.token}` },
        });

        if (response.ok) {
          // eslint-disable-next-line no-console
          console.log(`✅ Deleted: ${file.name}`);
          deletedCount += 1;
        } else {
          // eslint-disable-next-line no-console
          console.log(`❌ Failed to delete ${file.name}: ${response.status}`);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log(`❌ Error deleting ${file.name}:`, error.message);
      }
    }));

    // eslint-disable-next-line no-console
    console.log(`🎉 Cleanup complete! Deleted ${deletedCount}/${scanFiles.length} files`);
    // eslint-disable-next-line no-console
    console.log('🔄 You can now start a fresh scan');

    // Reset the UI
    resetUI();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Cleanup failed:', error);
  }
}

/**
   * Reset UI to initial state
   */
function resetUI() {
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  const progressBar = document.getElementById('scanProgress');
  const statusText = document.getElementById('scanStatus');

  if (startBtn) startBtn.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'none';
  if (progressBar) {
    progressBar.style.width = '0%';
    progressBar.style.display = 'none';
  }
  if (statusText) statusText.textContent = 'Ready to scan';
}

// Make functions globally available
window.startFullScan = startFullScan;
window.stopFullScan = stopFullScan;
window.cleanupScanFiles = cleanupScanFiles;