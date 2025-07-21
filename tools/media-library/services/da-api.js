/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { crawl } from 'https://da.live/nx/public/utils/tree.js';

/**
 * Create DA API Service using official DA SDK and utilities
 * Handles all interactions with DA Admin API
 */
function createDAApiService() {
  const state = {
    baseUrl: 'https://admin.da.live',
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
    resolveAssetUrl,
    ensureFolder,
    baseUrl: state.baseUrl,
    token: state.token,
    org: state.org,
    repo: state.repo,
  };

  async function init(daContext) {
    if (!daContext) {
      throw new Error('DA context is required');
    }

    state.context = daContext;
    state.org = daContext.org;
    state.repo = daContext.repo;
    state.ref = daContext.ref;
    state.path = daContext.path || '/';
    state.token = daContext.token;

    if (!state.org || !state.repo) {
      throw new Error('This plugin must be opened from within DA Admin.');
    }

    // Only use localStorage if available (not in Web Workers)
    if (typeof localStorage !== 'undefined') {
      const key = `media_${state.org}_${state.repo}_ctx`;
      localStorage.setItem(key, JSON.stringify({
        org: state.org,
        repo: state.repo,
        token: state.token,
      }));
    }

    state.initialized = true;
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

    for (let attempt = 0; attempt < state.maxRetries; attempt++) {
      try {
        const response = await fetch(url, requestOptions);

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '1', 10) * 1000;
          await delay(retryAfter);
          continue;
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
      }
    }
  }

  async function enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - state.lastRequestTime;

    if (timeSinceLastRequest < state.rateLimitDelay) {
      await delay(state.rateLimitDelay - timeSinceLastRequest);
    }

    state.lastRequestTime = Date.now();
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

    const response = await makeRequest(url, {
      method: 'POST',
      headers,
      body,
    });

    return response.json();
  }

  async function deleteFile(path) {
    const url = `${state.baseUrl}/source${path}`;

    const response = await makeRequest(url, {
      method: 'DELETE',
    });

    return response.ok;
  }

  function getConfig() {
    return {
      baseUrl: state.baseUrl,
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

  function resolveAssetUrl(src, baseUrl = null) {
    if (!src) return null;

    if (src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }

    if (src.startsWith('//')) {
      return `https:${src}`;
    }

    if (src.startsWith('/')) {
      const origin = baseUrl || 'https://admin.da.live';
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

  function delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  Object.defineProperties(api, {
    baseUrl: { get: () => state.baseUrl },
    token: { get: () => state.token },
    org: { get: () => state.org },
    repo: { get: () => state.repo },
  });

  return api;
}

export { createDAApiService };
