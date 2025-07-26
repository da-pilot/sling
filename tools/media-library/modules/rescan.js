import createSelectiveRescan from './selective-rescan.js';

let selectiveRescan = null;

async function initSelectiveRescan(
  docAuthoringService,
  sessionManager,
  processingStateManager,
  scanStatusManager,
) {
  try {
    selectiveRescan = createSelectiveRescan();
    await selectiveRescan.init(
      docAuthoringService,
      sessionManager,
      processingStateManager,
      scanStatusManager,
    );
    return selectiveRescan;
  } catch (error) {
    console.error('Failed to initialize selective rescan:', error);
    throw error;
  }
}

function getSelectiveRescan() {
  return selectiveRescan;
}

async function handleSelectiveRescan(operation, data) {
  if (!selectiveRescan) {
    console.warn('Selective rescan not initialized');
    return undefined;
  }

  try {
    switch (operation) {
      case 'rescanPage':
        return await selectiveRescan.rescanPage(data.pagePath);
      case 'rescanFolder':
        return await selectiveRescan.rescanFolder(data.folderPath);
      case 'rescanMedia':
        return await selectiveRescan.rescanMedia(data.mediaId);
      default:
        console.warn(`Unknown selective rescan operation: ${operation}`);
        return undefined;
    }
  } catch (error) {
    console.error(`Selective rescan operation failed: ${operation}`, error);
    throw error;
  }
}

export { initSelectiveRescan, getSelectiveRescan, handleSelectiveRescan };
