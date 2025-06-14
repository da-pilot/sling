// Adobe Data Layer Utilities for Sling TV EDS Marketing Site
// Simplified version to match production behavior closely

(function () {
  console.log('[DataLayer-Utils] Starting data layer initialization');

  // Adobe Client Data Layer - Core functionality only
  if (window.adobeDataLayer && window.adobeDataLayer.version) {
    console.warn('[DataLayer-Utils] Adobe Client Data Layer already loaded');
    return;
  }

  // Initialize Adobe Data Layer
  console.log('[DataLayer-Utils] Initializing Adobe Data Layer');
  window.adobeDataLayer = window.adobeDataLayer || [];

  /**
   * Core Adobe Data Layer Manager (simplified)
   */
  function initializeDataLayer(options) {
    const dataLayer = options?.dataLayer || [];

    dataLayer.version = '2.0.2';

    // Core data layer methods
    dataLayer.getState = function (path) {
      // Simplified state getter
      // eslint-disable-next-line no-underscore-dangle
      const state = this._state || {};
      return path ? state[path] : { ...state };
    };

    dataLayer.addEventListener = function (event, handler, listenerOptions) {
      // Simplified event listener
      // eslint-disable-next-line no-underscore-dangle
      this._listeners = this._listeners || {};
      // eslint-disable-next-line no-underscore-dangle
      this._listeners[event] = this._listeners[event] || [];
      // eslint-disable-next-line no-underscore-dangle
      this._listeners[event].push({ handler, options: listenerOptions });
    };

    // Enhanced push method
    const originalPush = dataLayer.push;
    dataLayer.push = function (data) {
      // Update internal state
      // eslint-disable-next-line no-underscore-dangle
      this._state = this._state || {};
      if (data && typeof data === 'object' && !data.event) {
        // eslint-disable-next-line no-underscore-dangle
        Object.assign(this._state, data);
      }

      // Call original push
      return originalPush.call(this, data);
    };

    return dataLayer;
  }

  /**
   * Simplified Data Layer Helpers - Only essential functions
   */
  const DataLayerHelpers = {

    // Push initial page data to data layer (matches production structure)
    pushInitialData(appName = 'eds-marketing-site') {
      const data = {
        web: {
          webPageDetails: {
            platform: 'web',
            // eslint-disable-next-line no-underscore-dangle
            _sling: {
              appName,
              analyticsVersion: '7.0.39',
            },
          },
        },
      };
      window.adobeDataLayer.push(data);
    },

    // Push page data to data layer (only when needed)
    pushPageData(pageInfo = {}) {
      const {
        name = window.location.pathname,
        lineOfBusiness = 'domestic',
        classification = 'us',
        type = 'generic',
        lang = 'en',
        domain = window.location.hostname,
        siteSection = lineOfBusiness,
        siteSubSection = classification,
        qsp = '',
        isErrorPage = false,
      } = pageInfo;

      const data = {
        web: {
          webPageDetails: {
            name,
            type,
            qsp,
            language: lang,
            siteSection,
            siteSubSection,
            domain,
            isErrorPage,
            // eslint-disable-next-line no-underscore-dangle
            _sling: {
              lineOfBusiness,
              classification,
              domain,
              appName: 'eds-marketing-site',
            },
          },
        },
      };
      window.adobeDataLayer.push(data);
    },

    // Push screen load event (simplified)
    pushScreenLoad() {
      const data = {
        event: 'screen_load',
        screenLoadFired: true,
        web: {
          currentEvent: 'screen_load',
        },
      };
      window.adobeDataLayer.push(data);
    },

    // Get page data based on URL (simplified)
    getPageData() {
      const { pathname } = window.location;
      const isHomePage = pathname === '/';

      const data = {
        name: isHomePage ? 'home' : pathname,
        type: 'generic',
        lineOfBusiness: 'domestic',
        classification: 'us',
      };

      if (isHomePage) {
        data.type = 'home';
      }

      return data;
    },

    // Cart functions - only for actual cart pages
    pushCartData(cartInfo = {}) {
      const {
        category = 'acquisition',
        subCategory = 'simple-shop',
        referrer = 'unknown',
        planName = 'monthly',
        offerName = '',
        deviceBundle = '',
        subType = 'paid',
        basePreselect = [],
        extrasPreselect = [],
      } = cartInfo;

      const packagePreselect = [...basePreselect, ...extrasPreselect];
      const formattedPackagePreselect = packagePreselect.join('|');

      const data = {
        commerce: {
          cart: {
            // eslint-disable-next-line no-underscore-dangle
            _sling: {
              category,
              subCategory,
              referrer,
              planName,
              offerName,
              deviceBundle,
              subType,
              basePreselect,
              extrasPreselect,
              packagePreselect,
              formattedPackagePreselect,
            },
          },
        },
      };
      window.adobeDataLayer.push(data);
    },

    pushCartStep(stepName = 'account') {
      const eventName = `cart_step_${stepName}`;
      const data = {
        event: eventName,
        web: {
          currentEvent: eventName,
        },
      };
      window.adobeDataLayer.push(data);
    },

    updatePageType(type = 'cart') {
      const data = {
        web: {
          webPageDetails: {
            name: window.location.pathname,
            type,
          },
        },
      };
      window.adobeDataLayer.push(data);
    },
  };

  // Initialize the data layer
  initializeDataLayer({ dataLayer: window.adobeDataLayer });

  // Simplified auto-initialization - only essential data
  setTimeout(async () => {
    console.log('[DataLayer-Utils] Auto-initializing data layer');
    const appName = 'eds-marketing-site';
    const pageData = DataLayerHelpers.getPageData();
    const skipAnalytics = !!document.querySelector('.skipAnalytics');

    // Push initial data
    DataLayerHelpers.pushInitialData(appName);

    if (!skipAnalytics) {
      // Only detect cart for actual cart/checkout pages
      const isActualCartPage = window.location.pathname.includes('/cart')
                               || window.location.pathname.includes('/checkout')
                               || window.location.pathname.includes('/account-form');

      if (isActualCartPage) {
        console.log('[DataLayer-Utils] Cart page detected, pushing cart data');
        DataLayerHelpers.pushCartData();
        DataLayerHelpers.pushCartStep('account');
        DataLayerHelpers.updatePageType('cart');
      }

      // Push basic page data and screen load
      DataLayerHelpers.pushPageData(pageData);
      DataLayerHelpers.pushScreenLoad();
    }
  }, 0);

  // Export for external use
  window.SlingDataLayer = {
    helpers: DataLayerHelpers,
    initialize: initializeDataLayer,
  };
}());