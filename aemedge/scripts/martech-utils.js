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
} from '../plugins/martech/index.js';

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

export {
  martechEager,
  martechLazy,
  martechDelayed,
  isPersonalizationEnabled,
  getPersonalizationForView,
  applyPersonalization,
  updateUserConsent,
};