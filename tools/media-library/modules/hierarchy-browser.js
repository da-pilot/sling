

import { fetchSheetJson } from './sheet-utils.js';

let hierarchyTree = {};
let currentPath = [];
let currentAssetPagePath = null;
let mediaAssets = [];
let isHierarchyView = false;

function getFolderAndPageParts(usedInPath) {
  const parts = usedInPath.replace(/^\/+/, '').split('/');
  const siteParts = parts.slice(2);
  let isPage = false;
  if (siteParts.length && siteParts[siteParts.length - 1].endsWith('.html')) {
    isPage = true;
  }
  return {
    folders: isPage ? siteParts.slice(0, -1) : siteParts,
    page: isPage ? siteParts[siteParts.length - 1] : null
  };
}

function buildHierarchyTree(assets) {
  const tree = {};
  for (const asset of assets) {
    let usedInArr = [];
    if (Array.isArray(asset.usedIn)) {
      usedInArr = asset.usedIn;
    } else if (typeof asset.usedIn === 'string') {
      usedInArr = [asset.usedIn];
    }
    for (const usedInPath of usedInArr) {
      const parts = usedInPath.split('/').filter(Boolean);
      const displayParts = parts.slice(2); // skip org and repo
      let node = tree;
      for (let i = 0; i < displayParts.length; i++) {
        const part = displayParts[i];
        if (!node[part]) {
          node[part] = { _children: {}, _type: i === displayParts.length - 1 ? 'page' : 'folder' };
        }
        if (i === displayParts.length - 1) {
          node[part]._fullPath = '/' + parts.join('/');
        }
        node = node[part]._children;
      }
    }
  }
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
  let html = `<span class="breadcrumb-item"><a href="#" data-bc-idx="-1">📁 Folders</a></span>`;
  for (let i = 0; i < path.length; i++) {
    html += `<span class="breadcrumb-separator">/</span>`;
    if (i === path.length - 1 && currentAssetPagePath) {
      html += `<span class="breadcrumb-item current">${path[i]}</span>`;
    } else {
      html += `<span class="breadcrumb-item"><a href="#" data-bc-idx="${i}">${path[i]}</a></span>`;
    }
  }
  breadcrumb.innerHTML = html;
  breadcrumb.querySelectorAll('a[data-bc-idx]').forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      const idx = parseInt(link.getAttribute('data-bc-idx'), 10);
      currentAssetPagePath = null;
      if (idx === -1) {
        currentPath = [];
      } else {
        currentPath = path.slice(0, idx + 1);
      }
      isHierarchyView = true;
      const assetsGrid = document.getElementById('assetsGrid');
      const hierarchyContainer = document.getElementById('hierarchyContainer');
      if (assetsGrid) assetsGrid.style.display = 'none';
      if (hierarchyContainer) hierarchyContainer.style.display = 'block';
      renderBreadcrumb(currentPath);
      renderHierarchyList(currentPath);
    };
  });
}

function onBreadcrumbClick(newPath) {
  currentPath = newPath;
  renderBreadcrumb(currentPath);
  renderHierarchyList(currentPath);
}

function renderHierarchyList(path) {
  currentAssetPagePath = null;
  const container = createHierarchyContainer();
  container.innerHTML = '';
  let node = hierarchyTree;
  for (const part of path) {
    if (!node[part]) return;
    node = node[part]._children || node[part];
  }
  const grid = document.createElement('div');
  grid.className = 'hierarchy-grid';
  let hasContent = false;
  for (const key in node) {
    if (!node.hasOwnProperty(key)) continue;
    const entry = node[key];
    if (entry._type === 'folder') {
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
    } else if (entry._type === 'page') {
      hasContent = true;
      const div = document.createElement('div');
      div.className = 'page-card';
      div.innerHTML = `<span class="hierarchy-icon" aria-hidden="true">📄</span><span><strong>${key.replace(/\.html$/, '')}</strong></span>`;
      div.onclick = () => {
        filterAssetsForPage(entry._fullPath, [...path, key]);
      };
      grid.appendChild(div);
    }
  }
  if (!hasContent) {
    const empty = document.createElement('div');
    empty.className = 'hierarchy-empty';
    empty.textContent = 'No folders or pages found in this location.';
    grid.appendChild(empty);
  }
  container.appendChild(grid);
}

async function filterAssetsForPage(pagePath, displayPath) {
  try {
    if (!window.stateManager || !window.stateManager.getMediaData) return;
    const allAssets = await window.stateManager.getMediaData();
    const filteredAssets = allAssets.filter(asset => {
      if (!asset.usedIn) return false;
      if (Array.isArray(asset.usedIn)) {
        return asset.usedIn.includes(pagePath);
      } else if (typeof asset.usedIn === 'string') {
        return asset.usedIn === pagePath;
      }
      return false;
    });
    isHierarchyView = false;
    currentPath = displayPath || [];
    currentAssetPagePath = pagePath;
    const assetsGrid = document.getElementById('assetsGrid');
    const hierarchyContainer = document.getElementById('hierarchyContainer');
    if (assetsGrid) assetsGrid.style.display = 'grid';
    if (hierarchyContainer) hierarchyContainer.style.display = 'none';
    const toggle = document.getElementById('hierarchyToggle');
    if (toggle) {
      toggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 18 18" width="16"><path d="M16.5,4l-7.16577.00378L7.68188,2.3031A1.00063,1.00063,0,0,0,6.9646,2H2A1,1,0,0,0,1,3V14.5a.5.5,0,0,0,.5.5h15a.5.5,0,0,0,.5-.5V4.5A.50018.50018,0,0,0,16.5,4ZM2,3H6.9646L8.908,5H2ZM12.35352,8.85352l-3,3a.49984.49984,0,0,1-.707,0l-3-3a.5.5,0,0,1,.707-.707L9,10.793l2.64648-2.64649a.5.5,0,0,1,.707.707Z"></path></svg>`;
    }
    const gridBtn = document.getElementById('gridViewBtn');
    if (gridBtn && !gridBtn.classList.contains('active')) {
      gridBtn.click();
    }
    if (window.renderAssets && typeof window.renderAssets === 'function') {
      window.renderAssets(filteredAssets);
    }
    renderBreadcrumb(currentPath);
  } catch (error) {
    console.error('[HierarchyBrowser] Error filtering assets for page:', error);
  }
}

function toggleHierarchyView() {
  const assetsGrid = document.getElementById('assetsGrid');
  const hierarchyContainer = document.getElementById('hierarchyContainer');
  const folderBtn = document.getElementById('hierarchyToggle');
  const gridBtn = document.getElementById('gridViewBtn');
  const listBtn = document.getElementById('listViewBtn');

  isHierarchyView = true;
  if (assetsGrid) assetsGrid.style.display = 'none';
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

function returnToAllAssets() {
    const assetsGrid = document.getElementById('assetsGrid');
  const hierarchyContainer = document.getElementById('hierarchyContainer');
  const folderBtn = document.getElementById('hierarchyToggle');

  // Exit folder view and return to All Assets
  isHierarchyView = false;
  currentPath = []; // Clear current path
  currentAssetPagePath = null; // Clear current page path
  

  
      if (assetsGrid) {
      assetsGrid.style.display = 'grid';
      assetsGrid.removeAttribute('style');
    }
  if (hierarchyContainer) hierarchyContainer.style.display = 'none';
  folderBtn?.classList.remove('active');
  
      if (window.handleViewChange && typeof window.handleViewChange === 'function') {
      window.handleViewChange('grid');
    } else {
    console.error('[HierarchyBrowser] handleViewChange not available');
  }
  
  // Reload all assets from IndexedDB to ensure complete asset set

  reloadAllAssetsFromIndexedDB();
  
  // Update sidebar to show All Assets as active
  document.querySelectorAll('.folder-item').forEach(item => {
    item.classList.remove('active');
    item.setAttribute('aria-selected', 'false');
  });
  const allAssetsItem = document.querySelector('.folder-item[data-filter="all"]');
  if (allAssetsItem) {
    allAssetsItem.classList.add('active');
    allAssetsItem.setAttribute('aria-selected', 'true');
  
  }
  
  const breadcrumb = document.querySelector('.breadcrumb');
  if (breadcrumb) {
    breadcrumb.innerHTML = '<span class="breadcrumb-item">All Assets</span>';
  
  }
  

}

async function reloadAllAssetsFromIndexedDB() {
  try {
  
    
    if (window.stateManager && typeof window.stateManager.getMediaData === 'function') {
      const allAssets = await window.stateManager.getMediaData();

      
      
      if (window.assetBrowser && typeof window.assetBrowser.setAssets === 'function') {

        
        window.assetBrowser.setAssets(allAssets);
        
        if (window.assetBrowser.setFilter) {

          window.assetBrowser.setFilter({
            types: ['image', 'video', 'document'],
            isExternal: undefined,
            usedOnPage: false,
            missingAlt: undefined,
            search: ''
          });
          
          
          // Check state after filter reset
          
        }
        
        // Check if container has content
        const container = document.getElementById('assetsGrid');
        if (container) {
          
        }
      } else {
        console.error('[HierarchyBrowser] Asset browser not available or setAssets not found');
      }
      
      
    } else {
      console.error('[HierarchyBrowser] State manager not available or getMediaData not found');
    }
  } catch (error) {
    console.error('[HierarchyBrowser] Error reloading assets from IndexedDB:', error);
  }
}

/**
 * Check if IndexedDB has data and render accordingly
 */
async function checkAndRenderHierarchyData() {
  const hierarchyContainer = document.getElementById('hierarchyContainer');
  if (!hierarchyContainer) return;
  
  hierarchyContainer.innerHTML = `
    <div class="hierarchy-loading">
      <div class="loading-spinner"></div>
      <p>Loading folder structure...</p>
    </div>
  `;
  
  try {
    if (window.stateManager && typeof window.stateManager.getMediaData === 'function') {
      const assets = await window.stateManager.getMediaData();
      
      if (assets && assets.length > 0) {
        mediaAssets = assets;
        hierarchyTree = buildHierarchyTree(mediaAssets);
        renderBreadcrumb(currentPath);
        renderHierarchyList(currentPath);
        return;
      }
    }
    
    hierarchyContainer.innerHTML = `
      <div class="hierarchy-no-data">
        <p>📁 Folder structure not ready yet</p>
        <p>Please wait for assets to finish loading, then try again.</p>
        <button onclick="toggleHierarchyView()" class="toolbar-btn">← Back to Assets</button>
      </div>
    `;
    
  } catch (error) {
    console.error('[HierarchyBrowser] Error checking hierarchy data:', error);
    hierarchyContainer.innerHTML = `
      <div class="hierarchy-error">
        <p>❌ Error loading folder structure</p>
        <p>${error.message}</p>
        <button onclick="toggleHierarchyView()" class="toolbar-btn">← Back to Assets</button>
      </div>
    `;
  }
}

/**
 * Check if IndexedDB is ready and update toggle button state
 */
async function checkIndexedDBReady() {
  try {
    if (window.stateManager && typeof window.stateManager.getMediaData === 'function') {
      const assets = await window.stateManager.getMediaData();
      const toggle = document.getElementById('hierarchyToggle');
      if (toggle) {
        if (assets && assets.length > 0) {
          toggle.disabled = false;
          toggle.title = 'Switch to folder view';
          toggle.style.opacity = '1';
        } else {
          toggle.disabled = true;
          toggle.title = 'Folder view not ready yet - waiting for assets to load';
          toggle.style.opacity = '0.5';
        }
      }
    }
  } catch (error) {
    // silent
  }
}

/**
 * Search assets in the current hierarchy context
 */
async function searchAssetsInHierarchy(searchTerm, currentPath = []) {
  if (!window.stateManager || !window.stateManager.searchMediaAssets) {
    return [];
  }

  try {
    const filters = {};
    
    // If we're in a specific folder/page context, filter by path
    if (currentPath.length > 0) {
      const pathString = '/' + currentPath.join('/');
      filters.usedIn = pathString;
    }

    return await window.stateManager.searchMediaAssets(searchTerm, filters);
  } catch (error) {
    console.error('Error searching assets:', error);
    return [];
  }
}

/**
 * Get assets for a specific path
 */
async function getAssetsForPath(path) {
  if (!window.stateManager || !window.stateManager.getMediaData) {
    return [];
  }

  try {
    const allAssets = await window.stateManager.getMediaData();
    return allAssets.filter(asset => 
      asset.usedIn && Array.isArray(asset.usedIn) && asset.usedIn.includes(path)
    );
  } catch (error) {
    console.error('Error getting assets for path:', error);
    return [];
  }
}

export async function initHierarchyBrowser() {

  let assetsData = [];
  
  let attempts = 0;
  const maxAttempts = 10;
  while (!window.stateManager && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }

  if (window.stateManager) {
    
  }
  
  if (window.stateManager && typeof window.stateManager.getMediaData === 'function') {
    try {
      assetsData = await window.stateManager.getMediaData();

    } catch (error) {
      console.warn('[HierarchyBrowser] Failed to get media data from state manager:', error);
      assetsData = [];
    }
  } else {
    console.warn('[HierarchyBrowser] window.stateManager or getMediaData not available');
  }
  
  if (!assetsData.length) {
    let apiConfig = null;
    if (window.stateManager && window.stateManager.state && window.stateManager.state.apiConfig) {
      apiConfig = window.stateManager.state.apiConfig;
    } else if (window.daContext) {
      apiConfig = window.daContext;
    } else if (window.daApi && window.daApi.getConfig) {
      apiConfig = window.daApi.getConfig();
    }
    if (apiConfig) {
      try {

        const data = await fetchSheetJson(apiConfig, 'media.json');
        
        if (data && data.data && Array.isArray(data.data)) {
          assetsData = data.data;
        } else if (data && Array.isArray(data)) {
          assetsData = data;
        } else if (data && data.data && Array.isArray(data.data.data)) {
          assetsData = data.data.data;
        }
        
        if (assetsData.length > 0 && window.stateManager && window.stateManager.syncMediaData) {
          try {
            await window.stateManager.syncMediaData(assetsData);

          } catch (syncError) {
            console.warn('[HierarchyBrowser] Failed to sync data to IndexedDB:', syncError);
          }
        }
      } catch (apiError) {
        console.warn('[HierarchyBrowser] Failed to fetch from DA API:', apiError);
      }
    } else {
      console.warn('[HierarchyBrowser] No apiConfig found for fallback fetch');
    }
  }
  
  if (!assetsData.length) {
    try {
      const org = window.daContext?.org || window.stateManager?.state?.apiConfig?.org;
      const repo = window.daContext?.repo || window.stateManager?.state?.apiConfig?.repo;
      if (org && repo) {
        const remoteUrl = `https://content.da.live/${org}/${repo}/.da/media.json`;

        const response = await fetch(remoteUrl, { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          assetsData = data?.data || [];
          
        } else {
          console.warn('[HierarchyBrowser] Remote fetch failed:', response.status);
        }
      } else {
        console.warn('[HierarchyBrowser] No org/repo for remote fetch');
      }
    } catch (remoteError) {
      console.warn('[HierarchyBrowser] Failed to fetch from remote URL:', remoteError);
    }
  }
  
  mediaAssets = assetsData || [];
  hierarchyTree = buildHierarchyTree(mediaAssets);
  currentPath = [];
  

  
  createHierarchyContainer();
  addHierarchyToggle();


}

function addHierarchyToggle() {
  let toggle = document.getElementById('hierarchyToggle');
  if (!toggle) return;
  checkIndexedDBReady();
  
  const hierarchyContainer = document.getElementById('hierarchyContainer');
  const isInFolderView = hierarchyContainer && hierarchyContainer.style.display !== 'none';
  if (isInFolderView) {
    isHierarchyView = true;
    toggle.classList.add('active');
  }
}

// Export search function for use in other modules
export { searchAssetsInHierarchy, getAssetsForPath, toggleHierarchyView, returnToAllAssets }; 