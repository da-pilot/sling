import { createTag, loadScript } from '../../scripts/utils.js';

function normalizeConfigKeys(config) {
  const normalized = {};
  Object.keys(config).forEach((key) => {
    normalized[key.trim().toLowerCase()] = config[key];
  });
  return normalized;
}

async function normalizeConfigValue(val, fallback) {
  if (Array.isArray(val)) {
    if (val[0].startsWith('/aemedge/fragments')) {
      const url = `${window.location.protocol}//${window.location.host}${val[0]}`;
      const resp = await fetch(`${url}.plain.html`);
      if (resp.ok) {
        const html = await resp.text();
        const temp = document.createElement('html');
        temp.innerHTML = html;
        const body = temp.querySelector('body');
        return body ? body.innerHTML : html;
      }
      return fallback;
    }
    return val.join(' ');
  }
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (val.trim() === '') return fallback;
    if (val.includes('/aemedge/fragments')) {
      const [firstPath] = val.trim().split(' ');
      const url = `${window.location.protocol}//${window.location.host}${firstPath}`;
      const resp = await fetch(`${url}.plain.html`);
      if (resp.ok) {
        const html = await resp.text();
        const temp = document.createElement('html');
        temp.innerHTML = html;
        const body = temp.querySelector('body');
        return body ? body.innerHTML : html;
      }
      return fallback;
    }
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
  block.querySelectorAll(':scope > div:not([id])').forEach((row) => {
    if (row.children) {
      const cols = [...row.children];
      if (cols[1]) {
        const name = toPropName(cols[0].textContent).toLowerCase().trim();
        const col = cols[1];
        let value = '';
        if (col.querySelector('img')) {
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
        config[name] = value;
      }
    }
  });

  return config;
}

export default async function decorate(block) {
  let config = await readBlockConfigForAccountForm(block);
  config = normalizeConfigKeys(config);
  const props = {
    testId: await normalizeConfigValue(config['test-id'], 'account-form-adobe-commerce'),
    cartSubCategory: await normalizeConfigValue(config['cart-sub-category'], 'simple-shop'),
    showZipField: await normalizeConfigValue(config['show-zip-field'], true),
    legalDisclaimerText: await normalizeConfigValue(config['legal-disclaimer-text'], 'New customers age 18+ only. We may contact you about Sling Television services. See <a href="https://www.sling.com/privacy" target="_blank">privacy policy</a> and <a href="https://www.sling.com/offer-details/disclaimers/terms-of-use" target="_blank">terms of use</a>.'),
    ctaButtonText: await normalizeConfigValue(config['cta-button-text'], 'Continue'),
    ctaSupportedBrowserDestinationURL: await normalizeConfigValue(config['cta-supported-browser-destination-url'], 'http://watch.sling.com'),
    ctaUnsupportedBrowserDestinationURL: await normalizeConfigValue(config['cta-unsupported-browser-destination-url'], 'http://www.sling.com/free14/confirmation'),
    baseRedirectUrl: await normalizeConfigValue(config['base-redirect-url'], '/'),
    planIdentifier: await normalizeConfigValue(config['plan-identifier'], 'monthly'),
    resuPlanIdentifier: await normalizeConfigValue(config['resu-plan-identifier'], 'one-stair-step'),
    classificationIdentifier: await normalizeConfigValue(config['classification-identifier'], 'us'),
    offerDetailsContent: await normalizeConfigValue(config['offer-details-content'], "I'm the offer details modal content"),
    createUserPath: await normalizeConfigValue(config['create-user-path'], 'https://authorization-gateway.q.sling.com/ums/v5/user?hydrate_auth2_token=true'),
    createUserHostName: await normalizeConfigValue(config['create-user-host-name'], 'authorization-gateway.q.sling.com'),
    analyticsUIEventName: await normalizeConfigValue(config['analytics-uievent-name'], 'continue'),
    analyticsUIEventParent: await normalizeConfigValue(config['analytics-uievent-parent'], 'cart-account'),
    analyticsUIEventTarget: await normalizeConfigValue(config['analytics-uievent-target'], 'cart-products'),
    analyticsViewEventName: await normalizeConfigValue(config['analytics-viewevent-name'], 'cart_step_account'),
    analyticsViewEventPageName: await normalizeConfigValue(config['analytics-viewevent-page-name'], '/cart/magento/account'),
    analyticsViewEventUserPackageName: await normalizeConfigValue(config['analytics-viewevent-user-package-name'], 'domestic'),
    analyticsViewEventUserSubType: await normalizeConfigValue(config['analytics-viewevent-user-sub-type'], 'active'),
    existingAccountOverlayMessage: await normalizeConfigValue(config['existing-account-overlay-message'], '<p>Hang tight!</p>'),
    loginUserEndpoint: await normalizeConfigValue(config['login-user-endpoint'], 'https://authorization-gateway.q.sling.com/ums/v5/sessions'),
    modalContentPrivacyPolicy: await normalizeConfigValue(config['modal-content-privacy-policy'], ''),
    modalContentTermsOfUse: await normalizeConfigValue(config['modal-content-terms-of-use'], ''),
    enableBriteVerify: await normalizeConfigValue(config['enable-brite-verify'], false),
    pixelWaitTime: Number(config['pixel-wait-time']) || 800,
    showLoginForm: await normalizeConfigValue(config['show-login-form'], false),
    analyticsModalName: await normalizeConfigValue(config['analytics-modal-name'], 'offer-details-modal'),
    showPartnerRestartForm: await normalizeConfigValue(config['show-partner-restart-form'], false),
    disablePwdEyeIcon: await normalizeConfigValue(config['disable-pwd-eye-icon'], false),
    focusEmail: await normalizeConfigValue(config['focus-email'], false),
  };

  console.log(props);
  // Create a container for the React component, add props as data attribute
  const container = createTag('div', { id: 'account-form-app', 'data-sling-props': JSON.stringify(props) });
  block.append(container);

  // Load the React build for account-form
  await loadScript('../../../aemedge/scripts/sling-react/account-form-build.js', {}, container);

  // Clean up any divs without IDs first (like base-cards)
  const divsWithoutId = block.querySelectorAll('div:not([id])');
  divsWithoutId.forEach((div) => div.remove());
}