/* eslint-disable no-use-before-define */
/**
 * Persistence Manager - Handles IndexedDB storage operations for media library
 * Provides persistent storage for media metadata, scan progress, and batch processing
 * Uses IndexedDB for better performance and larger storage capacity
 */

export default function createPersistenceManager() {
  const state = {
    dbName: 'MediaLibraryDB',
    dbVersion: 1, // Use consistent version
    db: null,
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
   * Delete existing database
   */
  async function deleteDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(state.dbName);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        console.error('[IndexedDB] ❌ Error deleting database:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Initialize IndexedDB database with data clearing
   */
  async function init() {
    try {
      if (!window.indexedDB) {
        throw new Error('IndexedDB is not available');
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open(state.dbName, state.dbVersion);

        request.onerror = () => {
          console.error('[IndexedDB] ❌ Database opening failed:', request.error);

          if (request.error.name === 'VersionError') {
            console.warn('[IndexedDB] ⚠️ Version conflict detected, deleting and recreating database');
            deleteDatabase()
              .then(() => {
                init().then(resolve).catch(reject);
              })
              .catch((deleteError) => {
                console.error('[IndexedDB] ❌ Failed to delete database:', deleteError);
                reject(request.error);
              });
          } else {
            reject(request.error);
          }
        };

        request.onsuccess = () => {
          state.db = request.result;

          // Clear all data but keep schema
          clearAllData()
            .then(() => {
              resolve(true);
            })
            .catch((clearError) => {
              console.error('[IndexedDB] ❌ Error clearing data:', clearError);
              resolve(true);
            });
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          Object.values(state.stores).forEach((storeName) => {
            if (!db.objectStoreNames.contains(storeName)) {
              const store = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
              store.createIndex('createdAt', 'createdAt', { unique: false });
              store.createIndex('sessionId', 'sessionId', { unique: false });
            }
          });
        };
      });
    } catch (error) {
      console.error('[IndexedDB] ❌ Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * Clear all data from all stores (keep schema)
   */
  async function clearAllData() {
    if (!state.db) {
      return;
    }

    const clearPromises = Object.values(state.stores).map(
      (storeName) => new Promise((resolve) => {
        const transaction = state.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const clearRequest = store.clear();

        clearRequest.onsuccess = () => {
          resolve();
        };

        clearRequest.onerror = () => {
          console.warn(`[IndexedDB] ⚠️ Could not clear ${storeName}:`, clearRequest.error);
          resolve();
        };
      }),
    );

    await Promise.all(clearPromises);
  }

  /**
   * Get data from IndexedDB store
   */
  async function getStoreData(storeName) {
    return new Promise((resolve, reject) => {
      if (!state.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = state.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        console.error(`[IndexedDB] ❌ Error getting data from ${storeName}:`, request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Save data to IndexedDB store
   */
  async function saveStoreData(storeName, data) {
    return new Promise((resolve, reject) => {
      if (!state.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = state.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);

      // Clear existing data and add new data
      const clearRequest = store.clear();
      clearRequest.onsuccess = () => {
        if (data.length === 0) {
          resolve(true);
          return;
        }

        let completed = 0;
        let hasError = false;

        data.forEach((item) => {
          const addRequest = store.add(item);
          addRequest.onsuccess = () => {
            completed += 1;
            if (completed === data.length && !hasError) {
              resolve(true);
            }
          };
          addRequest.onerror = () => {
            hasError = true;
            console.error(`[IndexedDB] ❌ Error adding item to ${storeName}:`, addRequest.error);
            reject(addRequest.error);
          };
        });
      };

      clearRequest.onerror = () => {
        console.error(`[IndexedDB] ❌ Error clearing ${storeName}:`, clearRequest.error);
        reject(clearRequest.error);
      };
    });
  }

  /**
   * Add single item to store
   */
  async function addToStore(storeName, item) {
    return new Promise((resolve, reject) => {
      if (!state.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = state.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(item);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.error(`[IndexedDB] ❌ Error adding item to ${storeName}:`, request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Queue media for processing
   */
  async function queueMediaForProcessing(media, sessionId) {
    try {
      const queueItem = {
        id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sessionId,
        media,
        status: 'pending',
        createdAt: Date.now(),
      };

      await addToStore(state.stores.mediaProcessingQueue, queueItem);
      return true;
    } catch (error) {
      console.error('[IndexedDB] ❌ Error queuing media for processing:', error);
      return false;
    }
  }

  /**
   * Get processing queue
   */
  async function getProcessingQueue(sessionId = null) {
    try {
      const queue = await getStoreData(state.stores.mediaProcessingQueue);
      if (sessionId) {
        return queue.filter((item) => item.sessionId === sessionId);
      }
      return queue;
    } catch (error) {
      console.error('[IndexedDB] ❌ Error getting processing queue:', error);
      return [];
    }
  }

  /**
   * Create upload batch
   */
  async function createUploadBatch(batchData) {
    try {
      const batch = {
        id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...batchData,
        status: 'pending',
        createdAt: Date.now(),
      };

      await addToStore(state.stores.mediaUploadBatches, batch);
      return true;
    } catch (error) {
      console.error('[IndexedDB] ❌ Error creating upload batch:', error);
      return false;
    }
  }

  /**
   * Get pending batches
   */
  async function getPendingBatches() {
    try {
      const batches = await getStoreData(state.stores.mediaUploadBatches);
      return batches.filter((batch) => batch.status === 'pending');
    } catch (error) {
      console.error('[IndexedDB] ❌ Error getting pending batches:', error);
      return [];
    }
  }

  /**
   * Confirm batch upload
   */
  async function confirmBatchUpload(batchId, data) {
    return new Promise((resolve, reject) => {
      if (!state.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = state.db.transaction([state.stores.mediaUploadBatches], 'readwrite');
      const store = transaction.objectStore(state.stores.mediaUploadBatches);
      const getRequest = store.get(batchId);

      getRequest.onsuccess = () => {
        const batch = getRequest.result;
        if (batch) {
          batch.status = 'completed';
          batch.completedAt = Date.now();
          batch.count = data.count;

          const putRequest = store.put(batch);
          putRequest.onsuccess = () => resolve(true);
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve(false);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Remove batch by ID
   */
  async function removeBatch(batchId) {
    return new Promise((resolve, reject) => {
      if (!state.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      if (!batchId) {
        reject(new Error('Batch ID is required for deletion'));
        return;
      }

      const transaction = state.db.transaction([state.stores.mediaUploadBatches], 'readwrite');
      const store = transaction.objectStore(state.stores.mediaUploadBatches);
      const deleteRequest = store.delete(batchId);

      deleteRequest.onsuccess = () => resolve(true);
      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }

  /**
   * Remove media from processing queue
   */
  async function removeMediaFromProcessingQueue(mediaIds, sessionId) {
    return new Promise((resolve, reject) => {
      if (!state.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = state.db.transaction([state.stores.mediaProcessingQueue], 'readwrite');
      const store = transaction.objectStore(state.stores.mediaProcessingQueue);
      const getRequest = store.getAll();

      getRequest.onsuccess = () => {
        const queue = getRequest.result;
        const updatedQueue = queue.filter((item) => {
          if (item.sessionId === sessionId) {
            const filteredMedia = item.media.filter((media) => !mediaIds.includes(media.id));
            if (filteredMedia.length === 0) {
              return false;
            }
            item.media = filteredMedia;
          }
          return true;
        });

        const clearRequest = store.clear();
        clearRequest.onsuccess = () => {
          if (updatedQueue.length === 0) {
            resolve(true);
            return;
          }

          let completed = 0;
          let hasError = false;

          updatedQueue.forEach((item) => {
            const addRequest = store.add(item);
            addRequest.onsuccess = () => {
              completed += 1;
              if (completed === updatedQueue.length && !hasError) {
                resolve(true);
              }
            };
            addRequest.onerror = () => {
              hasError = true;
              reject(addRequest.error);
            };
          });
        };

        clearRequest.onerror = () => reject(clearRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Save page scan status
   */
  async function savePageScanStatus(data) {
    try {
      return new Promise((resolve, reject) => {
        if (!state.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        const transaction = state.db.transaction([state.stores.pageScanStatus], 'readwrite');
        const store = transaction.objectStore(state.stores.pageScanStatus);
        
        // Use pagePath as unique identifier
        const record = { 
          id: data.pagePath, // Use pagePath as unique key
          ...data, 
          lastUpdated: Date.now() 
        };
        
        const request = store.put(record); // put() adds or updates
        
        request.onsuccess = () => {
          resolve(true);
        };
        
        request.onerror = () => {
          console.error('[IndexedDB] ❌ Error saving page scan status:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('[IndexedDB] ❌ Error saving page scan status:', error);
      throw error;
    }
  }

  /**
   * Save media to storage
   */
  async function saveMedia(mediaArray) {
    try {
      const media = await getStoreData(state.stores.media);
      mediaArray.forEach((item) => {
        const existingIndex = media.findIndex((m) => m.id === item.id);
        if (existingIndex !== -1) {
          media[existingIndex] = { ...media[existingIndex], ...item };
        } else {
          media.push(item);
        }
      });
      await saveStoreData(state.stores.media, media);
    } catch (error) {
      console.error('[IndexedDB] ❌ Error saving media:', error);
    }
  }

  /**
   * Check media by source
   */
  async function checkMediaBySrc(src) {
    try {
      const media = await getStoreData(state.stores.media);
      return media.find((item) => item.src === src);
    } catch (error) {
      console.error('[IndexedDB] ❌ Error checking media by src:', error);
      return null;
    }
  }

  /**
   * Get completed pages by file name
   */
  async function getCompletedPagesByFile(fileName) {
    try {
      const pageStatuses = await getStoreData(state.stores.pageScanStatus);
      return pageStatuses.filter((status) => status.sourceFile === fileName && status.status === 'completed');
    } catch (error) {
      console.error('[IndexedDB] ❌ Error getting completed pages by file:', error);
      return [];
    }
  }

  /**
   * Get all scan results by source file name
   */
  async function getScanResultsBySourceFile(sourceFile) {
    try {
      const pageStatuses = await getStoreData(state.stores.pageScanStatus);
      return pageStatuses.filter((status) => status.sourceFile === sourceFile);
    } catch (error) {
      console.error('[IndexedDB] ❌ Error getting scan results by source file:', error);
      return [];
    }
  }

  /**
   * Clear all data except checkpoints
   */
  async function clearIndexDBExceptCheckpoints() {
    try {
      const storesToClear = [
        state.stores.mediaProcessingQueue,
        state.stores.mediaUploadBatches,
        state.stores.mediaUploadHistory,
      ];

      await Promise.all(storesToClear.map((storeName) => saveStoreData(storeName, [])));
    } catch (error) {
      console.error('[IndexedDB] ❌ Error clearing storage:', error);
    }
  }

  /**
   * Reset database (clear all data)
   */
  async function resetDatabase() {
    try {
      await Promise.all(
        Object.values(state.stores).map((storeName) => saveStoreData(storeName, [])),
      );
    } catch (error) {
      console.error('[IndexedDB] ❌ Error resetting database:', error);
    }
  }

  /**
   * Save discovery checkpoint file
   */
  async function saveDiscoveryCheckpointFile(checkpoint) {
    try {
      const key = `${state.dbName}_discovery_checkpoint`;
      localStorage.setItem(key, JSON.stringify(checkpoint));
    } catch (error) {
      console.error('[IndexedDB] ❌ Error saving discovery checkpoint:', error);
    }
  }

  /**
   * Load all discovery files
   */
  async function loadAllDiscoveryFiles() {
    try {
      const key = `${state.dbName}_discovery_files`;
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('[IndexedDB] ❌ Error loading discovery files:', error);
      return [];
    }
  }

  /**
   * Ensure required folders (no-op for IndexedDB)
   */
  async function ensureRequiredFolders() {
    return true;
  }

  return {
    init,
    deleteDatabase,
    queueMediaForProcessing,
    getProcessingQueue,
    createUploadBatch,
    getPendingBatches,
    confirmBatchUpload,
    removeBatch,
    removeMediaFromProcessingQueue,
    savePageScanStatus,
    saveMedia,
    checkMediaBySrc,
    getCompletedPagesByFile,
    getScanResultsBySourceFile,
    clearIndexDBExceptCheckpoints,
    resetDatabase,
    saveDiscoveryCheckpointFile,
    loadAllDiscoveryFiles,
    ensureRequiredFolders,
    getStoreData,
    saveStoreData,
  };
}