// tools/media-library/modules/empty-state.js
// Empty state handling for Media Library

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
