/**
 * Media Library Utilities
 * Common utility functions inspired by DA Live patterns
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

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

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
    // Error getting org and repo
  }
  throw new Error('Unable to determine org and repo');
}
