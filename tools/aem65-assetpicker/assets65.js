// Import SDK for Document Authoring
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Message handling utility
const messageUtils = {
  container: document.querySelector('.message-wrapper'),
  show(text, isError = false) {
    const message = this.container.querySelector('.message');
    message.innerHTML = text.replace(/\r?\n/g, '<br>');
    message.classList.toggle('error', isError);
  },
};

// Asset handling utility
const assetUtils = {
  container: document.querySelector('.assets-content'),
  addAsset(url) {
    const assetItem = document.createElement('div');
    assetItem.className = 'asset-item';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'asset-url';
    urlSpan.textContent = url;

    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button';
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(url);
      copyButton.textContent = 'Copied!';
      setTimeout(() => {
        copyButton.textContent = 'Copy';
      }, 2000);
    });

    assetItem.append(urlSpan, copyButton);
    this.container.appendChild(assetItem);
  },
  clearAssets() {
    this.container.innerHTML = '';
  },
};

// Initialize the asset picker
async function init() {
  // Add message event listener for asset picker response
  window.addEventListener('message', (event) => {
    // Verify message origin for security
    if (event.origin !== 'https://author1uswest2-28575322.prod.slingtv-b75.adobecqms.net/') return;

    try {
      const message = JSON.parse(event.data);

      if (message.data && Array.isArray(message.data)) {
        // Transform localhost URLs to production URLs
        const assets = message.data.map((asset) => {
          const path = asset.url.replace('https://author1uswest2-28575322.prod.slingtv-b75.adobecqms.net/', 'https://www.cmegroup.com');
          return path;
        });

        const copyBuffer = document.querySelector('#copy-buffer');
        copyBuffer.value = assets.join('\n');
        copyBuffer.select();
        document.execCommand('copy');

        alert(`Copied Asset:\n\n${assets.join('\n')}`);
        console.log('Copied production assets to clipboard:', assets);
      }
    } catch (error) {
      console.error('Error handling asset selection:', error);
    }
  });
}

init();