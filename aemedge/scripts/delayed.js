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
    console.log('[Delayed.js] Data layer already loaded');
    return false;
  }

  // Load the EDS analytics library (minified for production, full version for dev/staging)
  const isProduction = window.location.hostname.endsWith('.live') || window.location.hostname.includes('sling.com');
  const dataLayerScript = isProduction
    ? '/aemedge/scripts/analytics-lib-eds.min.js'
    : '/aemedge/scripts/analytics-lib-eds.js';

  console.log('[Delayed.js] Loading analytics-lib-eds.js for testing:', dataLayerScript);
  await loadScript(dataLayerScript);

  // Initialize analytics-lib-eds.js with appName
  if (window.analytics && window.analytics.getInstance) {
    console.log('[Delayed.js] Initializing analytics-lib-eds.js with appName: eds-aem-marketing-site');
    // Check if analytics instance already exists (to prevent duplicates from scripts.js)
    if (!window.slingAnalytics) {
      window.slingAnalytics = window.analytics.getInstance('eds-aem-marketing-site');

      // Trigger initial page load to populate data layer
      if (window.slingAnalytics && window.slingAnalytics.screenLoad) {
        console.log('[Delayed.js] Triggering screenLoad event');
        window.slingAnalytics.screenLoad({
          name: window.location.pathname,
          type: 'generic',
        });
      }
    } else {
      console.log('[Delayed.js] Analytics instance already exists, skipping duplicate initialization');
    }
  }

  console.log('[Delayed.js] Analytics-lib-eds.js loaded and initialized');
  return true;
}

// Main delayed loading function
async function loadDelayedAnalytics() {
  // Load Adobe Launch when target metadata is not configured
  const targetEnabled = getMetadata('target');
  console.log('[Delayed.js] Target metadata value:', targetEnabled);
  if (!targetEnabled || targetEnabled.toLowerCase() !== 'true') {
    console.log('[Delayed.js] Loading data layer and Launch via delayed.js (target not explicitly true)');
    // Load data layer utilities BEFORE Adobe Launch
    await loadDataLayerUtils();

    // Load environment-specific Launch scripts to avoid bloating production analytics
    console.log('[Delayed.js] Current host:', window.location.host);
    if (window.location.host.startsWith('localhost')) {
      console.log('[Delayed.js] Loading development Launch script');
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-b69ac51c7dcd-development.min.js');
    } else if (window.location.host.includes('sling.com') || window.location.host.endsWith('.live')) {
      console.log('[Delayed.js] Loading production Launch script');
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-c846c0e0cbc6.min.js');
    } else if (window.location.host.endsWith('.page')) {
      console.log('[Delayed.js] Loading staging Launch script');
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-6367a8aeb307-staging.min.js');
    } else {
      console.log('[Delayed.js] No matching host condition for Launch script');
    }
  }
}

// Execute the delayed loading
loadDelayedAnalytics().catch((error) => {
  console.error('[Delayed.js] Error loading delayed analytics:', error);
});
