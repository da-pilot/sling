
/**
 * Event handlers for Media Library atomic operations
 * Handles discovery, scanning, progress tracking, and processing events
 */

/**
 * Handle discovery completion event
 */
export function handleDiscoveryComplete(data, updateLoadingText) {
  // eslint-disable-next-line no-console
  console.log('[Event Handlers] Discovery complete:', {
    totalDocuments: data.totalDocuments,
    discoveredDocuments: data.discoveredDocuments,
    timestamp: new Date().toISOString(),
  });

  if (updateLoadingText) {
    updateLoadingText(`Discovery complete: ${data.discoveredDocuments} documents found`);
  }
}

/**
 * Handle page scanned event
 */
export function handlePageScanned(
  data,
  media,
  mediaBrowser,
  metadataManager,
  processScanResults,
  updateLoadingText,
  updateScanProgressHeader,
) {
  // eslint-disable-next-line no-console
  console.log('[Event Handlers] Page scanned:', {
    pagePath: data.pagePath,
    mediaCount: data.mediaCount,
    timestamp: new Date().toISOString(),
  });

  if (updateLoadingText) {
    updateLoadingText(`Scanned: ${data.pagePath} (${data.mediaCount} media)`);
  }

  if (updateScanProgressHeader) {
    updateScanProgressHeader(data.scanned, data.total);
  }

  // Process scan results if available
  if (data.media && data.media.length > 0 && processScanResults) {
    processScanResults(data.media);
  }
}

/**
 * Handle scanning started event
 */
export function handleScanningStarted(
  data,
  isScanning,
  showScanProgress,
  updateLoadingText,
  updateScanProgressHeader,
) {
  // eslint-disable-next-line no-console
  console.log('[Event Handlers] Scanning started:', {
    sessionId: data.sessionId,
    totalPages: data.totalPages,
    timestamp: new Date().toISOString(),
  });

  if (showScanProgress) {
    showScanProgress();
  }

  if (updateLoadingText) {
    updateLoadingText(`Scanning started: ${data.totalPages} pages to process`);
  }

  if (updateScanProgressHeader) {
    updateScanProgressHeader(0, data.totalPages);
  }
}

/**
 * Handle scanning stopped event
 */
export function handleScanningStopped(data, media, isScanning, hideScanProgress) {
  // eslint-disable-next-line no-console
  console.log('[Event Handlers] Scanning stopped:', {
    sessionId: data.sessionId,
    totalMedia: data.totalMedia,
    timestamp: new Date().toISOString(),
  });

  if (hideScanProgress) {
    hideScanProgress();
  }
}

/**
 * Handle queue size update event
 */
export function handleQueueSizeUpdate(data, updateScanProgressHeader) {
  // eslint-disable-next-line no-console
  console.log('[Event Handlers] Queue size update:', {
    queueSize: data.queueSize,
    processed: data.processed,
    total: data.total,
    timestamp: new Date().toISOString(),
  });

  if (updateScanProgressHeader) {
    updateScanProgressHeader(data.processed, data.total);
  }
}

/**
 * Handle worker error event
 */
export function handleWorkerError(error) {
  // eslint-disable-next-line no-console
  console.error('[Event Handlers] Worker error:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle resuming from queue event
 */
export function handleResumingFromQueue(data, updateLoadingText) {
  // eslint-disable-next-line no-console
  console.log('[Event Handlers] Resuming from queue:', {
    sessionId: data.sessionId,
    remainingItems: data.remainingItems,
    timestamp: new Date().toISOString(),
  });

  if (updateLoadingText) {
    updateLoadingText(`Resuming scan: ${data.remainingItems} items remaining`);
  }
}

/**
 * Handle documents skipped event
 */
export function handleDocumentsSkipped(data, updateLoadingText) {
  // eslint-disable-next-line no-console
  console.log('[Event Handlers] Documents skipped:', {
    skippedCount: data.skippedCount,
    reason: data.reason,
    timestamp: new Date().toISOString(),
  });

  if (updateLoadingText) {
    updateLoadingText(`Skipped ${data.skippedCount} documents: ${data.reason}`);
  }
}