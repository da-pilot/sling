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

export default createUtils;

export function getOrgRepo(context) {
  if (context?.org && context?.repo) {
    return { org: context.org, repo: context.repo };
  }
  try {
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
      for (let i = 0; i < localStorage.length; i += 1) {
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
    // eslint-disable-next-line no-console
    console.error('[Utils] Error getting org and repo:', e);
  }
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
    // eslint-disable-next-line no-console
    console.error('[Utils] Error getting org and repo:', e);
  }
  throw new Error('Unable to determine org and repo');
}
