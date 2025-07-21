/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */

const DB_NAME = 'media-library';
const DB_VERSION = 1;
const STORE_NAME = 'assets';
const USAGE_STORE_NAME = 'usage';

class MediaIndexedDB {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the IndexedDB database
   */
  async init() {
    return new Promise((resolve, reject) => {
      // Use indexedDB from the appropriate global context
      const dbInstance = typeof window !== 'undefined' ? window.indexedDB : indexedDB;
      const request = dbInstance.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        const assetsStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        assetsStore.createIndex('type', 'type', { unique: false });
        assetsStore.createIndex('isExternal', 'isExternal', { unique: false });
        assetsStore.createIndex('name', 'name', { unique: false });
        assetsStore.createIndex('src', 'src', { unique: false });
        assetsStore.createIndex('usedIn', 'usedIn', { unique: false });
        assetsStore.createIndex('lastModified', 'lastModified', { unique: false });

        const usageStore = db.createObjectStore(USAGE_STORE_NAME, { keyPath: 'id' });
        usageStore.createIndex('assetId', 'assetId', { unique: false });
        usageStore.createIndex('pagePath', 'pagePath', { unique: false });
        usageStore.createIndex('altText', 'altText', { unique: false });
      };
    });
  }

  /**
   * Store assets in IndexedDB
   */
  async storeAssets(assets) {
    if (!this.isInitialized) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const clearRequest = store.clear();
      clearRequest.onsuccess = () => {
        let completed = 0;
        const total = assets.length;

        assets.forEach((asset, index) => {
          const assetWithTimestamp = {
            ...asset,
            lastModified: Date.now(),
            index: index + 1,
          };

          const request = store.add(assetWithTimestamp);
          request.onsuccess = () => {
            completed++;
            if (completed === total) {
              resolve(assets.length);
            }
          };
          request.onerror = () => reject(request.error);
        });
      };
      clearRequest.onerror = () => reject(clearRequest.error);
    });
  }

  /**
   * Get all assets with optional filtering
   */
  async getAssets(filters = {}) {
    if (!this.isInitialized) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        let assets = request.result;

        if (filters.type) {
          assets = assets.filter((asset) => asset.type === filters.type);
        }
        if (filters.isExternal !== undefined) {
          assets = assets.filter((asset) => asset.isExternal === filters.isExternal);
        }
        if (filters.search) {
          const searchTerm = filters.search.toLowerCase();
          assets = assets.filter((asset) => asset.name?.toLowerCase().includes(searchTerm)
            || asset.alt?.toLowerCase().includes(searchTerm)
            || asset.src?.toLowerCase().includes(searchTerm));
        }
        if (filters.usedIn) {
          assets = assets.filter((asset) => {
            if (!asset.usedIn) return false;

            let usedInArr = [];
            if (Array.isArray(asset.usedIn)) {
              usedInArr = asset.usedIn;
            } else if (typeof asset.usedIn === 'string') {
              usedInArr = asset.usedIn.split(',').map((s) => s.trim());
            }

            return usedInArr.includes(filters.usedIn);
          });
        }

        if (!filters.sortBy) {
          assets.sort((a, b) => (a.index || 0) - (b.index || 0));
        }

        resolve(assets);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Search assets with full-text search
   */
  async searchAssets(searchTerm, options = {}) {
    if (!this.isInitialized) await this.init();

    const assets = await this.getAssets();
    const term = searchTerm.toLowerCase();

    return assets.filter((asset) => {
      const searchableFields = [
        asset.name,
        asset.alt,
        asset.src,
        asset.type,
        asset.usedIn,
      ].filter(Boolean);

      return searchableFields.some((field) => field.toLowerCase().includes(term));
    });
  }

  /**
   * Get assets by folder/page path
   */
  async getAssetsByPath(path) {
    if (!this.isInitialized) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const assets = request.result.filter((asset) => {
          if (!asset.usedIn) return false;

          let usedInArr = [];
          if (Array.isArray(asset.usedIn)) {
            usedInArr = asset.usedIn;
          } else if (typeof asset.usedIn === 'string') {
            usedInArr = asset.usedIn.split(',').map((s) => s.trim());
          }

          return usedInArr.includes(path);
        });
        resolve(assets);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get asset by ID
   */
  async getAssetById(id) {
    if (!this.isInitialized) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get asset statistics
   */
  async getAssetStats() {
    if (!this.isInitialized) await this.init();

    const assets = await this.getAssets();

    return {
      total: assets.length,
      byType: assets.reduce((acc, asset) => {
        acc[asset.type] = (acc[asset.type] || 0) + 1;
        return acc;
      }, {}),
      byExternal: assets.reduce((acc, asset) => {
        const key = asset.isExternal ? 'external' : 'internal';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      unused: assets.filter((asset) => {
        if (!asset.usedIn) return true;
        if (typeof asset.usedIn === 'string') {
          return asset.usedIn.trim() === '';
        }
        if (Array.isArray(asset.usedIn)) {
          return asset.usedIn.length === 0;
        }
        return true;
      }).length,
    };
  }

  /**
   * Clear all data
   */
  async clear() {
    if (!this.isInitialized) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME, USAGE_STORE_NAME], 'readwrite');

      const assetsStore = transaction.objectStore(STORE_NAME);
      const usageStore = transaction.objectStore(USAGE_STORE_NAME);

      const clearAssets = assetsStore.clear();
      const clearUsage = usageStore.clear();

      Promise.all([
        new Promise((res, rej) => {
          clearAssets.onsuccess = res;
          clearAssets.onerror = rej;
        }),
        new Promise((res, rej) => {
          clearUsage.onsuccess = res;
          clearUsage.onerror = rej;
        }),
      ]).then(resolve).catch(reject);
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }
}

const mediaDB = new MediaIndexedDB();

export default mediaDB;