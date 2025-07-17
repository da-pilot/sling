/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Media Library Utilities
 * Common utility functions inspired by DA Live patterns
 */

/**
 * Debounce function calls (from DA Live Utils)
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a promise that resolves after specified delay
 */
function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Create utils module with only used functions
 */
function createUtils() {
  return {
    debounce,
    delay,
  };
}

export { createUtils };

export function getOrgRepo(context) {
  if (context?.org && context?.repo) {
    return { org: context.org, repo: context.repo };
  }
  // Try to get from localStorage using the new key format
  try {
    // If org/repo are known in context, use them
    let org; let repo;
    if (context && context.org && context.repo) {
      org = context.org;
      repo = context.repo;
      const key = `media_${org}_${repo}_ctx`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.org && parsed.repo) {
          return { org: parsed.org, repo: parsed.repo };
        }
      }
    } else {
      // Otherwise, scan for any media_*_ctx key
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('media_') && k.endsWith('_ctx')) {
          const stored = localStorage.getItem(k);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.org && parsed.repo) {
              return { org: parsed.org, repo: parsed.repo };
            }
          }
        }
      }
    }
  } catch (e) {
    // Failed to parse stored context - continue to next fallback
  }
  // Try to extract from current URL
  try {
    const { hostname } = window.location;
    if (hostname.includes('aem.page') || hostname.includes('aem.live')) {
      const parts = hostname.split('--');
      if (parts.length >= 3) {
        const org = parts[2].split('.')[0];
        const repo = parts[1];
        if (org && repo) {
          return { org, repo };
        }
      }
    }
  } catch (e) {
    // URL parsing failed - continue to error
  }
  throw new Error('Unable to determine org and repo');
}
