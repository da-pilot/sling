/* eslint-disable no-use-before-define */
/**
 * Persistence Manager - Handles local database operations for media library
 * Provides persistent storage for media metadata, scan progress, and batch processing
 */

export default function createPersistenceManager() {
  const state = {
    db: null,
    dbName: 'MediaLibraryDB',
    dbVersion: 3,
    stores: {
      media: 'media',
      scanProgress: 'scanProgress',
      sessions: 'sessions',
      mediaProcessingQueue: 'mediaProcessingQueue',
      mediaUploadBatches: 'mediaUploadBatches',
      mediaUploadHistory: 'mediaUploadHistory',
      pageScanStatus: 'pageScanStatus',
    },
  };

  /**
   * Initialize IndexedDB
   */
  async function init() {
    try {
      state.db = await openDatabase();

      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[IndexedDB] ❌ Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * Open or create database
   */
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(state.dbName, state.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create media store
        if (!db.objectStoreNames.contains(state.stores.media)) {
          const mediaStore = db.createObjectStore(state.stores.media, { keyPath: 'id' });
          mediaStore.createIndex('path', 'path', { unique: true });
          mediaStore.createIndex('type', 'type', { unique: false });
          mediaStore.createIndex('lastModified', 'lastModified', { unique: false });
        }

        // Create scan progress store
        if (!db.objectStoreNames.contains(state.stores.scanProgress)) {
          const progressStore = db.createObjectStore(state.stores.scanProgress, { keyPath: 'sessionId' });
          progressStore.createIndex('status', 'status', { unique: false });
          progressStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        // Create sessions store
        if (!db.objectStoreNames.contains(state.stores.sessions)) {
          const sessionsStore = db.createObjectStore(state.stores.sessions, { keyPath: 'sessionId' });
          sessionsStore.createIndex('userId', 'userId', { unique: false });
          sessionsStore.createIndex('status', 'status', { unique: false });
          sessionsStore.createIndex('lastHeartbeat', 'lastHeartbeat', { unique: false });
        }

        if (!db.objectStoreNames.contains(state.stores.mediaProcessingQueue)) {
          const processingQueueStore = db.createObjectStore(state.stores.mediaProcessingQueue, { keyPath: 'id' });
          processingQueueStore.createIndex('status', 'status', { unique: false });
          processingQueueStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(state.stores.mediaUploadBatches)) {
          const uploadBatchesStore = db.createObjectStore(state.stores.mediaUploadBatches, { keyPath: 'id' });
          uploadBatchesStore.createIndex('batchNumber', 'batchNumber', { unique: false });
          uploadBatchesStore.createIndex('status', 'status', { unique: false });
          uploadBatchesStore.createIndex('sessionId', 'sessionId', { unique: false });
        }

        if (!db.objectStoreNames.contains(state.stores.mediaUploadHistory)) {
          const uploadHistoryStore = db.createObjectStore(state.stores.mediaUploadHistory, { keyPath: 'id' });
          uploadHistoryStore.createIndex('batchId', 'batchId', { unique: false });
          uploadHistoryStore.createIndex('sessionId', 'sessionId', { unique: false });
          uploadHistoryStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(state.stores.pageScanStatus)) {
          const pageScanStatusStore = db.createObjectStore(state.stores.pageScanStatus, { keyPath: 'pageUrl' });
          pageScanStatusStore.createIndex('status', 'status', { unique: false });
          pageScanStatusStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }
      };
    });
  }

  /**
   * Save media items to database
   */
  async function saveMedia(mediaItems) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.media], 'readwrite');
    const store = transaction.objectStore(state.stores.media);

    const promises = mediaItems.map((mediaItem) => new Promise((resolve, reject) => {
      const request = store.put(mediaItem);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));

    await Promise.all(promises);
    return mediaItems.length;
  }

  /**
   * Get media items by criteria
   */
  async function getMedia(criteria = {}) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.media], 'readonly');
    const store = transaction.objectStore(state.stores.media);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        let results = request.result;

        // Apply filters
        if (criteria.type) {
          results = results.filter((item) => item.type === criteria.type);
        }
        if (criteria.path) {
          results = results.filter((item) => item.path.includes(criteria.path));
        }
        if (criteria.lastModified) {
          results = results.filter((item) => item.lastModified >= criteria.lastModified);
        }

        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update media item
   */
  async function updateMedia(mediaId, updates) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.media], 'readwrite');
    const store = transaction.objectStore(state.stores.media);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(mediaId);
      getRequest.onsuccess = () => {
        const existingItem = getRequest.result;
        if (!existingItem) {
          reject(new Error(`Media item with id ${mediaId} not found`));
          return;
        }

        const updatedItem = { ...existingItem, ...updates };
        const putRequest = store.put(updatedItem);
        putRequest.onsuccess = () => resolve(updatedItem);
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete media items
   */
  async function deleteMedia(mediaIds) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.media], 'readwrite');
    const store = transaction.objectStore(state.stores.media);

    const promises = mediaIds.map((mediaId) => new Promise((resolve, reject) => {
      const request = store.delete(mediaId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }));

    await Promise.all(promises);
    return mediaIds.length;
  }

  async function savePageScanStatus(pageData) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }
    const transaction = state.db.transaction([state.stores.pageScanStatus], 'readwrite');
    const store = transaction.objectStore(state.stores.pageScanStatus);
    const pageStatusData = {
      pageUrl: pageData.pagePath,
      sourceFile: pageData.sourceFile,
      scanStatus: pageData.status,
      mediaCount: pageData.mediaCount || 0,
      lastScannedAt: pageData.lastScannedAt || Date.now(),
      sessionId: pageData.sessionId,
      scanAttempts: pageData.scanAttempts || 1,
      scanErrors: pageData.scanErrors || [],
      lastUpdated: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const request = store.put(pageStatusData);
      request.onsuccess = () => resolve(pageStatusData);
      request.onerror = () => reject(request.error);
    });
  }
  async function getPageScanStatus(pageUrl) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }
    const transaction = state.db.transaction([state.stores.pageScanStatus], 'readonly');
    const store = transaction.objectStore(state.stores.pageScanStatus);
    return new Promise((resolve, reject) => {
      const request = store.get(pageUrl);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function getCompletedPagesByFile(sourceFile) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }
    const transaction = state.db.transaction([state.stores.pageScanStatus], 'readonly');
    const store = transaction.objectStore(state.stores.pageScanStatus);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const allPages = request.result;
        const completedPages = allPages.filter((page) => page.sourceFile === sourceFile && page.scanStatus === 'completed');
        resolve(completedPages);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async function getAllPageScanStatus() {
    if (!state.db) {
      throw new Error('Database not initialized');
    }
    const transaction = state.db.transaction([state.stores.pageScanStatus], 'readonly');
    const store = transaction.objectStore(state.stores.pageScanStatus);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function clearPageScanStatus() {
    if (!state.db) {
      throw new Error('Database not initialized');
    }
    const transaction = state.db.transaction([state.stores.pageScanStatus], 'readwrite');
    const store = transaction.objectStore(state.stores.pageScanStatus);
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save scan progress
   */
  async function saveScanProgress(sessionId, progress) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.scanProgress], 'readwrite');
    const store = transaction.objectStore(state.stores.scanProgress);

    const progressData = {
      sessionId,
      ...progress,
      lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const request = store.put(progressData);
      request.onsuccess = () => resolve(progressData);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get scan progress
   */
  async function getScanProgress(sessionId) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.scanProgress], 'readonly');
    const store = transaction.objectStore(state.stores.scanProgress);

    return new Promise((resolve, reject) => {
      const request = store.get(sessionId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save session data
   */
  async function saveSession(sessionId, sessionData) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.sessions], 'readwrite');
    const store = transaction.objectStore(state.stores.sessions);

    const session = {
      sessionId,
      ...sessionData,
      lastHeartbeat: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const request = store.put(session);
      request.onsuccess = () => resolve(session);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get session data
   */
  async function getSession(sessionId) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.sessions], 'readonly');
    const store = transaction.objectStore(state.stores.sessions);

    return new Promise((resolve, reject) => {
      const request = store.get(sessionId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all active sessions
   */
  async function getActiveSessions() {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.sessions], 'readonly');
    const store = transaction.objectStore(state.stores.sessions);
    const index = store.index('status');

    return new Promise((resolve, reject) => {
      const request = index.getAll('active');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all data
   */
  async function clearAll() {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const stores = Object.values(state.stores);
    const transaction = state.db.transaction(stores, 'readwrite');

    const promises = stores.map((storeName) => {
      const store = transaction.objectStore(storeName);
      return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    // eslint-disable-next-line no-console
    console.log('[IndexedDB] 🗑️ All data cleared');
  }

  /**
   * Get database statistics
   */
  async function getStats() {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const stats = {};
    const stores = Object.values(state.stores);

    const promises = stores.map(async (storeName) => {
      const transaction = state.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);

      return new Promise((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => {
          stats[storeName] = request.result;
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    return stats;
  }

  /**
   * Close database connection
   */
  function close() {
    if (state.db) {
      state.db.close();
      state.db = null;
      // eslint-disable-next-line no-console
      console.log('[IndexedDB] 🔒 Database connection closed');
    }
  }

  async function queueMediaForProcessing(mediaArray, sessionId) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.mediaProcessingQueue], 'readwrite');
    const store = transaction.objectStore(state.stores.mediaProcessingQueue);

    const queueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      media: mediaArray,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const request = store.put(queueItem);
      request.onsuccess = () => resolve(queueItem);
      request.onerror = () => reject(request.error);
    });
  }

  async function getProcessingQueue(sessionId) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.mediaProcessingQueue], 'readonly');
    const store = transaction.objectStore(state.stores.mediaProcessingQueue);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result;
        const sessionQueues = sessionId
          ? results.filter((item) => item.sessionId === sessionId)
          : results;
        resolve(sessionQueues);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function createUploadBatch(batchData, sessionId) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.mediaUploadBatches], 'readwrite');
    const store = transaction.objectStore(state.stores.mediaUploadBatches);

    const batchItem = {
      id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      batchNumber: batchData.batchNumber,
      media: batchData.media,
      status: 'pending',
      attempts: 0,
      lastAttempt: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const request = store.put(batchItem);
      request.onsuccess = () => resolve(batchItem);
      request.onerror = () => reject(request.error);
    });
  }

  async function updateBatchStatus(batchId, status, error = null) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.mediaUploadBatches], 'readwrite');
    const store = transaction.objectStore(state.stores.mediaUploadBatches);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(batchId);
      getRequest.onsuccess = () => {
        const existingBatch = getRequest.result;
        if (!existingBatch) {
          reject(new Error(`Batch with id ${batchId} not found`));
          return;
        }

        const updatedBatch = {
          ...existingBatch,
          status,
          error,
          attempts: status === 'failed' ? existingBatch.attempts + 1 : existingBatch.attempts,
          lastAttempt: Date.now(),
          updatedAt: Date.now(),
        };

        const putRequest = store.put(updatedBatch);
        putRequest.onsuccess = () => resolve(updatedBatch);
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async function getPendingBatches(sessionId) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.mediaUploadBatches], 'readonly');
    const store = transaction.objectStore(state.stores.mediaUploadBatches);
    const index = store.index('status');

    return new Promise((resolve, reject) => {
      const request = index.getAll('pending');
      request.onsuccess = () => {
        const results = request.result;
        const filteredBatches = sessionId
          ? results.filter((batch) => batch.sessionId === sessionId)
          : results;
        resolve(
          filteredBatches.sort(
            (a, b) => a.batchNumber - b.batchNumber,
          ),
        );
      };
      request.onerror = () => reject(request.error);
    });
  }
  async function confirmBatchUpload(batchId, uploadedData) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction(
      [state.stores.mediaUploadBatches, state.stores.mediaUploadHistory],
      'readwrite',
    );
    const batchStore = transaction.objectStore(state.stores.mediaUploadBatches);
    const historyStore = transaction.objectStore(state.stores.mediaUploadHistory);

    return new Promise((resolve, reject) => {
      const getRequest = batchStore.get(batchId);
      getRequest.onsuccess = () => {
        const batch = getRequest.result;
        if (!batch) {
          reject(new Error(`Batch with id ${batchId} not found`));
          return;
        }

        const updatedBatch = {
          ...batch,
          status: 'completed',
          updatedAt: Date.now(),
        };

        const historyItem = {
          id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          batchId,
          sessionId: batch.sessionId,
          uploadedData,
          timestamp: Date.now(),
        };

        const batchPutRequest = batchStore.put(updatedBatch);
        const historyPutRequest = historyStore.put(historyItem);

        batchPutRequest.onsuccess = () => {
          historyPutRequest.onsuccess = () => resolve({
            batch: updatedBatch,
            history: historyItem,
          });
          historyPutRequest.onerror = () => reject(historyPutRequest.error);
        };
        batchPutRequest.onerror = () => reject(batchPutRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async function getUploadProgress(sessionId) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction([state.stores.mediaUploadBatches], 'readonly');
    const store = transaction.objectStore(state.stores.mediaUploadBatches);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result;
        const sessionBatches = sessionId
          ? results.filter((batch) => batch.sessionId === sessionId)
          : results;

        const totalBatches = sessionBatches.length;
        const completedBatches = sessionBatches.filter((batch) => batch.status === 'completed').length;
        const failedBatches = sessionBatches.filter((batch) => batch.status === 'failed').length;
        const pendingBatches = sessionBatches.filter((batch) => batch.status === 'pending').length;

        const totalItems = sessionBatches.reduce(
          (sum, batch) => sum + (batch.media?.length || 0),
          0,
        );
        const completedBatchesForUpload = sessionBatches.filter(
          (batch) => batch.status === 'completed',
        );
        const uploadedItems = completedBatchesForUpload.reduce(
          (sum, batch) => sum + (batch.media?.length || 0),
          0,
        );

        resolve({
          totalBatches,
          completedBatches,
          failedBatches,
          pendingBatches,
          totalItems,
          uploadedItems,
          progress: totalBatches > 0 ? (completedBatches / totalBatches) * 100 : 0,
        });
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function clearProcessingQueue() {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    const transaction = state.db.transaction(
      [
        state.stores.mediaProcessingQueue,
        state.stores.mediaUploadBatches,
        state.stores.mediaUploadHistory,
      ],
      'readwrite',
    );
    const queueStore = transaction.objectStore(state.stores.mediaProcessingQueue);
    const batchStore = transaction.objectStore(state.stores.mediaUploadBatches);
    const historyStore = transaction.objectStore(state.stores.mediaUploadHistory);

    const clearQueue = new Promise((resolve, reject) => {
      const request = queueStore.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    const clearBatches = new Promise((resolve, reject) => {
      const request = batchStore.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    const clearHistory = new Promise((resolve, reject) => {
      const request = historyStore.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await Promise.all([clearQueue, clearBatches, clearHistory]);
  }

  async function removeMediaFromProcessingQueue(mediaIds, sessionId) {
    if (!state.db) throw new Error('Database not initialized');

    // Get the items first in a separate transaction
    const allItems = await getProcessingQueue(sessionId);

    // Then process them in a new transaction
    const transaction = state.db.transaction([state.stores.mediaProcessingQueue], 'readwrite');
    const store = transaction.objectStore(state.stores.mediaProcessingQueue);

    const promises = allItems.map((item) => new Promise((resolve, reject) => {
      const remainingMedia = (item.media || []).filter((m) => !mediaIds.includes(m.id));
      if (remainingMedia.length === 0) {
        const deleteRequest = store.delete(item.id);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      } else {
        const putRequest = store.put({ ...item, media: remainingMedia });
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      }
    }));

    await Promise.all(promises);
  }

  return {
    init,
    saveMedia,
    getMedia,
    updateMedia,
    deleteMedia,
    saveScanProgress,
    getScanProgress,
    saveSession,
    getSession,
    getActiveSessions,
    clearAll,
    getStats,
    close,
    queueMediaForProcessing,
    getProcessingQueue,
    createUploadBatch,
    updateBatchStatus,
    getPendingBatches,
    confirmBatchUpload,
    getUploadProgress,
    clearProcessingQueue,
    removeMediaFromProcessingQueue,
    savePageScanStatus,
    getPageScanStatus,
    getCompletedPagesByFile,
    getAllPageScanStatus,
    clearPageScanStatus,
  };
}