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
    console.log('[Document Handler] ✅ Initialized with config:', {
      org: config.org,
      repo: config.repo,
    });
  }

  /**
   * Get documents that need scanning from discovery files
   * @param {Array} discoveryFiles - Array of discovery files
   * @param {boolean} forceRescan - Whether to force rescan
   * @returns {Array} Array of documents to scan
   */
  function getDocumentsToScan(discoveryFiles, forceRescan = false) {
    console.log('[Document Handler] 🔍 Analyzing documents for scanning:', {
      fileCount: discoveryFiles.length,
      forceRescan,
    });

    const documentsToScan = [];
    let totalDocuments = 0;
    let alreadyScanned = 0;
    let newDocuments = 0;
    let changedDocuments = 0;
    let needsRescan = 0;
    let missingScanComplete = 0;

    discoveryFiles.forEach((file) => {
      file.documents.forEach((doc) => {
        totalDocuments += 1;

        if (doc.entryStatus === 'deleted') {
          return;
        }

        const hasScanStatus = Object.prototype.hasOwnProperty.call(doc, 'scanStatus');
        const hasScanComplete = Object.prototype.hasOwnProperty.call(doc, 'scanComplete');
        let needsScan = false;
        let scanReason = 'unknown';

        if (forceRescan) {
          needsScan = true;
          scanReason = 'force';
        } else if (hasScanStatus) {
          needsScan = doc.scanStatus === 'pending' || doc.scanStatus === 'failed';
          if (needsScan) {
            scanReason = doc.scanStatus === 'failed' ? 'retry' : 'new';
            if (doc.scanStatus === 'failed') {
              changedDocuments += 1;
            } else {
              newDocuments += 1;
            }
          }
        } else {
          needsScan = !doc.scanComplete || doc.needsRescan;
          if (needsScan) {
            if (!hasScanComplete) {
              scanReason = 'new';
              newDocuments += 1;
            } else if (doc.needsRescan) {
              scanReason = 'changed';
              changedDocuments += 1;
            } else {
              scanReason = 'incomplete';
            }
          }
        }

        if (!hasScanComplete && !hasScanStatus) {
          missingScanComplete += 1;
        }

        if (needsScan) {
          if (!doc.path) {
            console.warn('[Document Handler] ⚠️ Document missing path:', doc);
            return;
          }
          documentsToScan.push({
            ...doc,
            sourceFile: file.fileName,
            scanReason,
          });
        } else {
          alreadyScanned += 1;
        }

        if (doc.needsRescan) {
          needsRescan += 1;
        }
      });
    });

    const scanReasons = documentsToScan.reduce((acc, doc) => {
      acc[doc.scanReason] = (acc[doc.scanReason] || 0) + 1;
      return acc;
    }, {});

    if (documentsToScan.length > 0) {
      console.log('[Document Handler] 📊 Document scanning analysis:', {
        totalDocuments,
        documentsToScan: documentsToScan.length,
        alreadyScanned,
        newDocuments,
        changedDocuments,
        needsRescan,
        missingScanComplete,
        scanReasons,
      });
    }

    return documentsToScan;
  }

  /**
   * Detect changed documents by comparing lastModified timestamps
   * @param {Array} discoveryFiles - Array of discovery files
   * @returns {Object} Object with changed and unchanged counts
   */
  async function detectChangedDocuments(discoveryFiles) {
    console.log('[Document Handler] 🔍 Detecting changed documents...');
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

    console.log('[Document Handler] ✅ Change detection completed:', {
      changedCount,
      unchangedCount,
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
    console.log('[Document Handler] 🔍 [INCREMENTAL] Detecting document-level changes...');
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
    console.log('[Document Handler] 🔍 [INCREMENTAL] Document change detection:', {
      newDocuments: changes.newDocuments.length,
      modifiedDocuments: changes.modifiedDocuments.length,
      deletedDocuments: changes.deletedDocuments.length,
      unchangedDocuments: changes.unchangedDocuments.length,
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
    console.log('[Document Handler] 📄 Adding documents for scanning:', {
      hasDiscoveryFile: !!discoveryFile,
      documentCount: documents ? documents.length : 0,
      documents: documents ? documents.map((d) => ({ path: d.path, name: d.name })) : [],
    });

    if (!discoveryFile || !documents || !Array.isArray(documents)) {
      console.warn('[Document Handler] ⚠️ Invalid parameters for addDocumentsForScanning');
      return;
    }

    // Add documents to the discovery file for processing
    if (!discoveryFile.documents) {
      discoveryFile.documents = [];
    }

    discoveryFile.documents.push(...documents);

    console.log('[Document Handler] ✅ Documents added to discovery file:', {
      totalDocuments: discoveryFile.documents.length,
      addedDocuments: documents.length,
    });
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
    detectChangedDocuments,
    detectIncrementalDocumentChanges,
    addDocumentsForScanning,
    on,
    off,
    emit,
  };
}