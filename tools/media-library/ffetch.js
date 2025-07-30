/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-disable no-restricted-syntax,  no-await-in-loop */

async function* request(url, context) {
  const {
    chunkSize, cacheReload, sheetName, fetch,
  } = context;
  for (let offset = 0, total = Infinity; offset < total; offset += chunkSize) {
    const params = new URLSearchParams(`offset=${offset}&limit=${chunkSize}`);
    if (sheetName) params.append('sheet', sheetName);
    const resp = await fetch(`${url}?${params.toString()}`, { cache: cacheReload ? 'reload' : 'default' });
    if (resp.ok) {
      const json = await resp.json();
      total = json.total;
      context.total = total;
      for (const entry of json.data) yield entry;
    } else {
      return;
    }
  }
}

// Operations:

function withFetch(upstream, context, fetch) {
  context.fetch = fetch;
  return upstream;
}

function withHtmlParser(upstream, context, parseHtml) {
  context.parseHtml = parseHtml;
  return upstream;
}
function withAuth(upstream, context, token) {
  const authenticatedFetch = (url, options = {}) => {
    const headers = { ...options.headers };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return window.fetch(url, { ...options, headers });
  };
  context.fetch = authenticatedFetch;
  return upstream;
}

function chunks(upstream, context, chunkSize) {
  context.chunkSize = chunkSize;
  return upstream;
}

function sheet(upstream, context, sheetName) {
  context.sheetName = sheetName;
  return upstream;
}

async function all(upstream) {
  const result = [];
  for await (const entry of upstream) {
    result.push(entry);
  }
  return result;
}

async function first(upstream) {
  /* eslint-disable-next-line no-unreachable-loop */
  for await (const entry of upstream) {
    return entry;
  }
  return null;
}

// Helper

function assignOperations(generator, context) {
  // operations that return a new generator
  const operations = {
  };

  // functions that either return the upstream generator or no generator at all
  const functions = {
    chunks: chunks.bind(null, generator, context),
    all: all.bind(null, generator, context),
    first: first.bind(null, generator, context),
    withFetch: withFetch.bind(null, generator, context),
    withHtmlParser: withHtmlParser.bind(null, generator, context),
    withAuth: withAuth.bind(null, generator, context),
    sheet: sheet.bind(null, generator, context),
  };

  Object.assign(generator, operations, functions);
  Object.defineProperty(generator, 'total', { get: () => context.total });
  return generator;
}

export default function ffetch(url) {
  let chunkSize = 255;
  let cacheReload = false;
  const fetch = (...rest) => window.fetch.apply(null, rest);
  const parseHtml = (html) => new window.DOMParser().parseFromString(html, 'text/html');

  try {
    if ('connection' in window.navigator && window.navigator.connection.saveData === true) {
      // request smaller chunks in save data mode
      chunkSize = 64;
    }
    // detect page reloads and set cacheReload to true
    const entries = performance.getEntriesByType('navigation');
    const reloads = entries.filter((entry) => entry.type === 'reload');
    if (reloads.length > 0) cacheReload = true;
  } catch (e) { /* ignore */ }

  const context = {
    chunkSize, cacheReload, fetch, parseHtml,
  };
  const generator = request(url, context);

  return assignOperations(generator, context);
}