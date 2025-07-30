/* eslint-disable no-use-before-define */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { crawl } from 'https://da.live/nx/public/utils/tree.js';

const ADMIN_DA_LIVE_BASE = 'https://admin.da.live';
const CONTENT_DA_LIVE_BASE = 'https://content.da.live';

/**
 * Create Document Authoring Service using official DA SDK and utilities
 * Handles all interactions with DA Admin API
 */
function createDocAuthoringService() {
  const state = {
    baseUrl: ADMIN_DA_LIVE_BASE,
    contentBaseUrl: CONTENT_DA_LIVE_BASE,
    token: null,
    org: null,
    repo: null,
    context: null,
    daSDK: null,
    rateLimitDelay: 100,
    maxRetries: 3,
    lastRequestTime: 0,
    initialized: false,
  };

  function delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - state.lastRequestTime;

    if (timeSinceLastRequest < state.rateLimitDelay) {
      await delay(state.rateLimitDelay - timeSinceLastRequest);
    }

    state.lastRequestTime = Date.now();
  }

  async function makeRequest(url, options = {}) {
    await enforceRateLimit();

    const defaultOptions = {
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': 'application/json',
      },
    };

    const requestOptions = {
      ...defaultOptions,
      ...options,
      headers: { ...defaultOptions.headers, ...options.headers },
    };

    const attemptRequest = async (attempt) => {
      try {
        const response = await fetch(url, requestOptions);

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '1', 10) * 1000;
          await delay(retryAfter);
          return null; // Indicate retry needed
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        if (attempt === state.maxRetries - 1) {
          throw error;
        }
        await delay(1000 * 2 ** attempt);
        return null; // Indicate retry needed
      }
    };

    const makeRequestWithRetry = async (attempt) => {
      if (attempt >= state.maxRetries) {
        throw new Error('Max retries exceeded');
      }

      const result = await attemptRequest(attempt);
      if (result) {
        return result;
      }

      return makeRequestWithRetry(attempt + 1);
    };

    return makeRequestWithRetry(0);
  }

  async function init(daContext) {
    if (!daContext) {
      throw new Error('DA context is required');
    }

    state.context = daContext;
    state.org = daContext.org;
    state.repo = daContext.repo;
    state.ref = daContext.ref;
    state.path = daContext.path;
    state.token = daContext.token;
    state.baseUrl = daContext.baseUrl || ADMIN_DA_LIVE_BASE;
    state.contentBaseUrl = daContext.contentBaseUrl || CONTENT_DA_LIVE_BASE;

    if (!state.org || !state.repo) {
      throw new Error('This plugin must be opened from within DA Admin.');
    }

    state.initialized = true;
  }

  async function listPath(path = '/') {
    if (!state.org || !state.repo) {
      throw new Error(`Cannot list path: missing org (${state.org}) or repo (${state.repo})`);
    }

    const cleanPath = path.replace(/^\/+|\/+$/g, '') || '';

    if (state.org === undefined || state.repo === undefined) {
      throw new Error(`URL construction failed: org=${state.org}, repo=${state.repo}`);
    }

    const url = `${state.baseUrl}/list/${state.org}/${state.repo}/${cleanPath}`;

    let data;
    try {
      const response = await DA_SDK.daFetch(url, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      data = await response.json();
    } catch (error) {
      const response = await makeRequest(url);
      data = await response.json();
    }

    const items = Array.isArray(data) ? data : data.items || [];
    return items.map((item) => ({
      name: item.name,
      path: item.path,
      ext: item.ext,
      lastModified: item.lastModified,
    }));
  }

  async function getSource(path, ext = 'html') {
    const url = `${state.baseUrl}/source${path}${ext ? `.${ext}` : ''}`;

    const response = await makeRequest(url);
    return response.text();
  }

  async function saveFile(path, content, contentType = 'application/json') {
    console.log('[DA API] 💾 Starting saveFile operation:', {
      path,
      contentType,
      contentLength: typeof content === 'string' ? content.length : 'object',
      url: `${state.baseUrl}/source${path}`,
    });

    const url = `${state.baseUrl}/source${path}`;

    let body;
    const headers = { Authorization: `Bearer ${state.token}` };

    if (contentType === 'application/json') {
      body = JSON.stringify(content);
      headers['Content-Type'] = 'application/json';
    } else {
      const formData = new FormData();
      formData.append('data', content);
      body = formData;
    }

    console.log('[DA API] 💾 Making request to save file...');
    const response = await makeRequest(url, {
      method: 'POST',
      headers,
      body,
    });

    const result = response.json();
    console.log('[DA API] ✅ File saved successfully:', {
      path,
      status: response.status,
      result,
    });
    return result;
  }

  async function deleteFile(path) {
    const url = `${state.baseUrl}/source${path}`;

    const response = await makeRequest(url, {
      method: 'DELETE',
    });

    return response.ok;
  }

  function getConfig() {
    if (!state.initialized) {
      throw new Error('Doc Authoring Service not initialized');
    }

    if (!state.baseUrl) {
      throw new Error('baseUrl not set in DA context');
    }

    return {
      baseUrl: state.baseUrl,
      contentBaseUrl: state.contentBaseUrl,
      token: state.token,
      org: state.org,
      repo: state.repo,
      ref: state.ref,
      path: state.path,
      context: state.context,
      actions: state.actions,
    };
  }

  function isValidUrl(string) {
    try {
      const url = new URL(string);
      return !!url;
    } catch {
      return false;
    }
  }

  function resolveMediaUrl(src, baseUrl = null) {
    if (!src) return null;

    if (src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }

    if (src.startsWith('//')) {
      return `https:${src}`;
    }

    if (src.startsWith('/')) {
      const origin = baseUrl || ADMIN_DA_LIVE_BASE;
      return `${origin}${src}`;
    }

    return src;
  }

  async function ensureFolder(folderPath) {
    try {
      await listPath(folderPath);
      return true;
    } catch (error) {
      try {
        const url = `${state.baseUrl}/source${folderPath}/.folder`;

        const formData = new FormData();
        formData.append('data', '');

        const response = await makeRequest(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${state.token}` },
          body: formData,
        });
        return response.ok;
      } catch (createError) {
        return false;
      }
    }
  }

  async function crawlFiles(path = '/', callback = null, options = {}) {
    const { concurrent = 10, throttle = 100 } = options;

    const fullPath = `/${state.org}/${state.repo}${path}`;

    const opts = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    };

    const {
      results, getDuration, cancelCrawl, getCallbackErrors,
    } = crawl({
      path: fullPath,
      callback,
      concurrent,
      throttle,
      ...opts,
    });

    const files = await results;
    const duration = getDuration();
    const errors = getCallbackErrors();

    return {
      files, duration, errors, cancelCrawl,
    };
  }

  async function getAllHTMLFiles(path = '/') {
    const htmlFiles = [];

    const callback = (file) => {
      if (file.ext === 'html') {
        if (typeof file.lastModified === 'undefined') {
          return;
        }
        htmlFiles.push({
          name: file.name,
          path: file.path,
          lastModified: file.lastModified,
        });
      }
    };

    const { files } = await crawlFiles(path, callback, { throttle: 50 });

    return htmlFiles.length > 0 ? htmlFiles : files.filter((f) => f.ext === 'html');
  }

  const api = {
    init,
    listPath,
    getSource,
    saveFile,
    deleteFile,
    getConfig,

    crawlFiles,
    getAllHTMLFiles,
    isValidUrl,
    resolveMediaUrl,
    ensureFolder,
    baseUrl: state.baseUrl,
    token: state.token,
    org: state.org,
    repo: state.repo,
  };

  Object.defineProperties(api, {
    baseUrl: { get: () => state.baseUrl },
    token: { get: () => state.token },
    org: { get: () => state.org },
    repo: { get: () => state.repo },
  });

  return api;
}

export default createDocAuthoringService;
