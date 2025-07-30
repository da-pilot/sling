
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
import createMediaProcessor from './modules/media-processor.js';

// Internal modules
import createMediaBrowser from './modules/media-browser.js';
import createMediaInsertion from './modules/media-insert.js';
import createQueueManager from './modules/queue-manager.js';
import { initSelectiveRescan } from './modules/rescan.js';
import initUIEvents from './modules/ui-events.js';
import { initHierarchyBrowser } from './modules/hierarchy-browser.js';
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
let queueManager = null;
let sessionManager = null;
let processingStateManager = null;
let mediaProcessor = null;
let currentUserId = null;
let currentSessionId = null;
let currentBrowserId = null;
let media = [];

// =============================================================================
// GLOBAL WINDOW ASSIGNMENTS
// =============================================================================

window.loadMediaFromMediaJson = loadMediaFromMediaJson;
window.loadMediaFromIndexedDB = loadMediaFromIndexedDB;
window.checkIndexedDBStatus = checkIndexedDBStatus;

if (typeof setMediaLoaderMediaBrowser === 'function') setMediaLoaderMediaBrowser(media);

// =============================================================================
// MAIN INITIALIZATION
// =============================================================================

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

    // eslint-disable-next-line no-console
    console.log('🔧 [INIT] DA SDK loaded, initializing core services...');
    await initializeCoreServices();

    // eslint-disable-next-line no-console
    console.log('🔧 [INIT] Core services initialized, loading and rendering media...');
    await loadAndRenderMedia();

    // eslint-disable-next-line no-console
    console.log(
      '🔧 [INIT] Media loaded, initializing scanning...',
    );
    await initializeScanning();

    // eslint-disable-next-line no-console
    console.log('🔧 [INIT] Scanning initialized, setting up UI...');
    document.body.classList.add('loaded');
    document.body.style.opacity = '1';
    setInterval(checkScanAndStartPolling, POLLING_INTERVAL);

    // eslint-disable-next-line no-console
    console.log('🔧 [INIT] Media Library initialization complete!');
  } catch (error) {
    // eslint-disable-next-line no-console
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
  mediaProcessor = createMediaProcessor();

  await sessionManager.init(docAuthoringService);
  await processingStateManager.init({ daApi: docAuthoringService });
  await mediaProcessor.init(
    docAuthoringService,
    sessionManager,
    processingStateManager,
  );

  window.mediaProcessor = mediaProcessor;
  // Generate session identifiers
  currentUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const userAgent = navigator.userAgent.replace(/[^a-zA-Z0-9]/g, '').substr(0, 20);
  currentBrowserId = `browser_${userAgent}_${Date.now()}`;

  // Set up media update handler
  setupMediaUpdateHandler();

  // eslint-disable-next-line no-console
  console.log('[Media Library] ✅ Core services initialized:', {
    hasSessionManager: !!sessionManager,
    hasProcessingStateManager: !!processingStateManager,
    hasMediaProcessor: !!mediaProcessor,
    hasMediaBrowser: !!mediaBrowser,
    timestamp: new Date().toISOString(),
  });

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
      // eslint-disable-next-line no-console
      console.log('[Media Library] 📱 Updating UI with', updatedMedia.length, 'media');
      // Update global media array to keep it in sync
      media = updatedMedia || [];
      mediaBrowser.updateMedia(updatedMedia);
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
    // eslint-disable-next-line no-console
    console.log('📱 [LOAD] Loading media from media.json...');
    const { mediaJsonExists, media: loadedMedia } = await loadMediaFromMediaJson();

    // eslint-disable-next-line no-console
    console.log('📱 [LOAD] Media data loaded:', {
      mediaJsonExists,
      mediaCount: loadedMedia?.length || 0,
    });

    if (mediaJsonExists) {
      // eslint-disable-next-line no-console
      console.log('📱 [LOAD] Media.json exists, showing placeholder cards...');
      showPlaceholderCards();
    }

    // Update global media array
    media = loadedMedia || [];
    // eslint-disable-next-line no-console
    console.log('📱 [LOAD] Rendering media with count:', media.length);
    renderMedia(media);

    // Initialize hierarchy browser after media is loaded
    try {
      // eslint-disable-next-line no-console
      console.log('📱 [LOAD] Initializing hierarchy browser...');
      await initHierarchyBrowser();
      // eslint-disable-next-line no-console
      console.log('📱 [LOAD] Hierarchy browser initialized successfully');
    } catch (hierarchyError) {
      // eslint-disable-next-line no-console
      console.warn('Failed to initialize hierarchy browser:', hierarchyError);
    }
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

function setupUIEventHandlers() {
  document.querySelectorAll('.view-btn:not(#hierarchyToggle)').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      if (view) {
        handleViewChange(view);
      }
    });
  });

  const hierarchyToggle = document.getElementById('hierarchyToggle');
  if (hierarchyToggle) {
    hierarchyToggle.addEventListener('click', () => {
      if (typeof window.toggleHierarchyView === 'function') {
        window.toggleHierarchyView();
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
  console.log('🎨 [RENDER] Rendering media:', {
    count: mediaToRender?.length || 0,
    hasMediaBrowser: !!mediaBrowser,
  });

  if (mediaBrowser) mediaBrowser.updateMedia(mediaToRender);

  const grid = document.getElementById('mediaGrid');
  const loadingMsg = document.getElementById('mediaLoadingMessage');

  console.log('🎨 [RENDER] DOM elements found:', { hasGrid: !!grid, hasLoadingMsg: !!loadingMsg });

  if (mediaToRender?.length > 0) {
    console.log('🎨 [RENDER] Rendering media items...');
    if (grid) grid.style.display = '';
    if (loadingMsg) loadingMsg.style.display = 'none';

    const placeholders = grid?.querySelectorAll('.media-placeholder');
    placeholders?.forEach((p) => p.remove());

    const emptyState = grid?.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    return;
  }

  console.log('🎨 [RENDER] No media found, showing empty state...');
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
    console.log('🎨 [RENDER] Empty state HTML set');

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
    await initializeQueueManager();
  }

  if (queueManager?.getConfig) {
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
 * Initialize queue manager
 */
async function initializeQueueManager() {
  try {
    // eslint-disable-next-line no-console
    console.log('[Media Library] 🔧 Initializing queue manager...');
    queueManager = createQueueManager();
    await queueManager.init(
      docAuthoringService,
      sessionManager,
      processingStateManager,
      mediaProcessor, // Pass media processor reference
    );

    // Set up event listeners for queue manager
    queueManager.on('scanningStopped', (data) => {
      console.log('[Media Library] 📡 Received scanningStopped event:', data);
      hideScanProgress();
    });

    // Set up batch processing event handlers
    queueManager.on('batchProcessingStarted', () => {
      updateLoadingText('Uploading media to media.json...');
    });

    queueManager.on('batchUploaded', (data) => {
      const progress = Math.round((data.stats.processedBatches / data.stats.totalBatches) * 100);
      updateLoadingText(`Uploading media: ${progress}% (${data.stats.uploadedBatches}/${data.stats.totalBatches} batches)`);
    });

    queueManager.on('batchProcessingComplete', () => {
      updateLoadingText('Media upload completed');
      hideScanProgress();
    });

    queueManager.on('batchProcessingFailed', () => {
      updateLoadingText('Media upload failed');
      hideScanProgress();
    });

    // eslint-disable-next-line no-console
    console.log('[Media Library] ✅ Queue manager initialized');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Media Library] ❌ Failed to initialize queue manager:', error);
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
        console.log('[DEBUG] currentSessionId assigned:', currentSessionId);
        // Set session for core services
        if (mediaProcessor) {
          mediaProcessor.setCurrentSession(sessionId, currentUserId, currentBrowserId);
        }

        // eslint-disable-next-line no-console
        console.log('[Media Library] 🎯 Session created for scanning:', {
          sessionId,
          userId: currentUserId,
          browserId: currentBrowserId,
          scanType: forceRescan ? 'force' : 'incremental',
          timestamp: new Date().toISOString(),
        });
      } catch (sessionError) {
        // eslint-disable-next-line no-console
        console.warn('[Media Library] ⚠️ Failed to create session, falling back to legacy scanning:', sessionError);
      }
    }

    // eslint-disable-next-line no-console
    console.log('🚀 [FULL SCAN] Starting V2 full content scan...', {
      forceRescan,
      sessionId,
      hasV2Services: !!(processingStateManager),
      timestamp: new Date().toISOString(),
    });

    showScanProgress();
    updateLoadingText('Starting V2 full content scan...');

    // Start scanning with session management
    if (sessionId) {
      await queueManager.startQueueScanning(
        forceRescan,
        sessionId,
        currentUserId,
        currentBrowserId,
      );
    } else {
      await queueManager.startQueueScanning(forceRescan);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
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
    if (isScanning) {
      return;
    }

    const mediaData = await loadMediaFromMediaJson();
    if (mediaData.mediaJsonExists && mediaData.media.length > 0) {
      console.log('[Media Library] Media loaded successfully:', mediaData.media.length, 'items');
      return;
    }

    console.log('[Media Library] No media found in media.json');
  } catch (error) {
    console.error('[Media Library] Error in scan polling:', error);
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
function handleViewChange(view) {
  const viewBtns = document.querySelectorAll('.view-btn');
  viewBtns.forEach((btn) => btn.classList.remove('active'));

  const activeBtn = document.querySelector(`[data-view="${view}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (mediaBrowser) mediaBrowser.setView(view);

  const hierarchyContainer = document.getElementById('hierarchyContainer');
  const isInFolderView = hierarchyContainer && hierarchyContainer.style.display !== 'none';
  if (!isInFolderView) {
    document.getElementById('hierarchyToggle')?.classList.remove('active');
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