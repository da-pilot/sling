/*
 * <license header>
 */

/* This file exposes some common utilities for your actions */

/**
 * Returns a log ready string of the action input parameters.
 * The `Authorization` header content will be replaced by '<hidden>'.
 *
 * @param {object} params action input parameters.
 * @returns {string}
 */
function stringParameters(params) {
  // hide authorization token without overriding params
  let headers = params.__ow_headers || {};
  if (headers.authorization) {
    headers = { ...headers, authorization: '<hidden>' };
  }
  return JSON.stringify({ ...params, __ow_headers: headers });
}

/**
 * Returns the list of missing keys giving an object and its required keys.
 * A parameter is missing if its value is undefined or ''.
 * A value of 0 or null is not considered as missing.
 *
 * @param {object} obj object to check.
 * @param {array} required list of required keys.
 *        Each element can be multi level deep using a '.'
 *        separator e.g. 'myRequiredObj.myRequiredKey'
 * @returns {array}
 * @private
 */
function getMissingKeys(obj, required) {
  return required.filter((r) => {
    const splits = r.split('.');
    const last = splits[splits.length - 1];
    const traverse = splits.slice(0, -1).reduce((tObj, split) => {
      tObj = tObj[split] || {};
      return tObj;
    }, obj);
    return traverse[last] === undefined || traverse[last] === '';
  });
}

/**
 * Returns the list of missing keys giving an object and its required keys.
 * A parameter is missing if its value is undefined or ''.
 * A value of 0 or null is not considered as missing.
 *
 * @param {object} params action input parameters.
 * @param {array} requiredHeaders list of required input headers.
 * @param {array} requiredParams list of required input parameters.
 * @returns {string|null} if the return value is not null, then it holds an
 * error message describing the missing inputs.
 */
function checkMissingRequestInputs(params, requiredParams = [], requiredHeaders = []) {
  let errorMessage = null;

  // input headers are always lowercase
  requiredHeaders = requiredHeaders.map((h) => h.toLowerCase());
  // check for missing headers
  const missingHeaders = getMissingKeys(params.__ow_headers || {}, requiredHeaders);
  if (missingHeaders.length > 0) {
    errorMessage = `missing header(s) '${missingHeaders}'`;
  }

  // check for missing parameters
  const missingParams = getMissingKeys(params, requiredParams);
  if (missingParams.length > 0) {
    if (errorMessage) {
      errorMessage += ' and ';
    } else {
      errorMessage = '';
    }
    errorMessage += `missing parameter(s) '${missingParams}'`;
  }

  return errorMessage;
}

/**
 * Extracts the bearer token string from the Authorization header in the request parameters.
 *
 * @param {object} params action input parameters.
 * @returns {string|undefined} the token string or undefined if not set in request headers.
 */
function getBearerToken(params) {
  if (
    params.__ow_headers &&
    params.__ow_headers.authorization &&
    params.__ow_headers.authorization.startsWith('Bearer ')
  ) {
    return params.__ow_headers.authorization.substring('Bearer '.length);
  }
  return undefined;
}

/**
 * Returns an error response object with proper formatting for Adobe I/O Runtime
 * @param {number} statusCode - HTTP status code
 * @param {string|Error|Object} error - Error message, Error object, or error response object
 * @param {object} [logger] - Logger instance
 * @returns {Object} Error response object
 */
function errorResponse(statusCode, message, logger) {
  if (logger && typeof logger.info === 'function') {
    logger.info(`${statusCode}: ${message}`);
  }
  return {
    error: {
      statusCode,
      body: {
        error: message,
      },
    },
  };
}


// Function to convert into camel Case
function toCamelCase(str) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, function (word, index) {
      return index == 0 ? word.toLowerCase() : word.toUpperCase();
    })
    .replace(/\s+/g, '');
}

/**
 * Checks if the given origin is allowed
 * @param {string|URL} url - The URL to check
 * @returns {boolean} - Whether the origin is allowed
 */
function isOriginAllowed(url) {
  const urlToCheck = typeof url === 'string' ? new URL(url) : url;
  const isHlx = ['hlx.page', 'hlx.live', 'aem.page', 'aem.live'].some((host) => urlToCheck.hostname.includes(host));
  const isLocal = urlToCheck.hostname.includes('localhost');
  const isAllowed = (isHlx || isLocal) ? true : false;
  return isAllowed;
}

const allowedOrigins = [
  'https://916809-952dimlouse.adobeioruntime.net',
  'https://34866-789turquoisetick.adobeioruntime.net',
  'http://localhost:3000'
]

/**
 * Checks the origin of a request and returns the allowed origin
 * @param {Object} request - The request object
 * @returns {string} - The allowed origin
 */
function checkOrigin(request) {
  const origin = request.headers.get("Origin") || 'http://localhost:3000';
  return isOriginAllowed(origin) ? origin : allowedOrigins[0];
}

/**
 * Returns CORS headers for the given origin
 * @param {string} origin - The origin to allow
 * @returns {Object} - CORS headers
 */
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };
}

module.exports = {
  errorResponse,
  stringParameters,
  checkMissingRequestInputs,
  toCamelCase,
  getBearerToken,
  isOriginAllowed,
  corsHeaders,
  checkOrigin
};