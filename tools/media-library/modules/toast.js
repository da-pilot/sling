/**
 * Hide a toast notification
 */
function hideToast(toast) {
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-message">${message}</span>
      <button class="toast-close" aria-label="Close notification">×</button>
    </div>
  `;
  toastContainer.appendChild(toast);
  const autoRemove = setTimeout(() => {
    hideToast(toast);
  }, 5000);
  const closeBtn = toast.querySelector('.toast-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      clearTimeout(autoRemove);
      hideToast(toast);
    });
  }
}

/**
 * Show an error notification
 */
function showError(message, error) {
  // eslint-disable-next-line no-console
  console.error(message, error);

  const errorMessage = error?.message || error?.toString() || 'Unknown error';
  const fullMessage = `${message}: ${errorMessage}`;

  showToast(fullMessage, 'error');
}

export { showToast, showError };
