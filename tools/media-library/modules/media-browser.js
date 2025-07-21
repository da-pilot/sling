/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
import { isExternalAsset } from './external-asset.js';
/**
 * Create Asset Browser Module
 * Handles displaying and managing assets in grid and list views
 */
function createAssetBrowser(container) {
  const state = {
    container,
    assets: [],
    filteredAssets: [],
    currentView: 'grid',
    currentSort: 'name',
    currentFilter: { types: ['image', 'video', 'document'], search: '' },
    eventListeners: {},
    isInitialLoad: true,
  };

  const api = {
    on,
    emit,
    setAssets,
    addAssets,
    setView,
    setSort,
    setFilter,
    getSelectedAssets,
    clearSelection,
    processExternalAssets,
    markInitialLoadComplete,
  };

  function on(event, callback) {
    if (!state.eventListeners[event]) {
      state.eventListeners[event] = [];
    }
    state.eventListeners[event].push(callback);
  }

  function emit(event, data) {
    if (state.eventListeners[event]) {
      state.eventListeners[event].forEach((callback) => callback(data));
    }
  }

  function setAssets(assets) {
    state.assets = assets || [];

    if (state.isInitialLoad && assets && assets.length > 0) {
      state.isInitialLoad = false;
    }

    applyFiltersAndSort();
    render();
  }

  function addAssets(newAssets, isScanning = false) {
    const existingAssetSrcs = new Set(state.assets.map((asset) => asset.src));
    const uniqueNewAssets = newAssets.filter((asset) => !existingAssetSrcs.has(asset.src));

    if (uniqueNewAssets.length > 0) {
      state.assets = [...state.assets, ...uniqueNewAssets];

      applyFiltersAndSort();

      if (isScanning) {
        renderWithNewAssetIndicators(uniqueNewAssets);
      } else {
        render();
      }

      updateFilterCounts();
    }
  }

  function renderWithNewAssetIndicators(newAssets) {
    if (!state.container) return;

    if (state.currentView === 'list') {
      state.container.classList.add('list-view');
    } else {
      state.container.classList.remove('list-view');
    }

    state.container.innerHTML = '';

    if (state.filteredAssets.length === 0 && !state.isInitialLoad) {
      renderEmptyState();
      return;
    }

    if (state.currentView === 'list') {
      renderListHeader();
    }

    state.filteredAssets.forEach((asset) => {
      const assetElement = createAssetElement(asset);
      assetElement.setAttribute('data-asset-id', asset.id);

      if (newAssets.some((newAsset) => newAsset.src === asset.src)) {
        assetElement.classList.add('new-asset');
        setTimeout(() => {
          assetElement.classList.remove('new-asset');
        }, 3000);
      }

      state.container.appendChild(assetElement);
    });
  }

  function setView(view) {
    state.currentView = view;
    render();
  }

  function setSort(sortBy) {
    state.currentSort = sortBy;
    applyFiltersAndSort();
    render();
  }

  function setFilter(filter) {
    state.currentFilter = { ...state.currentFilter, ...filter };
    applyFiltersAndSort();
    render();
    updateFilterCounts();
  }

  function applyFiltersAndSort() {
    let filtered = [...state.assets];

    if (state.currentFilter.types && state.currentFilter.types.length > 0) {
      filtered = filtered.filter((asset) => state.currentFilter.types.includes(asset.type));
    }

    if (state.currentFilter.isExternal !== undefined) {
      filtered = filtered.filter((asset) => asset.isExternal === state.currentFilter.isExternal);
    }

    if (state.currentFilter.usedOnPage && state.currentFilter.missingAlt && window.currentPagePath) {
      filtered = filtered.filter((asset) => {
        if (asset.type !== 'image') return false;
        if (asset.alt && asset.alt.trim() !== '' && asset.alt !== 'Untitled') return false;

        if (!asset.usedIn) return false;
        let usedInPages = [];
        if (typeof asset.usedIn === 'string') {
          usedInPages = asset.usedIn.split(',').map((s) => s.trim());
        } else if (Array.isArray(asset.usedIn)) {
          usedInPages = asset.usedIn;
        }
        return usedInPages.includes(window.currentPagePath);
      });
    } else if (state.currentFilter.missingAlt) {
      filtered = filtered.filter((asset) => asset.type === 'image' && (!asset.alt || asset.alt.trim() === '' || asset.alt === 'Untitled'));
    } else if (state.currentFilter.usedOnPage && window.currentPagePath) {
      filtered = filtered.filter((asset) => {
        if (!asset.usedIn) return false;
        let usedInPages = [];
        if (typeof asset.usedIn === 'string') {
          usedInPages = asset.usedIn.split(',').map((s) => s.trim());
        } else if (Array.isArray(asset.usedIn)) {
          usedInPages = asset.usedIn;
        }
        return usedInPages.includes(window.currentPagePath);
      });
    }

    if (state.currentFilter.search) {
      const searchTerm = state.currentFilter.search.toLowerCase();
      filtered = filtered.filter((asset) => asset.name.toLowerCase().includes(searchTerm)
        || asset.alt.toLowerCase().includes(searchTerm)
        || asset.src.toLowerCase().includes(searchTerm));
    }

    filtered.sort((a, b) => {
      switch (state.currentSort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'modified':
          return (b.lastSeen || 0) - (a.lastSeen || 0);
        case 'type':
          return a.type.localeCompare(b.type);
        case 'usage':

          let aUsedInLength = 0;
          if (Array.isArray(a.usedIn)) {
            aUsedInLength = a.usedIn.length;
          } else if (typeof a.usedIn === 'string') {
            aUsedInLength = a.usedIn.split(',').length;
          }

          let bUsedInLength = 0;
          if (Array.isArray(b.usedIn)) {
            bUsedInLength = b.usedIn.length;
          } else if (typeof b.usedIn === 'string') {
            bUsedInLength = b.usedIn.split(',').length;
          }
          return bUsedInLength - aUsedInLength;
        default:
          return 0;
      }
    });

    state.filteredAssets = filtered;
  }

  function render() {
    if (!state.container) return;

    if (state.currentView === 'list') {
      state.container.classList.add('list-view');
    } else {
      state.container.classList.remove('list-view');
    }

    state.container.innerHTML = '';

    if (state.filteredAssets.length === 0 && !state.isInitialLoad) {
      renderEmptyState();
      return;
    }

    if (state.currentView === 'list') {
      renderListHeader();
    }

    state.filteredAssets.forEach((asset) => {
      const assetElement = createAssetElement(asset);
      assetElement.setAttribute('data-asset-id', asset.id);
      state.container.appendChild(assetElement);
    });
  }

  function renderEmptyState() {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state';
    emptyDiv.innerHTML = `
      <div class="empty-content">
        <h3>No assets found</h3>
        <p>Try adjusting your filters or scanning for assets.</p>
      </div>
    `;
    state.container.appendChild(emptyDiv);
  }

  function renderListHeader() {
    const header = document.createElement('div');
    header.className = 'list-header';
    header.innerHTML = `
      <div class="list-header-cell"></div> <!-- Thumbnail column -->
      <div class="list-header-cell">Name</div>
      <div class="list-header-cell">Type</div>
      <div class="list-header-cell">Actions</div>
    `;
    state.container.appendChild(header);
  }

  function createAssetElement(asset) {
    const element = document.createElement('div');
    element.className = 'asset-item';

    if (state.currentView === 'grid') {
      element.innerHTML = createGridViewHTML(asset);
    } else {
      element.innerHTML = createListViewHTML(asset);
    }

    addAssetEventListeners(element, asset);

    return element;
  }

  function createGridViewHTML(asset) {
    const isExternal = asset.isExternal ? 'external' : 'internal';
    const typePill = `<span class="badge ${asset.type}">${asset.type.toUpperCase()}</span>`;
    const intExtPill = `<span class="badge ${isExternal === 'external' ? 'ext' : 'int'}">${
      isExternal === 'external' ? 'EXT' : 'INT'
    }</span>`;

    const insertAsLinkBtn = asset.isExternal
      ? '<button class="action-btn link-insert-icon" data-action="insertAsLink" title="Insert as Link" aria-label="Insert as link">LINK</button>'
      : '';

    const hasOccurrences = asset.occurrences && asset.occurrences.length > 0;

    let missingAltCount = 0;
    if (hasOccurrences) {
      missingAltCount = asset.occurrences.filter((o) => !o.hasAltText).length;
    } else if (asset.type === 'image' && (!asset.alt || asset.alt.trim() === '' || asset.alt === 'Untitled')) {
      missingAltCount = 1;
    }
    const totalOccurrences = hasOccurrences ? asset.occurrences.length : 1;

    const altTextIndicator = missingAltCount > 0
      ? `<div class="alt-text-warning" title="${missingAltCount}/${totalOccurrences} occurrences missing alt text">⚠️ ${missingAltCount}</div>`
      : '';

    const previewElement = createAssetPreviewElement(asset);

    return `
      <div class="asset-preview">
        ${previewElement}
        ${altTextIndicator}
      </div>
      <div class="asset-info">
        <div class="asset-name">${asset.name}</div>
        <div class="asset-meta-row">
          <div class="asset-pills">
            ${typePill}
            ${intExtPill}
          </div>
          <div class="asset-actions">
            <button class="action-btn info-icon" data-action="info" title="View asset info" aria-label="View asset info">INFO</button>
            <button class="action-btn link-action" data-action="link" title="Open in new tab" aria-label="Open asset in new tab">OPEN</button>
            ${insertAsLinkBtn}
          </div>
        </div>
      </div>
    `;
  }

  function createListViewHTML(asset) {
    const isExternal = asset.isExternal ? 'external' : 'internal';
    const typePill = `<span class="badge ${asset.type}">${asset.type.toUpperCase()}</span>`;
    const intExtPill = `<span class="badge ${isExternal === 'external' ? 'ext' : 'int'}">${isExternal === 'external' ? 'EXT' : 'INT'}</span>`;
    const insertAsLinkBtn = asset.isExternal
      ? '<button class="action-btn link-insert-icon" data-action="insertAsLink" title="Insert as Link" aria-label="Insert as link">LINK</button>'
      : '';

    const previewElement = createAssetPreviewElement(asset);

    return `
      <div class="list-cell list-cell-thumb">
        ${previewElement}
      </div>
      <div class="list-cell list-cell-name">${asset.name}</div>
      <div class="list-cell list-cell-type">
        ${typePill}
        ${intExtPill}
      </div>
      <div class="list-cell list-cell-actions">
        <button class="action-btn info-icon" data-action="info" title="View asset info" aria-label="View asset info">INFO</button>
        <button class="action-btn link-action" data-action="link" title="Open in new tab" aria-label="Open asset in new tab">OPEN</button>
        ${insertAsLinkBtn}
      </div>
    `;
  }

  function createAssetPreviewElement(asset) {
    switch (asset.type) {
      case 'image':
        return `<img src="${asset.src}" alt="${asset.alt}" loading="lazy" data-action="insert" style="cursor: pointer;">`;

      case 'video':
        return `
          <div class="video-preview-container" data-action="insert" style="cursor: pointer;">
            <video 
              src="${asset.src}" 
              preload="metadata" 
              muted 
              class="video-preview"
              alt="${asset.alt}"
            >
              Your browser does not support the video tag.
            </video>
            <div class="video-play-overlay">
              <svg viewBox="0 0 24 24" class="play-icon">
                <path fill="currentColor" d="M8 5v14l11-7z"/>
              </svg>
            </div>
          </div>
        `;

      case 'document':
        return `
          <div class="document-preview-container" data-action="insert" style="cursor: pointer;">
            <div class="document-icon">
              <svg viewBox="0 0 24 24">
                <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
              </svg>
            </div>
            <div class="document-info">
              <div class="document-name">${asset.name}</div>
              <div class="document-type">${getFileExtension(asset.src)}</div>
            </div>
          </div>
        `;

      default:
        return `
          <div class="unknown-preview-container" data-action="insert" style="cursor: pointer;">
            <div class="unknown-icon">
              <svg viewBox="0 0 24 24">
                <path fill="currentColor" d="M5,4V7H10.5V19H13.5V7H19V4H5Z"/>
              </svg>
            </div>
            <div class="unknown-info">
              <div class="unknown-name">${asset.name}</div>
              <div class="unknown-type">${asset.type}</div>
            </div>
          </div>
        `;
    }
  }

  function getFileExtension(filename) {
    const match = filename.match(/\.([^.]+)$/);
    return match ? match[1].toUpperCase() : 'FILE';
  }

  function addAssetEventListeners(element, asset) {
    element.querySelectorAll('[data-action]').forEach((el) => {
      el.onclick = (e) => {
        const action = el.getAttribute('data-action');
        if (action === 'insert') {
          emit('assetSelected', asset);
        } else if (action === 'info') {
          emit('assetInfo', asset);
        } else if (action === 'link') {
          emit('assetLinkCopied', asset);
        } else if (action === 'insertAsLink') {
          emit('assetInsertAsLink', asset);
        }
        e.stopPropagation();
      };
    });
  }

  function updateFilterCounts() {
    const imageCount = state.assets.filter((a) => a.type === 'image').length;
    const videoCount = state.assets.filter((a) => a.type === 'video').length;
    const documentCount = state.assets.filter((a) => a.type === 'document').length;
    const internalCount = state.assets.filter((a) => a.isExternal === false).length;
    const externalCount = state.assets.filter((a) => a.isExternal === true).length;
    const totalCount = state.assets.length;

    const setCount = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    };
    setCount('imageCount', imageCount);
    setCount('videoCount', videoCount);
    setCount('documentCount', documentCount);
    setCount('internalCount', internalCount);
    setCount('externalCount', externalCount);
    setCount('totalCount', totalCount);
  }

  function getSelectedAssets() {
    const selectedElements = state.container.querySelectorAll('.asset-item.selected');
    return Array.from(selectedElements).map((element) => {
      const { assetId } = element.dataset;
      return state.assets.find((asset) => asset.id === assetId);
    }).filter(Boolean);
  }

  function clearSelection() {
    const selectedElements = state.container.querySelectorAll('.asset-item.selected');
    selectedElements.forEach((element) => {
      element.classList.remove('selected');
    });
  }

  function markInitialLoadComplete() {
    state.isInitialLoad = false;
  }

  /**
   * Process assets to detect external links and add metadata
   */
  function processExternalAssets(assets, pageContext = {}) {
    const internalDomains = [];

    if (pageContext && typeof pageContext === 'object') {
      if (pageContext.site) internalDomains.push(pageContext.site);
      if (pageContext.org) internalDomains.push(pageContext.org);
    }

    if (internalDomains.length === 0) {
      internalDomains.push(window.location.hostname);
    }

    return assets.map((asset) => {
      const isExternal = isExternalAsset(asset.src, internalDomains);
      return {
        ...asset,
        isExternal,
      };
    });
  }

  return api;
}

export { createAssetBrowser };
