// tools/media-library/modules/ui-events.js
// UI event handlers for Media Library

export function initUIEvents({
  assetBrowser: _assetBrowser,
  handleSearch,
  handleViewChange,
  handleAssetSelection: _handleAssetSelection,
}) {
  // Search input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      handleSearch(e.target.value);
    });
  }

  // View toggle buttons
  const viewBtns = document.querySelectorAll('.view-btn');
  viewBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const view = e.target.closest('.view-btn').dataset.view;
      handleViewChange(view);
    });
  });

  // Asset selection is handled in the main file
  // No need to register duplicate event listeners
}
