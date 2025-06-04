import { createTag, loadScript } from '../../scripts/utils.js';

function normalizeConfigKeys(config) {
  const normalized = {};
  Object.keys(config).forEach((key) => {
    normalized[key.trim().toLowerCase()] = config[key];
  });
  return normalized;
}

function normalizeConfigValue(val, fallback) {
  if (Array.isArray(val)) {
    // Join array elements into a single string, separated by space
    return val.join(' ');
  }
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (val.trim() === '') return fallback;
    return val;
  }
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null) return fallback;
  return val;
}

function toPropName(name) {
  return typeof name === 'string'
    ? name
      .replace(/[^0-9a-z]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    : '';
}

async function readBlockConfigForAccountForm(block) {
  const config = {};
  const promises = [];
  block.querySelectorAll(':scope > div:not([id])').forEach((row) => {
    if (row.children) {
      const cols = [...row.children];
      if (cols[1]) {
        const name = toPropName(cols[0].textContent).toLowerCase().trim();
        const col = cols[1];
        let value = '';
        const links = Array.from(col.querySelectorAll('a'));
        if (
          name === 'legal-disclaimer-text'
          && links.length === 1
          && links[0].getAttribute('href').includes('/modals')
        ) {
          const modalUrl = links[0].getAttribute('href');
          const p = fetch(`${modalUrl}.plain.html`).then(async (resp) => {
            if (resp.ok) {
              const modalHtml = await resp.text();
              config[name] = modalHtml;
            } else {
              config[name] = links[0].outerHTML;
            }
          }).catch(() => {
            config[name] = links[0].outerHTML;
          });
          promises.push(p);
          return;
        }
        const onlyLinks = col.childNodes.length > 0 && Array.from(col.childNodes)
          .every((node) => (
            (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A')
            || (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === '')
          ));
        if (onlyLinks) {
          value = links
            .map((a) => a.outerHTML)
            .join(' ');
        } else if (col.querySelector('a')) {
          value = col.innerHTML;
        } else if (col.querySelector('img')) {
          const imgs = [...col.querySelectorAll('img')];
          if (imgs.length === 1) {
            value = imgs[0].src;
          } else {
            value = imgs.map((img) => img.src);
          }
        } else if (col.querySelector('p')) {
          const ps = [...col.querySelectorAll('p')];
          if (ps.length === 1) {
            value = ps[0].innerHTML;
          } else {
            value = ps.map((p) => p.textContent);
          }
        } else value = row.children[1].textContent;

        // Only legal-disclaimer-text gets modal inlining; for others, just assign value
        config[name] = value;
      }
    }
  });
  if (promises.length) await Promise.all(promises);
  return config;
}

export default async function decorate(block) {
  // Read config from markup
  let config = await readBlockConfigForAccountForm(block);
  config = normalizeConfigKeys(config);
  console.log(config);

  // Build props object for the React component with defaults
  const props = {
    testId: normalizeConfigValue(config['test-id'], 'account-form-adobe-commerce'),
    cartSubCategory: normalizeConfigValue(config['cart-sub-category'], 'simple-shop'),
    showZipField: normalizeConfigValue(config['show-zip-field'], true),
    legalDisclaimerText: normalizeConfigValue(config['legal-disclaimer-text'], 'New customers age 18+ only. We may contact you about Sling Television services. See <a href="https://www.sling.com/privacy" target="_blank">privacy policy</a> and <a href="https://www.sling.com/offer-details/disclaimers/terms-of-use" target="_blank">terms of use</a>.'),
    ctaButtonText: normalizeConfigValue(config['cta-button-text'], 'Continue'),
    ctaSupportedBrowserDestinationURL: normalizeConfigValue(config['cta-supported-browser-destination-url'], 'http://watch.q.sling.com'),
    ctaUnsupportedBrowserDestinationURL: normalizeConfigValue(config['cta-unsupported-browser-destination-url'], 'http://www.q.sling.com/free14/confirmation'),
    baseRedirectUrl: normalizeConfigValue(config['base-redirect-url'], '/'),
    planIdentifier: normalizeConfigValue(config['plan-identifier'], 'monthly'),
    resuPlanIdentifier: normalizeConfigValue(config['resu-plan-identifier'], 'one-stair-step'),
    classificationIdentifier: normalizeConfigValue(config['classification-identifier'], 'us'),
    offerDetailsContent: normalizeConfigValue(config['offer-details-content'], "I'm the offer details modal content"),
    createUserPath: normalizeConfigValue(config['create-user-path'], 'https://authorization-gateway.q.sling.com/ums/v5/user?hydrate_auth2_token=true'),
    createUserHostName: normalizeConfigValue(config['create-user-host-name'], 'authorization-gateway.q.sling.com'),
    analyticsUIEventName: normalizeConfigValue(config['analytics-uievent-name'], 'continue'),
    analyticsUIEventParent: normalizeConfigValue(config['analytics-uievent-parent'], 'cart-account'),
    analyticsUIEventTarget: normalizeConfigValue(config['analytics-uievent-target'], 'cart-products'),
    analyticsViewEventName: normalizeConfigValue(config['analytics-viewevent-name'], 'cart_step_account'),
    analyticsViewEventPageName: normalizeConfigValue(config['analytics-viewevent-page-name'], '/cart/magento/account'),
    analyticsViewEventUserPackageName: normalizeConfigValue(config['analytics-viewevent-user-package-name'], 'domestic'),
    analyticsViewEventUserSubType: normalizeConfigValue(config['analytics-viewevent-user-sub-type'], 'active'),
    existingAccountOverlayMessage: normalizeConfigValue(config['existing-account-overlay-message'], '<p>Hang tight!</p>'),
    loginUserEndpoint: normalizeConfigValue(config['login-user-endpoint'], 'https://authorization-gateway.q.sling.com/ums/v5/sessions'),
    modalContentPrivacyPolicy: normalizeConfigValue(config['modal-content-privacy-policy'], "I'm the privacy policy modal content"),
    modalContentTermsOfUse: normalizeConfigValue(config['modal-content-terms-of-use'], "I'm the terms of use modal content"),
    enableBriteVerify: normalizeConfigValue(config['enable-brite-verify'], false),
    pixelWaitTime: Number(config['pixel-wait-time']) || 800,
    showLoginForm: normalizeConfigValue(config['show-login-form'], false),
    analyticsModalName: normalizeConfigValue(config['analytics-modal-name'], 'offer-details-modal'),
    showPartnerRestartForm: normalizeConfigValue(config['show-partner-restart-form'], false),
    disablePwdEyeIcon: normalizeConfigValue(config['disable-pwd-eye-icon'], false),
    focusEmail: normalizeConfigValue(config['focus-email'], false),
  };

  // Create a container for the React component, add props as data attribute
  const container = createTag('div', { id: 'account-form-app', 'data-sling-props': JSON.stringify(props) });
  block.append(container);

  // Load the React build for account-form
  await loadScript('../../../aemedge/scripts/sling-react/account-form-build.js', {}, container);

  // Clean up any divs without IDs first (like base-cards)
  const divsWithoutId = block.querySelectorAll('div:not([id])');
  divsWithoutId.forEach((div) => div.remove());
}