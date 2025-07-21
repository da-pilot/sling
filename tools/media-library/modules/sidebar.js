/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */

function updateSidebarCounts(assets, currentPage) {
  const imageCount = assets.filter((a) => a.type === 'image').length;
  const videoCount = assets.filter((a) => a.type === 'video').length;
  const documentCount = assets.filter((a) => a.type === 'document').length;
  const internalCount = assets.filter((a) => a.isExternal === false).length;
  const externalCount = assets.filter((a) => a.isExternal === true).length;
  const totalCount = assets.length;
  const missingAltCount = assets.filter((a) => {
    if (a.type !== 'image') return false;

    if (a.occurrences && a.occurrences.length > 0) {
      return a.occurrences.some((o) => !o.hasAltText);
    }

    return !a.alt || a.alt.trim() === '' || a.alt === 'Untitled';
  }).length;

  const setCount = (id, count) => {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  };
  setCount('totalCount', totalCount);
  setCount('internalCount', internalCount);
  setCount('externalCount', externalCount);
  setCount('imageCount', imageCount);
  setCount('videoCount', videoCount);
  setCount('documentCount', documentCount);
  setCount('missingAltCount', missingAltCount);

  let usedOnPageCount = '-';
  let usedInternalCount = '-';
  let usedExternalCount = '-';
  let usedMissingAltCount = '-';

  function normalizePath(path) {
    try {
      if (path.startsWith('http')) {
        return new URL(path).pathname;
      }
      return path;
    } catch {
      return path;
    }
  }

  if (currentPage) {
    const normalizedCurrentPage = normalizePath(currentPage);
    const usedOnPage = assets.filter((a) => {
      if (!a.usedIn) return false;

      let usedInArr = [];
      if (typeof a.usedIn === 'string') {
        usedInArr = a.usedIn.split(',').map((s) => normalizePath(s.trim()));
      } else if (Array.isArray(a.usedIn)) {
        usedInArr = a.usedIn.map((s) => normalizePath(s));
      }

      return usedInArr.includes(normalizedCurrentPage);
    });
    usedOnPageCount = usedOnPage.length;
    usedInternalCount = usedOnPage.filter((a) => a.isExternal === false).length;
    usedExternalCount = usedOnPage.filter((a) => a.isExternal === true).length;
    usedMissingAltCount = usedOnPage.filter((a) => {
      if (a.type !== 'image') return false;

      if (a.occurrences && a.occurrences.length > 0) {
        const pageOccurrences = a.occurrences.filter((o) => normalizePath(o.pagePath) === normalizedCurrentPage);
        return pageOccurrences.some((o) => !o.hasAltText);
      }

      return !a.alt || a.alt.trim() === '' || a.alt === 'Untitled';
    }).length;
  }
  setCount('usedOnPageCount', usedOnPageCount);
  setCount('usedInternalCount', usedInternalCount);
  setCount('usedExternalCount', usedExternalCount);
  setCount('usedMissingAltCount', usedMissingAltCount);
}

export { updateSidebarCounts };
