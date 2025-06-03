/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Import Web Component
import './palette/palette.js';

// seen at https://main--bacom-sandbox--adobecom.aem.page/tools/tags/tags.js
// async function getAemRepo(project, opts) {
//   const configUrl = `https://admin.da.live/config/${project.org}/${project.repo}`;
//   const resp = await fetch(configUrl, opts);
//   if (!resp.ok) return null;
//   const json = await resp.json();
//   const { value: repoId } = json.data.find((entry) => entry.key === 'aem.repositoryId');
//   if (repoId) return repoId;
//   return null;
// }

(async function init() {
  const { context, token, actions } = await DA_SDK;
  const colorBrowser = document.createElement('da-color-browser');
  colorBrowser.project = context.repo;
  colorBrowser.token = token;
  colorBrowser.actions = actions;
  document.body.append(colorBrowser);
}());