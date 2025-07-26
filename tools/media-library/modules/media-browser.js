/* eslint-disable no-console */
/* eslint-disable no-use-before-define */

import isExternalMedia from './external-media.js';

/**
 * Create Media Browser Module
 * Handles displaying and managing media in grid and list views
 */
export default function createMediaBrowser(container) {
  const state = {
    container,
    media: [],
    filteredMedia: [],
    currentView: 'grid',
    currentSort: 'name',
    currentFilter: { types: ['image', 'video', 'document'], search: '' },
    eventListeners: {},
    isInitialLoad: true,
  };

  const api = {
    on,
    emit,
    setMedia,
    addMedia,
    updateMedia,
    setView,
    setSort,
    setFilter,
    getSelectedMedia,
    clearSelection,
    processExternalMedia,
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

  function setMedia(media) {
    state.media = media || [];

    if (state.isInitialLoad && media && media.length > 0) {
      state.isInitialLoad = false;
    }

    applyFiltersAndSort();
    render();
  }

  function addMedia(newMedia, isScanning = false) {
    const existingMediaSrcs = new Set(state.media.map((media) => media.src));
    const uniqueNewMedia = newMedia.filter((media) => !existingMediaSrcs.has(media.src));

    if (uniqueNewMedia.length > 0) {
      state.media = [...state.media, ...uniqueNewMedia];

      applyFiltersAndSort();

      if (isScanning) {
        renderWithNewMediaIndicators(uniqueNewMedia);
      } else {
        render();
      }

      updateFilterCounts();
    }
  }

  function renderWithNewMediaIndicators(newMedia) {
    if (!state.container) return;

    if (state.currentView === 'list') {
      state.container.classList.add('list-view');
    } else {
      state.container.classList.remove('list-view');
    }

    state.container.innerHTML = '';

    if (state.filteredMedia.length === 0 && !state.isInitialLoad) {
      renderEmptyState();
      return;
    }

    if (state.currentView === 'list') {
      renderListHeader();
    }

    state.filteredMedia.forEach((media) => {
      const mediaElement = createMediaElement(media);
      mediaElement.setAttribute('data-media-id', media.id);

      if (newMedia.some((newMediaItem) => newMediaItem.src === media.src)) {
        mediaElement.classList.add('new-media');
        setTimeout(() => {
          mediaElement.classList.remove('new-media');
        }, 3000);
      }

      state.container.appendChild(mediaElement);
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
    let filtered = [...state.media];

    if (state.currentFilter.types && state.currentFilter.types.length > 0) {
      filtered = filtered.filter((media) => state.currentFilter.types.includes(media.type));
    }

    if (state.currentFilter.isExternal !== undefined) {
      filtered = filtered.filter((media) => media.isExternal === state.currentFilter.isExternal);
    }

    if (state.currentFilter.usedOnPage
      && state.currentFilter.missingAlt && window.currentPagePath) {
      filtered = filtered.filter((media) => {
        if (media.type !== 'image') return false;
        if (media.alt && media.alt.trim() !== '' && media.alt !== 'Untitled') return false;

        if (!media.usedIn) return false;
        let usedInPages = [];
        if (typeof media.usedIn === 'string') {
          usedInPages = media.usedIn.split(',').map((s) => s.trim());
        } else if (Array.isArray(media.usedIn)) {
          usedInPages = media.usedIn;
        }
        return usedInPages.includes(window.currentPagePath);
      });
    } else if (state.currentFilter.missingAlt) {
      filtered = filtered.filter((media) => media.type === 'image' && (!media.alt || media.alt.trim() === '' || media.alt === 'Untitled'));
    } else if (state.currentFilter.usedOnPage && window.currentPagePath) {
      filtered = filtered.filter((media) => {
        if (!media.usedIn) return false;
        let usedInPages = [];
        if (typeof media.usedIn === 'string') {
          usedInPages = media.usedIn.split(',').map((s) => s.trim());
        } else if (Array.isArray(media.usedIn)) {
          usedInPages = media.usedIn;
        }
        return usedInPages.includes(window.currentPagePath);
      });
    }

    if (state.currentFilter.search) {
      const searchTerm = state.currentFilter.search.toLowerCase();
      filtered = filtered.filter((media) => media.name.toLowerCase().includes(searchTerm)
        || media.alt.toLowerCase().includes(searchTerm)
        || media.src.toLowerCase().includes(searchTerm));
    }

    filtered.sort((a, b) => {
      switch (state.currentSort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'modified':
          return (b.lastSeen || 0) - (a.lastSeen || 0);
        case 'type':
          return a.type.localeCompare(b.type);
        case 'usage': {
          let aUsedInLength = 0;
          if (Array.isArray(a.usedIn)) aUsedInLength = a.usedIn.length;
          else if (typeof a.usedIn === 'string') aUsedInLength = a.usedIn.split(',').length;

          let bUsedInLength = 0;
          if (Array.isArray(b.usedIn)) {
            bUsedInLength = b.usedIn.length;
          } else if (typeof b.usedIn === 'string') {
            bUsedInLength = b.usedIn.split(',').length;
          }
          return bUsedInLength - aUsedInLength;
        }
        case 'discovery':
        default:
          // Default sort: discovery order (first discovered = first shown)
          if (a.discoveryOrder !== b.discoveryOrder) {
            return a.discoveryOrder - b.discoveryOrder;
          }
          // Secondary sort: alphabetical by name
          return (a.name || '').localeCompare(b.name || '');
      }
    });

    state.filteredMedia = filtered;
  }

  function render() {
    if (!state.container) return;

    if (state.currentView === 'list') {
      state.container.classList.add('list-view');
    } else {
      state.container.classList.remove('list-view');
    }

    state.container.innerHTML = '';

    if (state.filteredMedia.length === 0 && !state.isInitialLoad) {
      renderEmptyState();
      return;
    }

    if (state.currentView === 'list') {
      renderListHeader();
    }

    state.filteredMedia.forEach((media) => {
      const mediaElement = createMediaElement(media);
      mediaElement.setAttribute('data-media-id', media.id);
      state.container.appendChild(mediaElement);
    });
  }

  function renderEmptyState() {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state';
    emptyDiv.innerHTML = `
      <div class="empty-content">
        <h3>No media found</h3>
        <p>Try adjusting your filters or scanning for media.</p>
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

  function createMediaElement(media) {
    const element = document.createElement('div');
    element.className = 'media-item';

    if (state.currentView === 'grid') {
      element.innerHTML = createGridViewHTML(media);
    } else {
      element.innerHTML = createListViewHTML(media);
    }

    addMediaEventListeners(element, media);

    return element;
  }

  function createGridViewHTML(media) {
    const isExternal = media.isExternal ? 'external' : 'internal';
    const typePill = `<span class="badge ${media.type}">${media.type.toUpperCase()}</span>`;
    const intExtPill = `<span class="badge ${isExternal === 'external' ? 'ext' : 'int'}">${
      isExternal === 'external' ? 'EXT' : 'INT'
    }</span>`;

    const insertAsLinkBtn = media.isExternal
      ? '<button class="action-btn link-insert-icon" data-action="insertAsLink" title="Insert as Link" aria-label="Insert as link">LINK</button>'
      : '';

    const hasOccurrences = media.occurrences && media.occurrences.length > 0;

    let missingAltCount = 0;
    if (hasOccurrences) {
      missingAltCount = media.occurrences.filter((o) => !o.hasAltText).length;
    } else if (media.type === 'image' && (!media.alt || media.alt.trim() === '' || media.alt === 'Untitled')) {
      missingAltCount = 1;
    }
    const totalOccurrences = hasOccurrences ? media.occurrences.length : 1;

    const altTextIndicator = missingAltCount > 0
      ? `<div class="alt-text-warning" title="${missingAltCount}/${totalOccurrences} occurrences missing alt text">⚠️ ${missingAltCount}</div>`
      : '';

    const previewElement = createMediaPreviewElement(media);

    return `
      <div class="media-preview">
        ${previewElement}
        ${altTextIndicator}
      </div>
      <div class="media-info">
        <div class="media-name">${getDisplayedName(media.name)}</div>
        <div class="media-meta-row">
          <div class="media-pills">
            ${typePill}
            ${intExtPill}
          </div>
          <div class="media-actions">
            <button class="action-btn info-icon" data-action="info" title="View media info" aria-label="View media info">INFO</button>
            <button class="action-btn link-action" data-action="link" title="Open in new tab" aria-label="Open media in new tab">OPEN</button>
            ${insertAsLinkBtn}
          </div>
        </div>
      </div>
    `;
  }

  function createListViewHTML(media) {
    const isExternal = media.isExternal ? 'external' : 'internal';
    const typePill = `<span class="badge ${media.type}">${media.type.toUpperCase()}</span>`;
    const intExtPill = `<span class="badge ${isExternal === 'external' ? 'ext' : 'int'}">${isExternal === 'external' ? 'EXT' : 'INT'}</span>`;
    const insertAsLinkBtn = media.isExternal
      ? '<button class="action-btn link-insert-icon" data-action="insertAsLink" title="Insert as Link" aria-label="Insert as link">LINK</button>'
      : '';

    const previewElement = createMediaPreviewElement(media);

    return `
      <div class="list-cell list-cell-thumb">
        ${previewElement}
      </div>
      <div class="list-cell list-cell-name">${getDisplayedName(media.name)}</div>
      <div class="list-cell list-cell-type">
        ${typePill}
        ${intExtPill}
      </div>
      <div class="list-cell list-cell-actions">
        <button class="action-btn info-icon" data-action="info" title="View media info" aria-label="View media info">INFO</button>
        <button class="action-btn link-action" data-action="link" title="Open in new tab" aria-label="Open media in new tab">OPEN</button>
        ${insertAsLinkBtn}
      </div>
    `;
  }

  function createMediaPreviewElement(media) {
    switch (media.type) {
      case 'image':
        return `<img src="${media.src}" alt="${media.alt}" loading="lazy" data-action="insert" style="cursor: pointer;">`;

      case 'video':
        return `
          <div class="video-preview-container" data-action="insert" style="cursor: pointer;">
            <video 
              src="${media.src}" 
              preload="metadata" 
              muted 
              class="video-preview"
              alt="${media.alt}"
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
              <div class="document-name">${media.name}</div>
              <div class="document-type">${getFileExtension(media.src)}</div>
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
              <div class="unknown-name">${media.name}</div>
              <div class="unknown-type">${media.type}</div>
            </div>
          </div>
        `;
    }
  }
  function getDisplayedName(name) {
    if (name.length <= 40) return name;
    return `${name.substring(0, 37)}...`;
  }

  function getFileExtension(filename) {
    const match = filename.match(/\.([^.]+)$/);
    return match ? match[1].toUpperCase() : 'FILE';
  }

  function addMediaEventListeners(element, media) {
    element.querySelectorAll('[data-action]').forEach((el) => {
      el.onclick = (e) => {
        const action = el.getAttribute('data-action');
        if (action === 'insert') {
          emit('mediaSelected', media);
        } else if (action === 'info') {
          emit('mediaInfo', media);
        } else if (action === 'link') {
          emit('mediaLinkCopied', media);
        } else if (action === 'insertAsLink') {
          emit('mediaInsertAsLink', media);
        }
        e.stopPropagation();
      };
    });
  }

  function updateFilterCounts() {
    const imageCount = state.media.filter((a) => a.type === 'image').length;
    const videoCount = state.media.filter((a) => a.type === 'video').length;
    const documentCount = state.media.filter((a) => a.type === 'document').length;
    const internalCount = state.media.filter((a) => a.isExternal === false).length;
    const externalCount = state.media.filter((a) => a.isExternal === true).length;
    const totalCount = state.media.length;

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

  function getSelectedMedia() {
    const selectedElements = state.container.querySelectorAll('.media-item.selected');
    return Array.from(selectedElements).map((element) => {
      const { mediaId } = element.dataset;
      return state.media.find((media) => media.id === mediaId);
    }).filter(Boolean);
  }

  function clearSelection() {
    const selectedElements = state.container.querySelectorAll('.media-item.selected');
    selectedElements.forEach((element) => {
      element.classList.remove('selected');
    });
  }

  function markInitialLoadComplete() {
    state.isInitialLoad = false;
  }

  /**
   * Process media to detect external links and add metadata
   */
  function processExternalMedia(media, pageContext = {}) {
    const internalDomains = [];

    if (pageContext && typeof pageContext === 'object') {
      if (pageContext.site) internalDomains.push(pageContext.site);
      if (pageContext.org) internalDomains.push(pageContext.org);
    }

    if (internalDomains.length === 0) {
      internalDomains.push(window.location.hostname);
    }

    return media.map((mediaItem) => {
      const isExternal = isExternalMedia(mediaItem.src, internalDomains);
      return {
        ...mediaItem,
        isExternal,
      };
    });
  }

  // Add method to update media progressively
  function updateMedia(newMedia) {
    try {
      console.log('[Media Browser] 📱 Updating media progressively:', {
        currentCount: state.media.length,
        newCount: newMedia.length,
        timestamp: new Date().toISOString(),
      });

      // Merge with existing media (deduplicate by src)
      const existingMediaSrcs = new Set(state.media.map((mediaItem) => mediaItem.src));
      const uniqueNewMedia = newMedia.filter((mediaItem) => !existingMediaSrcs.has(mediaItem.src));
      if (uniqueNewMedia.length > 0) {
        state.media = [...state.media, ...uniqueNewMedia];
      } else {
        // If no new unique media, still update with the latest data (in case metadata changed)
        state.media = [...newMedia];
      }

      // Apply current filters and sort
      applyFiltersAndSort();

      // Re-render the grid
      render();

      // Update filter counts
      updateFilterCounts();

      // Update loading state if this is the first batch
      if (state.media.length > 0 && state.isInitialLoad) {
        state.isInitialLoad = false;
      }
    } catch (error) {
      console.error('[Media Browser] ❌ Error updating media:', error);
    }
  }

  return api;
}
