/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */

export function initUIEvents({
  assetBrowser: _assetBrowser,
  handleSearch,
  handleViewChange,
  handleAssetSelection: _handleAssetSelection,
}) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      handleSearch(e.target.value);
    });
  }

  const viewBtns = document.querySelectorAll('.view-btn');
  viewBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const { view } = e.target.closest('.view-btn').dataset;
      handleViewChange(view);
    });
  });
}
