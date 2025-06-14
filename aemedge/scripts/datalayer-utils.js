// Adobe Data Layer Utilities for Sling TV EDS Marketing Site
// Handles data layer initialization, manipulation, and basic event tracking

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
   * Updates the appName in Adobe Data Layer by appending 'eds' if not already present
   * @param {number} timeoutMs - Maximum time to wait for data layer (default: 1000ms)
   * @param {number} pollIntervalMs - How often to check for data layer (default: 100ms)
   * @param {boolean} setupListener - Whether to set up ongoing listener for new entries
   * @returns {Promise<boolean>} - Promise that resolves to true if update was successful
   */
  async function updateAppName(
    timeoutMs = 1000,
    pollIntervalMs = 100,
    setupListener = true,
  ) {
    const checkAndUpdate = () => {
      if (window.adobeDataLayer && Array.isArray(window.adobeDataLayer)) {
        let updated = false;

        // Iterate through all data layer objects
        window.adobeDataLayer.forEach((item) => {
          if (item?.web?.webPageDetails) {
            // eslint-disable-next-line no-underscore-dangle
            const slingData = item.web.webPageDetails._sling;

            if (slingData) {
              if (slingData.appName) {
                const currentAppName = slingData.appName;

                // Only update if 'eds' is not already in the appName
                if (!currentAppName.includes('eds')) {
                  // Append 'eds-' as prefix to maintain consistency
                  slingData.appName = `eds-${currentAppName}`;
                  updated = true;

                  console.log(`[DataLayer] Updated appName: "${currentAppName}" → "${slingData.appName}"`);
                }
              } else {
                // No appName exists, set default
                slingData.appName = 'eds-marketing-site';
                updated = true;
                console.log('[DataLayer] Set default appName: "eds-marketing-site"');
              }
            }
          }
        });

        return { found: true, updated };
      }
      return { found: false, updated: false };
    };

    // Set up ongoing listener for data layer changes if requested
    const setupDataLayerListener = () => {
      if (window.adobeDataLayer) {
        const listenerFlag = '_edsListenerSetup';
        if (!window.adobeDataLayer[listenerFlag]) {
          window.adobeDataLayer[listenerFlag] = true;

          // Listen for data layer changes
          window.adobeDataLayer.addEventListener('adobeDataLayer:change', () => {
            // Small delay to ensure the change is fully processed
            setTimeout(() => {
              checkAndUpdate();
            }, 50);
          });

          // Also set up periodic checks for new entries (every 5 seconds)
          setInterval(() => {
            checkAndUpdate();
          }, 5000);

          console.log('[DataLayer] Listener established for ongoing appName updates');
        }
      }
    };

    // Try immediately first
    const immediateResult = checkAndUpdate();
    if (immediateResult.found) {
      if (setupListener) {
        setupDataLayerListener();
      }
      return immediateResult.updated;
    }

    // If not available immediately, wait for it with timeout
    return new Promise((resolve) => {
      const startTime = Date.now();

      const pollInterval = setInterval(() => {
        const result = checkAndUpdate();

        if (result.found) {
          clearInterval(pollInterval);
          if (setupListener) {
            setupDataLayerListener();
          }
          resolve(result.updated);
          return;
        }

        // Check timeout
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(pollInterval);
          console.warn('[DataLayer] AppName update timed out after', timeoutMs, 'ms');
          resolve(false);
        }
      }, pollIntervalMs);
    });
  }

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
   * Data Layer Helper Functions
   */
  const DataLayerHelpers = {

    // Push debug data to data layer
    pushDebugData(appName) {
      const data = {
        web: {
          webPageDetails: {
            platform: 'web',
            // eslint-disable-next-line no-underscore-dangle
            _sling: {
              appName,
              analyticsVersion: '1.0.0-datalayer-utils',
            },
          },
        },
      };
      window.adobeDataLayer.push(data);
    },

    // Push page data to data layer
    pushPageData(pageInfo = {}) {
      const {
        name = window.location.pathname,
        lineOfBusiness = 'domestic',
        classification = 'us',
        type = 'generic',
        lang = 'en',
        domain = window.location.hostname,
      } = pageInfo;

      const data = {
        web: {
          webPageDetails: {
            name,
            type,
            language: lang,
            // eslint-disable-next-line no-underscore-dangle
            _sling: {
              lineOfBusiness,
              classification,
              domain,
            },
          },
        },
      };
      window.adobeDataLayer.push(data);
    },

    // Push screen load event
    pushScreenLoad(pageData = {}) {
      this.pushPageData(pageData);

      const data = {
        event: 'screen_load',
        screenLoadFired: true,
        web: {
          currentEvent: 'screen_load',
        },
      };
      window.adobeDataLayer.push(data);
    },

    // Push step event
    pushStepEvent(stepName, eventData = {}) {
      const validSteps = {
        cancelStart: 'cancel_start',
        screenLoad: 'screen_load',
      };

      if (!validSteps[stepName]) {
        console.warn(`[DataLayer] Event "${stepName}" is not a valid event`);
        return;
      }

      this.pushPageData(eventData);

      const eventName = validSteps[stepName];
      const data = {
        event: eventName,
        web: {
          currentEvent: eventName,
        },
      };
      window.adobeDataLayer.push(data);
    },

    // Get page data based on URL
    getPageData() {
      const { pathname } = window.location;
      const isHomePage = pathname === '/';

      const data = {
        name: isHomePage ? 'home' : pathname,
      };

      if (isHomePage) {
        data.type = 'home';
        data.lineOfBusiness = 'domestic';
        data.classification = 'us';
      } else {
        const firstDir = pathname.split('/')[1];
        if (firstDir.includes('account')) {
          data.type = 'account';
        } else if (firstDir.includes('latino')) {
          data.lineOfBusiness = 'latino';
        } else if (firstDir.includes('whatson')) {
          data.type = 'blog';
        } else if (firstDir.includes('help')) {
          data.type = 'help';
        } else if (firstDir.includes('international')) {
          data.lineOfBusiness = 'international';
        } else {
          data.lineOfBusiness = 'domestic';
        }

        data.classification = 'us'; // Simplified
      }

      return data;
    },
  };

  // Initialize the data layer
  initializeDataLayer({ dataLayer: window.adobeDataLayer });

  // Auto-initialize when DOM is ready
  setTimeout(async () => {
    console.log('[DataLayer-Utils] Auto-initializing data layer');
    const appName = 'eds-marketing-site';
    const pageData = DataLayerHelpers.getPageData();
    const skipAnalytics = !!document.querySelector('.skipAnalytics');
    const cancelStep = document.querySelector('meta[name="cancel-step"]')?.content || 'screen_load';

    console.log('[DataLayer-Utils] Pushing initial debug data with appName:', appName);
    // Push initial debug data
    DataLayerHelpers.pushDebugData(appName);

    // Update appName in data layer automatically
    console.log('[DataLayer-Utils] Updating appName in data layer');
    try {
      await updateAppName();
    } catch (error) {
      console.warn('[DataLayer-Utils] Failed to update appName:', error);
    }

    if (!skipAnalytics) {
      if (cancelStep !== 'screen_load') {
        console.log('[DataLayer] STEP EVENT');
        DataLayerHelpers.pushStepEvent(cancelStep, pageData);
      } else {
        console.log('[DataLayer] SCREEN LOAD EVENT');
        DataLayerHelpers.pushScreenLoad(pageData);
      }
    }
  }, 0);

  // Export for external use
  window.SlingDataLayer = {
    updateAppName,
    helpers: DataLayerHelpers,
    initialize: initializeDataLayer,
  };
}());