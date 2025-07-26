/**
 * Hide a toast notification
 */
function hideToast(toast) {
  toast.classList.remove('toast--visible');
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
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <div class="toast__content">
      <span class="toast__message">${message}</span>
      <button class="toast__close" aria-label="Close notification">×</button>
    </div>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast--visible');
  }, 10);

  const autoRemove = setTimeout(() => {
    hideToast(toast);
  }, 5000);

  const closeBtn = toast.querySelector('.toast__close');
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
