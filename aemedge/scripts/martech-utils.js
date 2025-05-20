/* eslint-disable import/no-relative-packages */
/* eslint-disable import/no-unresolved */
/*
 * martech-personalization.js
 * Unified utility for martech initialization, consent, personalization lifecycle,
 * and DOM/block observer/rebinding for personalization blocks.
 * Exports everything scripts.js needs for martech and personalization.
 */

import {
  initMartech,
  updateUserConsent,
  martechEager,
  martechLazy,
  martechDelayed,
  isPersonalizationEnabled,
  getPersonalizationForView,
  applyPersonalization,
  pushToDataLayer,
  pushEventToDataLayer,
} from '../plugins/martech/src/index.js';

// --- Martech Config ---
const DEFAULT_ALLOY_CONFIG = {
  orgId: 'C8F3055362AB2C450A495E69@AdobeOrg', // ACS Sandbox
  datastreamId: 'cce7e9e9-6e47-4b10-b74d-0e16cb8d3f01',
  defaultConsent: 'in',
  onBeforeEventSend: (payload) => {
    const dlState = window.adobeDataLayer?.getState
      ? window.adobeDataLayer.getState()
      : window.adobeDataLayer?.[0];
    payload.xdm = {
      ...payload.xdm,
      ...dlState,
    };
  },
  edgeConfigOverrides: {},
};

const DEFAULT_MARTECH_CONFIG = {
  analytics: true,
  alloyInstanceName: 'alloy',
  dataLayer: true,
  dataLayerInstanceName: 'adobeDataLayer',
  includeDataLayerState: true,
  launchUrls: ['https://assets.adobedtm.com/b571b7f9ddbe/d2cb1fb5f7cb/launch-9faa83378e20-development.min.js'],
  personalization: true,
  performanceOptimized: true,
  personalizationTimeout: 1000,
};

export const martechLoadedPromise = initMartech(
  DEFAULT_ALLOY_CONFIG,
  DEFAULT_MARTECH_CONFIG,
);

// Consent event handler
function consentEventHandler(ev) {
  const collect = ev.detail.categories.includes('CC_ANALYTICS') || true;
  const marketing = ev.detail.categories.includes('CC_MARKETING') || true;
  const personalize = ev.detail.categories.includes('CC_TARGETING') || true;
  const share = ev.detail.categories.includes('CC_SHARING') || true;
  updateUserConsent({
    collect, marketing, personalize, share,
  });
}
window.addEventListener('consent', consentEventHandler);

// --- Block Observer & Personalization DOM Utilities ---
export const blocksToObserve = [
  'carousel',
  'accordion',
  'tabs',
  'modal',
  'image-slider',
  'game-finder',
  'channel-lookup',
  'chat',
  'marquee',
  'offer-cards',
  'channel-shopper',
  'category',
];

export const blocksNeedingRebind = new Set();

export function isHeaderOrFooter(el) {
  let parent = el.parentElement;
  while (parent) {
    if (parent.tagName === 'HEADER' || parent.tagName === 'FOOTER') return true;
    parent = parent.parentElement;
  }
  return false;
}

export function rebindFlaggedBlocks() {
  blocksNeedingRebind.forEach((el) => {
    const blockType = el.getAttribute('data-block-name')
      || blocksToObserve.find((blockName) => el.classList.contains(blockName)
        || (el.classList.contains('block') && el.classList.contains(blockName)));
    if (blockType) {
      const importPath = window.hlx?.codeBasePath
        ? `${window.hlx.codeBasePath}/blocks/${blockType}/${blockType}.js`
        : `/aemedge/blocks/${blockType}/${blockType}.js`;
      import(importPath)
        .then((module) => {
          if (module.rebindEvents) {
            module.rebindEvents(el);
            el.setAttribute('data-bound', 'true');
            if (el.hasAttribute('data-rebind')) {
              el.removeAttribute('data-rebind');
            }
          }
        })
        .catch(() => {
          const altImportPath = `../blocks/${blockType}/${blockType}.js`;
          import(altImportPath)
            .then((module) => {
              if (module.rebindEvents) {
                module.rebindEvents(el);
                el.setAttribute('data-bound', 'true');
                if (el.hasAttribute('data-rebind')) {
                  el.removeAttribute('data-rebind');
                }
              }
            })
            .catch(() => {
              // Handle error silently
            });
        });
    }
  });
  blocksNeedingRebind.clear();
}

export function setupBlockObserver() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE
              || (node.parentElement
               && (node.parentElement.tagName === 'HEADER'
                || node.parentElement.tagName === 'FOOTER'))) {
            return;
          }
          const nodesToCheck = [node];
          if (node.querySelectorAll) {
            node.querySelectorAll('.block').forEach((descendant) => {
              nodesToCheck.push(descendant);
            });
          }
          nodesToCheck.forEach((el) => {
            if (isHeaderOrFooter(el)) return;
            const isObservedBlock = el.classList
              && blocksToObserve.some((blockName) => el.classList.contains(blockName)
                || (el.classList.contains('block') && el.classList.contains(blockName)));
            if (isObservedBlock) {
              blocksNeedingRebind.add(el);
            }
          });
        });
      }
    });
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  setTimeout(() => {
    observer.disconnect();
  }, 10000);
}

export function handleTargetSections(doc) {
  const main = doc.querySelector('main');
  main.querySelectorAll(':scope > div.section').forEach((section) => {
    const childSection = section.querySelector('div.section');
    if (childSection) {
      const parentFragmentId = section.getAttribute('data-fragment-id');
      const childFragmentId = childSection.getAttribute('data-fragment-id');
      if (parentFragmentId && childFragmentId && parentFragmentId === childFragmentId) {
        section.replaceWith(childSection);
      }
    }
  });
}

// Add XDM mapping utility for page load
function mapPageLoadToXDM(params) {
  return {
    eventType: params.eventType || 'web.webpagedetails.pageViews',
    web: {
      webPageDetails: {
        url: params.url,
        name: params.pageName,
        domain: params.server,
        siteSection: params.siteSection,
        type: params.siteSubSection,
        language: params.language,
        pName: params.pName,
        pURL: params.pURL,
      },
      user: {
        ecid: params.ecid,
        guid: params.guid,
        dma: params.dma,
        accountStatus: params.accountStatus,
        authState: params.authenticatedState,
      },
      platform: params.platform,
      currentChannel: params.currentChannel,
      _sling: {
        appName: 'aem-marketing-site',
        analyticsVersion: '7.0.38',
      },
    },
    zipcode: params.zipcode,
    selectedLanguage: params.selectedLanguage,
    screenLoadFired: true,
  };
}

// Utility to gather all page/user/environment info for analytics
function getPageLoadParams() {
  // Helper to get cookie value
  const getCookieValue = (name) => {
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match ? match[2] : '';
  };
  // Helper to get localStorage value
  const getLocalStorage = (key) => {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  };
  // Determine siteSection and siteSubSection from URL or other logic
  let siteSection = '';
  let siteSubSection = '';
  const url = window.location.href;
  if (url.includes('/whatson')) {
    siteSection = 'domestic';
    siteSubSection = 'blog';
  } else if (url.includes('/help')) {
    siteSection = 'domestic';
    siteSubSection = 'help';
  } else if (url === `${window.location.origin}/`) {
    siteSection = 'domestic';
    siteSubSection = 'home';
  } else {
    siteSection = 'domestic';
    siteSubSection = 'generic';
  }
  return {
    ecid: getCookieValue('AMCV_9425401053CD40810A490D4C@AdobeOrg'),
    url,
    pageName: document.title,
    server: window.location.hostname,
    siteSection,
    siteSubSection,
    language: document.documentElement.lang || 'en',
    pName: getCookieValue('pPage'),
    pURL: getCookieValue('pURL'),
    guid: getLocalStorage('sling_user_guid'),
    dma: getLocalStorage('user_dma'),
    accountStatus: getLocalStorage('account_status'),
    authenticatedState: 'logged_out', // Update if you have auth logic
    platform: 'web', // or 'mobile' if you have logic for this
    currentChannel: getCookieValue('aaMC'),
    zipcode: getLocalStorage('user_zip'),
    selectedLanguage: document.documentElement.lang || 'en',
  };
}

// --- Personalization (Target) Event Rules ---
export function setupPersonalizationEventRules() {
  // Listen for zipcode updates and trigger Target event
  document.addEventListener('zipupdate', (e) => {
    console.log('[DEBUG]setupPersonalizationEventRules: zipupdate received', e.detail);
    const { zipcode } = e.detail;
    pushEventToDataLayer(
      'zipcode-update',
      {
        web: {
          user: {
            zipcode,
          },
        },
      },
      {
        __adobe: {
          target: {
            zipcode,
          },
        },
      },
    );
    console.log('pushEventToDataLayer called for zipcode', zipcode);
  });

  // Listen for local channel availability (after API call)
  document.addEventListener('localchannels-available', (e) => {
    console.log('setupPersonalizationEventRules: localchannels-available received', e.detail);
    const { zipcode, channels } = e.detail;
    pushEventToDataLayer(
      'localchannels-available',
      {
        web: {
          user: {
            zipcode,
          },
        },
        localChannels: channels, // XDM extension for local channel info
      },
      {
        __adobe: {
          target: {
            zipcode,
            localChannels: channels,
          },
        },
      },
    );
    console.log('pushEventToDataLayer called for localchannels', zipcode, channels);
  });
}

// --- Analytics Event Rules (scaffold for future expansion) ---
export function setupAnalyticsEventRules() {
  // Listen for a custom analytics event: pageview
  document.addEventListener('pageview', () => {
    const params = getPageLoadParams();
    const xdm = mapPageLoadToXDM(params);
    pushToDataLayer({ xdm });
  });
}

export {
  martechEager,
  martechLazy,
  martechDelayed,
  isPersonalizationEnabled,
  getPersonalizationForView,
  applyPersonalization,
  updateUserConsent,
  pushToDataLayer,
  getPageLoadParams,
  mapPageLoadToXDM,
  pushEventToDataLayer,
};