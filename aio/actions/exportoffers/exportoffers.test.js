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

// Mock dependencies
jest.mock('@adobe/aio-sdk');
jest.mock('@adobe/aio-lib-target');
jest.mock('openwhisk');
jest.mock('@adobe/aio-lib-files');

// Create mock logger instance
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn()
};

// Mock Core.Logger
Core.Logger.mockImplementation(() => mockLogger);

describe('exportoffers action', () => {
  let mockFiles;
  let mockTargetClient;
  let mockOpenWhisk;
  let mockRead;
  let mockWrite;
  let mockList;

  // Mock parameters
  const mockParams = {
    offer: {
      name: 'Test Offer',
      content: '<div>Test content</div>',
      workspace: 'Default Workspace'
    },
    fragmentId: 'test-fragment-id',
    path: '/test/path',
    ADOBE_TARGET_TENANT: 'test-tenant',
    ADOBE_CLIENT_ID: 'test-client-id',
    LOG_LEVEL: 'info'
  };

  // Mock responses
  const mockTokenResponse = {
    body: {
      access_token: 'test-access-token'
    }
  };

  const mockCreateOfferResponse = {
    body: {
      id: 'new-offer-id',
      name: 'Test Offer',
      content: '<div>Test content</div>',
      workspace: 'Default Workspace'
    }
  };

  const mockUpdateOfferResponse = {
    body: {
      id: 'existing-offer-id',
      name: 'Updated Offer',
      content: '<div>Updated content</div>',
      workspace: 'Default Workspace'
    }
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Initialize mock functions
    mockRead = jest.fn();
    mockWrite = jest.fn();
    mockList = jest.fn();

    // Setup files mock
    mockFiles = {
      read: mockRead,
      write: mockWrite,
      list: mockList
    };
    filesLib.init.mockResolvedValue(mockFiles);

    // Setup Target client mock
    mockTargetClient = {
      createOffer: jest.fn(),
      updateOffer: jest.fn(),
      getOfferById: jest.fn()
    };
    targetSDK.init.mockResolvedValue(mockTargetClient);

    // Setup OpenWhisk mock
    mockOpenWhisk = {
      actions: {
        invoke: jest.fn()
      }
    };
    openwhisk.mockImplementation(() => mockOpenWhisk);

    // Reset logger mock
    mockLogger.info.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.error.mockClear();
  });

  test('should successfully create a new offer', async () => {
    // Setup mocks
    mockOpenWhisk.actions.invoke.mockResolvedValue(mockTokenResponse);
    mockTargetClient.createOffer.mockResolvedValue(mockCreateOfferResponse);
    mockList.mockResolvedValue([]);
    mockRead.mockRejectedValue(new Error('File not found'));

    // Call the action
    const result = await require('./index').main(mockParams);

    // Verify response
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(mockCreateOfferResponse);

    // Verify function calls
    expect(mockOpenWhisk.actions.invoke).toHaveBeenCalledWith({
      name: '/916809-952dimlouse/sling-da/gettoken',
      blocking: true,
      result: true
    });
    expect(targetSDK.init).toHaveBeenCalledWith(
      mockParams.ADOBE_TARGET_TENANT,
      mockParams.ADOBE_CLIENT_ID,
      mockTokenResponse.body.access_token
    );
    expect(mockTargetClient.createOffer).toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalled();
  });

  test('should successfully update an existing offer', async () => {
    // Setup mocks
    mockOpenWhisk.actions.invoke.mockResolvedValue(mockTokenResponse);
    mockTargetClient.updateOffer.mockResolvedValue(mockUpdateOfferResponse);
    mockList.mockResolvedValue(['target-exports.json']);
    mockRead.mockResolvedValue(JSON.stringify({
      data: [{
        'fragment-id': mockParams.fragmentId,
        'path': mockParams.path,
        'offer-id': 'existing-offer-id'
      }]
    }));

    // Call the action
    const result = await require('./index').main(mockParams);

    // Verify response
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(mockUpdateOfferResponse);

    // Verify function calls
    expect(mockTargetClient.updateOffer).toHaveBeenCalledWith(
      'existing-offer-id',
      expect.any(Object),
      expect.any(Object)
    );
  });

  test('should handle missing required parameters', async () => {
    const invalidParams = {
      offer: {
        name: 'Test Offer'
      }
    };

    const result = await require('./index').main(invalidParams);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Missing required parameters: offer, fragmentId, and path are required'
    });
  });

  test('should handle missing offer fields', async () => {
    const invalidParams = {
      ...mockParams,
      offer: {
        name: 'Test Offer'
      }
    };

    const result = await require('./index').main(invalidParams);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Missing required parameters: offer.name and offer.content are required'
    });
  });

  test('should handle token fetch failure', async () => {
    mockOpenWhisk.actions.invoke.mockRejectedValue(new Error('Token fetch failed'));

    const result = await require('./index').main(mockParams);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Failed to obtain access token: Token fetch failed'
    });
  });

  test('should handle offer creation failure', async () => {
    mockOpenWhisk.actions.invoke.mockResolvedValue(mockTokenResponse);
    mockTargetClient.createOffer.mockRejectedValue(new Error('Offer creation failed'));

    const result = await require('./index').main(mockParams);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Offer creation failed'
    });
  });

  test('should handle target exports update failure', async () => {
    // Setup mocks for the failure case
    mockOpenWhisk.actions.invoke.mockResolvedValue(mockTokenResponse);
    mockTargetClient.createOffer.mockResolvedValue(mockCreateOfferResponse);
    mockList.mockRejectedValue(new Error('Failed to list file'));

    // Call the action
    const result = await require('./index').main(mockParams);

    // Verify response
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Failed to update target exports: Failed to list file'
    });

    // Verify logger was called with error
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error processing offer:',
      expect.any(Error)
    );
  });

  test('should handle deleted offer by creating new one even if mapping removal fails', async () => {
    // Setup mocks
    mockOpenWhisk.actions.invoke.mockResolvedValue(mockTokenResponse);
    mockTargetClient.getOfferById.mockRejectedValue({
      name: 'TargetSDKError',
      message: '[TargetSDK:ERROR_GET_OFFER_BY_ID] Error: Not Found'
    });
    mockTargetClient.createOffer.mockResolvedValue(mockCreateOfferResponse);
    mockList.mockResolvedValue(['target-exports.json']);
    mockRead.mockResolvedValue(JSON.stringify({
      data: [{
        'fragment-id': mockParams.fragmentId,
        'path': mockParams.path,
        'offer-id': 'deleted-offer-id'
      }]
    }));
    // Mock the removal to fail
    mockWrite.mockRejectedValueOnce(new Error('Failed to write file'));

    // Call the action
    const result = await require('./index').main(mockParams);

    // Verify response
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(mockCreateOfferResponse);

    // Verify function calls
    expect(mockTargetClient.getOfferById).toHaveBeenCalledWith('deleted-offer-id', expect.any(Object));
    expect(mockTargetClient.createOffer).toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledWith(
      'target-exports.json',
      expect.stringContaining(mockCreateOfferResponse.body.id)
    );

    // Verify error was logged but didn't affect the result
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error checking offer existence:',
      expect.objectContaining({
        name: 'TargetSDKError',
        message: expect.stringContaining('ERROR_GET_OFFER_BY_ID')
      })
    );
  });

  test('should handle getOfferById failure', async () => {
    // Setup mocks
    mockOpenWhisk.actions.invoke.mockResolvedValue(mockTokenResponse);
    mockTargetClient.getOfferById.mockRejectedValue(new Error('Failed to get offer'));
    mockList.mockResolvedValue(['target-exports.json']);
    mockRead.mockResolvedValue(JSON.stringify({
      data: [{
        'fragment-id': mockParams.fragmentId,
        'path': mockParams.path,
        'offer-id': 'existing-offer-id'
      }]
    }));

    // Call the action
    const result = await require('./index').main(mockParams);

    // Verify response
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Failed to get offer'
    });
  });
}); 