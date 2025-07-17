// tools/media-library/modules/event-handlers.js
// Queue manager event handlers for Media Library

import { updateSidebarCounts } from './sidebar.js';
import { showEmptyState } from './empty-state.js';
import { showScanIndicator } from './scan-indicator.js';
import { saveMediaSheet, loadMediaSheet } from './media-processor.js';
import { getContext } from './media-loader.js';
import { CONTENT_DA_LIVE_BASE } from './sheet-utils.js';

/**
 * Handle discovery completion
 */
function handleDiscoveryComplete(data, updateLoadingText) {
  const { totalPages, discoveredPages } = data;
  const message = `Discovery complete: ${discoveredPages} pages found out of ${totalPages} total pages`;
  updateLoadingText(message);
}

/**
 * Handle page scanned event
 */
async function handlePageScanned(
  data,
  assets,
  assetBrowser,
  metadataManager,
  processScanResults,
  updateLoadingText,
  updateScanProgressHeader,
) {
  if (data.assets && data.assets.length > 0) {
    let baseAssets = [];
    const apiConfig = metadataManager?.daApi?.getConfig?.() || null;
    if (apiConfig) {
      try {
        baseAssets = await loadMediaSheet(apiConfig);
        console.log('[DEBUG] Loaded base assets from media.json:', baseAssets.length);
      } catch (err) {
        baseAssets = [];
        console.log('[DEBUG] Failed to load from media.json, using empty array');
      }
    }
    
    const newAssets = processScanResults([{ assets: data.assets, file: { path: data.page } }]);
    console.log('[DEBUG] New assets from current page:', newAssets.length);

    const allAssets = [...baseAssets, ...newAssets];
    const dedupedAssets = Array.from(new Map(allAssets.map((a) => [a.src, a])).values());
    console.log('[DEBUG] Total deduped assets:', dedupedAssets.length);

    if (apiConfig) {
      try {
        await saveMediaSheet(apiConfig, dedupedAssets);
        console.log('[DEBUG] Saved assets to media.json');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[DA] handlePageScanned: SAVE FAILED', err);
      }
    }
    
    // Only add truly new assets to prevent position changes
    const existingAssetSrcs = new Set(assets.map(a => a.src));
    const trulyNewAssets = dedupedAssets.filter(asset => !existingAssetSrcs.has(asset.src));
    console.log('[DEBUG] Truly new assets to add:', trulyNewAssets.length);
    
    if (trulyNewAssets.length > 0) {
      assets.push(...trulyNewAssets);
      
      // Batch UI updates to reduce refresh frequency
      if (!window.pendingAssetUpdate) {
        window.pendingAssetUpdate = {
          timer: null,
          assets: [],
          isFirstBatch: true
        };
      }
      
      window.pendingAssetUpdate.assets.push(...trulyNewAssets);
      
      // Show first batch immediately, batch subsequent updates
      if (window.pendingAssetUpdate.isFirstBatch) {
        console.log('[DEBUG] Showing first batch immediately');
        assetBrowser.addAssets(window.pendingAssetUpdate.assets, true);
        updateSidebarCounts(assets, getCurrentPageUrl());
        window.pendingAssetUpdate.assets = [];
        window.pendingAssetUpdate.isFirstBatch = false;
      } else {
        // Clear existing timer and set new one for subsequent batches
        if (window.pendingAssetUpdate.timer) {
          clearTimeout(window.pendingAssetUpdate.timer);
        }
        
        window.pendingAssetUpdate.timer = setTimeout(() => {
          console.log('[DEBUG] Showing batched assets');
          assetBrowser.addAssets(window.pendingAssetUpdate.assets, true);
          updateSidebarCounts(assets, getCurrentPageUrl());
          window.pendingAssetUpdate.assets = [];
          window.pendingAssetUpdate.timer = null;
        }, 500);
      }
    }
  }
  // Update progress
  const stats = data.stats;
  if (stats) {
    updateLoadingText(
      `Scanned: ${stats.scannedPages}/${stats.totalPages} pages, Found: ${stats.totalAssets} assets`,
    );
    updateScanProgressHeader(stats.scannedPages, stats.totalPages);
  }
}

/**
 * Handle scanning started event
 */
function handleScanningStarted(
  data,
  isScanning,
  showScanProgress,
  updateLoadingText,
  updateScanProgressHeader,
) {
  isScanning = true;
  // Note: showScanProgress() is called in startFullScan(), so we don't call it here
  updateLoadingText('Queue-based scanning started...');
  if (data && data.stats) {
    updateScanProgressHeader(data.stats.scannedPages, data.stats.totalPages);
  }
}

/**
 * Handle scanning stopped event
 */
function handleScanningStopped(
  data,
  assets,
  isScanning,
  hideScanProgress,
) {
  isScanning = false;
  hideScanProgress();
  const stats = data.stats;
  if (stats) {
    const percent = stats.totalPages > 0 ? Math.round((stats.scannedPages / stats.totalPages) * 100) : 0;
    if (stats.totalAssets === 0 && assets.length === 0) {
      showEmptyState();
      showScanIndicator(100, 'complete');
    } else {
      // Hide loading, show grid
      const grid = document.getElementById('assetsGrid');
      if (grid) grid.style.display = '';
      showScanIndicator(percent, 'complete');
      // Do not hide the scan indicator after partial scan; leave it visible
    }
    

  }
}

/**
 * Handle queue size updates
 */
function handleQueueSizeUpdate(
  data,
  updateScanProgressHeader,
) {
  const stats = data.stats;
  if (stats && stats.totalPages > 0) {
    updateScanProgressHeader(stats.scannedPages, stats.totalPages);
  }
}

/**
 * Handle worker errors
 */
function handleWorkerError(data) {
  // eslint-disable-next-line no-console
  console.error('Worker error:', data);
  showScanIndicator(0, 'error');
}

/**
 * Handle resuming from saved queue
 */
function handleResumingFromQueue(
  data,
  updateLoadingText,
) {
  updateLoadingText(`Resuming scan from ${data.queueSize} pending documents...`);
}

/**
 * Handle documents being skipped (already scanned)
 */
function handleDocumentsSkipped(
  data,
  updateLoadingText = () => {},
) {
  if (data.reason === 'already_scanned') {
    if (data.incrementalStats) {
      const { new: newDocs, changed, unchanged, toScan, skipped } = data.incrementalStats;
      const message = `Incremental scan: ${newDocs} new, ${changed} changed, ${skipped} skipped (${toScan} to scan)`;
      updateLoadingText(message);
    }
  }
}

function getCurrentPageUrl() {
  const daContext = getContext && getContext();
  if (daContext?.org && daContext?.repo && daContext?.path) {
    let pagePath = daContext.path;
    if (!pagePath.endsWith('.html')) {
      pagePath += '.html';
    }
    return `${CONTENT_DA_LIVE_BASE}/${daContext.org}/${daContext.repo}${pagePath}`;
  }
  return null;
}

export {
  handleDiscoveryComplete,
  handlePageScanned,
  handleScanningStarted,
  handleScanningStopped,
  handleQueueSizeUpdate,
  handleWorkerError,
  handleResumingFromQueue,
  handleDocumentsSkipped,
};
