export const CONTENT_DA_LIVE_BASE = 'https://content.da.live';
export const ADMIN_DA_LIVE_BASE = 'https://admin.da.live';

export function createWorkerDaApi() {
  let config = null;

  async function init(apiConfig) {
    config = apiConfig;
  }

  async function listPath(path) {
    if (!config) {
      throw new Error('Worker DA API not initialized');
    }

    // Extract the relative path part (remove org/repo prefix if present)
    let relativePath = path;
    const orgRepoPrefix = `/${config.org}/${config.repo}`;

    if (path.startsWith(orgRepoPrefix)) {
      relativePath = path.substring(orgRepoPrefix.length);
    }

    // Clean the path (remove leading/trailing slashes)
    const cleanPath = relativePath.replace(/^\/+|\/+$/g, '') || '';

    const url = `${config.baseUrl}/list/${config.org}/${config.repo}/${cleanPath}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list path: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const items = Array.isArray(data) ? data : data.items || [];
    return items.map((item) => ({
      name: item.name,
      path: item.path,
      ext: item.ext,
      lastModified: item.lastModified,
    }));
  }

  async function fetchPageContent(path) {
    if (!config) {
      throw new Error('Worker DA API not initialized');
    }
    const url = `${config.baseUrl}/source${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get source: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  return {
    init,
    listPath,
    fetchPageContent,
  };
}

export function createWorkerSheetUtils() {
  function buildSingleSheet(rows) {
    return {
      total: rows.length,
      limit: rows.length,
      offset: 0,
      data: rows,
      ':type': 'sheet',
    };
  }

  function parseSheet(json) {
    if (json[':type'] === 'sheet') {
      return {
        data: {
          data: Array.isArray(json.data) ? json.data.map((row) => ({ ...row })) : [],
        },
      };
    }
    if (json[':type'] === 'multi-sheet') {
      const out = {};
      const names = json[':names'] || [];
      names.forEach((name) => {
        out[name] = {
          data: Array.isArray(json[name]?.data) ? json[name].data.map((row) => ({ ...row })) : [],
        };
      });
      return out;
    }
    throw new Error('Unknown DA sheet type');
  }

  async function saveSheetFile(url, sheetData, token, method = 'POST') {
    const formData = new FormData();
    const jsonBlob = new Blob([JSON.stringify(sheetData, null, 2)], { type: 'application/json' });
    formData.append('data', jsonBlob);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to save sheet: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  async function loadSheetFile(url, token, method = 'GET') {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      if (response.status !== 404) {
        // eslint-disable-next-line no-console
        console.warn(`[Worker Sheet Utils] Failed to load sheet: ${response.status} ${response.statusText} - ${url}`);
      }
      throw new Error(`Failed to load sheet: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async function fetchSheetJson(configData, filename) {
    let basePath = '.media';

    if (filename === 'config.json' || filename === 'media.json') {
      basePath = '.media';
    } else if (filename === 'checkpoint.json' || filename === 'session-state.json'
      || filename === 'discovery-progress.json' || filename === 'scanning-progress.json'
      || filename === 'active-sessions.json') {
      basePath = '.media/.processing';
    } else if (filename.endsWith('-scan.json')) {
      basePath = '.media/.scan-status';
    } else {
      basePath = '.media/.pages';
    }

    // Use content.da.live for reading
    const url = `https://content.da.live/${configData.org}/${configData.repo}/${basePath}/${filename}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${configData.token}` },
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  return {
    buildSingleSheet,
    parseSheet,
    saveSheetFile,
    loadSheetFile,
    fetchSheetJson,
  };
}

export function createWorkerStateManager() {
  function sendProgress(data) {
    postMessage({
      type: 'discoveryProgress',
      data: {
        ...data,
        timestamp: new Date().toISOString(),
      },
    });
  }

  function sendComplete(data) {
    postMessage({
      type: 'discoveryComplete',
      data: {
        ...data,
        timestamp: new Date().toISOString(),
      },
    });
  }

  function sendError(error) {
    postMessage({
      type: 'discoveryError',
      data: {
        error: error.message || error,
        timestamp: new Date().toISOString(),
      },
    });
  }

  return {
    sendProgress,
    sendComplete,
    sendError,
  };
}

export const WORKER_CONSTANTS = {
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  BATCH_SIZE: 50,
};