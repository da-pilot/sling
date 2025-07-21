// tools/media-library/modules/media-info-modal.js

let currentMediaInfoModal = null;

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

export function showMediaInfoModal(asset) {
  const existingModal = document.querySelector('.media-info-modal');
  if (existingModal) {
    existingModal.remove();
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

  const modal = document.createElement('div');
  modal.className = 'media-info-modal';

  // Handle usedIn as either string, array, or undefined
  let usedInPages = [];
  if (asset.usedIn) {
    if (typeof asset.usedIn === 'string') {
      usedInPages = asset.usedIn.split(',').map((p) => p.trim()).filter(Boolean);
    } else if (Array.isArray(asset.usedIn)) {
      usedInPages = asset.usedIn.filter(Boolean);
    }
  }

  // Create preview content based on asset type
  let previewContent = '';
  if (asset.type === 'image') {
    previewContent = `
      <div class="image-preview-container">
        <div class="image-controls">
          <button class="zoom-toggle-btn" id="zoomToggle" title="Toggle full size view">🔍</button>
        </div>
        <img src="${asset.src}" alt="${asset.alt}" class="preview-image" id="previewImage">
      </div>
    `;
  } else if (asset.type === 'video') {
    previewContent = `
      <div class="video-preview-container">
        <video controls class="preview-video">
          <source src="${asset.src}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      </div>
    `;
  } else {
    previewContent = `
      <div class="document-preview">
        <div class="document-icon">📄</div>
        <h4>${asset.name}</h4>
        <p>Document: ${asset.src}</p>
      </div>
    `;
  }

  // Create usage information
  let usageContent = '';
  if (usedInPages.length === 0) {
    usageContent = '<div class="usage-no-pages">No pages found</div>';
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

    // Check if there are any missing alt text occurrences
    const hasMissingAltText = asset.occurrences && asset.occurrences.some((o) => !o.hasAltText);

    const isLinkAsset = asset.type === 'link'
                       || asset.context === 'external-link'
                       || asset.context === 'media-link'
                       || asset.isExternal
                       || (asset.type === 'video' && (asset.context === 'external-link' || asset.context === 'media-link' || asset.isExternal));

    const warningText = isLinkAsset ? 'Missing Title' : 'Missing Alt Text';
    const warningDescription = isLinkAsset ? 'This link needs a descriptive title for accessibility.' : 'This image needs descriptive alt text for accessibility.';

    usageContent = `
      ${hasMissingAltText ? `
        <div class="usage-alt-warning">
          <div class="usage-alt-warning-header">
            <span class="usage-alt-warning-icon">⚠️</span>
            <span class="usage-alt-warning-text">${warningText}</span>
          </div>
          <div class="usage-alt-warning-content">
            <p>${warningDescription}</p>
          </div>
        </div>
      ` : ''}
      
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
    ? `<div class="alt-text">${isLinkAsset ? 'Title' : 'Alt'}: "${o.altText}"</div>`
    : `<div class="no-alt">
                      <div class="no-alt-header">No ${isLinkAsset ? 'title' : 'alt text'}</div>
                      <div class="no-alt-guidance">
                        <strong>How to fix:</strong>
                        <ol>
                          <li>Click the <strong>Edit</strong> button above to open the page in DA Live</li>
                          ${o.contextualText && o.contextualText !== 'No contextual text found' && o.contextualText !== 'No context available'
    ? `<li>Search for "${o.contextualText}" in the document</li>`
    : `<li>Locate the ${isLinkAsset ? 'link' : 'image'} on the page</li>`
}
                          <li>Add descriptive ${isLinkAsset ? 'title' : 'alt text'} to the ${isLinkAsset ? 'link' : 'image'}</li>
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

  modal.innerHTML = `
    <div class="media-info-modal-header">
      <div class="media-info-header-content">
        <div class="asset-name">${asset.name}</div>
      </div>
      <button class="media-info-close-btn">×</button>
    </div>
    
    <div class="media-info-modal-content">
      <div class="media-info-simple-layout">
        <div class="preview-section">
          ${previewContent}
          <div class="scroll-indicator" title="Scroll for usage info" style="display: block;">
            <div class="scroll-arrow">↓</div>
          </div>
        </div>
        
        <div class="usage-section">
          ${usageContent}
        </div>
      </div>
    </div>
    
    <div class="media-info-modal-footer">
      ${asset.isExternal ? '<button class="btn btn-secondary" id="insertAsLinkBtn">Insert as Link</button>' : ''}
      <button class="btn btn-primary" id="insertBtn">Insert</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  currentMediaInfoModal = modal;

  // Setup event listeners
  const closeBtn = modal.querySelector('.media-info-close-btn');
  // eslint-disable-next-line no-use-before-define
  closeBtn.addEventListener('click', () => closeMediaInfoModal());

  // Insert buttons
  const insertBtn = modal.querySelector('#insertBtn');
  const insertAsLinkBtn = modal.querySelector('#insertAsLinkBtn');

  insertBtn.addEventListener('click', () => {
    // Trigger asset insertion
    const event = new CustomEvent('insertAsset', { detail: { assetId: asset.id } });
    document.dispatchEvent(event);
    // eslint-disable-next-line no-use-before-define
    closeMediaInfoModal();
  });

  // Only add event listener for "Insert as Link" if the button exists (external assets only)
  if (insertAsLinkBtn) {
    insertAsLinkBtn.addEventListener('click', () => {
      // Trigger asset insertion as link
      const event = new CustomEvent('insertAssetAsLink', { detail: { assetId: asset.id } });
      document.dispatchEvent(event);
      // eslint-disable-next-line no-use-before-define
      closeMediaInfoModal();
    });
  }

  // Setup scroll indicator functionality
  const modalContent = modal.querySelector('.media-info-modal-content');
  const scrollIndicator = modal.querySelector('.scroll-indicator');

  if (modalContent && scrollIndicator) {
    // Add click handler to scroll indicator
    scrollIndicator.addEventListener('click', () => {
      // Scroll to the usage section
      const usageSection = modal.querySelector('.usage-section');
      if (usageSection) {
        usageSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    modalContent.addEventListener('scroll', () => {
      if (modalContent.scrollTop > 50) {
        modalContent.classList.add('scrolled');
      } else {
        modalContent.classList.remove('scrolled');
      }
    });
  }

  // Setup image functionality
  if (asset.type === 'image') {
    const img = modal.querySelector('.preview-image');
    const zoomBtn = modal.querySelector('#zoomToggle');

    if (img && zoomBtn) {
      img.onload = () => {
        // Check if image is smaller than modal and hide zoom button if so
        if (modal) {
          const modalWidth = modal.offsetWidth - 80;
          const modalHeight = modal.offsetHeight - 200;

          if (img.naturalWidth <= modalWidth && img.naturalHeight <= modalHeight) {
            zoomBtn.style.display = 'none';
          } else {
            zoomBtn.style.display = 'block';
          }
        }
      };

      // If image is already loaded
      if (img.complete) {
        if (modal) {
          const modalWidth = modal.offsetWidth - 80;
          const modalHeight = modal.offsetHeight - 200;

          if (img.naturalWidth <= modalWidth && img.naturalHeight <= modalHeight) {
            zoomBtn.style.display = 'none';
          } else {
            zoomBtn.style.display = 'block';
          }
        }
      }
    }

    // Setup zoom toggle functionality
    if (zoomBtn && img) {
      let isZoomed = false;
      zoomBtn.onclick = () => {
        isZoomed = !isZoomed;
        if (isZoomed) {
          img.classList.add('zoomed');
          zoomBtn.textContent = '🔍-';
          zoomBtn.title = 'Return to normal size';
        } else {
          img.classList.remove('zoomed');
          zoomBtn.textContent = '🔍';
          zoomBtn.title = 'View full size';
        }
      };
    }
  }

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      // eslint-disable-next-line no-use-before-define
      closeMediaInfoModal();
    }
  });

  // Close on escape key
  const closeOnEscape = (e) => {
    if (e.key === 'Escape') {
      // eslint-disable-next-line no-use-before-define
      closeMediaInfoModal();
      document.removeEventListener('keydown', closeOnEscape);
    }
  };
  document.addEventListener('keydown', closeOnEscape);
}

export function closeMediaInfoModal() {
  if (currentMediaInfoModal) {
    currentMediaInfoModal.remove();
    currentMediaInfoModal = null;
  }

  // Remove overlay
  const overlay = document.querySelector('div[style*="background: rgba(0, 0, 0, 0.5)"]');
  if (overlay) {
    overlay.remove();
  }

  // Also remove any existing media info modal
  const existingModal = document.querySelector('.media-info-modal');
  if (existingModal) {
    existingModal.remove();
  }
}