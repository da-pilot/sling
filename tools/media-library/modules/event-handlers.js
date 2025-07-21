/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */

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
  if (data?.assets && data.assets.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[Event Handlers] 📄 handlePageScanned received data:', {
      data,
      assetsCount: data.assets?.length,
      hasFile: !!data.file,
      file: data.file,
      fileKeys: data.file ? Object.keys(data.file) : 'no file',
      fileOrg: data.file?.org,
      fileRepo: data.file?.repo,
      filePath: data.file?.path,
      timestamp: new Date().toISOString(),
    });

    const processedAssets = processScanResults([{ assets: data.assets, file: data.file }]);

    assets.push(...processedAssets);

    try {
      const context = getContext();
      if (context) {
        await saveMediaSheet(context, assets);
        // eslint-disable-next-line no-console
        console.log('[Event Handlers] ✅ Successfully saved assets to media.json:', {
          assetsCount: processedAssets.length,
          totalAssets: assets.length,
        });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Event Handlers] ❌ Failed to update media.json:', error);
    }

    if (assetBrowser && typeof assetBrowser.addAssets === 'function') {
      assetBrowser.addAssets(processedAssets);
    }
  }

  const stats = data?.stats;
  if (stats) {
    updateLoadingText(
      `Scanned: ${stats.scannedPages || 0}/${stats.totalPages || 0} pages, Found: ${stats.totalAssets || 0} assets`,
    );
    updateScanProgressHeader(stats.scannedPages || 0, stats.totalPages || 0);
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

  // eslint-disable-next-line no-console
  console.log('🔍 [SCAN] Starting document scanning...', {
    totalPages: data?.stats?.totalPages || 0,
    forceRescan: data?.forceRescan || false,
  });

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

  const { stats } = data;
  if (stats) {
    const percent = stats.totalPages > 0 ? Math.round((stats.scannedPages / stats.totalPages) * 100) : 0;

    // eslint-disable-next-line no-console
    console.log('✅ [SCAN] Scanning complete:', {
      scannedPages: stats.scannedPages || 0,
      totalPages: stats.totalPages || 0,
      totalAssets: stats.totalAssets || 0,
      percent: `${percent}%`,
      status: data.status || 'completed',
    });

    if (stats.totalAssets === 0 && assets.length === 0) {
      showEmptyState();
      showScanIndicator(100, 'complete');
    } else {
      const grid = document.getElementById('assetsGrid');
      if (grid) grid.style.display = '';
      showScanIndicator(percent, 'complete');
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
  const { stats } = data;
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
      const {
        new: newDocs, changed, unchanged, toScan, skipped,
      } = data.incrementalStats;
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
