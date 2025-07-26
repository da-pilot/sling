
function updateSidebarCounts(media, currentPage) {
  const imageCount = media.filter((a) => a.type === 'image').length;
  const videoCount = media.filter((a) => a.type === 'video').length;
  const documentCount = media.filter((a) => a.type === 'document').length;
  const internalCount = media.filter((a) => a.isExternal === false).length;
  const externalCount = media.filter((a) => a.isExternal === true).length;
  const totalCount = media.length;
  const missingAltCount = media.filter((a) => {
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
    const usedOnPage = media.filter((a) => {
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
        const pageOccurrences = a.occurrences.filter(
          (o) => normalizePath(o.pagePath) === normalizedCurrentPage,
        );
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

export default updateSidebarCounts;
