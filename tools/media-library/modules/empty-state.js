/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */

/**
 * Show empty state when no assets are found
 */
function showEmptyState() {
  const grid = document.getElementById('assetsGrid');
  if (grid) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📁</div>
        <h3 class="empty-state__title">No assets found</h3>
        <p class="empty-state__description">
          No media assets have been discovered yet. The system is scanning your content 
          for images, videos, and documents.
        </p>
      </div>
    `;
  }
}

export { showEmptyState };
