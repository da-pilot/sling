
/* eslint-disable no-use-before-define */

// =============================================================================
// IMPORTS & DEPENDENCIES
// =============================================================================

// External dependencies
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Internal services
import createDocAuthoringService from './services/doc-authoring-service.js';
import createMetadataManager from './services/metadata-manager.js';
import createSessionManager from './services/session-manager.js';
import createProcessingStateManager from './services/processing-state-manager.js';
import createPersistenceManager from './services/persistence-manager.js';
import createMediaProcessor from './modules/media-processor.js';

// Internal modules
import createMediaBrowser from './modules/media-browser.js';
import createMediaInsertion from './modules/media-insert.js';
import createQueueOrchestrator from './modules/queue/queue-orchestrator.js';
import createSelectiveRescan from './modules/selective-rescan.js';
import initUIEvents from './modules/ui-events.js';

import createFolderModal from './modules/folder-modal.js';
import { showMediaInfoModal } from './modules/media-info-modal.js';
import { showError, showToast } from './modules/toast.js';

// Utilities and constants
import {
  DA_PATHS, SCAN_CONFIG, ERROR_MESSAGES,
} from './constants.js';

import {
  loadMediaFromMediaJson,
  loadMediaFromIndexedDB,
  checkIndexedDBStatus,
  startMediaPolling,
  stopMediaPolling,
  setMediaBrowser as setMediaLoaderMediaBrowser,
  setContext as setMediaLoaderContext,
  setDocAuthoringService as setMediaLoaderDocAuthoringService,
} from './modules/media-loader.js';

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

const {
  POLLING_INTERVAL: _POLLING_INTERVAL,
} = SCAN_CONFIG;
const useQueueBasedScanning = true;
let pollingIntervalId = null;
const MEDIA_LASTMOD_KEY = 'mediaJsonLastModified';

// =============================================================================
// GLOBAL STATE VARIABLES
// =============================================================================

let daContext = null;
let daActions = null;
let docAuthoringService = null;
let metadataManager = null;
let mediaBrowser = null;
let mediaInsertion = null;
let queueOrchestrator = null;
let sessionManager = null;
let processingStateManager = null;
let persistenceManager = null;
let mediaProcessor = null;
let folderModal = null;
let selectiveRescan = null;
let currentUserId = null;
// eslint-disable-next-line no-unused-vars
let currentSessionId = null;
let currentBrowserId = null;
let media = [];
// eslint-disable-next-line no-unused-vars
let isScanningInProgress = false;

// =============================================================================
// GLOBAL WINDOW ASSIGNMENTS
// =============================================================================

window.loadMediaFromMediaJson = loadMediaFromMediaJson;
window.loadMediaFromIndexedDB = loadMediaFromIndexedDB;
window.checkIndexedDBStatus = checkIndexedDBStatus;
window.mediaLibraryMode = null; // Will be set during init

if (typeof setMediaLoaderMediaBrowser === 'function') setMediaLoaderMediaBrowser(media);

// =============================================================================
// MAIN INITIALIZATION
// =============================================================================

/**
 * Detect if running in iframe or full app mode
 */
function detectMode() {
  const isIframe = window.self !== window.top;
  const isFullApp = window.location.pathname.includes('/app/');
  const isShadowDOM = window.location.href.includes('shadow-dom')
    || (window.parent && window.parent !== window);

  // Get current page path for mode detection
  let currentPagePath = 'not-available';
  let isMediaLibraryPage = false;

  if (daContext && daContext.path) {
    currentPagePath = daContext.path;
    isMediaLibraryPage = currentPagePath.includes('tools/media-library/media-library');
  }

  // Shell mode = when we're on the media library page itself
  const isShellMode = isFullApp || isMediaLibraryPage;

  // Determine mode based on access level
  let mode;
  let capabilities;

  if (isShellMode) {
    mode = 'shell';
    capabilities = 'full-scan';
  } else {
    mode = 'iframe';
    capabilities = 'quick-access';
  }

  console.log('🔧 [MODE DETECTION]', {
    detectedMode: mode,
    capabilities,
    daContextPath: currentPagePath,
    timestamp: new Date().toISOString(),
  });

  return {
    mode,
    capabilities,
    isIframe,
    isFullApp,
    isShadowDOM,
    isShellMode,
  };
}

/**
   * Initialize the media library
   */
async function init() {
  try {
    // eslint-disable-next-line no-console
    console.log('🔧 [INIT] Initializing Media Library...');

    if (typeof DA_SDK === 'undefined') {
      throw new Error(ERROR_MESSAGES.DA_SDK_MISSING);
    }

    const { context, actions, token } = await DA_SDK;
    if (!context || !actions || !token) {
      throw new Error(ERROR_MESSAGES.CONTEXT_MISSING);
    }
    daContext = { ...context, token };
    daActions = actions;
    window.daContext = daContext;
    const modeInfo = detectMode();
    window.mediaLibraryMode = modeInfo; // Make it globally accessible
    await initializeCoreServices();
    await loadAndRenderMedia();
    await initializeScanning();
    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
    console.log('🔧 [INIT] Media Library initialization complete!');
  } catch (error) {
    console.error('[Media Library] Initialization failed:', {
      error,
      message: error.message,
      stack: error.stack,
      phase: 'initialization',
    });
    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
    showError(ERROR_MESSAGES.INITIALIZATION_FAILED, error);
  }

  // Add unhandled rejection handler
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Media Library] Unhandled Promise; Rejection:', {
      error: event.reason,
      message: event.reason.message,
      stack: event.reason.stack,
    });
  });
}

// =============================================================================
// CORE SERVICE INITIALIZATION
// =============================================================================

/**
 * Initialize all core services
 */
async function initializeCoreServices() {
  docAuthoringService = createDocAuthoringService();
  await docAuthoringService.init(daContext);

  // Set context and docAuthoringService for media loader
  if (typeof setMediaLoaderContext === 'function') {
    setMediaLoaderContext(daContext);
    console.log('[Media Library] Set context for media; loader:', { org: daContext.org, repo: daContext.repo });
  } else {
    console.warn('[Media Library] setMediaLoaderContext not available');
  }

  if (typeof setMediaLoaderDocAuthoringService === 'function') {
    setMediaLoaderDocAuthoringService(docAuthoringService);
    console.log('[Media Library] Set docAuthoringService for media loader');
  } else {
    console.warn('[Media Library] setMediaLoaderDocAuthoringService not available');
  }

  const metadataPath = DA_PATHS.getMediaDataFile(daContext.org, daContext.repo);
  metadataManager = createMetadataManager(docAuthoringService, metadataPath);
  await metadataManager.init(docAuthoringService.getConfig());

  mediaBrowser = createMediaBrowser(document.getElementById('mediaGrid'), {
    currentPagePath: daContext.path,
    org: daContext.org,
    repo: daContext.repo,
  });
  mediaBrowser.setView('grid');
  mediaBrowser.setSort('discovery');
  mediaBrowser.on('mediaSelected', handleMediaSelection);
  mediaBrowser.on('mediaInfo', handleMediaInfo);
  mediaBrowser.on('mediaInsertAsLink', handleMediaInsertAsLink);
  mediaBrowser.on('mediaLinkCopied', handleMediaLinkCopied);

  window.mediaBrowser = mediaBrowser;

  if (typeof setMediaLoaderMediaBrowser === 'function') {
    setMediaLoaderMediaBrowser(mediaBrowser);
  }

  mediaInsertion = createMediaInsertion();
  mediaInsertion.init(daActions, daContext);

  sessionManager = createSessionManager();
  processingStateManager = createProcessingStateManager(docAuthoringService);
  persistenceManager = createPersistenceManager();
  mediaProcessor = createMediaProcessor();

  await sessionManager.init(docAuthoringService);
  await processingStateManager.init({ daApi: docAuthoringService });
  await persistenceManager.init();
  await mediaProcessor.init(
    docAuthoringService,
    sessionManager,
    processingStateManager,
  );

  await persistenceManager.clearIndexDBExceptCheckpoints();

  window.mediaProcessor = mediaProcessor;

  // Generate session identifiers
  currentUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const userAgent = navigator.userAgent.replace(/[^a-zA-Z0-9]/g, '').substr(0, 20);
  currentBrowserId = `browser_${userAgent}_${Date.now()}`;

  setupMediaUpdateHandler();

  // Initialize folder modal
  folderModal = createFolderModal();
  await folderModal.init(docAuthoringService.getConfig(), docAuthoringService, null);

  initUIEvents({
    mediaBrowser,
    handleSearch,
    handleViewChange,
    handleMediaSelection,
  });

  setupUIEventHandlers();
}

/**
 * Set up media update handler
 */
function setupMediaUpdateHandler() {
  // Disabled media processor callback to prevent browser crashes during scanning
  // Media browser will handle updates through its own polling mechanism
  if (mediaProcessor) {
    mediaProcessor.setOnMediaUpdated(null);
  }
}

// =============================================================================
// MEDIA LOADING & RENDERING
// =============================================================================

/**
 * Load and render media from media.json
 */
async function loadAndRenderMedia() {
  try {
    showPlaceholderCards();
    const { media: loadedMedia } = await loadMediaFromMediaJson();
    media = loadedMedia || [];
    hideScanProgress();
    if (media.length > 0) {
      renderMedia(media);
    }
    if (mediaBrowser && typeof mediaBrowser.setMediaLoadingState === 'function') {
      mediaBrowser.setMediaLoadingState(false);
    }
    stopPolling();
    hideProgressiveLoadingIndicator();
    hideMediaLoadingProgress();
    startMediaPolling((updatedMedia) => {
      media = updatedMedia || [];
      renderMedia(media);
      showToast('Media updated', 'success');
      console.log('[Media Library] Auto-refreshed media from polling update');
    }, 30000);
  } catch (error) {
    console.error('[Media Library] Failed to load media:', error);
    media = [];
    if (mediaBrowser && typeof mediaBrowser.setMediaLoadingState === 'function') {
      mediaBrowser.setMediaLoadingState(false);
    }
  }
}

/**
 * Show placeholder cards while loading
 */
function showPlaceholderCards() {
  const grid = document.getElementById('mediaGrid');
  const loadingMsg = document.getElementById('mediaLoadingMessage');
  if (grid) {
    grid.style.display = '';
    grid.innerHTML = '';
    const placeholderTemplate = `
      <div class="media-placeholder">
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
    Array.from({ length: 12 }, () => {
      const placeholder = document.createElement('div');
      placeholder.className = 'media-placeholder';
      placeholder.innerHTML = placeholderTemplate;
      grid.appendChild(placeholder);
      return placeholder;
    });
    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
  }
  if (loadingMsg) loadingMsg.style.display = 'none';
}

/**
 * Return to all assets (clear all filters)
 */
function returnToAllAssets() {
  if (!mediaBrowser) return;

  // Clear all filters
  mediaBrowser.setFilter({
    folderPath: undefined,
    pagePath: undefined,
    types: ['image', 'video', 'document'],
    isExternal: undefined,
    usedOnPage: false,
    missingAlt: undefined,
    search: '',
  });

  // Clear active states
  document.querySelectorAll('.folder-item').forEach((item) => item.classList.remove('active'));

  // Set All Media as active
  const allMediaItem = document.querySelector('.folder-item[data-filter="all"]');
  if (allMediaItem) {
    allMediaItem.classList.add('active');
  }
}

// Make returnToAllAssets available globally
window.returnToAllAssets = returnToAllAssets;

function setupUIEventHandlers() {
  document.querySelectorAll('.view-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      if (view) {
        handleViewChange(view);
      }
    });
  });

  const folderBrowserBtn = document.getElementById('folderBrowserBtn');
  if (folderBrowserBtn) {
    folderBrowserBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (folderModal) {
        folderModal.showModal();
      } else {
        console.warn('[Media Library] Folder modal not initialized');
      }
    });
  }

  document.querySelectorAll('.folder-item[data-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      const filter = el.getAttribute('data-filter');

      if (filter === 'all') {
        if (typeof window.returnToAllAssets === 'function') {
          window.returnToAllAssets();
        }
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

      if (mediaBrowser) {
        mediaBrowser.setFilter({
          ...defaultFilter,
          ...filterObj,
        });
      }

      document.querySelectorAll('.folder-item').forEach((item) => item.classList.remove('active'));
      el.classList.add('active');
    });
  });

  const minPagesSlider = document.getElementById('minPagesSlider');
  const minPagesValue = document.getElementById('minPagesValue');
  const minOccurrencesSlider = document.getElementById('minOccurrencesSlider');
  const minOccurrencesValue = document.getElementById('minOccurrencesValue');
  if (minPagesSlider && minPagesValue) {
    minPagesSlider.addEventListener('input', (e) => {
      const { value } = e.target;
      minPagesValue.textContent = value;
      handleUsageFilterChange();
    });
  }
  if (minOccurrencesSlider && minOccurrencesValue) {
    minOccurrencesSlider.addEventListener('input', (e) => {
      const { value } = e.target;
      minOccurrencesValue.textContent = value;
      handleUsageFilterChange();
    });
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('.top-media-item')) {
      const topMediaItem = e.target.closest('.top-media-item');
      const mediaId = topMediaItem.getAttribute('data-media-id');
      const mediaName = topMediaItem.getAttribute('data-media-name');
      if (mediaId && mediaBrowser) {
        const foundMedia = mediaBrowser.getSelectedMedia().find((m) => m.id === mediaId)
          || window.media?.find((m) => m.id === mediaId);
        if (foundMedia) {
          handleMediaInfo(foundMedia);
        }
        if (mediaName) {
          const searchInput = document.getElementById('searchInput');
          if (searchInput) {
            searchInput.value = mediaName;
            handleSearch(mediaName);
            if (mediaBrowser && mediaBrowser.setCurrentFilter) {
              mediaBrowser.setCurrentFilter(mediaName);
            }
          }
        }
      }
    }
    if (e.target.closest('.accordion-header')) {
      const accordionHeader = e.target.closest('.accordion-header');
      const accordionId = accordionHeader.getAttribute('data-accordion');
      toggleAccordion(accordionId);
    }
    if (e.target.closest('.top-media-close')) {
      e.stopPropagation();
      clearActiveFilter();
    }
  });
}

/**
 * Render media in the UI
 */
function renderMedia(mediaToRender = media) {
  const grid = document.getElementById('mediaGrid');
  const loadingMsg = document.getElementById('mediaLoadingMessage');
  const placeholders = grid?.querySelectorAll('.media-placeholder');

  // Hide scan indicator when rendering media from media.json
  hideScanProgress();

  if (placeholders && placeholders.length > 0) {
    if (mediaToRender?.length > 0) {
      console.log('[Media Library] Replacing placeholders with real media');
      if (mediaBrowser) {
        mediaBrowser.setMedia(mediaToRender);
      }
      showRenderingProgress(placeholders.length, mediaToRender.length);
      waitForMediaElements(grid, placeholders);
    }
    if (loadingMsg) loadingMsg.style.display = 'none';
    return;
  }
  if (mediaBrowser) {
    mediaBrowser.setMedia(mediaToRender);
  }
  if (mediaToRender?.length > 0) {
    if (grid) grid.style.display = '';
    if (loadingMsg) loadingMsg.style.display = 'none';
    const emptyState = grid?.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    if (mediaBrowser && typeof mediaBrowser.markInitialLoadComplete === 'function') {
      mediaBrowser.markInitialLoadComplete();
    }
    setTimeout(() => {
      if (mediaBrowser && typeof mediaBrowser.setupIntersectionObserver === 'function') {
        mediaBrowser.setupIntersectionObserver();
      }
    }, 200);
  } else {
    setTimeout(() => {
      if (loadingMsg) loadingMsg.style.display = 'none';
      if (mediaBrowser && typeof mediaBrowser.markInitialLoadComplete === 'function') {
        mediaBrowser.markInitialLoadComplete();
      }
    }, 1000);
  }
}
/**
 * Wait for media elements to be rendered before removing placeholders
 */
function waitForMediaElements(grid, placeholders) {
  const maxAttempts = 50;
  let attempts = 0;
  const checkInterval = setInterval(() => {
    attempts += 1;
    const mediaItems = grid.querySelectorAll('.media-item');
    if (mediaItems.length > 0 || attempts >= maxAttempts) {
      clearInterval(checkInterval);
      setTimeout(() => {
        placeholders.forEach((p) => p.remove());
        const emptyState = grid?.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        hideRenderingProgress();
      }, 100);
    }
  }, 50);
}
/**
 * Show rendering progress indicator
 */
function showRenderingProgress(placeholderCount, mediaCount) {
  const grid = document.getElementById('mediaGrid');
  if (!grid) return;
  const progressIndicator = document.createElement('div');
  progressIndicator.className = 'rendering-progress';
  progressIndicator.innerHTML = `
    <div class="rendering-progress-content">
      <div class="rendering-spinner"></div>
      <div class="rendering-text">
        <h4>Rendering ${mediaCount} media items...</h4>
        <p>Replacing ${placeholderCount} placeholder cards</p>
      </div>
    </div>
  `;
  grid.appendChild(progressIndicator);
}
/**
 * Hide rendering progress indicator
 */
function hideRenderingProgress() {
  const progressIndicator = document.querySelector('.rendering-progress');
  if (progressIndicator) {
    progressIndicator.remove();
  }
}

// =============================================================================
// SCANNING INITIALIZATION
// =============================================================================

/**
 * Initialize scanning functionality
 */
async function initializeScanning() {
  if (useQueueBasedScanning) {
    await initializeQueueOrchestrator();
  }

  if (queueOrchestrator) {
    console.log('[Media Library] 🔧 Initializing selective rescan...');
    selectiveRescan = createSelectiveRescan();
    await selectiveRescan.init(
      docAuthoringService,
      sessionManager,
      processingStateManager,
      persistenceManager,
      mediaProcessor,
      queueOrchestrator,
    );
    console.log('[Media Library] ✅ Selective rescan initialized successfully');
  }

  try {
    // Check if it's safe to start a scan (multi-user coordination)
    const canStartScan = await checkInitialScanStatus();

    if (canStartScan) {
      await startFullScan(false);
    } else if (media.length === 0) {
      // Another user is scanning and we don't have media loaded - show scan progress
      showScanProgress();
    } else {
      // Another user is scanning but we have media loaded from media.json - hide scan progress
      hideScanProgress();
    }
  } catch (error) {
    console.warn('Failed to initialize scanning, continuing:', error);
  }
}

/**
 * Initialize queue orchestrator
 */
async function initializeQueueOrchestrator() {
  try {
    queueOrchestrator = createQueueOrchestrator();
    await queueOrchestrator.init(
      docAuthoringService.getConfig(),
      docAuthoringService,
      sessionManager,
      processingStateManager,
      mediaProcessor,
      null, // scanStateManager - will be initialized by orchestrator
      null, // discoveryCoordinator - will be initialized by orchestrator
      null, // scanCompletionHandler - will be initialized by orchestrator
      persistenceManager,
    );

    queueOrchestrator.on('scanningStopped', (data) => {
      console.log('[Media Library] 📡 Received scanningStopped event:', data);
      isScanningInProgress = false;
      if (mediaBrowser && typeof mediaBrowser.setScanningState === 'function') {
        mediaBrowser.setScanningState(false);
      }
      hideScanProgress();
      hideProgressiveLoadingIndicator();
    });

    queueOrchestrator.on('scanningStarted', () => {
      isScanningInProgress = true;
      if (mediaBrowser && typeof mediaBrowser.setScanningState === 'function') {
        mediaBrowser.setScanningState(true);
      }
      resetPollingState();
      console.log('[Media Library] 📡 Received scanningStarted event');
    });

    queueOrchestrator.on('batchProcessingStarted', () => {
    });

    queueOrchestrator.on('batchUploaded', (_data) => {
    });

    queueOrchestrator.on('batchProcessingComplete', () => {
      hideScanProgress();
    });

    queueOrchestrator.on('batchProcessingFailed', () => {
      hideScanProgress();
    });

    queueOrchestrator.on('siteStructureUpdated', (data) => {
      console.log('[Media Library] 📡 Received siteStructureUpdated event:', data);
      hideScanProgress();
      stopPolling();

      localStorage.setItem('fullScanCompleted', 'true');
      if (mediaBrowser && typeof mediaBrowser.setScanningState === 'function') {
        mediaBrowser.setScanningState(false);
      }
      isScanningInProgress = false;
    });

    // Re-initialize folder modal with queue orchestrator for event handling
    if (folderModal) {
      await folderModal.init(
        docAuthoringService.getConfig(),
        docAuthoringService,
        queueOrchestrator,
      );

      // Set up folder filter event handlers
      if (queueOrchestrator && typeof queueOrchestrator.on === 'function') {
        queueOrchestrator.on('folderFilterApplied', (data) => {
          if (mediaBrowser) {
            const { path, type } = data;
            if (type === 'folder') {
              mediaBrowser.setFilter({
                folderPath: path,
                types: ['image', 'video', 'document'],
                isExternal: undefined,
                usedOnPage: false,
                missingAlt: undefined,
                search: '',
              });
            } else if (type === 'file') {
              mediaBrowser.setFilter({
                pagePath: path,
                search: '',
              });
            }
          }
        });

        queueOrchestrator.on('folderFilterCleared', () => {
          if (mediaBrowser) {
            mediaBrowser.setFilter({
              folderPath: undefined,
              pagePath: undefined,
              folderPaths: undefined,
              pagePaths: undefined,
              types: ['image', 'video', 'document'],
              isExternal: undefined,
              usedOnPage: false,
              missingAlt: undefined,
              search: '',
            });
          }
        });

        queueOrchestrator.on('multiFilterApplied', (data) => {
          if (mediaBrowser) {
            const { items } = data;
            const folderPaths = [];
            const pagePaths = [];
            items.forEach((item) => {
              const fullPath = `/${daContext.org}/${daContext.repo}${item.path}`;
              if (item.type === 'folder') {
                folderPaths.push(fullPath);
              } else if (item.type === 'file') {
                pagePaths.push(fullPath);
              }
            });
            mediaBrowser.setFilter({
              folderPaths: folderPaths.length > 0 ? folderPaths : undefined,
              pagePaths: pagePaths.length > 0 ? pagePaths : undefined,
              types: ['image', 'video', 'document'],
              isExternal: undefined,
              usedOnPage: false,
              missingAlt: undefined,
              search: '',
            });
          }
        });

        queueOrchestrator.on('multiRescanRequested', async (data) => {
          const { items } = data;
          const folderPaths = [];
          const pagePaths = [];
          items.forEach((item) => {
            const orgRepoPattern = new RegExp(`^/${daContext.org}/${daContext.repo}/`);
            const relativePath = item.path.replace(orgRepoPattern, '');
            if (item.type === 'folder') {
              folderPaths.push(relativePath);
            } else if (item.type === 'file') {
              pagePaths.push(relativePath);
            }
          });
          await handleMultiRescan(folderPaths, pagePaths);
        });
      }
    }
  } catch (error) {
    console.error('[Media Library] ❌ Failed to initialize queue orchestrator:', error);
    throw error;
  }
}

// =============================================================================
// SCANNING OPERATIONS
// =============================================================================
/**
 * Check initial scan status by verifying discovery and scanning checkpoints
 * @returns {Promise<boolean>} True if safe to start scan, false if another scan is running
 */
async function checkInitialScanStatus() {
  try {
    const [discoveryCheckpoint, scanningCheckpoint] = await Promise.all([
      processingStateManager.loadDiscoveryCheckpoint(),
      processingStateManager.loadScanningCheckpoint(),
    ]);
    console.log('[Media Library] 📊 Checkpoint Status:', {
      discovery: discoveryCheckpoint.status,
      scanning: scanningCheckpoint.status,
      lastUpdate: new Date(scanningCheckpoint.lastUpdated).toLocaleString(),
    });
    const isActive = discoveryCheckpoint.status === 'running' || scanningCheckpoint.status === 'running';
    if (isActive) {
      return false;
    }
    return true;
  } catch (error) {
    console.error('[Media Library] ❌ Failed to check scan status:', error);
    return true;
  }
}

/**
 * Start full content scan with session management
 */
async function startFullScan(forceRescan = false) {
  try {
    console.log('[Media Library] startFullScan called with forceRescan:', forceRescan);
    resetPollingState();
    if (sessionManager && currentUserId && currentBrowserId) {
      try {
        const sessionId = await sessionManager.createSession(currentUserId, currentBrowserId, forceRescan ? 'force' : 'incremental');
        currentSessionId = sessionId;
        console.log('[Media Library] Created session:', sessionId);
        if (mediaProcessor) {
          mediaProcessor.setCurrentSession(sessionId, currentUserId, currentBrowserId);
        }
      } catch (sessionError) {
        console.warn('[Media Library] Failed to create session, falling back to legacy scanning:', sessionError);
      }
    }
    if (sessionManager && currentSessionId) {
      console.log('[Media Library] Starting queue scanning with session...');
      await queueOrchestrator.startQueueScanning(
        forceRescan,
        currentSessionId,
        currentUserId,
        currentBrowserId,
      );
    } else {
      console.log('[Media Library] Starting queue scanning without session...');
      await queueOrchestrator.startQueueScanning(forceRescan);
    }
  } catch (error) {
    console.error('[Media Library] Full scan failed:', error);
    showError('Full scan failed', error);
    hideScanProgress();
  }
}
/**
 * Stop polling for media updates
 */
function stopPolling() {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
    console.log('[Media Library] Stopped polling for media updates');
  }
  stopMediaPolling();
}

/**
 * Reset polling state when new scan starts
 */
function resetPollingState() {
  localStorage.removeItem(MEDIA_LASTMOD_KEY);
  localStorage.removeItem('fullScanCompleted');
}
/**
 * Hide progressive loading indicator
 */
function hideProgressiveLoadingIndicator() {
  const indicator = document.querySelector('.progressive-loading-indicator');
  if (indicator) {
    indicator.remove();
  }
}
/**
 * Hide media loading progress in top bar
 */
function hideMediaLoadingProgress() {
  const progressContainer = document.getElementById('mediaLoadingProgress');
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }
}

// =============================================================================
// MULTI-RESCAN HANDLERS
// =============================================================================

/**
 * Handle multi-selection rescan for folders and files
 * @param {Array<string>} folderPaths - Array of folder paths to rescan
 * @param {Array<string>} pagePaths - Array of page paths to rescan
 * @returns {Promise<void>}
 */
async function handleMultiRescan(folderPaths, pagePaths) {
  try {
    if (!selectiveRescan) {
      console.error('[Media Library] ❌ Selective rescan not available');
      showError('Selective rescan not available');
      return;
    }
    if (!currentSessionId && sessionManager && currentUserId && currentBrowserId) {
      const sessionId = await sessionManager.createSession(currentUserId, currentBrowserId, 'selective');
      currentSessionId = sessionId;
    }
    if (mediaProcessor && currentSessionId && currentUserId && currentBrowserId) {
      mediaProcessor.setCurrentSession(currentSessionId, currentUserId, currentBrowserId);
    }
    if (selectiveRescan && currentSessionId && currentUserId && currentBrowserId) {
      selectiveRescan.setCurrentSession(currentSessionId, currentUserId, currentBrowserId);
    }
    const results = [];
    if (folderPaths.length > 0) {
      console.log('[Media Library] 🔍 Starting folder rescan for paths:', folderPaths);
      const folderResults = await Promise.allSettled(
        folderPaths.map(async (folderPath) => {
          try {
            console.log('[Media Library] 🔍 Rescanning folder:', folderPath);
            const result = await selectiveRescan.rescanFolder(folderPath);
            console.log('[Media Library] ✅ Folder rescan completed:', { folderPath, result });
            return { type: 'folder', path: folderPath, result };
          } catch (error) {
            console.error('[Media Library] ❌ Folder rescan failed:', { folderPath, error: error.message, stack: error.stack });
            return { type: 'folder', path: folderPath, error: error.message };
          }
        }),
      );
      console.log('[Media Library] 📊 Folder results:', folderResults);
      results.push(...folderResults.map((r) => r.value || r.reason));
    }
    if (pagePaths.length > 0) {
      try {
        console.log('[Media Library] 🔍 Starting page rescan for paths:', pagePaths);
        const result = await selectiveRescan.rescanPages(pagePaths);
        console.log('[Media Library] ✅ Page rescan completed:', { pagePaths, result });
        results.push({ type: 'pages', paths: pagePaths, result });
      } catch (error) {
        console.error('[Media Library] ❌ Page rescan failed:', { pagePaths, error: error.message, stack: error.stack });
        results.push({ type: 'pages', paths: pagePaths, error: error.message });
      }
    }
    console.log('[Media Library] 📊 Final results:', results);
    const successCount = results.filter((r) => !r.error).length;
    const errorCount = results.filter((r) => r.error).length;
    console.log('[Media Library] 📈 Success/Error counts:', { successCount, errorCount, totalResults: results.length });
    if (errorCount === 0) {
      showToast(`Successfully queued ${successCount} items for processing`);
    } else {
      console.error('[Media Library] ❌ Errors found in results:', results.filter((r) => r.error));
      showToast(`Queued ${successCount} items, ${errorCount} errors`);
    }
  } catch (error) {
    console.error('[Media Library] ❌ Multi-rescan failed:', error);
    showError('Multi-rescan failed', error);
  }
}

// =============================================================================
// MEDIA EVENT HANDLERS
// =============================================================================

/**
 * Handle media selection
 */
const handleMediaSelection = async (selectedMedia) => {
  try {
    await mediaInsertion.selectMedia(selectedMedia);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to insert media:', error);
  }
};

/**
 * Handle media insertion as link
 */
const handleMediaInsertAsLink = async (selectedMedia) => {
  try {
    await mediaInsertion.insertMediaAsLink(selectedMedia);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to insert media as link:', error);
  }
};

/**
 * Handle media link copied
 */
const handleMediaLinkCopied = async (selectedMedia) => {
  try {
    const mediaUrl = selectedMedia.url || selectedMedia.src;
    window.open(mediaUrl, '_blank');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to open link:', error);
    showError('Failed to open link', error);
  }
};

/**
 * Handle media info display
 */
const handleMediaInfo = (selectedMedia) => {
  try {
    showMediaInfoModal(selectedMedia);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to show media info modal:', error);
    showError('Failed to show media details', error);
  }
};

// =============================================================================
// UI EVENT HANDLERS
// =============================================================================

/**
 * Handle search functionality
 */
function handleSearch(query) {
  const queryLower = query.toLowerCase();
  const filteredMedia = media.filter((mediaItem) => {
    const nameMatch = mediaItem.name.toLowerCase().includes(queryLower);
    const altMatch = mediaItem.alt.toLowerCase().includes(queryLower);
    return nameMatch || altMatch;
  });
  renderMedia(filteredMedia);
}

/**
 * Handle view changes
 */
function handleUsageFilterChange() {
  const minOccurrences = document.getElementById('minOccurrencesSlider')?.value;
  const minPages = document.getElementById('minPagesSlider')?.value;
  if (mediaBrowser) {
    mediaBrowser.setFilter({
      minOccurrences: minOccurrences ? parseInt(minOccurrences, 10) : 1,
      minPages: minPages ? parseInt(minPages, 10) : 1,
    });
  }
}

function toggleAccordion(accordionId) {
  const accordionHeader = document.querySelector(`[data-accordion="${accordionId}"]`);
  const accordionContent = document.getElementById(`${accordionId}Accordion`);
  const accordionIcon = accordionHeader.querySelector('.accordion-icon');
  if (accordionContent && accordionHeader) {
    const isCollapsed = accordionContent.classList.contains('collapsed');
    if (isCollapsed) {
      accordionContent.classList.remove('collapsed');
      accordionHeader.classList.remove('collapsed');
      accordionIcon.style.transform = 'rotate(0deg)';
    } else {
      accordionContent.classList.add('collapsed');
      accordionHeader.classList.add('collapsed');
      accordionIcon.style.transform = 'rotate(-90deg)';
    }
  }
}

function clearActiveFilter() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '';
    handleSearch('');
  }
  if (mediaBrowser && mediaBrowser.setCurrentFilter) {
    mediaBrowser.setCurrentFilter(null);
  }
}

function handleViewChange(view) {
  const viewBtns = document.querySelectorAll('.view-btn');
  viewBtns.forEach((btn) => btn.classList.remove('active'));

  const activeBtn = document.querySelector(`[data-view="${view}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (mediaBrowser) {
    mediaBrowser.setView(view);
  } else {
    console.log('[MediaLibrary] ⚠️ mediaBrowser not available');
  }
}

/**
 * Insert media by ID
 */
function insertMedia(mediaId) {
  const foundMedia = media.find((a) => a.id === mediaId);
  if (foundMedia) handleMediaSelection(foundMedia);
}

// =============================================================================
// PROGRESS & UI UPDATES
// =============================================================================

/**
 * Show scan progress indicators
 */
function showScanProgress() {
  console.log('[Media Library] showScanProgress called');
  const progressContainer = document.getElementById('scanProgress');
  if (progressContainer) {
    progressContainer.style.display = 'flex';
    console.log('[Media Library] Scan progress container shown');
  } else {
    console.log('[Media Library] Scan progress container not found');
  }
  if (typeof window.showScanIndicator === 'function') {
    window.showScanIndicator();
    console.log('[Media Library] Window showScanIndicator called');
  } else {
    try {
      import('./modules/scan-indicator.js').then((mod) => mod.showScanIndicator());
      console.log('[Media Library] Imported and called showScanIndicator');
    } catch (e) {
      console.log('[Media Library] Failed to import scan indicator:', e);
    }
  }
}

/**
 * Hide scan progress indicators
 */
function hideScanProgress() {
  const progressContainer = document.getElementById('scanProgress');
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }
  if (typeof window.hideScanIndicator === 'function') {
    window.hideScanIndicator();
  } else {
    try {
      import('./modules/scan-indicator.js').then((mod) => mod.hideScanIndicator());
    } catch (e) {
      console.warn('[Media Library] Failed to import scan indicator for hiding:', e);
    }
  }
}

/**
 * Update loading text
 */
function updateLoadingText(text) {
  const scanProgressText = document.getElementById('scanProgressText');
  const loadingMessage = document.getElementById('mediaLoadingMessage');

  if (scanProgressText) {
    scanProgressText.textContent = text;
  }

  if (loadingMessage && !text.includes('Uploading media:')) {
    const loadingText = loadingMessage.querySelector('.loading-text h3');
    if (loadingText) {
      loadingText.textContent = text;
    }
  }
}

// =============================================================================
// DOM EVENT LISTENERS
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Media Library] DOMContentLoaded event fired');
  document.body.style.opacity = '1';
  document.body.classList.add('loaded');
  showPlaceholderCards();

  console.log('[Media Library] Starting initialization...');
  init().catch((error) => {
    console.error('Initialization failed:', error);

    document.body.classList.add('loaded');
    document.body.style.opacity = '1';

    const grid = document.getElementById('mediaGrid');
    const loadingMsg = document.getElementById('mediaLoadingMessage');

    if (loadingMsg) loadingMsg.style.display = 'none';
    if (grid) {
      grid.style.display = '';
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <h3 class="empty-state-title">Media Library Error</h3>
          <p class="empty-state-description">
            Failed to initialize Media Library. Please refresh the page to try again.
          </p>
          <div class="empty-state-actions">
            <button class="btn btn-primary" onclick="location.reload()">
              Refresh Page
            </button>
          </div>
        </div>
      `;
    }
  });
});

document.addEventListener('insertMedia', (event) => {
  insertMedia(event.detail.mediaId);
});

document.addEventListener('insertMediaAsLink', (event) => {
  const foundMedia = media.find((a) => a.id === event.detail.mediaId);
  if (foundMedia) {
    handleMediaInsertAsLink(foundMedia);
  }
});

// =============================================================================
// WINDOW EXPOSURES
// =============================================================================

window.renderMedia = renderMedia;
window.handleViewChange = handleViewChange;
window.handleSearch = handleSearch;
window.handleMediaSelection = handleMediaSelection;
window.handleMediaInsertAsLink = handleMediaInsertAsLink;
window.handleMediaLinkCopied = handleMediaLinkCopied;
window.handleMediaInfo = handleMediaInfo;
window.insertMedia = insertMedia;
window.showScanProgress = showScanProgress;
window.hideScanProgress = hideScanProgress;
window.updateLoadingText = updateLoadingText;
window.updateLoadingText = updateLoadingText;