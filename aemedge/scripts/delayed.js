// eslint-disable-next-line import/no-cycle

import { loadScript, getMetadata } from './aem.js';

/**
 * Lightweight environment detection for delayed loading
 * @returns {boolean} true if production environment
 */
function isProduction() {
  const { hostname } = window.location;
  return hostname.includes('sling.com') || hostname.includes('.aem.live');
}

/**
 * Loads data layer utilities if not already loaded
 * @returns {Promise<boolean>} - True if loaded, false if already exists
 */
async function loadDataLayerUtils() {
  // Check if already loaded
  if (window.adobeDataLayer && window.adobeDataLayer.version) {
    return false;
  }

  const dataLayerScript = isProduction()
    ? '/aemedge/scripts/datalayer-utils.min.js'
    : '/aemedge/scripts/datalayer-utils.js';

  await loadScript(dataLayerScript);
  return true;
}

// Load Adobe Launch when target metadata is not configured
if (!getMetadata('target')) {
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
