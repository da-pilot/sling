/**
 * Queue Document Processor - Handles document processing and queue management
 */
import createEventEmitter from '../../shared/event-emitter.js';

export default function createQueueDocumentProcessor() {
  const eventEmitter = createEventEmitter('Queue Document Processor');
  const state = {
    config: null,
    daApi: null,
  };

  /**
   * Initialize document processor
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API instance
   */
  async function init(config, daApi) {
    state.config = config;
    state.daApi = daApi;
  }

  /**
   * Get documents to scan for incremental discovery
   * @param {Array} discoveryFiles - Array of discovery files
   * @param {Object} incrementalChanges - Incremental changes object
   * @returns {Array} Array of documents to scan
   */
  function getDocumentsToScanIncremental(discoveryFiles, incrementalChanges) {
    const documentsToScan = [];
    const changedPaths = new Set();
    console.log('[Document Handler] 🔍 [INCREMENTAL] Starting incremental document filtering');
    console.log('[Document Handler] 🔍 [INCREMENTAL] Discovery files count:', discoveryFiles.length);
    console.log('[Document Handler] 🔍 [INCREMENTAL] Incremental changes structure:', {
      hasIncrementalChanges: !!incrementalChanges,
      hasExistingFiles: !!(incrementalChanges && incrementalChanges.existingFiles),
      existingFilesCount: incrementalChanges?.existingFiles?.length || 0,
    });
    if (incrementalChanges && incrementalChanges.existingFiles) {
      console.log('[Document Handler] 🔍 [INCREMENTAL] Processing existing files for change detection');
      incrementalChanges.existingFiles.forEach((file, fileIndex) => {
        console.log('[Document Handler] 🔍 [INCREMENTAL] Processing file:', fileIndex, {
          fileName: file.name,
          hasData: !!file.data,
          dataLength: file.data?.length || 0,
        });
        if (file.data && Array.isArray(file.data)) {
          let addedToChangedPaths = 0;
          file.data.forEach((doc) => {
            const { needsRescan, scanStatus, scanComplete } = doc;
            const hasScanComplete = Object.prototype.hasOwnProperty.call(doc, 'scanComplete');
            const shouldAddToChangedPaths = needsRescan || scanStatus === 'pending' || scanStatus === 'failed' || !scanComplete;
            if (shouldAddToChangedPaths) {
              changedPaths.add(doc.path);
              addedToChangedPaths += 1;
              if (addedToChangedPaths <= 3) {
                let reason = 'unknown';
                if (needsRescan) {
                  reason = 'needsRescan';
                } else if (scanStatus === 'pending') {
                  reason = 'pending';
                } else if (scanStatus === 'failed') {
                  reason = 'failed';
                } else {
                  reason = '!scanComplete';
                }
                console.log('[Document Handler] 🔍 [INCREMENTAL] Added to changedPaths:', {
                  path: doc.path,
                  needsRescan,
                  scanStatus,
                  scanComplete,
                  hasScanComplete,
                  reason,
                });
              }
            }
          });
          console.log('[Document Handler] 🔍 [INCREMENTAL] File summary:', {
            fileName: file.name,
            totalDocs: file.data.length,
            addedToChangedPaths,
          });
        }
      });
    }
    console.log('[Document Handler] 🔍 [INCREMENTAL] Changed paths count:', changedPaths.size);
    if (changedPaths.size > 0) {
      console.log('[Document Handler] 🔍 [INCREMENTAL] Sample changed paths:', Array.from(changedPaths).slice(0, 5));
    }
    discoveryFiles.forEach((file, fileIndex) => {
      console.log('[Document Handler] 🔍 [INCREMENTAL] Processing discovery file:', fileIndex, {
        fileName: file.fileName,
        documentsCount: file.documents?.length || 0,
      });
      let fileDocumentsToScan = 0;
      let debugCount = 0;
      file.documents.forEach((doc) => {
        if (doc.entryStatus === 'deleted') {
          return;
        }
        const hasScanStatus = Object.prototype.hasOwnProperty.call(doc, 'scanStatus');
        const hasScanComplete = Object.prototype.hasOwnProperty.call(doc, 'scanComplete');
        if (debugCount < 3) {
          console.log('[Document Handler] 🔍 [INCREMENTAL] Document debug:', {
            path: doc.path,
            hasScanStatus,
            scanStatus: doc.scanStatus,
            hasScanComplete,
            scanComplete: doc.scanComplete,
            needsRescan: doc.needsRescan,
          });
          debugCount += 1;
        }
        let needsScan = false;
        let scanReason = 'unknown';
        if (changedPaths.has(doc.path)) {
          needsScan = true;
          scanReason = 'incremental_change';
        } else if (doc.needsRescan) {
          needsScan = true;
          scanReason = 'changed';
        }
        if (needsScan) {
          if (!doc.path) {
            return;
          }
          fileDocumentsToScan += 1;
          documentsToScan.push({
            ...doc,
            sourceFile: file.fileName,
            scanReason,
          });
        }
      });
      console.log('[Document Handler] 🔍 [INCREMENTAL] File scan summary:', {
        fileName: file.fileName,
        totalDocs: file.documents?.length || 0,
        documentsToScan: fileDocumentsToScan,
      });
    });
    console.log('[Document Handler] 🔍 [INCREMENTAL] Final result:', {
      totalDocumentsToScan: documentsToScan.length,
      scanReasons: documentsToScan.reduce((acc, doc) => {
        acc[doc.scanReason] = (acc[doc.scanReason] || 0) + 1;
        return acc;
      }, {}),
    });
    return documentsToScan;
  }
  /**
   * Get documents to scan
   * @param {Array} discoveryFiles - Array of discovery files
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Array} Array of documents to scan
   */
  function getDocumentsToScan(discoveryFiles, forceRescan = false) {
    if (!discoveryFiles || discoveryFiles.length === 0) {
      return [];
    }
    const documentsToScan = [];
    discoveryFiles.forEach((file) => {
      if (!file.documents || !Array.isArray(file.documents)) {
        return;
      }
      file.documents.forEach((document) => {
        const { scanStatus, scanComplete } = document;
        const hasScanStatus = scanStatus !== undefined;
        const shouldScan = forceRescan || !hasScanStatus || scanStatus === 'pending' || scanStatus === 'failed' || !scanComplete;
        if (shouldScan) {
          documentsToScan.push({
            pagePath: document.path,
            sourceFile: file.fileName,
            scanStatus: scanStatus || 'pending',
            mediaCount: document.mediaCount || 0,
            scanComplete: scanComplete || false,
          });
        }
      });
    });
    return documentsToScan;
  }

  /**
   * Detect changed documents by comparing lastModified timestamps
   * @param {Array} discoveryFiles - Array of discovery files
   * @returns {Object} Object with changed and unchanged counts
   */
  async function detectChangedDocuments(discoveryFiles) {
    let changedCount = 0;
    let unchangedCount = 0;

    discoveryFiles.forEach((file) => {
      file.documents.forEach((doc) => {
        if (doc.lastScanned && doc.lastModified) {
          const lastScannedTime = new Date(doc.lastScanned).getTime();
          const lastModifiedTime = new Date(doc.lastModified).getTime();
          if (lastModifiedTime > lastScannedTime) {
            doc.needsRescan = true;
            changedCount += 1;
          } else {
            doc.needsRescan = false;
            unchangedCount += 1;
          }
        } else {
          doc.needsRescan = true;
          changedCount += 1;
        }
      });
    });

    return { changedCount, unchangedCount };
  }

  /**
   * Detect document-level changes for incremental discovery
   * @param {Array} existingDiscoveryFiles - Existing discovery files from DA
   * @param {Array} currentDiscoveryFiles - Current discovery files from file system
   * @returns {Object} Change detection results
   */
  async function detectIncrementalDocumentChanges(existingDiscoveryFiles, currentDiscoveryFiles) {
    const changes = {
      newDocuments: [],
      modifiedDocuments: [],
      deletedDocuments: [],
      unchangedDocuments: [],
    };
    const existingDocs = new Map();
    const currentDocs = new Map();
    existingDiscoveryFiles.forEach((file) => {
      file.data.forEach((doc) => {
        existingDocs.set(doc.path, { ...doc, sourceFile: file.name });
      });
    });
    currentDiscoveryFiles.forEach((file) => {
      file.documents.forEach((doc) => {
        currentDocs.set(doc.path, { ...doc, sourceFile: file.fileName });
      });
    });
    currentDocs.forEach((currentDoc, path) => {
      const existingDoc = existingDocs.get(path);
      if (!existingDoc) {
        changes.newDocuments.push(currentDoc);
      } else if (currentDoc.lastModified !== existingDoc.lastModified) {
        changes.modifiedDocuments.push({ current: currentDoc, existing: existingDoc });
      } else {
        changes.unchangedDocuments.push(currentDoc);
      }
    });
    existingDocs.forEach((existingDoc, path) => {
      if (!currentDocs.has(path)) {
        changes.deletedDocuments.push(existingDoc);
      }
    });
    return changes;
  }

  /**
   * Add documents for scanning
   * @param {Object} discoveryFile - Discovery file
   * @param {Array} documents - Documents to add
   * @returns {Promise<void>}
   */
  async function addDocumentsForScanning(discoveryFile, documents) {
    if (!discoveryFile || !documents || !Array.isArray(documents)) {
      return;
    }

    // Add documents to the discovery file for processing
    if (!discoveryFile.documents) {
      discoveryFile.documents = [];
    }

    discoveryFile.documents.push(...documents);
  }

  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function on(event, callback) {
    eventEmitter.on(event, callback);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  function off(event, callback) {
    eventEmitter.off(event, callback);
  }

  /**
   * Emit event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  function emit(event, data) {
    eventEmitter.emit(event, data);
  }

  return {
    init,
    getDocumentsToScan,
    getDocumentsToScanIncremental,
    detectChangedDocuments,
    detectIncrementalDocumentChanges,
    addDocumentsForScanning,
    on,
    off,
    emit,
  };
}