// eslint-disable-next-line import/no-cycle

import { loadScript, getMetadata } from './aem.js';

/**
 * Lightweight environment detection for delayed loading
 * @returns {boolean} true if production environment
 */
// function isProduction() {
//   const { hostname } = window.location;
//   return hostname.includes('sling.com') || hostname.includes('.aem.live');
// }

/**
 * Loads data layer utilities if not already loaded
 * @returns {Promise<boolean>} - True if loaded, false if already exists
 */
async function loadDataLayerUtils() {
  // Check if already loaded
  if (window.adobeDataLayer && window.adobeDataLayer.version) {
    return false;
  }

  // Load the EDS analytics library (minified for production, full version for dev/staging)
  const isProduction = window.location.hostname.endsWith('.live') || window.location.hostname.includes('sling.com');
  const dataLayerScript = isProduction
    ? '/eds/scripts/analytics-lib-eds.min.js'
    : '/eds/scripts/analytics-lib-eds.js';

  await loadScript(dataLayerScript);

  // Initialize analytics-lib-eds.js with appName
  if (window.analytics && window.analytics.getInstance) {
    // Check if analytics instance already exists (to prevent duplicates from scripts.js)
    if (!window.slingAnalytics) {
      window.slingAnalytics = window.analytics.getInstance('eds-aem-marketing-site');

      // Trigger initial page load to populate data layer
      if (window.slingAnalytics && window.slingAnalytics.screenLoad) {
        window.slingAnalytics.screenLoad({
          name: window.location.pathname,
          type: 'generic',
        });
      }
    }
  }
  return true;
}

// Main delayed loading function
async function loadDelayedAnalytics() {
  // Load Adobe Launch when target metadata is not configured
  const targetEnabled = getMetadata('target');
  if (!targetEnabled || targetEnabled.toLowerCase() !== 'true') {
    // Load data layer utilities BEFORE Adobe Launch
    await loadDataLayerUtils();

    // Load environment-specific Launch scripts to avoid bloating production analytics
    if (window.location.host.startsWith('localhost')) {
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-b69ac51c7dcd-development.min.js');
    } else if (window.location.host.includes('sling.com') || window.location.host.endsWith('.live')) {
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-c846c0e0cbc6.min.js');
    } else if (window.location.host.endsWith('.page')) {
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-6367a8aeb307-staging.min.js');
    }
  }
}

// Execute the delayed loading
loadDelayedAnalytics().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[Delayed.js] Error loading delayed analytics:', error);
});
