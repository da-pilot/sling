
/**
 * Show empty state when no media are found
 */
export default function showEmptyState() {
  const grid = document.getElementById('mediaGrid');
  if (grid) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📁</div>
        <h3 class="empty-state-title">No media found</h3>
        <p class="empty-state-description">
          No media has been discovered yet. The system is scanning your content 
          for images, videos, and documents.
        </p>
        <div class="empty-state-actions">
          <button class="btn btn-primary" onclick="loadMediaFromMediaJson({ force: true })">
            Refresh Media
          </button>
        </div>
      </div>
    `;
  }
}
