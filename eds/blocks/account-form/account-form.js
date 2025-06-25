import {
  createTag, loadScript, decodeAmpersand, rewriteLinksForSlingDomain,
} from '../../scripts/utils.js';

function normalizeConfigKeys(config) {
  const normalized = {};
  Object.keys(config).forEach((key) => {
    normalized[key.trim().toLowerCase()] = config[key];
  });
  return normalized;
}

async function normalizeConfigValue(val, fallback, key) {
  // Special keys that require fetching .plain.html if value is a hyperlink or contains an <a href>
  const htmlFetchKeys = [
    'modal-content-terms-of-use',
    'modal-content-privacy-policy',
    'offer-details-content',
  ];

  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (val.trim() === '') return fallback;

    // If the key matches and value contains an <a href>, extract the href and fetch .plain.html
    if (key && htmlFetchKeys.includes(key) && val.includes('<a ')) {
      try {
        const match = val.match(/<a [^>]*href=["']([^"']+)["']/i);
        if (match && match[1]) {
          let href = match[1];
          // If relative path, convert to absolute
          if (href.startsWith('/')) {
            href = `${window.location.protocol}//${window.location.host}${href}`;
          }
          const url = href.endsWith('.html') ? href.replace(/\.html$/, '.plain.html') : `${href}.plain.html`;
          const resp = await fetch(url);
          if (resp.ok) {
            const html = await resp.text();
            const temp = document.createElement('html');
            temp.innerHTML = html;
            const body = temp.querySelector('body');
            return body ? body.innerHTML : html;
          }
          return fallback;
        }
      } catch (e) {
        return fallback;
      }
    }

    // If the key matches and value is a direct hyperlink, fetch .plain.html
    if (
      key
      && htmlFetchKeys.includes(key)
      && (val.startsWith('http://') || val.startsWith('https://'))
    ) {
      try {
        const url = val.endsWith('.html') ? val.replace(/\.html$/, '.plain.html') : `${val}.plain.html`;
        const resp = await fetch(url);
        if (resp.ok) {
          const html = await resp.text();
          const temp = document.createElement('html');
          temp.innerHTML = html;
          const body = temp.querySelector('body');
          return body ? body.innerHTML : html;
        }
        return fallback;
      } catch (e) {
        return fallback;
      }
    }

    if (/^\/.+/.test(val)) {
      return `https://www.sling.com${val}`;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.join(' ');
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
    testId: await normalizeConfigValue(config['test-id'], 'account-form-adobe-commerce', 'test-id'),
    cartSubCategory: await normalizeConfigValue(config['cart-sub-category'], 'simple-shop', 'cart-sub-category'),
    showZipField: await normalizeConfigValue(config['show-zip-field'], true, 'show-zip-field'),
    legalDisclaimerText: await normalizeConfigValue(config['legal-disclaimer-text'], 'New customers age 18+ only. We may contact you about Sling Television services. See <a href="https://www.sling.com/privacy" target="_blank">privacy policy</a> and <a href="https://www.sling.com/offer-details/disclaimers/terms-of-use" target="_blank">terms of use</a>.', 'legal-disclaimer-text'),
    ctaButtonText: await normalizeConfigValue(config['cta-button-text'], 'Continue', 'cta-button-text'),
    ctaSupportedBrowserDestinationURL: await normalizeConfigValue(decodeAmpersand(config['cta-supported-browser-destination-url']), 'http://watch.sling.com', 'cta-supported-browser-destination-url'),
    ctaUnsupportedBrowserDestinationURL: await normalizeConfigValue(decodeAmpersand(config['cta-unsupported-browser-destination-url']), 'http://www.sling.com/free14/confirmation', 'cta-unsupported-browser-destination-url'),
    baseRedirectUrl: await normalizeConfigValue(config['base-redirect-url'], '/', 'base-redirect-url'),
    planIdentifier: await normalizeConfigValue(config['plan-identifier'], 'monthly', 'plan-identifier'),
    resuPlanIdentifier: await normalizeConfigValue(config['resu-plan-identifier'], 'one-stair-step', 'resu-plan-identifier'),
    classificationIdentifier: await normalizeConfigValue(config['classification-identifier'], 'us', 'classification-identifier'),
    offerDetailsContent: await normalizeConfigValue(config['offer-details-content'], "I'm the offer details modal content", 'offer-details-content'),
    createUserPath: await normalizeConfigValue(config['create-user-path'], 'https://authorization-gateway.q.sling.com/ums/v5/user?hydrate_auth2_token=true', 'create-user-path'),
    createUserHostName: await normalizeConfigValue(config['create-user-host-name'], 'authorization-gateway.q.sling.com', 'create-user-host-name'),
    analyticsUIEventName: await normalizeConfigValue(config['analytics-uievent-name'], 'continue', 'analytics-uievent-name'),
    analyticsUIEventParent: await normalizeConfigValue(config['analytics-uievent-parent'], 'cart-account', 'analytics-uievent-parent'),
    analyticsUIEventTarget: await normalizeConfigValue(config['analytics-uievent-target'], 'cart-products', 'analytics-uievent-target'),
    analyticsViewEventName: await normalizeConfigValue(config['analytics-viewevent-name'], 'cart_step_account', 'analytics-viewevent-name'),
    analyticsViewEventPageName: await normalizeConfigValue(config['analytics-viewevent-page-name'], '/cart/magento/account', 'analytics-viewevent-page-name'),
    analyticsViewEventUserPackageName: await normalizeConfigValue(config['analytics-viewevent-user-package-name'], 'domestic', 'analytics-viewevent-user-package-name'),
    analyticsViewEventUserSubType: await normalizeConfigValue(config['analytics-viewevent-user-sub-type'], 'active', 'analytics-viewevent-user-sub-type'),
    existingAccountOverlayMessage: await normalizeConfigValue(config['existing-account-overlay-message'], '<p>Hang tight!</p>', 'existing-account-overlay-message'),
    loginUserEndpoint: await normalizeConfigValue(config['login-user-endpoint'], 'https://authorization-gateway.q.sling.com/ums/v5/sessions', 'login-user-endpoint'),
    modalContentPrivacyPolicy: await normalizeConfigValue(config['modal-content-privacy-policy'], '', 'modal-content-privacy-policy'),
    modalContentTermsOfUse: await normalizeConfigValue(config['modal-content-terms-of-use'], '', 'modal-content-terms-of-use'),
    enableBriteVerify: await normalizeConfigValue(config['enable-brite-verify'], false, 'enable-brite-verify'),
    pixelWaitTime: Number(config['pixel-wait-time']) || 800,
    showLoginForm: await normalizeConfigValue(config['show-login-form'], false, 'show-login-form'),
    analyticsModalName: await normalizeConfigValue(config['analytics-modal-name'], 'offer-details-modal', 'analytics-modal-name'),
    showPartnerRestartForm: await normalizeConfigValue(config['show-partner-restart-form'], false, 'show-partner-restart-form'),
    disablePwdEyeIcon: await normalizeConfigValue(config['disable-pwd-eye-icon'], false, 'disable-pwd-eye-icon'),
    focusEmail: await normalizeConfigValue(config['focus-email'], false, 'focus-email'),
    heading: await normalizeConfigValue(config.heading, '', 'heading'),
    emailPlaceholder: 'username@domain.com',
  };

  // Render heading if present
  if (props.heading) {
    const headingEl = document.createElement('h2');
    headingEl.className = 'account-form-heading';
    headingEl.innerHTML = props.heading;
    block.prepend(headingEl);
  }

  // Create a container for the React component, add props as data attribute
  const container = createTag('div', { id: 'account-form-app', 'data-sling-props': JSON.stringify(props) });
  block.append(container);

  // Patch cart links for sling.com redirection
  rewriteLinksForSlingDomain(container, /^\/cart/);

  // IntersectionObserver to lazy-load React app
  const options = { threshold: 0.25 };
  const observer = new IntersectionObserver(async (entries, obs) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      await loadScript('../../../eds/scripts/sling-react/account-form-build.js', {}, container);

      // Ensure email placeholder is set correctly after React component loads
      setTimeout(() => {
        const emailInput = container.querySelector('input[name="email"]');
        if (emailInput) {
          emailInput.placeholder = props.emailPlaceholder;
        }

        // Also set the placeholder value on the email label
        const emailLabel = container.querySelector('label[data-test-id*="email-field-text-field-label"]');
        if (emailLabel) {
          emailLabel.setAttribute('placeholder', props.emailPlaceholder);

          // Copy classes from zip field label to email label
          const zipLabel = container.querySelector('label[data-test-id*="zip-field-text-field-label"]');
          if (zipLabel) {
            emailLabel.className = zipLabel.className;
          }
        }
      }, 100);

      obs.unobserve(container);
    }
  }, options);

  observer.observe(container);

  // Clean up any divs without IDs first (like base-cards)
  const divsWithoutId = block.querySelectorAll('div:not([id])');
  divsWithoutId.forEach((div) => div.remove());
}