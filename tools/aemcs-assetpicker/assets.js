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
    const configUrl = `https://main--${context.repo}--${context.org}.aem.page/.da/config.json`;
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

function closeDialog() {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      action: 'triggerCloseButton',
      selector: 'button.primary',
    }, '*');
  }
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
    const aemTierType = repositoryId.includes('delivery') ? 'delivery' : 'author';
    const useDms7Links = await getConfKey(owner, repo, 'aem.assets.image.type') === 'dms7link';
    const dms7Options = useDms7Links ? (await getConfKey(owner, repo, 'aem.assets.dm.options') || '') : '';

    const selectorProps = {
      imsToken: token,
      repositoryId,
      aemTierType,
      onClose: closeDialog,
      handleSelection: (assets) => {
        assets.forEach((asset) => {
          if (asset.type === 'folder') {
            return;
          }

          const assetUrl = asset.path || asset.href || asset.downloadUrl || asset.url;
          const scene7Url = asset['repo:dmScene7Url'];

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

            const infoList = document.querySelector('.info-list');
            if (infoList) {
              const listItem = document.createElement('li');
              listItem.textContent = `Inserted asset link: ${finalUrl}`;
              infoList.appendChild(listItem);
            }
          }
        });

        closeDialog();
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
    document.getElementById('asset-selector-container').innerHTML = `
      <div style="color: red; padding: 20px;">
        Error initializing Asset Selector: ${error.message}
      </div>
    `;
  }
}

init();
