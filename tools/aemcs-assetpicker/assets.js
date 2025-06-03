/* eslint-disable no-undef */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Helper function to load external scripts
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Configuration cache
const CONFS = {};

// Fetch configuration from DA Live
async function fetchConf(path) {
  if (CONFS[path]) {
    return CONFS[path];
  }

  try {
    const { context } = await DA_SDK;
    const configUrl = `https://content.da.live/${context.org}/${context.repo}/.da/config.json`;
    const response = await fetch(configUrl);

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const data = json.data || [];

    if (!data) {
      return null;
    }

    CONFS[path] = data;
    return data;
  } catch (error) {
    return null;
  }
}

// Get a specific configuration value
async function fetchValue(path, key) {
  if (CONFS[path]?.[key]) {
    return CONFS[path][key];
  }

  const data = await fetchConf(path);
  if (!data) {
    return null;
  }

  const confKey = data.find((conf) => conf.key === key);
  if (!confKey) {
    return null;
  }

  return confKey.value;
}

// Get configuration key for owner and repo
async function getConfKey(owner, repo, key) {
  const path = 'config';
  const value = await fetchValue(path, key);
  return value;
}

// Transform Scene7 URL to include /is/image/ for DM S7 links
function transformDms7Url(originalUrl, dms7Options = '') {
  if (!originalUrl) {
    return originalUrl;
  }

  const urlParts = originalUrl.split('/');
  const domainIndex = urlParts.findIndex((part) => part.includes('scene7.com'));

  if (domainIndex !== -1) {
    urlParts.splice(domainIndex + 1, 0, 'is', 'image');
    return urlParts.join('/') + dms7Options;
  }
  return originalUrl;
}

// Initialize the Asset Selector
async function init() {
  try {
    const { context, token, actions } = await DA_SDK;

    if (!window.PureJSSelectors) {
      const ASSET_SELECTOR_URL = 'https://experience.adobe.com/solutions/CQ-assets-selectors/assets/resources/assets-selectors.js';
      await loadScript(ASSET_SELECTOR_URL);
    }

    const container = document.getElementById('asset-selector-container');
    if (!container) {
      return;
    }

    const owner = context.org || '';
    const repo = context.repo || '';

    const repositoryId = await getConfKey(owner, repo, 'aem.repositoryId') || '';

    // Check if repositoryId is empty and show configuration message
    if (!repositoryId) {
      // Use the template from HTML
      const template = document.getElementById('config-error-template');
      const configErrorContent = template.content.cloneNode(true);

      // Set the config URL
      const configUrlElement = configErrorContent.querySelector('#config-url');
      if (configUrlElement) {
        configUrlElement.textContent = `https://content.da.live/${owner}/${repo}/.da/config.json`;
      }

      container.appendChild(configErrorContent);
      return;
    }

    const aemTierType = repositoryId.includes('delivery') ? 'delivery' : 'author';
    const useDms7Links = await getConfKey(owner, repo, 'aem.assets.image.type') === 'dms7link';
    const dms7Options = useDms7Links ? (await getConfKey(owner, repo, 'aem.assets.dm.options') || '') : '';

    const selectorProps = {
      imsToken: token,
      repositoryId,
      aemTierType,
      handleSelection: (assets) => {
        let scene7ErrorShown = false;
        assets.forEach((asset) => {
          if (asset.type === 'folder') {
            return;
          }

          const assetUrl = asset.path || asset.href || asset.downloadUrl || asset.url;
          const scene7Url = asset['repo:dmScene7Url'];
          if (!scene7Url) {
            if (!scene7ErrorShown) {
              if (actions?.sendHTML) {
                actions.sendHTML(`DM url is not available for the asset <b>"${assetUrl}" </b>. Please cross check DM renditions at <a href="https://${repositoryId}/${assetUrl}">${repositoryId}</a> and retry once DM url is available.`);
              }
              if (actions?.closeLibrary) {
                actions.closeLibrary();
              }
              scene7ErrorShown = true;
            }
            return;
          }
          if (!assetUrl) {
            return;
          }

          let finalUrl = assetUrl;

          if (useDms7Links && scene7Url) {
            finalUrl = transformDms7Url(scene7Url, dms7Options);
          }

          const assetName = asset.name || asset.title || asset.label || finalUrl.split('/').pop();
          const assetHtml = `<a href="${finalUrl}" class="asset">${assetName}</a>`;

          if (actions?.sendHTML) {
            actions.sendHTML(assetHtml);
            actions.closeLibrary();
          }
        });
      },
      config: {
        selection: {
          allowFolderSelection: false,
          allowMultiSelection: true,
        },
      },
    };

    window.PureJSSelectors.renderAssetSelector(container, selectorProps);
    window.DA_TOKEN = token;
  } catch (error) {
    const container = document.getElementById('asset-selector-container');

    // Use the error template from HTML
    const template = document.getElementById('error-message-template');
    const errorContent = template.content.cloneNode(true);

    // Set the error message
    const errorMessageElement = errorContent.querySelector('#error-message-text');
    if (errorMessageElement) {
      errorMessageElement.textContent = error.message;
    }

    container.appendChild(errorContent);
  }
}

init();
