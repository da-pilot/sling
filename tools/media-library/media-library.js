

import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { createDAApiService } from './services/da-api.js';
import { createMetadataManager } from './services/metadata-manager.js';
import { createAssetBrowser } from './modules/media-browser.js';
import { createAssetInsertion } from './modules/media-insert.js';
import { createQueueManager } from './modules/queue-manager.js';
import { initSelectiveRescan } from './modules/rescan.js';
import { createStateManager } from './services/state-manager.js';
import { fetchSheetJson, CONTENT_DA_LIVE_BASE } from './modules/sheet-utils.js';
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

// Global function to stop scanning for testing
window.stopScanning = async () => {
  if (queueManager) {
    await queueManager.stopQueueScanning();
    showToast('Scanning stopped', 'info');
  }
};

// Global function to check scan status
window.isScanning = () => {
  return isScanning;
};

// Global function to trigger a rescan
window.triggerRescan = async () => {
  try {
    if (queueManager) {
      await queueManager.startQueueScanning();
      showToast('Rescan started', 'info');
    } else {
      showToast('Queue manager not available', 'error');
    }
  } catch (error) {
    console.error('Failed to trigger rescan:', error);
    showToast('Failed to start rescan', 'error');
  }
};

const POLLING_INTERVAL = 10000;
const ASSET_POLLING_INTERVAL = 5000;
const PLACEHOLDER_COUNT = 6;
const HOURS_IN_DAY = 24;

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

const handleDiscoveryCompleteWrapper = (data) =>
  handleDiscoveryComplete(data, updateLoadingText);
const handlePageScannedWrapper = (data) =>
  handlePageScanned(
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
const handleQueueSizeUpdateWrapper = (data) =>
  handleQueueSizeUpdate(data, updateScanProgressHeader);
const handleResumingFromQueueWrapper = (data) =>
  handleResumingFromQueue(data, updateLoadingText);

const STATUS_TEXT_MAP = {
  connected: 'Connected',
  error: 'Connection Error',
  'local-dev': 'Local Development',
  'local-dev-connected': 'Local Development (Connected)',
  default: 'Connecting...',
};

async function init() {
  try {
    initializeElements();
    showInitialLoadingState();
    updateLoadingProgress(0, 'Initializing DA SDK...');

    // Note: Service workers don't work reliably in iframes
    // Background scanning will only work while the media library tab is open

    if (typeof DA_SDK === 'undefined') {
      throw new Error('DA SDK not available. Make sure you are running this plugin within the DA Admin environment.');
    }

    const { context, actions, token } = await DA_SDK;
    if (!context || !actions || !token) {
      throw new Error('Failed to get DA context, actions, or token from SDK');
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
    showError('Failed to initialize Media Library', error);
  }
}

async function initializeCoreServices() {
  updateLoadingProgress(1, 'Setting up core services...');

  daApi = createDAApiService();
  await daApi.init(daContext);

      if (typeof setAssetLoaderContext === 'function') {
    setAssetLoaderContext(daContext);
  }

  const metadataPath = `/${daContext.org}/${daContext.repo}/.da/media.json`;
  metadataManager = createMetadataManager(daApi, metadataPath);

  assetBrowser = createAssetBrowser(elements.assetsGrid);
  assetBrowser.setView('grid'); // Ensure we always start in grid view
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
  
  // Global functions for testing incremental scanning
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

  // Enhanced logging and monitoring functions
  window.getBackgroundActivityStatus = async () => {
    if (!queueManager) {
      return { error: 'Queue manager not initialized' };
    }

    try {
      const [isActive, stats, persistentStats] = await Promise.all([
        queueManager.isScanActive(),
        queueManager.getStats(),
        queueManager.getPersistentStats()
      ]);

      return {
        isActive,
        currentStats: stats,
        persistentStats,
        timestamp: new Date().toISOString(),
        serviceWorkers: {
          discoveryWorker: 'Running (if scanning)',
          scanWorker: 'Running (if scanning)'
        }
      };
    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  };

  window.logBackgroundActivity = () => {
    console.log('=== BACKGROUND ACTIVITY STATUS ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Queue Manager:', queueManager ? 'Initialized' : 'Not initialized');
    
    if (queueManager) {
      queueManager.getStats().then(stats => {
        console.log('Current Stats:', stats);
      });
      
      queueManager.isScanActive().then(isActive => {
        console.log('Scan Active:', isActive);
      });
    }
    
    console.log('Service Workers: Check browser dev tools for worker status');
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
// Service worker registration removed - not compatible with iframe context

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
  updateLoadingProgress(3, 'Setting up scanning system...');

  if (useQueueBasedScanning) await initializeQueueManager();

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

  // Note: showScanProgress() is called in startFullScan(), so we don't call it here
  try {
    await queueManager?.startQueueScanning();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to start queue-based scan:', error);
  }
}

async function initializeQueueManager() {
  try {
    updateLoadingText('Initializing queue-based scanning system...');

    queueManager = createQueueManager();

    // Setup event listeners
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
      queueManager.on(event, handler);
    });

    const apiConfig = daApi.getConfig();
    await queueManager.init(apiConfig);

    try {
      await stateManager.ensureStorageStructure();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to ensure storage structure, continuing:', error);
    }
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
      queueManager.isScanActive(),
      queueManager.getPersistentStats(),
    ]);

    if (isActive && !persistentStats.currentSession) {
      updateLoadingText('Scan in progress by another user. Please wait...');

      if (persistentStats.lastScanTime) {
        const lastScanDate = new Date(persistentStats.lastScanTime).toLocaleString();
        updateLoadingText(`Last scan: ${lastScanDate}. Another user is scanning...`);
      }
      return;
    }

    if (persistentStats.lastScanTime) {
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

async function startFullScan(forceRescan = false) {
  try {
    isScanning = true;
    showScanProgress(); // This will set the button state
    updateLoadingText('Starting full content scan...');
    
    // Background scanning disabled - iframe context limitations
    
    await queueManager.startQueueScanning(forceRescan);
  } catch (error) {
    showError('Full scan failed', error);
    isScanning = false;
    // setForceRescanButtonState(false); // Always enable after scan complete
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

// Event listeners for unified modal
document.addEventListener('insertAsset', (event) => {
  insertAsset(event.detail.assetId);
});

document.addEventListener('insertAssetAsLink', (event) => {
  const asset = assets.find(a => a.id === event.detail.assetId);
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
  
  // Update the loading message in the new structure
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
  const filteredAssets = assets.filter((asset) =>
    asset.name.toLowerCase().includes(queryLower)
    || asset.alt.toLowerCase().includes(queryLower),
  );
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
    console.error('Initialization failed:', error);
  });
});

// Background scanning UI removed - not compatible with iframe context