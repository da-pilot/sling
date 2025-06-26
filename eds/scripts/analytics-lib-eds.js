/**
 * Analytics Library for EDS (Edge Delivery Services)
 * Streamlined version of analytics-lib.js for EDS architecture
 * Version: 7.0.39 (matching production)
 */

// Environment detection for conditional logging
function isProduction() {
  return window.location.hostname.endsWith('.live') || window.location.hostname.includes('sling.com');
}

function analyticsLog(...args) {
  if (!isProduction()) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

function analyticsWarn(msg) {
  if (!isProduction()) {
    // eslint-disable-next-line no-console
    console.warn(`[Analytics Warning] ${msg}`);
  }
}

function analyticsError(msg) {
  if (!isProduction()) {
    // eslint-disable-next-line no-console
    console.error(`[Analytics Error] ${msg}`);
  }
}

// Target functionality for A/B testing and personalization
function addTargetHider() {
  const hiderId = 'sling-target-hider';
  if (!document.getElementById(hiderId)) {
    const style = document.createElement('style');
    style.id = hiderId;
    style.innerHTML = 'body { opacity: 0 !important; }';
    document.head.appendChild(style);
  }
}

function removeTargetHider() {
  const hider = document.getElementById('sling-target-hider');
  if (hider) {
    hider.remove();
  }
}

function insertContent(selector, content) {
  const element = document.querySelector(selector);
  if (element) {
    element.insertAdjacentHTML('beforeend', content);
  }
}

function replaceContent(selector, content) {
  const element = document.querySelector(selector);
  if (element) {
    element.innerHTML = content;
  }
}

function deleteContent(selector) {
  const element = document.querySelector(selector);
  if (element) {
    element.remove();
  }
}

function executeTargetTest(testConfig) {
  if (!testConfig || !testConfig.selector) return;

  try {
    switch (testConfig.action) {
      case 'insert':
        insertContent(testConfig.selector, testConfig.content);
        break;
      case 'replace':
        replaceContent(testConfig.selector, testConfig.content);
        break;
      case 'delete':
        deleteContent(testConfig.selector);
        break;
      default:
        analyticsWarn(`Unknown target action: ${testConfig.action}`);
    }
  } catch (error) {
    analyticsError(`Target test execution failed: ${error.message}`);
  }
}

// Add the classifications object and getPageData function from production
const classifications = {
  arabic: 'arabic',
  bangla: 'bangla',
  bengali: 'bengali',
  brazilian: 'brazilian',
  cantonese: 'cantonese',
  caribe: 'caribe',
  centroamerica: 'centroamerica',
  espana: 'espana',
  french: 'french',
  german: 'german',
  greek: 'greek',
  hindi: 'hindi',
  internationalSports: 'international-sports',
  italian: 'italian',
  kannada: 'kannada',
  latino: 'latino',
  malayalam: 'malayalam',
  mandarin: 'mandarin',
  mexico: 'mexico',
  marathi: 'marathi',
  polish: 'polish',
  punjabi: 'punjabi',
  sudamerica: 'sudamerica',
  taiwanese: 'taiwanese',
  tamil: 'tamil',
  telugu: 'telugu',
  urdu: 'urdu',
  us: 'us',
  vietnamese: 'vietnamese',
  worldCricket: 'world-cricket',
};

function getPageData() {
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

    data.classification = Object.values(classifications).find((val) => pathname.includes(val));
    if (pathname.includes('cricket') && !pathname.includes('world-cricket')) {
      data.classification = classifications.worldCricket;
    }
  }

  return data;
}

class AnalyticsADL {
  constructor(appName, dataLayer) {
    this.appName = appName;
    this.dataLayer = dataLayer;
    this.screenLoadCalled = false;
  }

  updateDebugData() {
    // Match production structure exactly
    this.dataLayer.push({
      web: {
        webPageDetails: {
          platform: 'web',
          _sling: {
            appName: this.appName, // Only change: 'eds-marketing-site'
            analyticsVersion: '7.0.39', // Match production version exactly
          },
        },
      },
    });
  }

  updatePageData(pageData) {
    // Extract language from document.documentElement.lang like production
    const lang = document.documentElement?.lang?.substr(0, 2) || 'en';

    // Get query string parameters like production
    const qsp = window.location.search.slice(1);

    // Check for 404 page like production
    const pageTitle = document.title;
    const pageErrorName = pageTitle === '404' ? pageTitle : undefined;

    // Map lineOfBusiness to siteSection and classification to siteSubSection like production
    const siteSection = pageData.lineOfBusiness || 'unknown';
    const siteSubSection = pageData.classification || 'us'; // Default to 'us' when no classification found

    // First push: main page details (match production structure exactly)
    this.dataLayer.push({
      web: {
        webPageDetails: {
          name: pageData.name || 'unknown',
          type: pageData.type || 'generic',
          qsp,
          language: lang,
          siteSection,
          siteSubSection,
          siteSubSubSection: undefined, // Match production
          domain: pageData.domain || window.location.hostname,
          pageErrorName,
        },
      },
    });

    // Second push: day of week (separate like production)
    const currentDate = new Date();
    const dayOfWeek = currentDate.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();

    this.dataLayer.push({
      web: {
        webPageDetails: {
          _sling: {
            pageViewDayOfWeek: dayOfWeek,
          },
        },
      },
    });
  }

  updatePageAccessInfo() {
    // This method exists but production doesn't seem to use it in the same way
    // Keeping it for compatibility but not pushing data here
    analyticsLog(`[Analytics] updatePageAccessInfo called for ${this.appName}`);
  }

  updateUrlParamsData(urlSearchParams) {
    const params = {};
    const simpleParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

    urlSearchParams.forEach((value, key) => {
      if (simpleParams.includes(key)) {
        params[key] = value;
      }
    });

    // Match production structure exactly
    this.dataLayer.push({
      web: {
        webPageDetails: {
          _sling: {
            urlParams: Object.keys(params).length > 0 ? params : {},
          },
        },
      },
    });
  }

  updateUserData(userData) {
    if (userData) {
      this.dataLayer.push({
        web: {
          user: userData,
        },
      });
    }
  }

  updatePerformanceData() {
    // Set up load time tracking to match production's final entry
    if (window.performance && window.performance.timing) {
      const { timing } = window.performance;

      // If page is still loading, wait for load event
      if (timing.loadEventEnd === 0 || timing.navigationStart === 0) {
        window.addEventListener('load', () => {
          this.updatePerformanceData();
        }, { once: true });
        return;
      }

      const loadTime = timing.loadEventEnd - timing.navigationStart;

      // Match production's load time bucket format exactly
      let loadTimeBucket = 'unknown';
      if (loadTime < 1000) loadTimeBucket = '<1sec';
      else if (loadTime < 2000) loadTimeBucket = '1-2sec';
      else if (loadTime < 3000) loadTimeBucket = '2-3sec';
      else if (loadTime < 4000) loadTimeBucket = '3-4sec';
      else if (loadTime < 5000) loadTimeBucket = '4-5sec';
      else if (loadTime < 6000) loadTimeBucket = '5-6sec';
      else if (loadTime < 7000) loadTimeBucket = '6-7sec';
      else if (loadTime < 8000) loadTimeBucket = '7-8sec';
      else if (loadTime < 9000) loadTimeBucket = '8-9sec';
      else if (loadTime < 10000) loadTimeBucket = '9-10sec';
      else loadTimeBucket = '>10sec';

      // Push load time data separately like production's final entry
      this.dataLayer.push({
        web: {
          webPageDetails: {
            loadTime,
            _sling: {
              loadTimeBucket,
            },
          },
        },
      });
    }
  }

  // Add comprehensive testing ID and Neustar data push (like production entry #16)

  screenLoad(options = {}) {
    // Prevent duplicate screenLoad calls globally (across all instances)
    if (window.slingScreenLoadCalled || this.screenLoadCalled) {
      return;
    }
    this.screenLoadCalled = true;
    window.slingScreenLoadCalled = true;

    // Match production event name exactly: 'screen_load' not 'screenLoad'
    this.dataLayer.push({
      event: 'screen_load', // EXACT match to production
      screenLoadFired: true, // Match production
      web: {
        currentEvent: 'screen_load', // Match production
      },
    });

    // Update page name if provided in options (after screen_load like production)
    if (options.name) {
      const pageData = getPageData();
      const lang = document.documentElement?.lang?.substr(0, 2) || 'en';
      const qsp = window.location.search.slice(1);

      // Production shows updated page details after screen_load event
      this.dataLayer.push({
        web: {
          webPageDetails: {
            name: options.name,
            type: options.type || pageData.type || 'generic',
            qsp,
            language: lang,
            siteSection: pageData.lineOfBusiness || 'domestic',
            siteSubSection: pageData.classification || 'us',
            domain: window.location.hostname,
            isErrorPage: false,
          },
        },
      });
    }

    // Add essential user identity structure (Adobe Launch will handle the rest)
    this.dataLayer.push({
      useridentity: {
        authState: 'logged_out',
        accountStatus: '',
      },
    });

    // User data (including localStorage values) will be handled by Adobe Launch

    // Neustar data and testing ID will be handled by Adobe Launch

    // Add performance data tracking (will push load time data when page loads)
    this.updatePerformanceData();
  }

  // Commerce methods
  updateCartData(cartData) {
    this.dataLayer.push({
      commerce: {
        cart: cartData,
      },
    });
  }

  // UI interaction tracking
  uiInteraction(params) {
    this.dataLayer.push({
      event: 'uiInteraction',
      eventInfo: params,
    });
  }

  // Modal tracking
  modalOpen(modalData) {
    this.dataLayer.push({
      event: 'modalOpen',
      eventInfo: modalData,
    });
  }

  modalClose() {
    this.dataLayer.push({
      event: 'modalClose',
    });
  }

  // Form tracking
  formStart(formData) {
    this.dataLayer.push({
      event: 'formStart',
      eventInfo: formData,
    });
  }

  formComplete(formData) {
    this.dataLayer.push({
      event: 'formComplete',
      eventInfo: formData,
    });
  }

  formError(errorData) {
    this.dataLayer.push({
      event: 'formError',
      eventInfo: errorData,
    });
  }

  // User actions
  userLogin(userInfo) {
    this.dataLayer.push({
      event: 'userLogin',
      user: userInfo,
    });
  }

  userLogout() {
    this.dataLayer.push({
      event: 'userLogout',
    });
  }

  userRegister(userInfo) {
    this.dataLayer.push({
      event: 'userRegister',
      user: userInfo,
    });
  }
}

// Singleton instance
let instance;

function getInstance(appName) {
  if (!instance) {
    // Initialize Adobe Data Layer if it doesn't exist
    window.adobeDataLayer = window.adobeDataLayer || [];

    // Create proxy handler for error handling
    const handler = {
      get(target, prop) {
        const fn = target[prop];
        if (!fn) {
          analyticsError(`Property ${prop} accessed, but does not exist. If this is a function call, it will silently fail as a no-op. This needs to be fixed in the calling code.`);
          return function noOp() { /* intentionally empty */ };
        }
        return function proxyFunction(...args) {
          try {
            return target[prop](...args);
          } catch (e) {
            analyticsError(e);
          }
          return undefined;
        };
      },
    };

    // Create the analytics instance
    instance = new Proxy(new AnalyticsADL(appName, window.adobeDataLayer), handler);

    // Add debug data to the data layer (platform and app info)
    instance.updateDebugData();

    // Set the page defaults like production (starts with "unknown")
    const pageData = getPageData();
    instance.updatePageData({
      name: 'unknown', // Always start with "unknown" like production
      lineOfBusiness: pageData.lineOfBusiness || 'unknown',
      classification: pageData.classification || 'us', // Default to 'us' like production
      type: pageData.type || 'generic',
      domain: window.location.hostname,
    });

    // Update URL parameters
    const urlSearchParams = new URLSearchParams(window.location.search);
    instance.updateUrlParamsData(urlSearchParams);

    // Load user data from localStorage if available
    if (localStorage.getItem('adobeDataLayer.web.user')) {
      try {
        instance.updateUserData(JSON.parse(localStorage.getItem('adobeDataLayer.web.user')));
      } catch (e) {
        analyticsError(e);
      }
    }

    // Load additional user data from localStorage (zip code, etc.)
    const additionalUserData = {};

    // Check for zip code in localStorage
    const userZip = localStorage.getItem('user_zip');
    if (userZip) {
      additionalUserData.zip = userZip;
      additionalUserData.zipCode = userZip; // Match production structure
    }

    // Add default authentication state like production
    additionalUserData.authState = 'logged_out';
    additionalUserData.accountStatus = '';

    // Load Neustar targeting data from localStorage
    const neustarData = {};

    // Get Neustar Fabrick ID
    const fabrickID = localStorage.getItem('fabrickID');
    if (fabrickID) {
      neustarData.fabrickID = fabrickID;
    }

    // Get segment code
    const segmentCode = localStorage.getItem('segmentCode');
    if (segmentCode) {
      neustarData.segmentCode = segmentCode;
    }

    // Get Neustar levels (L0, L1, L2, L3)
    const neustarL0 = localStorage.getItem('neustarL0');
    const neustarL1 = localStorage.getItem('neustarL1');
    const neustarL2 = localStorage.getItem('neustarL2');
    const neustarL3 = localStorage.getItem('neustarL3');

    if (neustarL0) neustarData.level0 = neustarL0;
    if (neustarL1) neustarData.level1 = neustarL1;
    if (neustarL2) neustarData.level2 = neustarL2;
    if (neustarL3) neustarData.level3 = neustarL3;

    // Get Neustar audience data
    const neustarAud = localStorage.getItem('neustarAud');
    if (neustarAud) {
      try {
        const audienceArray = JSON.parse(neustarAud);
        if (Array.isArray(audienceArray)) {
          neustarData.audience = audienceArray;
        }
      } catch (e) {
        // If parsing fails, use as string
        neustarData.audience = [neustarAud];
      }
    }

    // Add audienceLists structure like production (with default false values)
    neustarData.audienceLists = {
      dishActive: false,
      dishFormer2022: false,
      dishFormer2023: false,
      dishFormer6mo: false,
      slingActive: false,
      slingFormer2023: false,
      slingFormer6mo: false,
    };

    // Store user and Neustar data for later use by screenLoad()
    // Don't push here to avoid duplicates - screenLoad() will handle the data layer pushes
  }

  return instance;
}

// Global utilities setup
window.slingUtils = window.slingUtils || {};
window.slingUtils.lazy = window.slingUtils.lazy || {};
window.slingUtils.lazy.registerComponent = window.slingUtils.lazy.registerComponent
  || function registerComponent() {};

// Adobe Data Layer compatibility methods
if (window.adobeDataLayer && !window.adobeDataLayer.getState) {
  window.adobeDataLayer.getState = function getState(path) {
    // Simple state getter - in a real implementation this would traverse the data layer
    return path ? undefined : {};
  };

  window.adobeDataLayer.addEventListener = function addEventListener(event) {
    // Simple event listener - in a real implementation this would register listeners
    analyticsLog('addEventListener called:', event);
  };

  window.adobeDataLayer.removeEventListener = function removeEventListener(event) {
    // Simple event listener removal
    analyticsLog('removeEventListener called:', event);
  };
}

// Target utilities - make them globally available
window.addTargetHider = addTargetHider;
window.removeTargetHider = removeTargetHider;
window.executeTargetTest = executeTargetTest;

// Module exports
const analytics = {
  getInstance,
  addTargetHider,
  removeTargetHider,
  executeTargetTest,
  insertContent,
  replaceContent,
  deleteContent,
};

// Support both CommonJS and global access
if (typeof module !== 'undefined' && module.exports) {
  module.exports = analytics;
}

// Global access
window.analytics = analytics;