/* eslint-disable no-undef */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Initialize the Asset Selector
async function init() {
  try {
    const { context, token } = await DA_SDK;

    // Define the redirect URI for authentication flow
    const redirectUri = window.location.origin + window.location.pathname;

    // Configure the auth service based on environment
    const authConfig = {
      imsClientId: 'darkalley', // Required parameter for AEM Assets Selectors
      imsScope: 'AdobeID,openid,additional_info.projectedProductContext,read_organizations', // Required parameter
      redirectUri, // Add redirect URI for authentication flow
      token, // Use the token from DA SDK
    };

    // Register the Assets Selectors Auth Service
    PureJSSelectors.registerAssetsSelectorsAuthService(authConfig);

    // Configuration for the Asset Selector
    const assetSelectorConfig = {
      repositoryId: context.org, // Use the organization ID from DA context
      handleSelection: (assets) => {
        // Handle the selected assets
        console.log('Selected assets:', assets);
        // You can implement your custom logic here
      },
      config: {
        copyMode: [
          {
            mimeType: 'image/*',
            value: 'reference',
          },
        ],
      },
    };

    // Render the Asset Selector
    PureJSSelectors.renderAssetSelectorWithAuthFlow(
      document.getElementById('asset-selector-container'),
      assetSelectorConfig,
    );

    // Store token for debug panel
    window.DA_TOKEN = token;
  } catch (error) {
    console.error('Error initializing Asset Selector:', error);
    document.getElementById('asset-selector-container').innerHTML = `
      <div style="color: red; padding: 20px;">
        Error initializing Asset Selector: ${error.message}
      </div>
    `;
  }
}

// Start initialization
init();
