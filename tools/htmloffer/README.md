# Adobe Target HTML Offer Integration

This guide provides a complete step-by-step walkthrough for setting up Adobe Target HTML Offer integration with your EDS (Experience-Driven Sites) project. The integration allows content authors to export any block or section as an HTML Offer directly to Adobe Target for A/B testing and personalization campaigns.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Setting up Adobe IO Project](#setting-up-adobe-io-project)
4. [Installing CLI and Testing Integration](#installing-cli-and-testing-integration)
5. [Creating Adobe IO Actions](#creating-adobe-io-actions)
6. [Deploying and Testing](#deploying-and-testing)
7. [EDS Project Implementation](#eds-project-implementation)
8. [Using HTML Offers in VEC Editor](#using-html-offers-in-vec-editor)
9. [Troubleshooting](#troubleshooting)
10. [References](#references)

## Overview

The Adobe Target HTML Offer integration consists of:

- **Frontend**: Export dialog for content authors to select blocks/sections and export to Target
- **Backend**: Adobe IO Runtime actions for authentication and Target API integration
- **Automation**: Fragment ID system for identifying exportable content
- **Rendering**: Automatic event rebinding for Target-delivered content

## Prerequisites

- Adobe Experience Cloud account with Target access
- Admin access to Adobe Developer Console
- Node.js 18+ installed
- Access to your EDS project repository
- Basic understanding of Adobe Target and Adobe IO Runtime

## Setting up Adobe IO Project

### Step 1: Access Adobe Developer Console

1. Go to [Adobe Developer Console](https://console.adobe.io/)
2. Sign in with your Adobe ID
3. Ensure your account has both **Product Admin** and **Developer** level access to Target

### Step 2: Create New Project

1. Select your Experience Cloud Organization
2. Click **Create new project**
3. Choose **Create an empty project**
4. Give it a meaningful name (e.g., "Target HTML Offer Integration")

### Step 3: Add Adobe Target API

1. Click **Add API** to add a REST API
2. Search for and select **Adobe Target**
3. Click **Next**

### Step 4: Configure Service Account (JWT)

1. Select **Option 1: Generate a key pair**
2. Click **Generate keypair**
3. **Download the `config` file** (contains your private key)
4. Click **Next**

**⚠️ Important**: JWT credentials will be deprecated on January 1, 2025. Plan to migrate to OAuth Server-to-Server credentials.

### Step 5: Select Product Profile

1. Choose product profile(s) corresponding to your Target properties
2. If not using properties, select **Default Workspace**
3. Click **Save configured API**

### Step 6: Create Integration

1. Click **Create Integration**
2. Rename your project to something meaningful
3. Note your **Client ID** and **Client Secret**

### Step 7: Configure JWT Scopes

1. Go to **Service Account (JWT)** section
2. Add these required scopes:
   ```
   openid
   AdobeID
   target_sdk
   target_admin
   target_write
   target_read
   additional_info.projectedProductContext
   read_organizations
   additional_info.roles
   ```

## Installing CLI and Testing Integration

### Step 1: Install Adobe IO CLI

```bash
npm install -g @adobe/aio-cli
```

### Step 2: Login to Adobe IO

```bash
aio login
```

### Step 3: Create Runtime Namespace

```bash
# List existing namespaces
aio runtime namespace list

# Create new namespace if needed
aio runtime namespace create
```

### Step 4: Test Authentication (Optional)

You can test your authentication setup using Postman:

1. **Export Project Details to Postman**:
   - In Adobe Developer Console, go to your project's **Service Account (JWT)** section
   - Click **Download for Postman** > **Service Account (JWT)**
   - Import the JSON file into Postman

2. **Generate Access Token**:
   - Import the [Adobe I/O Access Token Generation Postman collection](https://experienceleague.adobe.com/en/docs/target-dev/developer/api/configure-authentication)
   - Use the **IMS: JWT Generate + Auth via User Token** request
   - Note: Token is valid for 24 hours

3. **Test Target API**:
   - Import the Adobe Target Admin APIs Postman Collection
   - Use the **List activities** request to verify authentication

## Creating Adobe IO Actions

### Step 1: Project Structure

Your Adobe IO project should have this structure:

```
aio/
├── actions/
│   ├── gettoken/
│   │   └── index.js
│   └── exportoffers/
│       └── index.js
├── app.config.yaml
└── package.json
```

### Step 2: Dependencies

Ensure your `package.json` includes:

```json
{
  "dependencies": {
    "@adobe/aio-sdk": "^3.0.0",
    "@adobe/aio-lib-files": "^3.0.0",
    "@adobe/aio-lib-target": "^4.0.1",
    "openwhisk": "^3.21.7"
  }
}
```

### Step 3: Configuration

Your `app.config.yaml` should look like:

```yaml
application:
  actions: actions
  web: false
  runtimeManifest:
    packages:
      sling-da:
        license: Apache-2.0
        actions:
          gettoken:
            function: actions/gettoken/index.js
            web: false
            runtime: nodejs:18
            inputs:
              ADOBE_CLIENT_ID: $SERVICE_API_KEY
              ADOBE_CLIENT_SECRET: $ADOBE_CLIENT_SECRET
              ADOBE_TARGET_SCOPES: $ADOBE_TARGET_SCOPES
              LOG_LEVEL: info
            annotations:
              final: true
              require-adobe-auth: false
            limits:
              timeout: 60000
              memorySize: 1024

          exportoffers:
            function: actions/exportoffers/index.js
            web: true
            runtime: nodejs:18
            inputs:
              ADOBE_CLIENT_ID: $ADOBE_CLIENT_ID
              ADOBE_TARGET_TENANT: 'your-tenant-id'
              LOG_LEVEL: info
              AIO_RUNTIME_NAMESPACE: $AIO_RUNTIME_NAMESPACE
              ADOBE_TARGET_WORKSPACE_ID: 'your-workspace-id'
            annotations:
              final: true
              require-adobe-auth: false
            limits:
              timeout: 60000
              memorySize: 1024
```

### Step 4: Get Token Action

Create `aio/actions/gettoken/index.js`:

```javascript
const { Core } = require('@adobe/aio-sdk');
const fetch = require('node-fetch');
const { errorResponse } = require('../utils');

const TOKEN_CACHE_KEY = 'adobe_access_token';

async function main(params) {
  const logger = Core.Logger('gettoken', { level: params.LOG_LEVEL || 'info' });
  
  try {
    if (!params.ADOBE_CLIENT_ID || !params.ADOBE_CLIENT_SECRET) {
      throw new Error('Missing required environment variables: ADOBE_CLIENT_ID and/or ADOBE_CLIENT_SECRET');
    }

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
      throw new Error(data.error_description || 'Failed to get access token');
    }

    return {
      statusCode: 200,
      body: {
        access_token: data.access_token,
        cached: false
      }
    };

  } catch (error) {
    logger.error('Error getting access token:', error);
    return errorResponse(500, error, logger);
  }
}

exports.main = main;
```

### Step 5: Export Offers Action

Create `aio/actions/exportoffers/index.js`:

```javascript
const { Core } = require('@adobe/aio-sdk');
const { errorResponse } = require('../utils');
const targetSDK = require('@adobe/aio-lib-target');
const openwhisk = require('openwhisk');
const filesLib = require('@adobe/aio-lib-files');

const TARGET_EXPORTS_FILE = 'target-exports.json';

async function main(params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' });
  
  try {
    if (!params.offer || !params.fragmentId || !params.path) {
      return errorResponse(400, 'Missing required parameters: offer, fragmentId, and path are required', logger);
    }

    const { offer, fragmentId, path } = params;
    
    // Get access token
    const ow = openwhisk();
    const namespace = params.AIO_RUNTIME_NAMESPACE || '';
    const actionName = namespace ? `/${namespace}/sling-da/gettoken` : 'sling-da/gettoken';
    
    const tokenResult = await ow.actions.invoke({
      name: actionName,
      blocking: true,
      result: true
    });

    if (!tokenResult.body || !tokenResult.body.access_token) {
      throw new Error('Failed to obtain access token');
    }

    const accessToken = tokenResult.body.access_token;

    // Initialize Target client
    const targetClient = await targetSDK.init(
      params.ADOBE_TARGET_TENANT,
      params.ADOBE_CLIENT_ID,
      accessToken
    );

    // Check if offer already exists
    const existingOfferId = await getExistingOfferMapping(fragmentId, path, logger);
    let isUpdate = false;
    let response;

    const offerData = {
      name: offer.name,
      content: offer.content,
      workspace: params.ADOBE_TARGET_WORKSPACE_ID
    };

    const options = {
      headers: {
        'Accept': 'application/vnd.adobe.target.v2+json',
      }
    };

    if (existingOfferId) {
      // Update existing offer
      response = await targetClient.updateOffer(existingOfferId, offerData, options);
      logger.info(`Successfully updated offer: ${response.body.id}`);
    } else {
      // Create new offer
      response = await targetClient.createOffer(offerData, options);
      logger.info(`Successfully created offer: ${response.body.id}`);
    }

    // Update target exports mapping
    await updateTargetExports(fragmentId, response.body.id, path, logger);

    return {
      statusCode: 200,
      body: JSON.stringify(response?.body),
      headers: {
        'Content-Type': 'application/json'
      }
    };

  } catch (error) {
    logger.error(`Error processing offer: ${error.message}`);
    return errorResponse(500, error, logger);
  }
}

exports.main = main;
```

## Deploying and Testing

### Step 1: Deploy Actions

```bash
# Navigate to your aio directory
cd aio

# Deploy the application
aio app deploy
```

### Step 2: Set Environment Variables

```bash
# Set required environment variables
aio app config set ADOBE_CLIENT_ID your_client_id
aio app config set ADOBE_CLIENT_SECRET your_client_secret
aio app config set ADOBE_TARGET_SCOPES "openid,AdobeID,target_sdk,target_admin,target_write,target_read,additional_info.projectedProductContext,read_organizations,additional_info.roles"
aio app config set AIO_RUNTIME_NAMESPACE your_runtime_namespace
aio app config set ADOBE_TARGET_TENANT your_tenant_id
aio app config set ADOBE_TARGET_WORKSPACE_ID your_workspace_id
```

### Step 3: Test Actions

```bash
# Test gettoken action
aio runtime action invoke sling-da/gettoken

# Test exportoffers action (requires parameters)
aio runtime action invoke sling-da/exportoffers --param '{"offer":{"name":"Test","content":"<div>Test</div>"},"fragmentId":"test123","path":"/test"}'
```

### Step 4: Verify Deployment

```bash
# List deployed actions
aio runtime action list

# Check action details
aio runtime action get sling-da/gettoken
aio runtime action get sling-da/exportoffers
```

## EDS Project Implementation

### Step 1: Fragment ID System

The system automatically creates fragment IDs using CSS classes with the pattern `fragment-id-{UUID}`.

#### How Fragment IDs Work:

1. **CSS Class Pattern**: `fragment-id-{uuid}`
2. **Automatic Processing**: System scans for these classes during page load
3. **Attribute Conversion**: Converts to `data-fragment-id` attribute
4. **Export Button**: Automatically appears for blocks with fragment IDs

#### Example HTML:

```html
<div class="block banner-image fragment-id-abc123-def456-ghi789">
  <!-- Block content -->
</div>
```

#### Automatic Processing:

```javascript
// From eds/scripts/utils.js
export async function setFragmentIds(main) {
  const blocks = [...main.querySelectorAll('div.block')];
  blocks.forEach((block) => {
    const classes = Array.from(block.classList);
    const fragmentClass = classes.find((cls) => cls.startsWith('fragment-id-'));
    if (fragmentClass) {
      const fragmentId = fragmentClass.replace('fragment-id-', '');
      block.setAttribute('data-fragment-id', fragmentId);
      block.classList.remove(fragmentClass);
    }
  });
}
```

### Step 2: Fragment ID Creation Tools

#### Properties Tool (Recommended)

The `tools/properties/properties.js` automatically generates UUIDs:

```javascript
// Generate UUID when button is clicked
const uuid = crypto.randomUUID();
actions.sendText(`fragment-id|${uuid}`);
```

#### Manual Creation

Add CSS classes directly to HTML:

```html
<div class="block hero fragment-id-123e4567-e89b-12d3-a456-426614174000">
  <!-- Hero content -->
</div>
```

### Step 3: Export Button Integration

#### Sidekick Integration

The `eds/scripts/utils.js` creates export buttons for blocks with fragment IDs:

```javascript
const createExportButton = () => {
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-button';

  const exportIcon = document.createElement('img');
  exportIcon.src = '/.da/icons/export-to-target.png';
  exportIcon.className = 'export-icon';
  exportIcon.alt = '';

  const exportText = document.createElement('span');
  exportText.textContent = 'Export to Target';

  exportBtn.append(exportIcon, exportText);
  exportBtn.addEventListener('click', handleExportClick);
  return exportBtn;
};
```

#### Button Display Logic

```javascript
// Only show export button for blocks with fragment IDs
if (block.getAttribute('data-fragment-id')) {
  header.append(createExportButton());
}
```

### Step 4: Export Dialog

#### HTML Structure

```html
<!-- tools/htmloffer/htmloffer.html -->
<div class="offer-dialog">
  <div class="dialog-header">
    <h2>Create HTML Offer</h2>
    <button type="button" class="btn-close" aria-label="Close dialog">&times;</button>
  </div>
  <form id="offerForm">
    <div class="form-group">
      <label for="offer-name">Offer Name</label>
      <input type="text" id="offer-name" name="offer-name" required>
    </div>
    <div class="form-group">
      <label for="block-html">Block HTML</label>
      <textarea id="block-html" name="blockHtml" rows="6" required></textarea>
    </div>
    <div class="button-wrapper">
      <div class="message-wrapper"></div>
      <div class="button-group">
        <button type="submit" class="btn-export">Export</button>
        <button type="button" class="btn-reset">Reset</button>
      </div>
    </div>
  </form>
</div>
```

#### JavaScript Logic

```javascript
// tools/htmloffer/htmloffer.js
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const params = {
    offer: {
      name: offerNameInput.value.trim(),
      content: formatHTMLForAPI(blockHtmlInput.value),
    },
    fragmentId,
    path: window.location.pathname,
  };

  const response = await fetch(`https://${RUNTIME_NAMESPACE}.adobeioruntime.net/api/v1/web/sling-da/exportoffers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const responseData = await response.json();
  // Handle response...
});
```

### Step 5: Content Highlighting

#### CSS for Exportable Blocks

```css
/* eds/scripts/utils.js creates headers for exportable blocks */
.block-header {
  /* Header styling */
}

.export-button {
  /* Export button styling */
}

.export-icon {
  /* Icon styling */
}
```

#### JavaScript Highlighting

```javascript
// Show blocks with fragment IDs
const showBlocks = ({ detail: payload }) => {
  const blocks = document.querySelectorAll('div.block');
  blocks.forEach((block) => {
    const name = block.getAttribute('data-block-name');
    if (name && block.getAttribute('data-fragment-id')) {
      // Add header with export button
      if (!block.querySelector('.block-header')) {
        const header = document.createElement('div');
        header.className = 'block-header';
        // ... header creation logic
      }
    }
  });
};
```

### Step 6: Event Rebinding System

#### Automatic Event Rebinding

The system automatically rebinds events for Target-delivered content:

```javascript
// From eds/scripts/scripts.js
function setupBlockObserver() {
  const blocksToObserve = [
    'carousel', 'accordion', 'tabs', 'modal', 'image-slider',
    'game-finder', 'channel-lookup', 'chat', 'marquee',
    'offer-cards', 'channel-shopper', 'category'
  ];

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Process added nodes and rebind events
        mutation.addedNodes.forEach((node) => {
          // ... rebinding logic
        });
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
```

#### Example: Carousel Rebinding

```javascript
// From eds/blocks/carousel/carousel.js
export function rebindEvents(block) {
  const prevButton = block.querySelector('.slide-prev');
  const nextButton = block.querySelector('.slide-next');

  if (prevButton && nextButton) {
    // Remove existing listeners and add new ones
    prevButton.replaceWith(prevButton.cloneNode(true));
    nextButton.replaceWith(nextButton.cloneNode(true));

    // Get fresh references and rebind events
    const newPrevButton = block.querySelector('.slide-prev');
    const newNextButton = block.querySelector('.slide-next');

    newPrevButton.addEventListener('click', () => {
      const currentSlide = parseInt(block.dataset.activeSlide, 10) || 0;
      showSlide(block, currentSlide - 1);
    });

    newNextButton.addEventListener('click', () => {
      const currentSlide = parseInt(block.dataset.activeSlide, 10) || 0;
      showSlide(block, currentSlide + 1);
    });
  }
}
```

## Using HTML Offers in VEC Editor

### Step 1: Access Adobe Target

1. Log into Adobe Experience Cloud
2. Navigate to Adobe Target
3. Go to **Offers** > **Code Offers**

### Step 2: Locate Your HTML Offers

1. Your exported offers will appear in the **Code Offers** section
2. Offers are named according to what you specified during export
3. Each offer contains the HTML content from your blocks/sections

### Step 3: Use in VEC Editor

1. **Create Activity**: Go to **Activities** > **Create Activity**
2. **Choose Activity Type**: Select your desired activity type (A/B Test, Experience Targeting, etc.)
3. **Enter URL**: Specify the page where you want to test
4. **Open VEC Editor**: Click **Next** to open the Visual Experience Composer
5. **Apply HTML Offer**:
   - Click on the element you want to replace
   - Choose **Replace Content** action
   - Select **HTML Offer**
   - Choose your exported HTML offer
6. **Save and Test**: Save your activity and start testing

### Step 4: Targeting and Scheduling

1. **Audience Targeting**: Define who should see the offer
2. **Goals and Metrics**: Set up conversion tracking
3. **Schedule**: Set start and end dates
4. **Activate**: Launch your activity

## Troubleshooting

### Common Issues

#### 1. Authentication Errors

**Problem**: "Failed to obtain access token"

**Solutions**:
- Verify `ADOBE_CLIENT_ID` and `ADOBE_CLIENT_SECRET` are correct
- Check JWT scopes are properly configured
- Ensure service account has proper Target permissions

#### 2. Runtime Errors

**Problem**: "Action not found" or deployment failures

**Solutions**:
- Verify namespace exists: `aio runtime namespace list`
- Check action deployment: `aio runtime action list`
- Ensure environment variables are set: `aio app config get`

#### 3. Target API Errors

**Problem**: "Failed to create/update offer"

**Solutions**:
- Verify Target tenant ID is correct
- Check workspace ID exists and is accessible
- Ensure service account has proper Target permissions

#### 4. Fragment ID Issues

**Problem**: Export buttons not appearing

**Solutions**:
- Check CSS class format: `fragment-id-{uuid}`
- Verify `setFragmentIds()` function is called
- Check browser console for JavaScript errors

### Debug Commands

```bash
# Check action status
aio runtime action list
aio runtime action get sling-da/gettoken
aio runtime action get sling-da/exportoffers

# View logs
aio runtime activation list
aio runtime activation logs activation_id

# Test actions manually
aio runtime action invoke sling-da/gettoken
```

### Environment Variable Checklist

```bash
# Required variables
ADOBE_CLIENT_ID=your_client_id
ADOBE_CLIENT_SECRET=your_client_secret
ADOBE_TARGET_SCOPES=openid,AdobeID,target_sdk,target_admin,target_write,target_read,additional_info.projectedProductContext,read_organizations,additional_info.roles
AIO_RUNTIME_NAMESPACE=your_runtime_namespace
ADOBE_TARGET_TENANT=your_tenant_id
ADOBE_TARGET_WORKSPACE_ID=your_workspace_id
```

## References

### Official Documentation

- [Adobe Target Developer Guide](https://experienceleague.adobe.com/en/docs/target-dev/developer/api/configure-authentication)
- [Adobe IO Console](https://console.adobe.io/)
- [Adobe IO CLI](https://github.com/adobe/aio-cli)
- [Adobe Target API Reference](https://developer.adobe.com/target/apis/)

### Migration Information

- **JWT Deprecation**: Service Account (JWT) credentials will be deprecated on January 1, 2025
- **Migration Guide**: Available in Adobe Developer Console documentation
- **OAuth Server-to-Server**: New recommended authentication method

### Code Examples

- **Complete Implementation**: See the `tools/htmloffer/` directory
- **Adobe IO Actions**: See the `aio/actions/` directory
- **EDS Integration**: See the `eds/scripts/utils.js` file

### Support Resources

- [Adobe Target Community](https://experienceleaguecommunities.adobe.com/t5/adobe-target/ct-p/adobe-target-community)
- [Adobe IO Community](https://experienceleaguecommunities.adobe.com/t5/adobe-io/ct-p/adobe-io)
- [Adobe Developer Support](https://developer.adobe.com/support/)

---

## Quick Start Checklist

- [ ] Adobe IO Project created with Target API
- [ ] JWT scopes configured
- [ ] Adobe IO CLI installed and configured
- [ ] Actions deployed to runtime
- [ ] Environment variables set
- [ ] Fragment IDs added to blocks/sections
- [ ] Export functionality tested
- [ ] HTML Offers verified in Target console

This integration provides a seamless workflow from content creation to A/B testing, enabling content authors to quickly export and test different content variations in Adobe Target.
