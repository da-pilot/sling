/*
* Copyright 2024 Adobe. All rights reserved.
* This file is licensed to you under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License. You may obtain a copy
* of the License at http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software distributed under
* the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
* OF ANY KIND, either express or implied. See the License for the specific language
* governing permissions and limitations under the License.
*/

const { Core } = require('@adobe/aio-sdk');
const { errorResponse } = require('../utils');
const targetSDK = require('@adobe/aio-lib-target');
const openwhisk = require('openwhisk');
const filesLib = require('@adobe/aio-lib-files');

// File path for storing target exports
const TARGET_EXPORTS_FILE = 'target-exports.json';

/**
 * Gets the existing offer mapping for a fragment ID
 * @param {string} fragmentId - The fragment ID to check
 * @returns {Promise<string|null>} The offer ID if found, null otherwise
 */
async function getExistingOfferMapping(fragmentId, path, logger) {
  try {
    logger.info(`Getting existing offer mapping for fragmentId: ${fragmentId} and path: ${path}`);
    const files = await filesLib.init();
    let targetExports;
    try {
      const existingFile = await files.read(TARGET_EXPORTS_FILE);
      targetExports = JSON.parse(existingFile);
    } catch (readError) {
      // If file does not exist, create it with empty data array
      logger.warn('target-exports.json does not exist, creating new file.');
      targetExports = { data: [] };
      await files.write(TARGET_EXPORTS_FILE, JSON.stringify(targetExports));
    }
    logger.info(`Target exports: ${JSON.stringify(targetExports)}`);
    const existingMapping = targetExports.data.find(item => item['fragment-id'] === fragmentId && item['path'] === path);
    logger.info(`Existing mapping: ${JSON.stringify(existingMapping)}`);
    logger.info(`Existing mapping offer-id: ${existingMapping ? existingMapping['offer-id'] : null}`);
    return existingMapping ? existingMapping['offer-id'] : null;
  } catch (error) {
    logger.error('Error getting existing offer mapping:', error);
    throw new Error(`Failed to get existing offer mapping: ${error.message}`);
  }
}

/**
 * Updates the target exports file with new offer mapping
 * @param {string} fragmentId - The fragment ID
 * @param {string} offerId - The Target offer ID
 * @param {string} path - The page path
 * @returns {Promise<void>}
 */
async function updateTargetExports(fragmentId, offerId, path, logger) {
    const files = await filesLib.init();
    if (!fragmentId || !offerId || !path) {
      logger.error(`Missing required parameters: fragmentId: ${fragmentId}, offerId: ${offerId}, path: ${path}`);
      throw new Error(`Missing required parameters to update target exports: fragmentId: ${fragmentId}, offerId: ${offerId}, path: ${path}`);
    }
    // Try to read existing file
    let targetExports;
    let existingIndex = -1;
    let fileContent;
    try {
      const existingFile = await files.list(TARGET_EXPORTS_FILE);
      // If the file exists, read it and check if the mapping already exists
      if (existingFile.length > 0) {
        fileContent = await files.read(TARGET_EXPORTS_FILE);
        targetExports = JSON.parse(fileContent);
        logger.info(`Target exports: ${JSON.stringify(targetExports)}`);
        existingIndex = targetExports.data.findIndex(item => item['fragment-id'] === fragmentId && item['path'] === path);
        if (existingIndex >= 0) {
          logger.info(`Existing mapping found for fragmentId: ${fragmentId}, offerId: ${offerId}, path: ${path}`);
          return;
        } else {
            // If the mapping doesn't exist, add it
            targetExports.data.push({
                path,
                'fragment-id': fragmentId,
                'offer-id': offerId
              });
            await files.write(`${TARGET_EXPORTS_FILE}`, JSON.stringify(targetExports));
            fileContent = await files.read(TARGET_EXPORTS_FILE);
            targetExports = JSON.parse(fileContent);
            logger.info(`Updated target exports: ${JSON.stringify(targetExports)}`);
        }
      } else {
        // If the file doesn't exist, create a new one
        targetExports = {
            data: []
          };
        await files.write(`${TARGET_EXPORTS_FILE}`, JSON.stringify(targetExports));
      }
    } catch (error) {
        logger.error(`Error updating target exports: ${error.message}`);
        throw new Error(`Failed to update target exports: ${error.message}`);
    }
}

/**
 * Creates or updates an offer in Adobe Target
 * @param {Object} params - Action parameters
 * @returns {Promise<Object>} Response object
 */
async function main(params) {
  // Initialize logger
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' });
  
  try {
    // Log the incoming parameters (excluding sensitive data)
    logger.info(`Processing offer with params: ${JSON.stringify(params)} with method: ${params.method}`);
    if (params.method === "GET") {
      return errorResponse(405, 'GET method not allowed', logger);
    }

    if (params.method === "OPTIONS") {
        // Check that the request's origin is a valid origin, allowed to access this API
        const allowedOrigin = checkOrigin(params);
        return {
            statusCode: 200,
            headers: corsHeaders(allowedOrigin)
        }
    }
 
    // Validate required parameters
    if (!params.offer || !params.fragmentId || !params.path) {
      return errorResponse(400, 'Missing required parameters: offer, fragmentId, and path are required', logger);
    }

    // Validate required offer fields
    if (!params.offer.name || !params.offer.content) {
      return errorResponse(400, 'Missing required parameters: offer.name and offer.content are required', logger);
    }
    const { offer, fragmentId, path } = params;
    // Initialize OpenWhisk client
    const ow = openwhisk();
    
    // Call gettoken action to get access token with fully qualified name
    logger.debug('Fetching access token...');
    const namespace = params.AIO_RUNTIME_NAMESPACE || '';
    const actionName = namespace ? `/${namespace}/sling-da/gettoken` : 'sling-da/gettoken';
    const tokenResult = await ow.actions.invoke({
      name: actionName,
      blocking: true,
      result: true
    });

    if (!tokenResult.body || !tokenResult.body.access_token) {
      logger.error(`Token result error: ${JSON.stringify(tokenResult)}`);
      throw new Error(`Failed to obtain access token: ${JSON.stringify(tokenResult)}`);
    }

    const accessToken = tokenResult.body.access_token;
    logger.debug('Successfully obtained access token');

    // Initialize Target client
    logger.debug('Initializing Target client...');
    const targetClient = await targetSDK.init(
      params.ADOBE_TARGET_TENANT,
      params.ADOBE_CLIENT_ID,
      accessToken
    );
    logger.debug('Target client initialized');

    // Check if offer already exists for this fragment
    const existingOfferId = await getExistingOfferMapping(params.fragmentId, params.path, logger);
    let isUpdate = false;
    let response;

    // Format the offer according to Target API spec
    const workspaceId = params.ADOBE_TARGET_WORKSPACE_ID || offer.workspace ;
    if (!workspaceId) {
      logger.warn('No workspace ID provided in offer or environment variable.');
    }
    const offerData = {
      name: offer.name,
      content: offer.content,
      workspace: workspaceId
    };

    logger.debug(`Offer request data: ${JSON.stringify(offerData)}`);

    // Add options with proper headers for content type
    const options = {
      headers: {
        'Accept': 'application/vnd.adobe.target.v2+json',
      }
    };

    if (existingOfferId) {
      try {
        // Check if the offer still exists in Target
        await targetClient.getOfferById(existingOfferId, options);
        isUpdate = true;
        logger.info(`Offer ${existingOfferId} exists in Target, proceeding with update`);
      } catch (error) {
        logger.error(`Error checking offer existence: ${error}`);
        // Check if it's a TargetSDKError with 404
        if (error.name === 'TargetSDKError' && 
            error.message.includes('ERROR_GET_OFFER_BY_ID') && 
            error.message.includes('Not Found')) {
          logger.info(`Offer ${existingOfferId} does not exist in Target, will create new offer`);
          isUpdate = false;
        } else {
          throw new Error(`Failed to check offer existence: ${error.message}`);
        }
      }
    }

    if (isUpdate) {
      // Update existing offer
      logger.info('Updating existing offer in Adobe Target...');
      response = await targetClient.updateOffer(existingOfferId, offerData, options);
      logger.info(`Successfully updated offer: ${response.body.id}`);
    } else {
      // Create new offer
      logger.info('Creating new offer in Adobe Target...');
      logger.debug(`Payload for createOffer: ${JSON.stringify(offerData)}`);
      try {
        response = await targetClient.createOffer(offerData, options);
        logger.info(`Successfully created offer: ${response.body.id}`);
      } catch (error) {
        logger.error(`Error creating offer: ${error.message}, response: ${JSON.stringify(error.response)}`);
        throw error;
      }
    }

    // Update target exports with the new mapping
    await updateTargetExports(fragmentId, response.body.id, path, logger);

    return {
      statusCode: 200,
      body: JSON.stringify(response?.body),
      headers: {
        'Content-Type': 'application/json'
      }
    };

  } catch (error) {
    // Log the full error for debugging
    logger.error(`Error processing offer: ${error.message}`);
    // Log additional error details if available
    if (error.response) {
      logger.error(`Error response: ${JSON.stringify(error.response)}`);
    }
    if (error.body) {
      logger.error(`Error body: ${JSON.stringify(error.body)}`);
    }
    if (error.stack) {
      logger.error(`Error stack: ${error.stack}`);
    }
    // Build a detailed error object for the response
    const statusCode = error.statusCode || 500;
    const errorDetails = {
      message: error.message || 'An unknown error occurred',
      response: error.response || null,
      body: error.body || null,
      stack: error.stack || null
    };
    return errorResponse(statusCode, JSON.stringify(errorDetails), logger);
  }
}

/**
 * Removes a mapping from target exports file
 * @param {string} fragmentId - The fragment ID
 * @param {string} path - The page path
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
async function removeTargetExportsMapping(fragmentId, path, logger) {
  try {
    const files = await filesLib.init();
    logger.info(`Removing target exports mapping for fragmentId: ${fragmentId}, path: ${path}`);
    
    // Read existing file
    const existingFile = await files.read(TARGET_EXPORTS_FILE);
    const targetExports = JSON.parse(existingFile);
    
    // Remove the mapping
    targetExports.data = targetExports.data.filter(item => 
      !(item['fragment-id'] === fragmentId && item['path'] === path)
    );
    
    // Update total count
    targetExports.total = targetExports.data.length;
    
    // Write updated data back to file
    await files.write(TARGET_EXPORTS_FILE, JSON.stringify(targetExports, null, 2));
    logger.info('Target exports mapping removed successfully');
  } catch (error) {
    logger.error(`Error removing target exports mapping: ${error.message}`);
    throw new Error(`Failed to remove target exports mapping: ${error.message}`);
  }
}

exports.main = main;