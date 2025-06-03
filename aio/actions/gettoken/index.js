/*
* Copyright 2024 Adobe. All rights reserved.
* This file is licensed to you under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License. You may obtain a copy
* of the License at http://www.apache.org/licenses/LICENSE-2.0
*/

const { Core } = require('@adobe/aio-sdk');
const fetch = require('node-fetch');
const { errorResponse } = require('../utils');

// Cache key for storing the token
const TOKEN_CACHE_KEY = 'adobe_access_token';

/**
 * Fetches an access token from Adobe IMS
 * @param {Object} params Runtime action parameters
 * @returns {Promise<Object>} Object containing the access token or error
 */
async function main(params) {
  const logger = Core.Logger('gettoken', { level: params.LOG_LEVEL || 'info' });
  logger.info('DEBUG PARAMS:', JSON.stringify(params));

  try {
    // Validate required environment variables
    if (!params.ADOBE_CLIENT_ID || !params.ADOBE_CLIENT_SECRET) {
      throw new Error('Missing required environment variables: ADOBE_CLIENT_ID and/or ADOBE_CLIENT_SECRET');
    }
    logger.info(`ADOBE_CLIENT_ID: ${params.ADOBE_CLIENT_ID}`);
    logger.info(`ADOBE_CLIENT_SECRET: ${params.ADOBE_CLIENT_SECRET}`);
    // Try to get cached token first
    const cachedToken = await getCachedToken(logger);
    if (cachedToken) {
      logger.info('Using cached access token');
      return {
        statusCode: 200,
        body: {
          access_token: cachedToken.access_token,
          cached: true
        }
      };
    }

    logger.debug('Fetching new access token from IMS...');

    const scopes = params.ADOBE_TARGET_SCOPES || 'openid,AdobeID,target_sdk,target_admin,target_write,target_read,additional_info.projectedProductContext,read_organizations,additional_info.roles';
    const response = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache'
      },
      body: new URLSearchParams({
        client_id: params.ADOBE_CLIENT_ID,
        client_secret: params.ADOBE_CLIENT_SECRET,
        grant_type: 'client_credentials',
        scope: scopes
      })
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error('Failed to get access token:', data);
      throw new Error(data.error_description || 'Failed to get access token');
    }

    // Cache the new token
    await cacheToken(data, logger);

    logger.info('Successfully obtained new access token');

    return {
      statusCode: 200,
      body: {
        access_token: data.access_token,
        cached: false
      }
    };

  } catch (error) {
    logger.error('Error getting access token:', error);
    const statusCode = error.statusCode || 500;
    return errorResponse(statusCode, error, logger);
  }
}

/**
 * Gets the cached token if it exists and is still valid
 * @param {Object} logger Logger instance
 * @returns {Promise<Object|null>} Cached token data or null if not found/expired
 */
async function getCachedToken(logger) {
  try {
    // Get the cached token from the filesystem
    const fs = require('fs');
    const path = require('path');
    const cacheFile = path.join('/tmp', TOKEN_CACHE_KEY + '.json');

    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const now = Date.now();

    // Check if token is still valid (with 5 minutes buffer)
    if (cachedData.expiresAt > now + 300000) {
      return cachedData;
    }

    // Token expired, delete the cache file
    fs.unlinkSync(cacheFile);
    return null;
  } catch (error) {
    logger.warn('Error reading cached token:', error);
    return null;
  }
}

/**
 * Caches the token data
 * @param {Object} tokenData Token response from Adobe IMS
 * @param {Object} logger Logger instance
 * @returns {Promise<void>}
 */
async function cacheToken(tokenData, logger) {
  try {
    const fs = require('fs');
    const path = require('path');
    const cacheFile = path.join('/tmp', TOKEN_CACHE_KEY + '.json');

    // Calculate expiration time (current time + expires_in in seconds)
    const expiresAt = Date.now() + (tokenData.expires_in * 1000);

    const dataToCache = {
      access_token: tokenData.access_token,
      expiresAt: expiresAt
    };

    fs.writeFileSync(cacheFile, JSON.stringify(dataToCache));
    logger.debug('Token cached successfully');
  } catch (error) {
    logger.warn('Error caching token:', error);
    // Don't throw error as this is not critical
  }
}

exports.main = main; 