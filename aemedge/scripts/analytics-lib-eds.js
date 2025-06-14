// Streamlined Analytics Library for EDS
// Based on analytics-lib.js but with unnecessary features removed
// Removes: Experience Fragments, React Components, Lazy Loading
// Includes: Core Target functionality for DOM manipulation and flicker prevention

(function () {
  // Version info
  const version = '7.0.38-eds';

  function analyticsWarn(msg) {
    console.warn(`[Analytics-EDS] ${msg}`);
  }

  function analyticsError(msg) {
    console.error(`[Analytics-EDS] ${msg}`);
  }

  // Target functionality constants
  const TARGET_EVENT = 'slingTargetReady';
  const TARGET_HIDER_ID = 'sling-target-hider';

  // Target utility functions
  function addTargetHider() {
    // Use of document.write: javascript cannot locate the body until after this line has executed
    document.write(`<style id="${TARGET_HIDER_ID}" type="text/css">body {visibility: hidden;}</style>`);
  }

  function removeTargetHider() {
    const hiderElement = document.querySelector(`#${TARGET_HIDER_ID}`);
    if (hiderElement) {
      hiderElement.remove();
    }
  }

  function findTarget(id) {
    const target = document.querySelector(`#${id}`);
    if (target && target.classList.contains('container--anchor-hack-child')) {
      return target.closest('.container');
    }
    return target;
  }

  async function deleteContent({ delete: id }) {
    await new Promise((resolve) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve);
      } else {
        resolve();
      }
    });

    const element = document.querySelector(`#${id}`);
    if (element) {
      element.remove();
    }
  }

  async function insertContent({ content, before, after }) {
    await new Promise((resolve) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve);
      } else {
        resolve();
      }
    });

    const targetId = before || after;
    const targetElement = findTarget(targetId);

    if (targetElement && content) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;

      while (tempDiv.firstChild) {
        if (before) {
          targetElement.parentNode.insertBefore(tempDiv.firstChild, targetElement);
        } else {
          targetElement.parentNode.insertBefore(tempDiv.firstChild, targetElement.nextSibling);
        }
      }

      // Trigger event for any React components that might need to initialize
      document.dispatchEvent(new CustomEvent('slingTargetInsert', {
        detail: { targetId, action: before ? 'before' : 'after' },
      }));
    }
  }

  async function replaceContent({ content, replace: id }) {
    await new Promise((resolve) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve);
      } else {
        resolve();
      }
    });

    const targetElement = findTarget(id);

    if (targetElement && content) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;

      // Replace the target element with new content
      const parent = targetElement.parentNode;
      while (tempDiv.firstChild) {
        parent.insertBefore(tempDiv.firstChild, targetElement);
      }
      targetElement.remove();

      // Trigger event for any React components that might need to initialize
      document.dispatchEvent(new CustomEvent('slingTargetInsert', {
        detail: { targetId: id, action: 'replace' },
      }));
    }
  }

  // Target functions registry for EDS
  const targetFunctions = {
    'eds.insertContent': insertContent,
    'eds.replaceContent': replaceContent,
    'eds.deleteContent': deleteContent,
  };

  async function executeTargetTest(testData) {
    addTargetHider();

    try {
      // Process target test data
      if (testData && testData.actions) {
        const promises = testData.actions.map(async (action) => {
          const { type, ...actionData } = action;
          const targetFunction = targetFunctions[type];

          if (targetFunction) {
            return targetFunction(actionData);
          }
          analyticsWarn(`Unknown target action type: ${type}`);
          return Promise.resolve();
        });

        await Promise.allSettled(promises);
      }
    } catch (error) {
      analyticsError('Target test execution failed:', error);
    } finally {
      // Always remove the hider to show content
      removeTargetHider();

      // Dispatch target ready event
      document.dispatchEvent(new CustomEvent(TARGET_EVENT, {
        detail: { testData },
      }));
    }
  }

  /**
   * Core Analytics ADL Class - Streamlined for EDS
   * @param {string} appName - The name of the application using analytics
   * @param {object} dataLayer - Adobe Data Layer instance
   */
  function AnalyticsADL(appName, dataLayer) {
    this.screenLoadFired = false;
    this.formStartFired = {};
    this.appName = appName;
    this.dataLayer = dataLayer;

    // Debug mode
    if (localStorage.getItem('debugACDL') === 'true') {
      this.dataLayer.addEventListener('adobeDataLayer:change', (e) => {
        console.log(JSON.stringify(e, null, '  '));
      });
    }
  }

  AnalyticsADL.prototype = {
    /**
     * Update debug data with app info
     */
    updateDebugData() {
      const data = {
        web: {
          webPageDetails: {
            platform: 'web',
            _sling: {
              appName: this.appName,
              analyticsVersion: version,
            },
          },
        },
      };
      this.dataLayer.push(data);
    },

    /**
     * Update page data
     */
    updatePageData({
      name = window.location.pathname === '/' ? 'home' : window.location.pathname,
      lineOfBusiness = 'domestic',
      classification = 'us',
      type = 'generic',
      lang = 'en',
      domain = window.location.hostname,
      siteSection = lineOfBusiness,
      siteSubSection = classification,
      qsp = '',
      isErrorPage = false,
    } = {}) {
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
          },
        },
      };
      this.dataLayer.push(data);
    },

    /**
     * Update page access info (day of week, etc.)
     */
    updatePageAccessInfo() {
      const now = new Date();
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

      const data = {
        web: {
          webPageDetails: {
            _sling: {
              pageViewDayOfWeek: dayNames[now.getDay()],
            },
          },
        },
      };
      this.dataLayer.push(data);
    },

    /**
     * Update URL parameters data
     */
    updateUrlParamsData(urlSearchParams = new URLSearchParams(window.location.search)) {
      const fromEntriesToObject = (prev, cur) => {
        const [key, value] = cur;
        prev[key] = { [`param_${key}`]: value || 'null' };
        return prev;
      };

      const isSimpleParam = (paramName) => {
        const simpleParams = ['media', 'convertro'];
        return simpleParams.includes(paramName);
      };

      const urlParams = Array.from(urlSearchParams.entries())
        .filter(([key]) => isSimpleParam(key))
        .reduce(fromEntriesToObject, {});

      const data = {
        web: {
          webPageDetails: {
            _sling: {
              urlParams,
            },
          },
        },
      };
      this.dataLayer.push(data);
    },

    /**
     * Screen load event - main page load tracking
     */
    screenLoad({
      name = window.location.pathname === '/' ? 'home' : window.location.pathname,
      lineOfBusiness = 'domestic',
      classification = 'us',
      type = 'generic',
      lang = 'en',
    } = {}) {
      if (this.screenLoadFired) {
        analyticsWarn('Screen load already fired');
        return;
      }

      // Update debug data first
      this.updateDebugData();

      // Update page access info (day of week)
      this.updatePageAccessInfo();

      // Update URL params
      this.updateUrlParamsData();

      // Update page data
      this.updatePageData({
        name,
        lineOfBusiness,
        classification,
        type,
        lang,
      });

      // Fire screen load event
      const eventData = {
        event: 'screen_load',
        screenLoadFired: true,
        web: {
          currentEvent: 'screen_load',
        },
      };
      this.dataLayer.push(eventData);

      // Additional page tracking data
      const pageTrackingData = {
        web: {
          webPageDetails: {
            pageViews: {
              value: 1,
            },
            acdlversion: '2.0.2',
            libbuildInfo: 'production',
            URL: window.location.href,
            _sling: {
              urlParams: this.getUrlParamsForTracking(),
            },
          },
        },
      };
      this.dataLayer.push(pageTrackingData);

      // Previous page tracking (empty for now)
      const prevPageData = {
        web: {
          webPageDetails: {
            pName: '',
            pURL: '',
          },
        },
      };
      this.dataLayer.push(prevPageData);

      // Reset page views to null after initial tracking
      const resetPageViews = {
        web: {
          webPageDetails: {
            pageViews: null,
          },
        },
      };
      this.dataLayer.push(resetPageViews);

      this.screenLoadFired = true;
    },

    /**
     * Get URL parameters for tracking
     */
    getUrlParamsForTracking() {
      const urlSearchParams = new URLSearchParams(window.location.search);
      const trackingParams = ['media', 'convertro'];

      const urlParams = {};
      trackingParams.forEach((param) => {
        const value = urlSearchParams.get(param);
        urlParams[param] = { [`param_${param}`]: value || 'null' };
      });

      return urlParams;
    },

    /**
     * Update cart data
     */
    updateCartData({
      category = 'acquisition',
      subCategory = 'simple-shop',
      referrer = 'unknown',
      planName = 'monthly',
      offerName = '',
      deviceBundle = '',
      subType = 'paid',
      basePreselect = [],
      extrasPreselect = [],
    } = {}) {
      const packagePreselect = [...basePreselect, ...extrasPreselect];
      const formattedPackagePreselect = packagePreselect.join('|');

      const data = {
        commerce: {
          cart: {
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
      this.dataLayer.push(data);
    },

    /**
     * Cart step tracking
     */
    cartStep(stepName = 'account', cartData = {}, pageData = {}) {
      // Update cart data if provided
      if (Object.keys(cartData).length > 0) {
        this.updateCartData(cartData);
      }

      // Update page data if provided
      if (Object.keys(pageData).length > 0) {
        this.updatePageData(pageData);
      }

      // Fire cart step event
      const eventName = `cart_step_${stepName}`;
      const eventData = {
        event: eventName,
        web: {
          currentEvent: eventName,
        },
      };
      this.dataLayer.push(eventData);
    },

    /**
     * Generic step tracking
     */
    step(name, eventData = {}) {
      const validSteps = {
        cancelStart: 'cancel_start',
        screenLoad: 'screen_load',
      };

      if (!validSteps[name]) {
        analyticsWarn(`Step "${name}" is not a valid step`);
        return;
      }

      // Update page data if provided
      if (Object.keys(eventData).length > 0) {
        this.updatePageData(eventData);
      }

      const stepEventName = validSteps[name];
      const stepData = {
        event: stepEventName,
        web: {
          currentEvent: stepEventName,
        },
      };
      this.dataLayer.push(stepData);
    },

    /**
     * Execute Target test with flicker prevention
     */
    executeTargetTest(testData) {
      return executeTargetTest(testData);
    },
  };

  /**
   * Get an instance of AnalyticsADL
   * @param {string} appName - Application name
   * @returns {AnalyticsADL} - Analytics instance
   */
  function getInstance(appName) {
    if (!window.adobeDataLayer) {
      analyticsError('Adobe Data Layer not found');
      return null;
    }

    const instance = new AnalyticsADL(appName, window.adobeDataLayer);

    // Return a proxy to handle missing methods gracefully
    return new Proxy(instance, {
      get(target, prop) {
        if (target[prop]) {
          return typeof target[prop] === 'function'
            ? target[prop].bind(target)
            : target[prop];
        }
        analyticsWarn(`Method "${prop}" not implemented in EDS analytics`);
        return () => {}; // Return empty function for missing methods
      },
    });
  }

  // Export to global scope
  if (typeof window !== 'undefined') {
    window.MyLibrary = {
      getInstance,
      version,
      // Target utilities for direct access
      target: {
        executeTest: executeTargetTest,
        addHider: addTargetHider,
        removeHider: removeTargetHider,
        insertContent,
        replaceContent,
        deleteContent,
      },
    };
  }

  // Also export as module if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getInstance,
      version,
      target: {
        executeTest: executeTargetTest,
        addHider: addTargetHider,
        removeHider: removeTargetHider,
        insertContent,
        replaceContent,
        deleteContent,
      },
    };
  }
}());