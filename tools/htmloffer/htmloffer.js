
document.addEventListener('DOMContentLoaded', async () => {
  // Form elements
  const form = document.getElementById('offerForm');
  const titleInput = document.getElementById('title');
  const nameInput = document.getElementById('name');
  const descriptionInput = document.getElementById('description');
  const blockHtmlInput = document.getElementById('block-html');
  const resetButton = document.querySelector('.btn-reset');
  const closeButton = document.querySelector('.btn-close');
  const dialogContainer = document.querySelector('.html-offer-dialog-container');
  const messageWrapper = document.querySelector('.message-wrapper');

  /**
   * Shows a message in the message wrapper
   * @param {string} message - The message to display
   * @param {string} type - The type of message ('success' or 'error')
   */
  function showMessage(message, type = 'success') {
    messageWrapper.textContent = message;
    messageWrapper.className = `message-wrapper ${type}`;
  }

  /**
   * Clears any displayed message
   */
  function clearMessage() {
    messageWrapper.textContent = '';
    messageWrapper.className = 'message-wrapper';
  }

  /**
   * Formats HTML with proper indentation
   * @param {string} html - The HTML string to format
   * @returns {string} Formatted HTML string
   */
  function formatHTML(html) {
    let formatted = '';
    let indent = 0;

    // Split HTML into individual lines
    const lines = html
      .replace(/>\s*</g, '>\n<') // Add line breaks between elements
      .replace(/</g, '\n<') // Add line breaks before opening tags
      .replace(/>/g, '>\n') // Add line breaks after closing tags
      .split('\n');

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;

      // Decrease indent for closing tags
      if (trimmedLine.startsWith('</')) {
        indent -= 1;
      }

      // Add indentation
      formatted += `${'  '.repeat(Math.max(0, indent)) + trimmedLine}\n`;

      // Increase indent for opening tags, but not for self-closing tags
      if (trimmedLine.startsWith('<') && !trimmedLine.startsWith('</') && !trimmedLine.endsWith('/>')) {
        indent += 1;
      }
    });

    return formatted.trim();
  }

  /**
   * Converts title to URL-friendly name format
   * @param {string} title - The title to convert
   * @returns {string} URL-friendly name
   */
  function convertTitleToName(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .trim(); // Remove leading/trailing spaces
  }

  /**
   * Closes the dialog and removes it from DOM
   */
  function closeDialog() {
    if (dialogContainer?.parentNode) {
      dialogContainer.parentNode.removeChild(dialogContainer);
    }
  }

  /**
   * Gets the HTML of the current block
   * @returns {string} Formatted HTML of the block
   */
  function getBlockHtml() {
    const currentBlockName = dialogContainer.getAttribute('data-current-block');
    const block = window.parent.document.querySelector(`.block[data-block-name="${currentBlockName}"]`);
    return block ? formatHTML(block.outerHTML) : '';
  }

  /**
   * Resets the form to initial state
   */
  function resetForm() {
    const currentBlockName = dialogContainer.getAttribute('data-current-block');
    titleInput.value = currentBlockName || '';
    nameInput.value = convertTitleToName(currentBlockName || '');
    descriptionInput.value = '';
    blockHtmlInput.value = getBlockHtml();
    titleInput.classList.remove('error');
    clearMessage();
  }

  // Initialize form with current block data
  const currentBlockName = dialogContainer.getAttribute('data-current-block');
  const blockContent = dialogContainer.getAttribute('data-block-content');

  if (currentBlockName) {
    titleInput.value = `${currentBlockName} Block`;
    nameInput.value = convertTitleToName(currentBlockName);
    blockHtmlInput.value = blockContent || getBlockHtml();
    blockHtmlInput.classList.add('formatted-html');
  }

  // Event Listeners
  titleInput.addEventListener('input', (e) => {
    nameInput.value = convertTitleToName(e.target.value);
    clearMessage(); // Clear message when user starts typing
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Validate form
    if (!titleInput.value.trim()) {
      titleInput.classList.add('error');
      showMessage('Title is required', 'error');
      return;
    }

    // Create offer object
    const offer = {
      title: titleInput.value.trim(),
      name: nameInput.value,
      description: descriptionInput.value.trim(),
      html: blockHtmlInput.value,
    };

    try {
      // Copy HTML to clipboard
      await navigator.clipboard.writeText(blockHtmlInput.value);
      showMessage('HTML Offer Created');
    } catch (err) {
      showMessage('Failed to copy HTML to clipboard', 'error');
      console.error('Failed to copy HTML:', err);
    }

    // Log the export data
    console.log('Exporting offer:', offer);
  });

  // Remove error class on input
  titleInput.addEventListener('input', () => {
    titleInput.classList.remove('error');
  });

  // Handle reset and close buttons
  resetButton.addEventListener('click', resetForm);
  closeButton.addEventListener('click', closeDialog);

  // Handle ESC key to close dialog
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDialog();
    }
  });
});