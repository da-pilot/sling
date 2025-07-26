export default function initUIEvents({
  handleSearch,
  handleViewChange,
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
