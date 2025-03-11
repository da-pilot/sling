// Import SDK
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Import Web Component
import './tagger.js';

(async function init() {
  const { context, token, actions } = await DA_SDK;
  const tagBrowser = document.createElement('da-tag-browser');
  tagBrowser.project = context.repo;
  tagBrowser.token = token;
  tagBrowser.actions = actions;
  document.body.append(tagBrowser);
}());