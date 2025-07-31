/* eslint-disable no-use-before-define */

import { loadSheetFile, CONTENT_DA_LIVE_BASE } from './sheet-utils.js';

let hierarchyTree = {};
let currentPath = [];
let currentMediaPagePath = null;
let isHierarchyView = false;

function buildHierarchyTree(mediaData) {
  const tree = {};
  mediaData.forEach((mediaItem) => {
    let usedInArr = [];
    if (Array.isArray(mediaItem.usedIn)) {
      usedInArr = mediaItem.usedIn;
    } else if (typeof mediaItem.usedIn === 'string') {
      usedInArr = [mediaItem.usedIn];
    }
    usedInArr.forEach((usedInPath) => {
      const parts = usedInPath.split('/').filter(Boolean);
      const displayParts = parts.slice(2);
      let node = tree;
      displayParts.forEach((part, i) => {
        if (!node[part]) {
          node[part] = { children: {}, type: i === displayParts.length - 1 ? 'page' : 'folder' };
        }
        if (i === displayParts.length - 1) {
          node[part].fullPath = `/${parts.join('/')}`;
        }
        node = node[part].children;
      });
    });
  });
  return tree;
}

function createHierarchyContainer() {
  let container = document.getElementById('hierarchyContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'hierarchyContainer';
    container.style.display = 'none';
    container.className = 'hierarchy-container';

    const breadcrumb = document.querySelector('.breadcrumb');
    if (breadcrumb && breadcrumb.parentNode) {
      breadcrumb.parentNode.insertBefore(container, breadcrumb.nextSibling);
    }
  }
  return container;
}

function renderBreadcrumb(path) {
  const breadcrumb = document.querySelector('.breadcrumb');
  if (!breadcrumb) return;
  let html = '<span class="breadcrumb-item"><a href="#" data-bc-idx="-1">📁 Folders</a></span>';
  for (let i = 0; i < path.length; i += 1) {
    html += '<span class="breadcrumb-separator">/</span>';
    if (i === path.length - 1 && currentMediaPagePath) {
      html += `<span class="breadcrumb-item current">${path[i]}</span>`;
    } else {
      html += `<span class="breadcrumb-item"><a href="#" data-bc-idx="${i}">${path[i]}</a></span>`;
    }
  }
  breadcrumb.innerHTML = html;
  breadcrumb.querySelectorAll('a[data-bc-idx]').forEach((link) => {
    link.onclick = (e) => {
      e.preventDefault();
      const idx = parseInt(link.getAttribute('data-bc-idx'), 10);
      currentMediaPagePath = null;
      if (idx === -1) {
        currentPath = [];
      } else {
        currentPath = path.slice(0, idx + 1);
      }
      isHierarchyView = true;
      const mediaGrid = document.getElementById('mediaGrid');
      const hierarchyContainer = document.getElementById('hierarchyContainer');
      if (mediaGrid) mediaGrid.style.display = 'none';
      if (hierarchyContainer) hierarchyContainer.style.display = 'block';
      renderBreadcrumb(currentPath);
      renderHierarchyList(currentPath);
    };
  });
}

function renderHierarchyList(path) {
  currentMediaPagePath = null;
  const container = createHierarchyContainer();
  container.innerHTML = '';
  let node = hierarchyTree;
  path.forEach((part) => {
    if (!node[part]) return;
    node = node[part].children || node[part];
  });
  const grid = document.createElement('div');
  grid.className = 'hierarchy-grid';
  let hasContent = false;
  Object.entries(node).forEach(([key, entry]) => {
    if (entry.type === 'folder') {
      hasContent = true;
      const div = document.createElement('div');
      div.className = 'folder-card';
      div.innerHTML = `<span class="hierarchy-icon" aria-hidden="true">📁</span><span><strong>${key}</strong></span>`;
      div.onclick = () => {
        currentPath = [...path, key];
        renderBreadcrumb(currentPath);
        renderHierarchyList(currentPath);
      };
      grid.appendChild(div);
    } else if (entry.type === 'page') {
      hasContent = true;
      const div = document.createElement('div');
      div.className = 'page-card';
      div.innerHTML = `<span class="hierarchy-icon" aria-hidden="true">📄</span><span><strong>${key.replace(/\.html$/, '')}</strong></span>`;
      div.onclick = () => {
        filterMediaForPage(entry.fullPath, [...path, key]);
      };
      grid.appendChild(div);
    }
  });
  if (!hasContent) {
    const empty = document.createElement('div');
    empty.className = 'hierarchy-empty';
    empty.textContent = 'No folders or pages found in this location.';
    grid.appendChild(empty);
  }
  container.appendChild(grid);
}

async function filterMediaForPage(pagePath, displayPath) {
  try {
    // Try to get media data from media processor or media browser
    let allMedia = [];
    if (window.mediaProcessor && typeof window.mediaProcessor.getMediaData === 'function') {
      allMedia = await window.mediaProcessor.getMediaData();
    } else if (window.mediaBrowser && typeof window.mediaBrowser.getMedia === 'function') {
      allMedia = await window.mediaBrowser.getMedia();
    }
    if (!allMedia || allMedia.length === 0) return;
    const filteredMedia = allMedia.filter((media) => {
      if (!media.usedIn) return false;
      if (Array.isArray(media.usedIn)) {
        return media.usedIn.includes(pagePath);
      } if (typeof media.usedIn === 'string') {
        return media.usedIn === pagePath;
      }
      return false;
    });
    isHierarchyView = false;
    currentPath = displayPath || [];
    currentMediaPagePath = pagePath;
    const mediaGrid = document.getElementById('mediaGrid');
    const hierarchyContainer = document.getElementById('hierarchyContainer');
    if (mediaGrid) mediaGrid.style.display = 'grid';
    if (hierarchyContainer) hierarchyContainer.style.display = 'none';
    const toggle = document.getElementById('hierarchyToggle');
    if (toggle) {
      toggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="9"></line><line x1="9" y1="12" x2="15" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>';
    }
    const gridBtn = document.getElementById('gridViewBtn');
    if (gridBtn && !gridBtn.classList.contains('active')) {
      gridBtn.click();
    }
    if (window.renderMedia && typeof window.renderMedia === 'function') {
      window.renderMedia(filteredMedia);
    }
    renderBreadcrumb(currentPath);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[HierarchyBrowser] Error filtering media for page:', error);
  }
}

function toggleHierarchyView() {
  const mediaGrid = document.getElementById('mediaGrid');
  const hierarchyContainer = document.getElementById('hierarchyContainer');
  const folderBtn = document.getElementById('hierarchyToggle');
  const gridBtn = document.getElementById('gridViewBtn');
  const listBtn = document.getElementById('listViewBtn');

  isHierarchyView = true;
  if (mediaGrid) mediaGrid.style.display = 'none';
  if (hierarchyContainer) hierarchyContainer.style.display = 'block';
  currentPath = [];
  renderBreadcrumb(currentPath);
  renderHierarchyList(currentPath);
  folderBtn?.classList.add('active');
  gridBtn?.classList.remove('active');
  listBtn?.classList.remove('active');

  setTimeout(() => {
    if (isHierarchyView && folderBtn) {
      folderBtn.classList.add('active');
    }
  }, 0);
}

async function reloadAllMediaFromIndexedDB() {
  try {
    // Try to get media data from media processor or media browser
    let allMedia = [];
    if (window.mediaProcessor && typeof window.mediaProcessor.getMediaData === 'function') {
      allMedia = await window.mediaProcessor.getMediaData();
    } else if (window.mediaBrowser && typeof window.mediaBrowser.getMedia === 'function') {
      allMedia = await window.mediaBrowser.getMedia();
    }

    if (window.mediaBrowser && typeof window.mediaBrowser.setMedia === 'function') {
      window.mediaBrowser.setMedia(allMedia);

      if (window.mediaBrowser.setFilter) {
        window.mediaBrowser.setFilter({
          types: ['image', 'video', 'document'],
          isExternal: undefined,
          usedOnPage: false,
          missingAlt: undefined,
          search: '',
        });
      }

      const container = document.getElementById('mediaGrid');
      if (container) {
        // Container ready
      }
    } else {
      // eslint-disable-next-line no-console
      console.error('[HierarchyBrowser] Media browser not available or setMedia not found');
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[HierarchyBrowser] Error reloading media from IndexedDB:', error);
  }
}

function returnToAllMedia() {
  const mediaGrid = document.getElementById('mediaGrid');
  const hierarchyContainer = document.getElementById('hierarchyContainer');
  const folderBtn = document.getElementById('hierarchyToggle');

  isHierarchyView = false;
  currentPath = [];
  currentMediaPagePath = null;

  if (mediaGrid) {
    mediaGrid.style.display = 'grid';
    mediaGrid.removeAttribute('style');
  }

  if (hierarchyContainer) {
    hierarchyContainer.style.display = 'none';
  }

  folderBtn?.classList.remove('active');

  if (window.mediaBrowser && typeof window.mediaBrowser.setView === 'function') {
    window.mediaBrowser.setView('grid');
  } else {
    console.log('[HierarchyBrowser] ⚠️ mediaBrowser.setView not available');
  }

  reloadAllMediaFromIndexedDB();

  document.querySelectorAll('.folder-item').forEach((item) => {
    item.classList.remove('active');
    item.setAttribute('aria-selected', 'false');
  });

  const allMediaItem = document.querySelector('.folder-item[data-filter="all"]');
  if (allMediaItem) {
    allMediaItem.classList.add('active');
    allMediaItem.setAttribute('aria-selected', 'true');
  }

  const breadcrumb = document.querySelector('.breadcrumb');
  if (breadcrumb) {
    breadcrumb.innerHTML = '<span class="breadcrumb-item">All Media</span>';
  }

  console.log('[HierarchyBrowser] After return - isHierarchyView:', isHierarchyView);
}

/**
 * Check if IndexedDB is ready and update toggle button state
 */
async function checkIndexedDBReady() {
  try {
    const toggle = document.getElementById('hierarchyToggle');
    if (toggle) {
      toggle.disabled = false;
      toggle.title = 'Switch to folder view';
      toggle.style.opacity = '1';
    }
  } catch (error) {
    // Handle error silently
  }
}

/**
 * Search media in the current hierarchy context
 */
async function searchMediaInHierarchy(searchTerm, searchPath = []) {
  // Try to get media data from media processor or media browser
  let allMedia = [];
  if (window.mediaProcessor && typeof window.mediaProcessor.getMediaData === 'function') {
    allMedia = await window.mediaProcessor.getMediaData();
  } else if (window.mediaBrowser && typeof window.mediaBrowser.getMedia === 'function') {
    allMedia = await window.mediaBrowser.getMedia();
  }

  if (!allMedia || allMedia.length === 0) {
    return [];
  }

  try {
    const filters = {};

    if (searchPath.length > 0) {
      const pathString = `/${searchPath.join('/')}`;
      filters.usedIn = pathString;
    }

    // Simple search implementation
    return allMedia.filter((media) => {
      const matchesSearch = media.name?.toLowerCase().includes(searchTerm.toLowerCase())
        || media.src?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPath = !filters.usedIn
        || (media.usedIn && Array.isArray(media.usedIn) && media.usedIn.includes(filters.usedIn));
      return matchesSearch && matchesPath;
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error searching media:', error);
    return [];
  }
}

/**
 * Get media for a specific path
 */
async function getMediaForPath(path) {
  // Try to get media data from media processor or media browser
  let allMedia = [];
  if (window.mediaProcessor && typeof window.mediaProcessor.getMediaData === 'function') {
    allMedia = await window.mediaProcessor.getMediaData();
  } else if (window.mediaBrowser && typeof window.mediaBrowser.getMedia === 'function') {
    allMedia = await window.mediaBrowser.getMedia();
  }

  if (!allMedia || allMedia.length === 0) {
    return [];
  }

  try {
    return allMedia.filter(
      (media) => media.usedIn && Array.isArray(media.usedIn) && media.usedIn.includes(path),
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error getting media for path:', error);
    return [];
  }
}

function addHierarchyToggle() {
  const toggle = document.getElementById('hierarchyToggle');
  if (!toggle) return;
  checkIndexedDBReady();

  const hierarchyContainer = document.getElementById('hierarchyContainer');
  const isInFolderView = hierarchyContainer && hierarchyContainer.style.display !== 'none';
  if (isInFolderView) {
    isHierarchyView = true;
    toggle.classList.add('active');
  }
}

export async function initHierarchyBrowser() {
  let mediaData = [];

  const maxAttempts = 10;
  // Wait for media processor or media browser to be available
  const waitForMediaSource = async () => {
    for (let i = 0; i < maxAttempts; i += 1) {
      if (window.mediaProcessor || window.mediaBrowser) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  };
  await waitForMediaSource();

  window.toggleHierarchyView = toggleHierarchyView;
  window.returnToAllMedia = returnToAllMedia;
  window.handleViewChange = window.handleViewChange || (() => {});

  // Try to get media data from media processor or media browser
  if (window.mediaProcessor && typeof window.mediaProcessor.getMediaData === 'function') {
    try {
      mediaData = await window.mediaProcessor.getMediaData();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[HierarchyBrowser] Failed to get media data from media processor:', error);
      mediaData = [];
    }
  } else if (window.mediaBrowser && typeof window.mediaBrowser.getMedia === 'function') {
    try {
      mediaData = await window.mediaBrowser.getMedia();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[HierarchyBrowser] Failed to get media data from media browser:', error);
      mediaData = [];
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('[HierarchyBrowser] No media data source available');
  }

  if (!mediaData.length) {
    let apiConfig = null;
    if (window.daContext) {
      apiConfig = window.daContext;
    } else if (window.daApi && window.daApi.getConfig) {
      apiConfig = window.daApi.getConfig();
    }
    if (apiConfig) {
      try {
        const org = window.daContext?.org || apiConfig?.org;
        const repo = window.daContext?.repo || apiConfig?.repo;
        const remoteUrl = `${CONTENT_DA_LIVE_BASE}/${org}/${repo}/.media/media.json`;

        const data = await loadSheetFile(remoteUrl, window.daContext?.token || apiConfig?.token);
        mediaData = data?.data || [];

        if (mediaData.length > 0 && window.mediaProcessor && typeof window.mediaProcessor.syncMediaData === 'function') {
          try {
            await window.mediaProcessor.syncMediaData(mediaData);
          } catch (syncError) {
            console.warn('[HierarchyBrowser] Failed to sync data to media processor:', syncError);
          }
        }
      } catch (apiError) {
        // eslint-disable-next-line no-console
        console.warn('[HierarchyBrowser] Failed to fetch from DA API:', apiError);
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('[HierarchyBrowser] No apiConfig found for fallback fetch');
    }
  }

  hierarchyTree = buildHierarchyTree(mediaData || []);
  currentPath.length = 0;

  createHierarchyContainer();
  addHierarchyToggle();
}

export {
  searchMediaInHierarchy, getMediaForPath, toggleHierarchyView, returnToAllMedia,
};