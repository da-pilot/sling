import { CLOUDFLARE_AI_CONFIG, getCloudflareAIUrl, validateCloudflareConfig } from '../config/ai-config.js';

let currentModalData = null;

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = 'Copied to clipboard!';
    document.body.appendChild(toast);
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 2000);
  }).catch(() => {
    const toast = document.createElement('div');
    toast.className = 'toast-notification error';
    toast.textContent = 'Failed to copy to clipboard';
    document.body.appendChild(toast);
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 2000);
  });
}

async function generateAltTextWithCloudflare(imageUrl, imageName) {
  try {
    const configValidation = validateCloudflareConfig();
    if (!configValidation.isValid) {
      throw new Error('Cloudflare AI is not properly configured');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLOUDFLARE_AI_CONFIG.TIMEOUT);
    const response = await fetch(getCloudflareAIUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_AI_CONFIG.API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Generate a concise, descriptive alt text for this image. Focus on what's visually important and keep it under ${CLOUDFLARE_AI_CONFIG.MAX_ALT_TEXT_LENGTH} characters. Image name: ${imageName}`,
        images: [imageUrl],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Cloudflare API error: ${errorData.errors?.[0]?.message || response.statusText}`);
    }
    const result = await response.json();
    let generatedText = result.result?.response || result.result?.text || '';
    generatedText = generatedText.replace(/^["']|["']$/g, '');
    if (generatedText.length > CLOUDFLARE_AI_CONFIG.MAX_ALT_TEXT_LENGTH) {
      generatedText = `${generatedText.substring(0, CLOUDFLARE_AI_CONFIG.MAX_ALT_TEXT_LENGTH - 3)}...`;
    }
    return generatedText || null;
  } catch (error) {
    return null;
  }
}

export function closeMediaInfoModal() {
  if (currentModalData) {
    const { modal, overlay } = currentModalData;
    if (modal && modal.parentNode) {
      modal.remove();
    }
    if (overlay && overlay.parentNode) {
      overlay.remove();
    }
    currentModalData = null;
  }
  document.body.style.overflow = '';
  const remainingOverlays = document.querySelectorAll('.modal-overlay');
  remainingOverlays.forEach((overlay) => overlay.remove());
  const remainingModals = document.querySelectorAll('.media-info-modal');
  remainingModals.forEach((modal) => modal.remove());
}

window.clearStuckModals = function clearStuckModals() {
  document.querySelectorAll('.modal-overlay, .media-info-modal').forEach((el) => el.remove());
  document.querySelectorAll('div[style*="background: rgba(0, 0, 0, 0.5)"]').forEach((el) => el.remove());
  document.body.style.overflow = '';
  currentModalData = null;
};

/**
 * Build preview URL from page path
 */
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

/**
 * Build live URL from page path
 */
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

/**
 * Show media info modal
 */
export function showMediaInfoModal(media) {
  closeMediaInfoModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'media-info-modal';
  let usedInPages = [];
  if (media.usedIn) {
    if (typeof media.usedIn === 'string') {
      usedInPages = media.usedIn.split(',').map((p) => p.trim()).filter(Boolean);
    } else if (Array.isArray(media.usedIn)) {
      usedInPages = media.usedIn.filter(Boolean);
    }
  }
  let previewContent = '';
  if (media.type === 'image') {
    previewContent = `
      <div class="image-preview-container">
        <div class="image-controls">
          <button class="zoom-toggle-btn" id="zoomToggle" title="Toggle full size view">🔍</button>
        </div>
        <img src="${media.src}" alt="${media.alt}" class="preview-image" id="previewImage">
      </div>
    `;
  } else if (media.type === 'video') {
    previewContent = `
      <div class="video-preview-container">
        <video controls class="preview-video">
          <source src="${media.src}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      </div>
    `;
  } else {
    previewContent = `
      <div class="document-preview">
        <div class="document-icon">📄</div>
        <h4>${media.name}</h4>
        <p>Document: ${media.src}</p>
      </div>
    `;
  }
  let usageContent = '';
  if (usedInPages.length === 0) {
    usageContent = '<div class="usage-no-pages">No pages found</div>';
  } else {
    const pageOccurrences = {};
    usedInPages.forEach((pagePath) => {
      pageOccurrences[pagePath] = [];
    });
    if (media.occurrences && Array.isArray(media.occurrences)) {
      media.occurrences.forEach((occurrence) => {
        if (pageOccurrences[occurrence.pagePath]) {
          pageOccurrences[occurrence.pagePath].push(occurrence);
        }
      });
    }
    const hasMissingAltText = media.type !== 'video' && media.occurrences && media.occurrences.some((o) => !o.hasAltText);
    const isLinkMedia = media.type === 'link'
                       || media.context === 'external-link'
                       || media.context === 'internal-link'
                       || media.context === 'media-link'
                       || media.isExternal
                       || (media.type === 'video' && (media.context === 'external-link' || media.context === 'internal-link' || media.context === 'media-link' || media.isExternal));
    const warningText = isLinkMedia ? 'Missing Title' : 'Missing Alt Text';
    const warningDescription = isLinkMedia ? 'This link needs a descriptive title for accessibility.' : 'This image needs descriptive alt text for accessibility.';
    const fixInstructions = `
      <div class="fix-instructions">
        <strong>How to fix:</strong>
        <ol>
          <li>Click the <strong>Edit</strong> button below to open the page in DA Live</li>
          <li>Search for the context text (use copy button below)</li>
          <li>Add descriptive ${isLinkMedia ? 'title' : 'alt text'} to the ${isLinkMedia ? 'link' : 'image'}</li>
          <li>Save and publish the page</li>
        </ol>
      </div>
    `;
    usageContent = `
      ${hasMissingAltText ? `
        <div class="usage-alt-warning">
          <div class="usage-alt-warning-header">
            <span class="usage-alt-warning-icon">
              <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 0 18 18" width="18">
                <defs>
                  <style>
                    .fill {
                      fill: #464646;
                    }
                  </style>
                </defs>
                <title>S Alert 18 N</title>
                <rect id="Canvas" fill="#ff13dc" opacity="0" width="18" height="18" /><path class="fill" d="M8.5635,1.2895.2,16.256A.5.5,0,0,0,.636,17H17.364a.5.5,0,0,0,.436-.744L9.4365,1.2895a.5.5,0,0,0-.873,0ZM10,14.75a.25.25,0,0,1-.25.25H8.25A.25.25,0,0,1,8,14.75v-1.5A.25.25,0,0,1,8.25,13h1.5a.25.25,0,0,1,.25.25Zm0-3a.25.25,0,0,1-.25.25H8.25A.25.25,0,0,1,8,11.75v-6a.25.25,0,0,1,.25-.25h1.5a.25.25,0,0,1,.25.25Z" />
              </svg>
            </span>
            <span class="usage-alt-warning-text">${warningText}</span>
          </div>
          <div class="usage-alt-warning-content">
            <p>${warningDescription}</p>
            ${fixInstructions}
          </div>
        </div>
      ` : ''}
      <div class="usage-table-wrapper">
        <table class="usage-table">
          <thead>
            <tr>
              <th class="page-column">Page</th>
              <th class="occurrences-column">Usage</th>
            </tr>
          </thead>
          <tbody>
            ${usedInPages.map((pagePath) => {
    const occurrences = pageOccurrences[pagePath] || [];
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
          </div>
          ${occurrences.length > 0 ? `
            <div class="occurrence-details">
              ${occurrences.map((o, index) => `
                <div class="occurrence-item ${o.hasAltText ? 'has-alt' : 'missing-alt'}">
                  <div class="occurrence-header">
                    <span class="occurrence-number">#${index + 1}</span>
                    <span class="occurrence-type">${o.occurrenceType || 'Image'}</span>
                    <span class="occurrence-status ${o.hasAltText ? 'has-alt' : 'missing-alt'}">
                      ${o.hasAltText ? '✓' : `
                        <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 0 18 18" width="14">
                          <defs>
                            <style>
                              .fill {
                                fill: #464646;
                              }
                            </style>
                          </defs>
                          <title>S Alert 18 N</title>
                          <rect id="Canvas" fill="#ff13dc" opacity="0" width="18" height="18" /><path class="fill" d="M8.5635,1.2895.2,16.256A.5.5,0,0,0,.636,17H17.364a.5.5,0,0,0,.436-.744L9.4365,1.2895a.5.5,0,0,0-.873,0ZM10,14.75a.25.25,0,0,1-.25.25H8.25A.25.25,0,0,1,8,14.75v-1.5A.25.25,0,0,1,8.25,13h1.5a.25.25,0,0,1,.25.25Zm0-3a.25.25,0,0,1-.25.25H8.25A.25.25,0,0,1,8,11.75v-6a.25.25,0,0,1,.25-.25h1.5a.25.25,0,0,1,.25.25Z" />
                        </svg>
                      `}
                    </span>
                  </div>
                  ${!o.hasAltText ? `
                    <div class="occurrence-context">
                      "${o.contextualText || 'No context available'}"
                      ${o.contextualText ? `<button class="copy-context-btn" onclick="copyToClipboard('${o.contextualText}')" title="Copy to clipboard">📋</button>` : ''}
                    </div>
                    <div class="occurrence-status-text">
                      No ${isLinkMedia ? 'title' : 'alt text'}
                    </div>
                    <div class="occurrence-actions">
                      <button class="generate-ai-alt-btn" onclick="generateAIAltText('${media.id}', '${o.occurrenceId || index}')" title="Generate AI alt text">
                        <span class="ai-btn-text">Generate Alt Text</span>
                        <span class="ai-btn-icon">✨</span>
                      </button>
                    </div>
                  ` : `
                    <div class="alt-text">${isLinkMedia ? 'Title' : 'Alt'}: "${o.altText}"</div>
                  `}
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
        <div class="media-name">${media.name}</div>
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
      ${media.isExternal ? '<button class="btn btn-secondary" id="insertAsLinkBtn">Insert as Link</button>' : ''}
      <button class="btn btn-primary" id="insertBtn">Insert</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  const closeBtn = modal.querySelector('.media-info-close-btn');
  closeBtn.addEventListener('click', () => closeMediaInfoModal());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeMediaInfoModal();
    }
  });
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      closeMediaInfoModal();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
  const insertBtn = modal.querySelector('#insertBtn');
  const insertAsLinkBtn = modal.querySelector('#insertAsLinkBtn');
  insertBtn.addEventListener('click', () => {
    const event = new CustomEvent('insertMedia', { detail: { mediaId: media.id } });
    document.dispatchEvent(event);
    closeMediaInfoModal();
  });
  if (insertAsLinkBtn) {
    insertAsLinkBtn.addEventListener('click', () => {
      const event = new CustomEvent('insertMediaAsLink', { detail: { mediaId: media.id } });
      document.dispatchEvent(event);
      closeMediaInfoModal();
    });
  }
  const modalContent = modal.querySelector('.media-info-modal-content');
  const scrollIndicator = modal.querySelector('.scroll-indicator');
  if (modalContent && scrollIndicator) {
    scrollIndicator.addEventListener('click', () => {
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
  window.generateAIAltText = function generateAIAltText(mediaId, occurrenceId) {
    const button = window.event.target.closest('.generate-ai-alt-btn');
    const btnText = button.querySelector('.ai-btn-text');
    const btnIcon = button.querySelector('.ai-btn-icon');
    const originalText = btnText.textContent;
    const originalIcon = btnIcon.textContent;
    btnText.textContent = 'Generating...';
    btnIcon.textContent = '⏳';
    button.disabled = true;
    const mediaData = currentModalData?.media || {};
    const imageUrl = mediaData.src;
    const imageName = mediaData.name || 'image';
    generateAltTextWithCloudflare(imageUrl, imageName)
      .then((generatedAltText) => {
        if (generatedAltText) {
          btnText.textContent = 'Copy Generated Text';
          btnIcon.textContent = '📋';
          button.onclick = () => copyToClipboard(generatedAltText);
          const toast = document.createElement('div');
          toast.className = 'toast-notification success';
          toast.innerHTML = `
            <div>Generated alt text:</div>
            <div style="font-style: italic; margin-top: 4px;">"${generatedAltText}"</div>
          `;
          document.body.appendChild(toast);
          setTimeout(() => {
            if (toast.parentNode) {
              document.body.removeChild(toast);
            }
          }, 4000);
        } else {
          throw new Error('No alt text generated');
        }
      })
      .catch(() => {
        btnText.textContent = 'Retry';
        btnIcon.textContent = '🔄';
        const toast = document.createElement('div');
        toast.className = 'toast-notification error';
        toast.textContent = 'AI generation failed. Please try again.';
        document.body.appendChild(toast);
        setTimeout(() => {
          if (toast.parentNode) {
            document.body.removeChild(toast);
          }
        }, 3000);
      })
      .finally(() => {
        setTimeout(() => {
          btnText.textContent = originalText;
          btnIcon.textContent = originalIcon;
          button.disabled = false;
          button.onclick = () => generateAIAltText(mediaId, occurrenceId);
        }, 10000);
      });
  };

  currentModalData = { modal, overlay, media };
}