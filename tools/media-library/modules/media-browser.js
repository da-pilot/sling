/* eslint-disable no-console */
/* eslint-disable no-use-before-define */

import { MEDIA_TYPES } from '../constants.js';

/**
 * Create Media Browser Module
 * Handles displaying and managing media in grid and list views
 */
export default function createMediaBrowser(container, context = null) {
  const state = {
    container,
    media: [],
    filteredMedia: [],
    currentView: 'grid',
    currentSort: 'discovery',
    currentFilter: {
      types: [MEDIA_TYPES.IMAGE, MEDIA_TYPES.VIDEO, MEDIA_TYPES.DOCUMENT],
      isExternal: undefined,
      usedOnPage: false,
      missingAlt: undefined,
      search: '',
      minOccurrences: null,
      maxOccurrences: null,
      minPages: null,
      maxPages: null,
    },
    currentFilterString: null,
    isInitialLoad: true,
    context: context || {},
    eventListeners: {},
    // Virtual scrolling state
    virtualScroll: {
      itemsPerPage: 50,
      currentPage: 0,
      totalPages: 0,
      visibleItems: [],
      observer: null,
      isLoading: false,
      hasMoreItems: true,
    },
  };

  // Virtual scrolling helper functions
  function calculateVirtualScrollState() {
    const totalItems = state.filteredMedia.length;
    state.virtualScroll.totalPages = Math.ceil(totalItems / state.virtualScroll.itemsPerPage);
    state.virtualScroll.hasMoreItems = state.virtualScroll.currentPage
      < state.virtualScroll.totalPages;
  }

  function getVisibleItems() {
    const startIndex = state.virtualScroll.currentPage * state.virtualScroll.itemsPerPage;
    const endIndex = startIndex + state.virtualScroll.itemsPerPage;
    return state.filteredMedia.slice(startIndex, endIndex);
  }

  function setupIntersectionObserver() {
    if (state.virtualScroll.observer) {
      state.virtualScroll.observer.disconnect();
    }

    const observerCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !state.virtualScroll.isLoading
            && state.virtualScroll.hasMoreItems) {
          loadMoreItems();
        }
      });
    };

    state.virtualScroll.observer = new IntersectionObserver(observerCallback, {
      rootMargin: '100px',
      threshold: 0.1,
    });

    // Observe the last item for infinite scroll
    const lastItem = state.container?.querySelector('.media-item:last-child');
    if (lastItem) {
      state.virtualScroll.observer.observe(lastItem);
    }
  }

  function loadMoreItems() {
    if (state.virtualScroll.isLoading || !state.virtualScroll.hasMoreItems) return;

    state.virtualScroll.isLoading = true;
    state.virtualScroll.currentPage += 1;

    const newItems = getVisibleItems();
    state.virtualScroll.visibleItems = [...state.virtualScroll.visibleItems, ...newItems];

    renderVisibleItems(newItems, true);
    calculateVirtualScrollState();

    state.virtualScroll.isLoading = false;
  }

  function renderVisibleItems(items, append = false) {
    if (!state.container) return;

    const fragment = document.createDocumentFragment();

    items.forEach((media) => {
      const mediaElement = createMediaElement(media);
      mediaElement.setAttribute('data-media-id', media.id);
      fragment.appendChild(mediaElement);
    });

    if (append) {
      state.container.appendChild(fragment);
    } else {
      state.container.innerHTML = '';
      state.container.appendChild(fragment);
    }

    // Setup observer for the last item
    setTimeout(() => {
      setupIntersectionObserver();
    }, 100);
  }

  const api = {
    on,
    emit,
    setMedia,
    addMedia,
    setView,
    setSort,
    setFilter,
    getSelectedMedia,
    clearSelection,
    markInitialLoadComplete,
    cleanup,
    setCurrentFilter,
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

    // Reset virtual scroll state when media changes
    state.virtualScroll.currentPage = 0;
    state.virtualScroll.visibleItems = [];
    state.virtualScroll.hasMoreItems = true;

    applyFiltersAndSort();
    render();
    updateFilterCounts();
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
    const newContent = document.createDocumentFragment();
    if (state.filteredMedia.length === 0 && !state.isInitialLoad) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.innerHTML = `
        <div class="empty-content">
          <h3>No media found</h3>
          <p>Try adjusting your filters or scanning for media.</p>
        </div>
      `;
      newContent.appendChild(emptyDiv);
    } else {
      if (state.currentView === 'list') {
        const header = document.createElement('div');
        header.className = 'list-header';
        header.innerHTML = `
          <div class="list-header-cell"></div>
          <div class="list-header-cell">Name</div>
          <div class="list-header-cell">Type</div>
          <div class="list-header-cell">Actions</div>
        `;
        newContent.appendChild(header);
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
        newContent.appendChild(mediaElement);
      });
    }
    state.container.innerHTML = '';
    state.container.appendChild(newContent);
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

    // Use home page path if we're on the media library page
    let pagePathForFiltering = state.context.currentPagePath;
    if (pagePathForFiltering && pagePathForFiltering.includes('tools/media-library/media-library')) {
      const homePagePath = `/${state.context.org}/${state.context.repo}/index.html`;
      pagePathForFiltering = homePagePath;
    } else if (pagePathForFiltering && !pagePathForFiltering.startsWith(`/${state.context.org}/${state.context.repo}`)) {
      // If path doesn't start with full org/repo structure, construct full path
      const fullPath = `/${state.context.org}/${state.context.repo}${pagePathForFiltering}.html`;
      pagePathForFiltering = fullPath;
    } else if (pagePathForFiltering && !pagePathForFiltering.includes('.html')) {
      // If path doesn't end with .html, add it
      const fullPath = `${pagePathForFiltering}.html`;
      pagePathForFiltering = fullPath;
    }

    if (state.currentFilter.types && state.currentFilter.types.length > 0) {
      filtered = filtered.filter((media) => state.currentFilter.types.includes(media.type));
    }

    if (state.currentFilter.isExternal !== undefined) {
      filtered = filtered.filter((media) => media.isExternal === state.currentFilter.isExternal);
    }

    if (state.currentFilter.usedOnPage
      && state.currentFilter.missingAlt && pagePathForFiltering) {
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
        return usedInPages.includes(pagePathForFiltering);
      });
    } else if (state.currentFilter.missingAlt) {
      filtered = filtered.filter((media) => media.type === 'image' && (!media.alt || media.alt.trim() === '' || media.alt === 'Untitled'));
    } else if (state.currentFilter.usedOnPage && pagePathForFiltering) {
      filtered = filtered.filter((media) => {
        if (!media.usedIn) return false;
        let usedInPages = [];
        if (typeof media.usedIn === 'string') {
          usedInPages = media.usedIn.split(',').map((s) => s.trim());
        } else if (Array.isArray(media.usedIn)) {
          usedInPages = media.usedIn;
        }
        return usedInPages.includes(pagePathForFiltering);
      });
    }

    // Apply folder path filter (for folder-based filtering)
    if (state.currentFilter.folderPath) {
      filtered = filtered.filter((media) => {
        if (!media.usedIn) return false;
        let usedInPages = [];
        if (typeof media.usedIn === 'string') {
          usedInPages = media.usedIn.split(',').map((s) => s.trim());
        } else if (Array.isArray(media.usedIn)) {
          usedInPages = media.usedIn;
        }
        // Check if media is used in any page that starts with the folder path
        const matches = usedInPages.some((page) => {
          // Use exact path matching for better reliability
          const result = page.startsWith(state.currentFilter.folderPath);
          return result;
        });
        return matches;
      });
    }

    // Apply page path filter (for file-based filtering)
    if (state.currentFilter.pagePath) {
      filtered = filtered.filter((media) => {
        if (!media.usedIn) return false;
        let usedInPages = [];
        if (typeof media.usedIn === 'string') {
          usedInPages = media.usedIn.split(',').map((s) => s.trim());
        } else if (Array.isArray(media.usedIn)) {
          usedInPages = media.usedIn;
        }
        // Check if media is used in the specific page using exact path matching
        const matches = usedInPages.some((page) => {
          const result = page === state.currentFilter.pagePath;
          return result;
        });
        return matches;
      });
    }

    if (state.currentFilter.search) {
      const searchTerm = state.currentFilter.search.toLowerCase();
      filtered = filtered.filter((media) => media.name.toLowerCase().includes(searchTerm)
        || media.alt.toLowerCase().includes(searchTerm)
        || media.src.toLowerCase().includes(searchTerm));
    }
    if (state.currentFilter.minOccurrences && state.currentFilter.minOccurrences > 1) {
      const minOcc = state.currentFilter.minOccurrences;
      filtered = filtered.filter((media) => (media.occurrenceCount || 0) >= minOcc);
    }
    if (state.currentFilter.minPages && state.currentFilter.minPages > 1) {
      const { minPages } = state.currentFilter;
      filtered = filtered.filter((media) => (media.pageCount || 0) >= minPages);
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
    if (!state.container) {
      return;
    }
    if (state.currentView === 'list') {
      state.container.classList.add('list-view');
    } else {
      state.container.classList.remove('list-view');
    }
    state.virtualScroll.currentPage = 0;
    state.virtualScroll.visibleItems = [];
    calculateVirtualScrollState();
    if (state.filteredMedia.length === 0 && !state.isInitialLoad) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.innerHTML = `
        <div class="empty-content">
          <h3>No media found</h3>
          <p>Try adjusting your filters or scanning for media.</p>
        </div>
      `;
      state.container.innerHTML = '';
      state.container.appendChild(emptyDiv);
    } else {
      if (state.currentView === 'list') {
        const header = document.createElement('div');
        header.className = 'list-header';
        header.innerHTML = `
          <div class="list-header-cell"></div>
          <div class="list-header-cell">Name</div>
          <div class="list-header-cell">Type</div>
          <div class="list-header-cell">Actions</div>
        `;
        state.container.innerHTML = '';
        state.container.appendChild(header);
      } else {
        state.container.innerHTML = '';
      }
      const initialItems = getVisibleItems();
      state.virtualScroll.visibleItems = initialItems;
      renderVisibleItems(initialItems, false);
    }
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

    const usageBadge = (media.occurrenceCount || 0) > 1
      ? `<span class="badge usage-count" title="Used ${media.occurrenceCount || 0} times across ${media.pageCount || 0} pages">${media.occurrenceCount || 0}</span>`
      : '';

    const insertAsLinkBtn = media.isExternal
      ? '<button class="action-btn link-insert-icon" data-action="insertAsLink" title="Insert as Link" aria-label="Insert as link">LINK</button>'
      : '';

    const hasOccurrences = media.occurrences && media.occurrences.length > 0;

    let missingAltCount = 0;
    if (hasOccurrences) {
      missingAltCount = media.type !== 'video' ? media.occurrences.filter((o) => !o.hasAltText).length : 0;
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
            ${usageBadge}
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
    const usageBadge = (media.occurrenceCount || 0) > 1
      ? `<span class="badge usage-count" title="Used ${media.occurrenceCount || 0} times across ${media.pageCount || 0} pages">${media.occurrenceCount || 0}</span>`
      : '';
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
        ${usageBadge}
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
      case 'image': {
        // Use optimized thumbnail URL for better performance
        const thumbnailUrl = getOptimizedImageUrl(media.src);
        return `<img src="${thumbnailUrl}" alt="${media.alt}" loading="lazy" data-action="insert" style="cursor: pointer;">`;
      }

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

  function getOptimizedImageUrl(originalUrl) {
    // If URL already has parameters, add to existing ones
    if (originalUrl.includes('?')) {
      return `${originalUrl}&width=200&format=webply&optimize=medium`;
    }
    // Otherwise add new parameters
    return `${originalUrl}?width=200&format=webply&optimize=medium`;
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

  function getTopUsedMedia(limit = 10) {
    return state.media
      .sort((a, b) => (b.usageScore || 0) - (a.usageScore || 0))
      .slice(0, limit);
  }
  function renderTopMediaList() {
    const topMediaList = document.getElementById('topMediaList');
    if (!topMediaList) return;
    const topMedia = getTopUsedMedia(10);
    const { currentFilterString } = state;
    topMediaList.innerHTML = topMedia.map((media, index) => {
      const {
        name,
        id,
        occurrenceCount,
        pageCount,
      } = media;
      const mediaName = getDisplayedName(name);
      const isActiveFilter = currentFilterString && currentFilterString.includes(mediaName);
      return `
        <div class="top-media-item ${isActiveFilter ? 'active-filter' : ''}" data-media-id="${id}" data-media-name="${mediaName}">
          <div class="top-media-rank">${index + 1}</div>
          <div class="top-media-info">
            <div class="top-media-name">${mediaName}</div>
            <div class="top-media-usage">×${occurrenceCount || 0} (${pageCount || 0} pages)</div>
          </div>
          ${isActiveFilter ? '<button class="top-media-close" aria-label="Clear filter">×</button>' : ''}
        </div>
      `;
    }).join('');
  }
  function updateFilterCounts() {
    const imageCount = state.media.filter((a) => a.type === 'image').length;
    const videoCount = state.media.filter((a) => a.type === 'video').length;
    const documentCount = state.media.filter((a) => a.type === 'document').length;
    const internalCount = state.media.filter((a) => a.isExternal === false).length;
    const externalCount = state.media.filter((a) => a.isExternal === true).length;
    const totalCount = state.media.length;
    const missingAltCount = state.media.filter((a) => {
      const hasOccurrences = a.occurrences && a.occurrences.length > 0;
      if (hasOccurrences) {
        return a.type !== 'video' && a.occurrences.some((o) => !o.hasAltText);
      }
      return a.type !== 'video' && (!a.alt || a.alt.trim() === '' || a.alt === 'Untitled Media');
    }).length;
    const missingAltPercentage = imageCount > 0
      ? Math.round((missingAltCount / imageCount) * 100)
      : 0;

    // Used on Page counts
    let usedOnPageCount = '-';
    let usedInternalCount = '-';
    let usedExternalCount = '-';
    let usedImageCount = '-';
    let usedVideoCount = '-';
    let usedMissingAltCount = '-';
    let usedMissingAltPercentage = 0;

    // Use home page path if we're on the media library page
    let pagePathForMetrics = state.context.currentPagePath;
    if (pagePathForMetrics && pagePathForMetrics.includes('tools/media-library/media-library')) {
      const homePagePath = `/${state.context.org}/${state.context.repo}/index.html`;
      pagePathForMetrics = homePagePath;
    } else if (pagePathForMetrics && !pagePathForMetrics.startsWith(`/${state.context.org}/${state.context.repo}`)) {
      // If path doesn't start with full org/repo structure, construct full path
      const fullPath = `/${state.context.org}/${state.context.repo}${pagePathForMetrics}.html`;
      pagePathForMetrics = fullPath;
    } else if (pagePathForMetrics && !pagePathForMetrics.includes('.html')) {
      // If path doesn't end with .html, add it
      const fullPath = `${pagePathForMetrics}.html`;
      pagePathForMetrics = fullPath;
    }

    if (pagePathForMetrics) {
      const usedOnPage = state.media.filter((a) => {
        if (!a.usedIn) return false;
        const usedInPages = typeof a.usedIn === 'string' ? a.usedIn.split(',') : a.usedIn;
        return usedInPages.includes(pagePathForMetrics);
      });

      usedOnPageCount = usedOnPage.length;
      usedInternalCount = usedOnPage.filter((a) => a.isExternal === false).length;
      usedExternalCount = usedOnPage.filter((a) => a.isExternal === true).length;
      usedImageCount = usedOnPage.filter((a) => a.type === 'image').length;
      usedVideoCount = usedOnPage.filter((a) => a.type === 'video').length;
      usedMissingAltCount = usedOnPage.filter((a) => {
        const hasOccurrences = a.occurrences && a.occurrences.length > 0;
        if (hasOccurrences) {
          const pageOccurrences = a.occurrences.filter(
            (o) => o.pagePath === pagePathForMetrics,
          );
          return a.type !== 'video' && pageOccurrences.some((o) => !o.hasAltText);
        }
        return a.type !== 'video' && (!a.alt || a.alt.trim() === '' || a.alt === 'Untitled Media');
      }).length;
      usedMissingAltPercentage = usedImageCount > 0
        ? Math.round((usedMissingAltCount / usedImageCount) * 100)
        : 0;
    }

    const setCount = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    };
    const setPercentage = (id, percentage) => {
      const el = document.getElementById(id);
      if (el) el.textContent = ` (${percentage}% of images)`;
    };
    setCount('imageCount', imageCount);
    setCount('videoCount', videoCount);
    setCount('documentCount', documentCount);
    setCount('internalCount', internalCount);
    setCount('externalCount', externalCount);
    setCount('totalCount', totalCount);
    setCount('missingAltCount', missingAltCount);
    setPercentage('missingAltPercentage', missingAltPercentage);
    setCount('usedOnPageCount', usedOnPageCount);
    setCount('usedInternalCount', usedInternalCount);
    setCount('usedExternalCount', usedExternalCount);
    setCount('usedImageCount', usedImageCount);
    setCount('usedVideoCount', usedVideoCount);
    setCount('usedMissingAltCount', usedMissingAltCount);
    setPercentage('usedMissingAltPercentage', usedMissingAltPercentage);
    renderTopMediaList();
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

  function setCurrentFilter(filterValue) {
    state.currentFilterString = filterValue || null;
    renderTopMediaList();
  }

  function markInitialLoadComplete() {
    state.isInitialLoad = false;
  }

  function cleanup() {
    if (state.virtualScroll.observer) {
      state.virtualScroll.observer.disconnect();
      state.virtualScroll.observer = null;
    }
  }

  return api;
}
