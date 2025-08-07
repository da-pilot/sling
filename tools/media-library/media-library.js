
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
import { initSelectiveRescan } from './modules/rescan.js';
import initUIEvents from './modules/ui-events.js';

import createFolderModal from './modules/folder-modal.js';
import { showMediaInfoModal } from './modules/media-info-modal.js';
import { showError } from './modules/toast.js';

// Utilities and constants
import {
  DA_PATHS, SCAN_CONFIG, ERROR_MESSAGES,
} from './constants.js';
import {
  loadMediaFromMediaJson,
  loadMediaFromIndexedDB,
  checkIndexedDBStatus,
  setMediaBrowser as setMediaLoaderMediaBrowser,
  setContext as setMediaLoaderContext,
  setDocAuthoringService as setMediaLoaderDocAuthoringService,
} from './modules/media-loader.js';

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

const { POLLING_INTERVAL } = SCAN_CONFIG;
const HOURS_IN_DAY = 24;
const useQueueBasedScanning = true;

// Polling control variables
let pollingIntervalId = null;
let lastMediaCount = 0;
let lastMediaUpdateTime = null;
let consecutiveUnchangedCount = 0;
let spinnerTimeoutId = null;
const MAX_UNCHANGED_COUNT = 1; // Stop polling after 1 consecutive unchanged count
const STABLE_PERIOD_MS = 30000; // 30 seconds of no changes before stopping
const SPINNER_TIMEOUT_MS = 10000; // 10 seconds of inactivity before hiding spinner

// =============================================================================
// GLOBAL STATE VARIABLES
// =============================================================================

let isScanning = false;
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
let currentUserId = null;
// eslint-disable-next-line no-unused-vars
let currentSessionId = null;
let currentBrowserId = null;
let media = [];

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

    // Add mode detection here AFTER daContext is available
    const modeInfo = detectMode();
    window.mediaLibraryMode = modeInfo; // Make it globally accessible

    await initializeCoreServices();

    await loadAndRenderMedia();

    await initializeScanning();

    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
    startPolling();

    // eslint-disable-next-line no-console
    console.log('🔧 [INIT] Media Library initialization complete!');
  } catch (error) {
    console.error('Failed to initialize:', error);
    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
    showError(ERROR_MESSAGES.INITIALIZATION_FAILED, error);
  }
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

  if (typeof setMediaLoaderContext === 'function') {
    setMediaLoaderContext(daContext);
  }

  if (typeof setMediaLoaderDocAuthoringService === 'function') {
    setMediaLoaderDocAuthoringService(docAuthoringService);
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
  if (mediaProcessor && mediaBrowser) {
    mediaProcessor.setOnMediaUpdated((updatedMedia) => {
      // Update global media array to keep it in sync
      media = updatedMedia || [];
      mediaBrowser.setMedia(updatedMedia);
    });
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
    const { mediaJsonExists, media: loadedMedia } = await loadMediaFromMediaJson();

    if (mediaJsonExists) {
      showPlaceholderCards();
    }

    // Update global media array
    media = loadedMedia || [];
    renderMedia(media);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to load media:', error);
    media = [];
    renderMedia(media);
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
  }

  if (loadingMsg) loadingMsg.style.display = 'none';

  if (mediaBrowser && typeof mediaBrowser.markInitialLoadComplete === 'function') {
    mediaBrowser.markInitialLoadComplete();
  }
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
}

/**
 * Render media in the UI
 */
function renderMedia(mediaToRender = media) {
  if (mediaBrowser) mediaBrowser.setMedia(mediaToRender);

  const grid = document.getElementById('mediaGrid');
  const loadingMsg = document.getElementById('mediaLoadingMessage');

  if (mediaToRender?.length > 0) {
    if (grid) grid.style.display = '';
    if (loadingMsg) loadingMsg.style.display = 'none';

    const placeholders = grid?.querySelectorAll('.media-placeholder');
    placeholders?.forEach((p) => p.remove());

    const emptyState = grid?.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    return;
  }

  if (grid) {
    grid.style.display = '';
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📁</div>
        <h3 class="empty-state-title">No media found</h3>
        <p class="empty-state-description">
          No media has been discovered yet. The system is scanning your content
          for images, videos, and documents.
        </p>
        <div class="empty-state-actions">
          <button class="btn btn-primary" onclick="loadMediaFromMediaJson({ force: true })">
            Refresh Media
          </button>
        </div>
      </div>
    `;
    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
  }

  const placeholders = grid?.querySelectorAll('.media-placeholder');
  if (placeholders && placeholders.length > 0) {
    if (loadingMsg) loadingMsg.style.display = 'none';
  } else {
    setTimeout(() => {
      if (loadingMsg) loadingMsg.style.display = 'none';
    }, 1000);
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
    await initSelectiveRescan(
      docAuthoringService,
      sessionManager,
      processingStateManager,
    );
  }

  try {
    await checkScanStatus();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to check scan status, continuing:', error);
  }

  try {
    await startFullScan(false);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to start full scan, continuing:', error);
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
      hideScanProgress();
    });

    queueOrchestrator.on('scanningStarted', () => {
      resetPollingState();
      console.log('[Media Library] 📡 Received scanningStarted event');
    });

    queueOrchestrator.on('batchProcessingStarted', () => {
      updateLoadingText('Uploading media to media.json...');
    });

    queueOrchestrator.on('batchUploaded', (data) => {
      const progress = Math.round((data.stats.processedBatches / data.stats.totalBatches) * 100);
      updateLoadingText(`Uploading media: ${progress}% (${data.stats.uploadedBatches}/${data.stats.totalBatches} batches)`);
    });

    queueOrchestrator.on('batchProcessingComplete', () => {
      updateLoadingText('Media upload completed');
      hideScanProgress();
    });

    queueOrchestrator.on('batchProcessingFailed', () => {
      updateLoadingText('Media upload failed');
      hideScanProgress();
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
              types: ['image', 'video', 'document'],
              isExternal: undefined,
              usedOnPage: false,
              missingAlt: undefined,
              search: '',
            });
          }
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
 * Check current scan status
 */
async function checkScanStatus() {
  if (!useQueueBasedScanning || !queueOrchestrator) return;

  try {
    const [isActive, persistentStats] = await Promise.all([
      /* eslint-disable-next-line no-use-before-define */
      queueOrchestrator.isScanActive(),
      /* eslint-disable-next-line no-use-before-define */
      queueOrchestrator.getPersistentStats(),
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
 * Start full content scan with session management
 */
async function startFullScan(forceRescan = false) {
  try {
    isScanning = true;

    // Create session for scanning
    let sessionId = null;
    if (sessionManager && currentUserId && currentBrowserId) {
      try {
        sessionId = await sessionManager.createSession(currentUserId, currentBrowserId, forceRescan ? 'force' : 'incremental');
        currentSessionId = sessionId;
        if (mediaProcessor) {
          mediaProcessor.setCurrentSession(sessionId, currentUserId, currentBrowserId);
        }
      } catch (sessionError) {
        console.warn('[Media Library] ⚠️ Failed to create session, falling back to legacy scanning:', sessionError);
      }
    }

    showScanProgress();
    updateLoadingText('Starting V2 full content scan...');
    resetPollingState();

    if (sessionId) {
      await queueOrchestrator.startQueueScanning(
        forceRescan,
        sessionId,
        currentUserId,
        currentBrowserId,
      );
    } else {
      await queueOrchestrator.startQueueScanning(forceRescan);
    }
  } catch (error) {
    console.error('V2 full scan failed:', error);
    showError('V2 full scan failed', error);
    isScanning = false;
    hideScanProgress();
  }
}

/**
 * Check scan status and start polling
 */
async function checkScanAndStartPolling() {
  try {
    isScanning = await checkScanStatus();
    if (isScanning) {
      consecutiveUnchangedCount = 0;
      // Restart polling if scanning is active but polling was stopped
      if (!pollingIntervalId) {
        startPolling();
      }
      return;
    }

    // If not scanning and no polling, hide scan progress
    if (!isScanning && !pollingIntervalId) {
      hideScanProgress();
    }

    const mediaData = await loadMediaFromMediaJson();
    const currentMediaCount = mediaData.media?.length || 0;
    const currentTime = Date.now();

    // Check if media count has changed
    if (currentMediaCount !== lastMediaCount) {
      lastMediaCount = currentMediaCount;
      lastMediaUpdateTime = currentTime;
      consecutiveUnchangedCount = 0;

      // Reset spinner timeout on activity
      if (spinnerTimeoutId) {
        clearTimeout(spinnerTimeoutId);
        spinnerTimeoutId = setTimeout(() => {
          hideScanProgress();
          console.log('[Media Library] Hiding spinner due to inactivity timeout');
        }, SPINNER_TIMEOUT_MS);
      }

      // Only refresh UI when count actually changes
      if (mediaData.mediaJsonExists && mediaData.media.length > 0) {
        renderMedia(mediaData.media);
      }
    } else {
      consecutiveUnchangedCount += 1;

      // Stop polling if count hasn't changed for multiple consecutive checks
      if (consecutiveUnchangedCount >= MAX_UNCHANGED_COUNT) {
        stopPolling();
        hideScanProgress();
        console.log('[Media Library] Stopping polling - no media updates detected');
      }

      // Stop polling if no changes for stable period
      if (lastMediaUpdateTime && (currentTime - lastMediaUpdateTime) > STABLE_PERIOD_MS) {
        stopPolling();
        hideScanProgress();
        console.log('[Media Library] Stopping polling - stable period reached');
      }
    }
  } catch (error) {
    console.error('[Media Library] Error in scan polling:', error);
  }
}

/**
 * Start polling for media updates
 */
function startPolling() {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
  }
  pollingIntervalId = setInterval(checkScanAndStartPolling, POLLING_INTERVAL);
  console.log('[Media Library] Started polling for media updates');

  // Set timeout to hide spinner if no activity
  if (spinnerTimeoutId) {
    clearTimeout(spinnerTimeoutId);
  }
  spinnerTimeoutId = setTimeout(() => {
    hideScanProgress();
    console.log('[Media Library] Hiding spinner due to inactivity timeout');
  }, SPINNER_TIMEOUT_MS);
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

  // Clear spinner timeout
  if (spinnerTimeoutId) {
    clearTimeout(spinnerTimeoutId);
    spinnerTimeoutId = null;
  }
}

/**
 * Reset polling state when new scan starts
 */
function resetPollingState() {
  lastMediaCount = 0;
  lastMediaUpdateTime = null;
  consecutiveUnchangedCount = 0;

  // Clear spinner timeout when resetting
  if (spinnerTimeoutId) {
    clearTimeout(spinnerTimeoutId);
    spinnerTimeoutId = null;
  }

  console.log('[Media Library] Reset polling state');
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

/**
 * Hide scan progress indicators
 */
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

/**
 * Update loading text
 */
function updateLoadingText(text) {
  const loadingMessage = document.getElementById('mediaLoadingMessage');
  if (loadingMessage) {
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
  document.body.style.opacity = '1';
  document.body.classList.add('loaded');
  showPlaceholderCards();

  if (typeof window.showScanIndicator === 'function') {
    window.showScanIndicator();
  } else {
    try {
      import('./modules/scan-indicator.js').then((mod) => mod.showScanIndicator());
    } catch (e) {
      // Intentionally empty: scan indicator is non-critical
    }
  }

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