// tools/media-library/modules/usage-modal.js

let currentUsagePopup = null;

function buildPreviewUrlFromPath(pagePath) {
  const parts = pagePath.split('/');
  const org = parts[1];
  const repo = parts[2];
  let rest = parts.slice(3).join('/');
  rest = rest.replace(/\.html$/, '');
  if (!rest.startsWith('/') && rest.length > 0) rest = `/${rest}`;
  if (rest === '/index') rest = '/';
  return `https://main--${repo}--${org}.aem.page${rest}`;
}

function buildLiveUrlFromPath(pagePath) {
  const parts = pagePath.split('/');
  const org = parts[1];
  const repo = parts[2];
  let rest = parts.slice(3).join('/');
  rest = rest.replace(/\.html$/, '');
  if (!rest.startsWith('/') && rest.length > 0) rest = `/${rest}`;
  if (rest === '/index') rest = '/';
  return `https://main--${repo}--${org}.aem.live${rest}`;
}

export function showUsageInfo(asset, triggerElement) {
  const existingPopup = document.querySelector('.usage-info-popup');
  if (existingPopup) {
    existingPopup.remove();
    return;
  }

  // Create background overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
  `;

  const popup = document.createElement('div');
  popup.className = 'usage-info-popup';

  // Handle usedIn as either string, array, or undefined
  let usedInPages = [];
  if (asset.usedIn) {
    if (typeof asset.usedIn === 'string') {
      usedInPages = asset.usedIn.split(',').map((p) => p.trim()).filter(Boolean);
    } else if (Array.isArray(asset.usedIn)) {
      usedInPages = asset.usedIn.filter(Boolean);
    }
  }

  let pagesHtml = '';
  if (usedInPages.length === 0) {
    pagesHtml = '<div class="usage-page-item no-pages">No pages found</div>';
  } else {
    // Group occurrences by page
    const pageOccurrences = {};

    // Initialize page occurrences
    usedInPages.forEach((pagePath) => {
      pageOccurrences[pagePath] = [];
    });

    // Add individual occurrences if available
    if (asset.occurrences && Array.isArray(asset.occurrences)) {
      asset.occurrences.forEach((occurrence) => {
        if (pageOccurrences[occurrence.pagePath]) {
          pageOccurrences[occurrence.pagePath].push(occurrence);
        }
      });
    }

    pagesHtml = `
      <div class="usage-table-wrapper">
        <table class="usage-table">
          <thead>
            <tr>
              <th class="page-column">Page</th>
              <th class="occurrences-column">Occurrences</th>
            </tr>
          </thead>
          <tbody>
            ${usedInPages.map((pagePath) => {
    const occurrences = pageOccurrences[pagePath] || [];
    const totalOccurrences = occurrences.length || 1;

    let displayPath = pagePath;
    if (displayPath.includes('index.html')) {
      displayPath = '/';
    }
    const previewUrl = buildPreviewUrlFromPath(pagePath);
    const liveUrl = buildLiveUrlFromPath(pagePath);
    const editUrl = `https://da.live/edit#${pagePath.replace(/\.html$/, '')}`;

    return `
      <tr>
        <td class="page-column">
          <div class="page-info">
            <div class="page-path">${displayPath}</div>
            <div class="page-actions">
              <a href="${editUrl}" target="_blank" rel="noopener" class="page-action-btn edit-btn">Edit</a>
              <a href="${previewUrl}" target="_blank" rel="noopener" class="page-action-btn preview-btn">Preview</a>
              <a href="${liveUrl}" target="_blank" rel="noopener" class="page-action-btn live-btn">Live</a>
            </div>
          </div>
        </td>
        <td class="occurrences-column">
          <div class="occurrence-summary">
            <span class="occurrence-count">${totalOccurrences} occurrence${totalOccurrences !== 1 ? 's' : ''}</span>
          </div>
          ${occurrences.length > 0 ? `
            <div class="occurrence-details">
              ${occurrences.map((o, index) => `
                <div class="occurrence-item ${o.hasAltText ? 'has-alt' : 'missing-alt'}">
                  <div class="occurrence-header">
                    <span class="occurrence-number">#${index + 1}</span>
                    <span class="occurrence-type">${o.occurrenceType || 'Image'}</span>
                    <span class="occurrence-status ${o.hasAltText ? 'has-alt' : 'missing-alt'}">
                      ${o.hasAltText ? '✓' : '⚠'}
                    </span>
                  </div>
                  ${!o.hasAltText ? `<div class="occurrence-context">"${o.contextualText || 'No context available'}"</div>` : ''}
                  ${o.hasAltText
    ? `<div class="alt-text">Alt: "${o.altText}"</div>`
    : `<div class="no-alt">
                      <div class="no-alt-header">No alt text</div>
                      <div class="no-alt-guidance">
                        <strong>How to fix:</strong>
                        <ol>
                          <li>Click the <strong>Edit</strong> button above to open the page in DA Live</li>
                          <li>Search for "${o.contextualText || 'this image'}" in the document</li>
                          <li>Find the image and add descriptive alt text</li>
                          <li>Save and publish the page</li>
                        </ol>
                      </div>
                    </div>`
}
                </div>
              `).join('')}
            </div>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Create asset preview thumbnail
  const assetThumbnail = asset.type === 'image'
    ? `<img src="${asset.src}" alt="${asset.alt}" class="asset-thumbnail" loading="lazy">`
    : `<div class="asset-thumbnail-placeholder">${asset.type.toUpperCase()}</div>`;

  popup.innerHTML = `
    <div class="usage-info-header">
      <div class="usage-header-content">
        <div class="asset-preview-section">
          <div class="asset-thumbnail-container">
            ${assetThumbnail}
          </div>
          <div class="asset-info">
            <div class="asset-name">${asset.name}</div>
            <div class="asset-meta">
              <span class="asset-type-badge ${asset.type}">${asset.type.toUpperCase()}</span>
              ${asset.type === 'image' ? `<span class="asset-dimensions">${asset.naturalWidth || '?'} × ${asset.naturalHeight || '?'}px</span>` : ''}
            </div>
          </div>
        </div>
        <div class="usage-title">
          <strong>Used in ${usedInPages.length} page${usedInPages.length !== 1 ? 's' : ''}</strong>
        </div>
      </div>
      <button class="usage-close-btn">×</button>
    </div>
    <div class="usage-pages-list">
      ${pagesHtml}
    </div>
    `;

  document.body.appendChild(overlay);
  document.body.appendChild(popup);
  currentUsagePopup = popup;

  const closeBtn = popup.querySelector('.usage-close-btn');
  // eslint-disable-next-line no-use-before-define
  closeBtn.addEventListener('click', () => closeUsagePopup());

  // Also close when clicking overlay
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      // eslint-disable-next-line no-use-before-define
      closeUsagePopup();
    }
  });

  const closeOnOutsideClick = (e) => {
    if (!popup.contains(e.target) && e.target !== triggerElement && e.target !== overlay) {
      // eslint-disable-next-line no-use-before-define
      closeUsagePopup();
      document.removeEventListener('click', closeOnOutsideClick);
    }
  };

  setTimeout(() => {
    document.addEventListener('click', closeOnOutsideClick);
  }, 100);
}

export function closeUsagePopup() {
  if (currentUsagePopup) {
    currentUsagePopup.remove();
    currentUsagePopup = null;
  }

  // Remove overlay
  const overlay = document.querySelector('div[style*="background: rgba(0, 0, 0, 0.5)"]');
  if (overlay) {
    overlay.remove();
  }
}
