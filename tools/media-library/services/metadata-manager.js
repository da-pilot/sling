/**
 * Create Metadata Manager
 * Handles metadata storage and retrieval in DA
 */
// DA Sheet Utility (duplicate from state-manager.js for local use)
const DASheetUtilLocal = {
  build(sheetMap, options = {}) {
    const sheetNames = Object.keys(sheetMap);
    if (sheetNames.length === 1 && (!options.forceMultiSheet)) {
      const name = sheetNames[0];
      const sheet = DASheetUtilLocal._stringifySheet(sheetMap[name]);
      return {
        total: sheet.data.length,
        limit: sheet.data.length,
        offset: 0,
        data: sheet.data,
        ':type': 'sheet',
      };
    }
    const out = {};
    for (const name of sheetNames) {
      const sheet = DASheetUtilLocal._stringifySheet(sheetMap[name]);
      out[name] = {
        total: sheet.data.length,
        limit: sheet.data.length,
        offset: 0,
        data: sheet.data,
      };
    }
    out[':version'] = options.version || 3;
    out[':names'] = sheetNames;
    out[':type'] = 'multi-sheet';
    return out;
  },
  parse(json) {
    if (json[':type'] === 'sheet') {
      return {
        data: {
          data: DASheetUtilLocal._parseDataArray(json.data),
        },
      };
    }
    if (json[':type'] === 'multi-sheet') {
      const out = {};
      for (const name of json[':names'] || []) {
        out[name] = {
          data: DASheetUtilLocal._parseDataArray(json[name]?.data || []),
        };
      }
      return out;
    }
    throw new Error('Unknown DA sheet type');
  },
  _stringifySheet(sheet) {
    return {
      ...sheet,
      data: (sheet.data || []).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, v != null ? String(v) : '']),
        ),
      ),
    };
  },
  _parseDataArray(dataArr) {
    return Array.isArray(dataArr) ? dataArr.map((row) => ({ ...row })) : [];
  },
};

function createMetadataManager(daApi, metadataPath) {
  const state = {
    daApi,
    metadataPath,
    cache: null,
    cacheTimestamp: 0,
    cacheTTL: 5 * 60 * 1000,
  };

  const api = {
    getMetadata,
    saveMetadata,
    updateMetadata,
    clearMetadata,
    validateMetadata,
    getAssetStatistics,
    exportMetadata,
    importMetadata,
    createMetadataFile,
    clearCache,
    daApi: state.daApi, // Expose daApi for external access
  };

  async function getMetadata() {
    if (isCacheValid()) {
      return state.cache;
    }

    try {
      const content = await state.daApi.getSource(state.metadataPath, '');

      if (!content || content.trim() === '') {
        // Metadata file doesn't exist, create default
        const defaultMetadata = createDefaultMetadata();
        await saveMetadata(defaultMetadata);
        return defaultMetadata;
      }

      const metadata = JSON.parse(content);
      const validatedMetadata = validateAndMigrateMetadata(metadata);

      updateCache(validatedMetadata);
      return validatedMetadata;
    } catch (error) {
      // Metadata file doesn't exist, create default
      const defaultMetadata = createDefaultMetadata();
      await saveMetadata(defaultMetadata);
      return defaultMetadata;
    }
  }

  function isCacheValid() {
    return state.cache
           && state.cacheTimestamp
           && (Date.now() - state.cacheTimestamp) < state.cacheTTL;
  }

  function updateCache(metadata) {
    state.cache = metadata;
    state.cacheTimestamp = Date.now();
  }

  async function saveMetadata(metadata) {
    try {
      const validatedMetadata = validateMetadata(metadata);
      const jsonContent = JSON.stringify(validatedMetadata, null, 2);

      await ensureMetadataFolder();

      await state.daApi.saveFile(state.metadataPath, jsonContent, 'text/plain');

      updateCache(validatedMetadata);
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to save metadata:', error);
      throw error;
    }
  }

  async function ensureMetadataFolder() {
    const folderPath = state.metadataPath.substring(0, state.metadataPath.lastIndexOf('/'));

    if (folderPath) {
      await state.daApi.ensureFolder(folderPath);
    }
  }

  async function updateMetadata(updates) {
    try {
      const currentMetadata = await getMetadata();

      const updatedMetadata = {
        ...currentMetadata,
        ...updates,
        lastModified: Date.now(),
      };

      return await saveMetadata(updatedMetadata);
    } catch (error) {
      throw new Error(`Failed to update metadata: ${error.message}`);
    }
  }

  async function clearMetadata() {
    try {
      const emptyMetadata = createDefaultMetadata();
      await saveMetadata(emptyMetadata);
      return emptyMetadata;
    } catch (error) {
      throw new Error(`Failed to clear metadata: ${error.message}`);
    }
  }

  function createDefaultMetadata() {
    return {
      ':type': 'sheet',
      ':version': '1.0.0',
      ':sheets': ['config', 'scans', 'assets', 'statistics'],
      config: {
        total: 1,
        offset: 0,
        limit: 1,
        columns: ['version', 'created', 'lastModified', 'lastFullScan', 'scanBatchSize', 'scanDelay'],
        data: [{
          version: '1.0.0',
          created: Date.now(),
          lastModified: Date.now(),
          lastFullScan: null,
          scanBatchSize: 5,
          scanDelay: 100,
        }],
      },
      scans: {
        total: 0,
        offset: 0,
        limit: 1000,
        columns: ['path', 'lastModified', 'lastScanned', 'imageCount'],
        data: [],
      },
      assets: {
        total: 0,
        offset: 0,
        limit: 1000,
        columns: ['id', 'src', 'name', 'type', 'usedIn', 'isExternal'],
        data: [],
      },
      statistics: {
        total: 3,
        offset: 0,
        limit: 3,
        columns: ['metric', 'value', 'lastUpdated'],
        data: [
          {
            metric: 'totalAssets',
            value: 0,
            lastUpdated: Date.now(),
          },
          {
            metric: 'totalScannedFiles',
            value: 0,
            lastUpdated: Date.now(),
          },
          {
            metric: 'lastScanDuration',
            value: 0,
            lastUpdated: Date.now(),
          },
        ],
      },
    };
  }

  function validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return createDefaultMetadata();
    }

    return {
      version: metadata.version || '1.0.0',
      created: metadata.created || Date.now(),
      lastModified: Date.now(),
      lastFullScan: metadata.lastFullScan || null,
      scannedFiles: metadata.scannedFiles || {},
      assets: metadata.assets || {},
      statistics: metadata.statistics || {
        totalAssets: 0,
        totalScannedFiles: 0,
        lastScanDuration: 0,
      },
    };
  }

  function validateAndMigrateMetadata(metadata) {
    const validatedMetadata = validateMetadata(metadata);

    if (!validatedMetadata.scannedFiles) {
      validatedMetadata.scannedFiles = {};
    }

    if (validatedMetadata.assets) {
      Object.keys(validatedMetadata.assets).forEach((assetId) => {
        const asset = validatedMetadata.assets[assetId];
        if (!asset.usedIn || !Array.isArray(asset.usedIn)) {
          asset.usedIn = [];
        }
        if (typeof asset.lastSeen !== 'number') {
          asset.lastSeen = Date.now();
        }
      });
    }

    return validatedMetadata;
  }

  async function getAssetStatistics() {
    const metadata = await getMetadata();
    const assets = Object.values(metadata.assets || {});

    const statistics = {
      totalAssets: assets.length,
      totalScannedFiles: Object.keys(metadata.scannedFiles || {}).length,
      lastScanDuration: metadata.statistics?.lastScanDuration || 0,
    };

    const assetsByType = {};
    let externalAssets = 0;
    let unusedAssets = 0;

    assets.forEach((asset) => {
      assetsByType[asset.type] = (assetsByType[asset.type] || 0) + 1;

      if (asset.isExternal) {
        externalAssets++;
      }

      if (!asset.usedIn || asset.usedIn.length === 0) {
        unusedAssets++;
      }
    });

    const mostUsedAssets = assets
      .filter((asset) => asset.usedIn && asset.usedIn.length > 0)
      .sort((a, b) => b.usedIn.length - a.usedIn.length)
      .slice(0, 10);

    const recentAssets = assets
      .filter((asset) => asset.lastSeen && (Date.now() - asset.lastSeen) < (7 * 24 * 60 * 60 * 1000))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 10);

    return {
      ...statistics,
      assetsByType,
      externalAssets,
      unusedAssets,
      mostUsedAssets,
      recentAssets,
    };
  }

  async function exportMetadata() {
    try {
      const metadata = await getMetadata();
      const exportData = {
        ...metadata,
        exportedAt: Date.now(),
        exportVersion: '1.0.0',
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `da-media-metadata-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return exportData;
    } catch (error) {
      throw new Error(`Failed to export metadata: ${error.message}`);
    }
  }

  async function importMetadata(file) {
    try {
      const content = await readFileAsText(file);
      const importedData = JSON.parse(content);

      validateImportedData(importedData);

      const cleanedData = {
        ...importedData,
        lastModified: Date.now(),
        imported: true,
        importedAt: Date.now(),
      };

      delete cleanedData.exportedAt;
      delete cleanedData.exportVersion;

      return await saveMetadata(cleanedData);
    } catch (error) {
      throw new Error(`Failed to import metadata: ${error.message}`);
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function validateImportedData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid import data: must be a valid JSON object');
    }

    if (!data.version) {
      throw new Error('Invalid import data: missing version field');
    }
  }

  /**
   * Clear the cache to force fresh data fetch
   */
  function clearCache() {
    state.cache = null;
    state.cacheTimestamp = 0;
  }

  /**
   * Create metadata file for a document
   */
  async function createMetadataFile(documentPath, assets) {
    const metadataPath = documentPath.replace(/\.html$/, '.json');

    // Use DASheetUtil to build DA-compliant JSON
    const structure = {
      data: { data: [{ path: documentPath, assets, lastScanned: Date.now() }] },
    };
    const jsonToWrite = DASheetUtilLocal.build(structure);

    try {
      // Create FormData and append the JSON as a file
      const formData = new FormData();
      const jsonBlob = new Blob([JSON.stringify(jsonToWrite)], { type: 'application/json' });
      formData.append('file', jsonBlob, 'data.json');

      const url = `${state.daApi.baseUrl}/source${metadataPath}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.daApi.token}`,
        },
        body: formData,
      });

      if (response.ok) {
        return true;
      }
      const errorText = await response.text();
      // eslint-disable-next-line no-console
      console.error('Error response:', errorText);
      return false;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`❌ Error creating metadata ${metadataPath}:`, error);
      return false;
    }
  }

  return api;
}

export { createMetadataManager };
