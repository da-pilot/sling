// tools/media-library/modules/rescan.js
// Selective rescan functionality for Media Library

import { createSelectiveRescan } from './selective-rescan.js';

let selectiveRescan = null;

/**
 * Initialize selective rescan module
 */
async function initSelectiveRescan(config, queueManager, metadataManager) {
  try {
    selectiveRescan = createSelectiveRescan();
    await selectiveRescan.init(config, queueManager, metadataManager);
    return selectiveRescan;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize selective rescan:', error);
    throw error;
  }
}

/**
 * Get selective rescan instance
 */
function getSelectiveRescan() {
  return selectiveRescan;
}

/**
 * Handle selective rescan operations
 */
async function handleSelectiveRescan(operation, data) {
  if (!selectiveRescan) {
    // eslint-disable-next-line no-console
    console.warn('Selective rescan not initialized');
    return;
  }

  try {
    switch (operation) {
      case 'rescanPage':
        return await selectiveRescan.rescanPage(data.pagePath);
      case 'rescanFolder':
        return await selectiveRescan.rescanFolder(data.folderPath);
      case 'rescanAsset':
        return await selectiveRescan.rescanAsset(data.assetId);
      default:
        // eslint-disable-next-line no-console
        console.warn(`Unknown selective rescan operation: ${operation}`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Selective rescan operation failed: ${operation}`, error);
    throw error;
  }
}

export { initSelectiveRescan, getSelectiveRescan, handleSelectiveRescan };
