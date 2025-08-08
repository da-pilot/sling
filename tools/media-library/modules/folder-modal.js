/* eslint-disable no-use-before-define */
/**
 * Folder Modal Component
 * Displays site structure hierarchy and allows filtering media by folders/files
 */
import { loadDataSafe, CONTENT_DA_LIVE_BASE } from './sheet-utils.js';

export default function createFolderModal() {
  const state = {
    modal: null,
    siteStructure: null,
    currentPath: [],
    isVisible: false,
    isLoading: false,
    config: null,
    daApi: null,
    eventEmitter: null,
  };

  /**
   * Render loading state
   */
  function renderLoadingState() {
    const treeContainer = state.modal?.querySelector('#folderTree');
    if (!treeContainer) return;
    console.log('[Folder Modal] 🔄 Rendering loading state');
    treeContainer.innerHTML = `
      <div class="folder-loading-state">
        <div class="folder-loading-spinner"></div>
        <p>Loading folder structure...</p>
        <p>Please wait while we build the folder hierarchy.</p>
      </div>
    `;
  }

  /**
   * Show the modal
   */
  function showModal() {
    if (!state.modal) return;
    state.isVisible = true;
    document.body.classList.add('modal-open');
    state.modal.style.display = 'flex';
    setTimeout(() => {
      state.modal.classList.add('visible');
    }, 10);

    // Show loading state if site structure is not available
    if (!state.siteStructure) {
      state.isLoading = true;
      console.log('[Folder Modal] 🔄 Site structure not available, showing loading state');
      renderLoadingState();
    } else {
      console.log('[Folder Modal] ✅ Site structure available, no loading needed');
    }

    const searchInput = state.modal.querySelector('#folderSearchInput');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 350);
    }
    console.log('[Folder Modal] Modal shown');
  }

  /**
   * Hide the modal
   */
  function hideModal() {
    if (!state.modal) return;
    state.isVisible = false;
    state.isLoading = false;
    document.body.classList.remove('modal-open');
    state.modal.classList.remove('visible');
    setTimeout(() => {
      state.modal.style.display = 'none';
    }, 300);
    state.modal.querySelectorAll('.folder-tree-item').forEach((el) => {
      el.classList.remove('selected');
    });
    const searchInput = state.modal.querySelector('#folderSearchInput');
    if (searchInput) {
      searchInput.value = '';
    }
    console.log('[Folder Modal] Modal hidden');
  }

  /**
   * Calculate total media count for a folder
   * @param {Object} folder - Folder data
   * @returns {number} Total media count
   */
  function calculateFolderMediaCount(folder) {
    let count = 0;
    if (folder.files) {
      count += folder.files.reduce((sum, file) => sum + (file.mediaCount || 0), 0);
    }
    if (folder.subfolders) {
      Object.values(folder.subfolders).forEach((subFolder) => {
        count += calculateFolderMediaCount(subFolder);
      });
    }
    return count;
  }

  /**
   * Create a file node HTML
   * @param {Object} file - File data
   * @param {number} level - Indentation level
   * @returns {string} HTML string
   */
  function createFileNode(file, level = 0) {
    const mediaCount = file.mediaCount || 0;
    const indent = level * 20;
    const fileName = file.path.split('/').pop() || `${file.name}.${file.ext}`;
    const isHtmlFile = fileName.toLowerCase().endsWith('.html');
    const iconPath = isHtmlFile ? '/tools/media-library/icons/Smock_FileHTML_18_N.svg' : '/tools/media-library/icons/Smock_Document_18_N.svg';
    return `
      <div class="folder-tree-item file-item" data-path="${file.path}" data-type="file" style="padding-left: ${indent}px;">
        <img src="${iconPath}" class="folder-tree-icon" alt="Document">
        <span class="folder-tree-name">${fileName}</span>
        <span class="folder-tree-count">(${mediaCount})</span>
      </div>
    `;
  }

  /**
   * Create folder node HTML
   * @param {string} folderName - Name of the folder
   * @param {Object} folder - Folder data object
   * @param {number} level - Nesting level
   * @returns {string} HTML string for folder node
   */
  function createFolderNode(folderName, folder, level = 0) {
    const totalMedia = calculateFolderMediaCount(folder);
    const hasSubfolders = folder.subfolders && Object.keys(folder.subfolders).length > 0;
    const hasFiles = folder.files && folder.files.length > 0;
    const hasChildren = hasSubfolders || hasFiles;
    const indent = level * 20;
    let html = `
    <div class="folder-tree-item folder-item" data-path="${folder.path}" data-type="folder" data-level="${level}" style="padding-left: ${indent}px;">
      <span class="folder-tree-toggle">${hasChildren ? '<img src="/tools/media-library/icons/chevron-right.svg" class="chevron-icon" alt="Expand">' : ''}</span>
      <img src="/tools/media-library/icons/Smock_Folder_18_N.svg" class="folder-tree-icon" alt="Folder">
      <span class="folder-tree-name">${folderName}</span>
      <span class="folder-tree-count">(${totalMedia})</span>
    </div>
  `;
    if (hasChildren) {
      html += '<div class="folder-tree-children" style="display: none;"></div>';
    }
    html += '</div>';
    return html;
  }

  /**
   * Find folder data by path
   * @param {string} path - Folder path
   * @returns {Object|null} Folder data object or null
   */
  function findFolderData(path) {
    if (!state.siteStructure?.structure?.root) return null;
    const pathParts = path.split('/').filter(Boolean);
    let current = state.siteStructure.structure.root;
    return pathParts.every((part) => {
      if (current.subfolders && current.subfolders[part]) {
        current = current.subfolders[part];
        return true;
      }
      return false;
    }) ? current : null;
  }

  /**
   * Toggle folder expand/collapse
   * @param {HTMLElement} folderItem - Folder item element
   */
  function toggleFolder(folderItem) {
    const children = folderItem.nextElementSibling;
    const toggleIcon = folderItem.querySelector('.folder-tree-toggle');
    const folderIcon = folderItem.querySelector('.folder-tree-icon');
    if (children && children.classList.contains('folder-tree-children') && toggleIcon && toggleIcon.innerHTML.trim()) {
      const isExpanded = children.style.display !== 'none';
      if (isExpanded) {
        children.style.display = 'none';
        toggleIcon.innerHTML = '<img src="/tools/media-library/icons/chevron-right.svg" class="chevron-icon" alt="Expand">';
        if (folderIcon) {
          folderIcon.src = '/tools/media-library/icons/Smock_Folder_18_N.svg';
        }
      } else {
        const treeContainer = state.modal?.querySelector('#folderTree');
        if (treeContainer) {
          const currentParent = folderItem.parentElement;
          if (currentParent) {
            const siblings = currentParent.querySelectorAll('.folder-item');
            siblings.forEach((sibling) => {
              if (sibling !== folderItem) {
                const siblingChildren = sibling.nextElementSibling;
                const siblingToggle = sibling.querySelector('.folder-tree-toggle');
                const siblingFolderIcon = sibling.querySelector('.folder-tree-icon');
                if (siblingChildren && siblingChildren.classList.contains('folder-tree-children')) {
                  siblingChildren.style.display = 'none';
                  if (siblingToggle && siblingToggle.innerHTML.trim()) {
                    siblingToggle.innerHTML = '<img src="/tools/media-library/icons/chevron-right.svg" class="chevron-icon" alt="Expand">';
                  }
                  if (siblingFolderIcon) {
                    siblingFolderIcon.src = '/tools/media-library/icons/Smock_Folder_18_N.svg';
                  }
                }
              }
            });
          }
        }
      }
      if (children.children.length === 0) {
        const folderPath = folderItem.dataset.path;
        const folderData = findFolderData(folderPath);
        if (folderData) {
          renderFolderChildren(children, folderData, parseInt(folderItem.dataset.level || '0', 10) + 1);
        }
      }
      children.style.display = 'block';
      toggleIcon.innerHTML = '<img src="/tools/media-library/icons/chevron-down.svg" class="chevron-icon" alt="Collapse">';
      if (folderIcon) {
        folderIcon.src = '/tools/media-library/icons/Smock_FolderOpen_18_N.svg';
      }
    }
  }

  /**
   * Select a folder or file item
   * @param {HTMLElement} item - Item element
   */
  function selectItem(item) {
    state.modal?.querySelectorAll('.folder-tree-item').forEach((el) => {
      el.classList.remove('selected');
    });
    item.classList.add('selected');
    const applyBtn = state.modal?.querySelector('#applyFolderFilter');
    if (applyBtn) {
      applyBtn.disabled = false;
    }
  }

  /**
   * Apply the selected folder filter
   */
  function applyFolderFilter() {
    const selectedItem = state.modal?.querySelector('.folder-tree-item.selected');
    if (!selectedItem) return;
    const { path, type } = selectedItem.dataset;
    let fullPath = path;

    if (state.config && state.config.org && state.config.repo) {
      if (type === 'folder') {
        fullPath = `/${state.config.org}/${state.config.repo}${fullPath}`;
      } else if (type === 'file') {
        fullPath = `/${state.config.org}/${state.config.repo}${fullPath}`;
      }
    }
    if (state.eventEmitter) {
      state.eventEmitter.emit('folderFilterApplied', {
        path: fullPath,
        type,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Add event listeners to folder tree items
   */
  function addFolderTreeEventListeners() {
    const treeContainer = state.modal?.querySelector('#folderTree');
    if (!treeContainer) return;
    treeContainer.querySelectorAll('.folder-item').forEach((item) => {
      const toggleIcon = item.querySelector('.folder-tree-toggle');
      if (toggleIcon && toggleIcon.innerHTML && toggleIcon.innerHTML.trim()) {
        toggleIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFolder(item);
        });
      }
      item.addEventListener('click', (e) => {
        if (e.target === toggleIcon) return;
        e.stopPropagation();
        selectItem(item);
        if (toggleIcon && toggleIcon.innerHTML && toggleIcon.innerHTML.trim()) {
          toggleFolder(item);
        }
        setTimeout(() => {
          applyFolderFilter();
        }, 100);
      });
    });
    treeContainer.querySelectorAll('.file-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectItem(item);
        setTimeout(() => {
          applyFolderFilter();
        }, 100);
      });
    });
  }

  /**
   * Render folder children
   * @param {HTMLElement} container - Container element
   * @param {Object} folderData - Folder data object
   * @param {number} level - Nesting level
   */
  function renderFolderChildren(container, folderData, level) {
    const childItems = [];
    if (folderData.files) {
      folderData.files.forEach((file) => {
        childItems.push({
          type: 'file',
          name: file.path.split('/').pop() || `${file.name}.${file.ext}`,
          data: file,
          level,
        });
      });
    }
    if (folderData.subfolders) {
      Object.entries(folderData.subfolders).forEach(([subFolderName, subFolder]) => {
        childItems.push({
          type: 'folder',
          name: subFolderName,
          data: subFolder,
          level,
        });
      });
    }
    childItems.sort((a, b) => a.name.localeCompare(b.name));
    let html = '';
    childItems.forEach((item) => {
      if (item.type === 'file') {
        html += createFileNode(item.data, item.level);
      } else {
        html += createFolderNode(item.name, item.data, item.level);
      }
    });
    container.innerHTML = html;
    addFolderTreeEventListeners();
  }

  /**
   * Filter folders based on search term
   * @param {string} searchTerm - Search term
   */
  function filterFolders(searchTerm) {
    const treeContainer = state.modal?.querySelector('#folderTree');
    if (!treeContainer) return;
    const items = treeContainer.querySelectorAll('.folder-tree-item');
    const term = searchTerm.toLowerCase();
    items.forEach((item) => {
      const name = item.querySelector('.folder-tree-name')?.textContent || '';
      const matches = name.toLowerCase().includes(term);
      item.style.display = matches ? 'block' : 'none';
    });
  }

  /**
   * Clear the current folder filter
   */
  function clearFilter() {
    // Clear any selected items
    state.modal?.querySelectorAll('.folder-tree-item').forEach((el) => {
      el.classList.remove('selected');
    });

    // Emit clear filter event
    if (state.eventEmitter) {
      state.eventEmitter.emit('folderFilterCleared', {
        timestamp: new Date().toISOString(),
      });
    }
  }

  function renderEmptyState() {
    const treeContainer = state.modal?.querySelector('#folderTree');
    if (!treeContainer) return;
    console.log('[Folder Modal] 📝 Rendering empty state');
    treeContainer.innerHTML = `
      <div class="folder-empty-state">
        <p>No folders or files found.</p>
        <p>Run a discovery scan to build the folder hierarchy.</p>
      </div>
    `;
  }

  /**
   * Render the folder tree
   */
  function renderFolderTree() {
    const treeContainer = state.modal?.querySelector('#folderTree');
    if (!treeContainer || !state.siteStructure) return;
    const structure = state.siteStructure.structure?.root;
    if (!structure) {
      renderEmptyState();
      return;
    }

    let html = '';

    const allItems = [];

    // Add root-level files
    if (structure.files && structure.files.length > 0) {
      structure.files.forEach((file) => {
        allItems.push({
          type: 'file',
          name: file.path.split('/').pop() || `${file.name}.${file.ext}`,
          data: file,
          level: 0,
        });
      });
    }

    // Add root-level folders
    if (structure.subfolders) {
      Object.entries(structure.subfolders).forEach(([folderName, folder]) => {
        allItems.push({
          type: 'folder',
          name: folderName,
          data: folder,
          level: 0,
        });
      });
    }

    // Sort all items alphabetically
    allItems.sort((a, b) => a.name.localeCompare(b.name));

    // Render all items
    allItems.forEach((item) => {
      if (item.type === 'file') {
        html += createFileNode(item.data, item.level);
      } else {
        html += createFolderNode(item.name, item.data, item.level);
      }
    });

    const hasNoItems = allItems.length === 0;
    if (hasNoItems) {
      renderEmptyState();
      return;
    }

    treeContainer.innerHTML = html;
    addFolderTreeEventListeners();
  }

  /**
   * Load site structure data
   */
  async function loadSiteStructure() {
    if (!state.config || !state.daApi) {
      console.warn('[Folder Modal] Configuration not available');
      return;
    }
    const filePath = `/${state.config.org}/${state.config.repo}/.media/site-structure.json`;
    const url = `${CONTENT_DA_LIVE_BASE}${filePath}`;
    const data = await loadDataSafe(url, state.config.token);
    if (data && data.data && data.data.length > 0) {
      const [siteStructure] = data.data;
      state.siteStructure = siteStructure;
      state.isLoading = false;
      renderFolderTree();
    } else {
      console.warn('[Folder Modal] No site structure data found');
      state.isLoading = false;
      renderEmptyState();
    }
  }

  /**
   * Setup modal event listeners
   */
  function setupEventListeners() {
    const { modal } = state;
    if (!modal) return;

    const closeBtn = modal.querySelector('#folderModalClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => hideModal());
    }

    const showAllBtn = modal.querySelector('#showAllBtn');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        clearFilter();
        hideModal();
      });
    }

    modal.addEventListener('click', ({ target }) => {
      if (target === modal) {
        hideModal();
      }
    });

    const searchInput = modal.querySelector('#folderSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', ({ target }) => {
        filterFolders(target.value);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.isVisible) {
        hideModal();
      }
    });
  }

  /**
   * Create the modal DOM element
   */
  function createModalElement() {
    const existingModal = document.getElementById('folderModal');
    if (existingModal) {
      existingModal.remove();
    }
    const modal = document.createElement('div');
    modal.id = 'folderModal';
    modal.className = 'folder-modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="folder-modal-content">
        <div class="folder-modal-header">
          <h3>Page Hierarchy</h3>
          <div class="folder-modal-actions">
            <button class="folder-modal-action-btn" id="showAllBtn" title="Show all assets">Show All</button>
            <button class="folder-modal-close" id="folderModalClose">&times;</button>
          </div>
        </div>
        <div class="folder-modal-body">
          <div class="folder-search-container">
            <input type="text" class="folder-search-input" placeholder="Search Folders & Files" id="folderSearchInput">
          </div>
          <div class="folder-tree-container">
            <div class="folder-tree" id="folderTree"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    state.modal = modal;
    setupEventListeners();
  }

  /**
   * Initialize the folder modal
   * @param {Object} config - API configuration
   * @param {Object} daApi - DA API instance
   * @param {Object} eventEmitter - Event emitter instance or queue orchestrator
   */
  async function init(config, daApi, eventEmitter) {
    state.config = config;
    state.daApi = daApi;
    state.eventEmitter = eventEmitter;
    createModalElement();
    await loadSiteStructure();

    // Listen for site structure updates
    if (eventEmitter && typeof eventEmitter.on === 'function') {
      eventEmitter.on('siteStructureUpdated', async () => {
        state.isLoading = false;
        await loadSiteStructure();
      });
    }
  }

  return {
    init,
    showModal,
    hideModal,
    loadSiteStructure,
    on: (event, callback) => {
      if (state.eventEmitter && typeof state.eventEmitter.on === 'function') {
        state.eventEmitter.on(event, callback);
      }
    },
    emit: (event, data) => {
      if (state.eventEmitter && typeof state.eventEmitter.emit === 'function') {
        state.eventEmitter.emit(event, data);
      }
    },
  };
}