document.addEventListener('DOMContentLoaded', async () => {
  // Constants
  const RUNTIME_NAMESPACE = '916809-952dimlouse';
  const TARGET_WORKSPACE_ID = '857317386';

  // Form elements
  const form = document.getElementById('offerForm');
  const offerNameInput = document.getElementById('offer-name');
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
   * Formats HTML with proper indentation for display
   * @param {string} html - The HTML string to format
   * @returns {string} Formatted HTML string
   */
  function formatHTMLForDisplay(html) {
    let formatted = '';
    let indent = 0;

    // First clean up any excessive whitespace and line breaks
    const cleanHtml = html
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .trim();

    // Then add proper formatting
    const tokens = cleanHtml.split(/(<\/?[^>]+>)/g);
    tokens.forEach((token) => {
      if (!token) return;

      // Decrease indent for closing tags
      if (token.startsWith('</')) {
        indent -= 1;
      }

      // Add the token with proper indentation
      if (token.startsWith('<')) {
        formatted += `${'  '.repeat(Math.max(0, indent)) + token}\n`;
      } else {
        formatted += `${'  '.repeat(Math.max(0, indent)) + token.trim()}\n`;
      }

      // Increase indent for opening tags, but not for self-closing tags
      if (token.startsWith('<') && !token.startsWith('</') && !token.endsWith('/>')) {
        indent += 1;
      }
    });

    return formatted.trim();
  }

  /**
   * Formats HTML for API by removing excessive whitespace and line breaks
   * @param {string} html - The HTML string to format
   * @returns {string} Cleaned HTML string
   */
  function formatHTMLForAPI(html) {
    return html
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '')
      .trim();
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
   * Gets the HTML of the current element (block or section)
   * @returns {string} Formatted HTML of the element
   */
  function getElementHtml() {
    const blockName = dialogContainer.getAttribute('data-current-block');
    const sectionName = dialogContainer.getAttribute('data-current-section');

    if (blockName) {
      const block = window.parent.document.querySelector(`.block[data-block-name="${blockName}"]`);
      return block ? formatHTMLForDisplay(block.outerHTML) : '';
    } if (sectionName) {
      const section = window.parent.document.querySelector(`.section[data-section-name="${sectionName}"]`);
      return section ? formatHTMLForDisplay(section.outerHTML) : '';
    }
    return '';
  }

  /**
   * Resets the form to initial state
   */
  function resetForm() {
    const blockName = dialogContainer.getAttribute('data-current-block');
    const sectionName = dialogContainer.getAttribute('data-current-section');

    // Use block or section name for the offer name
    const elementName = blockName || sectionName || '';
    offerNameInput.value = elementName;

    // Get the HTML content
    blockHtmlInput.value = getElementHtml();
    offerNameInput.classList.remove('error');
    clearMessage();
  }

  // Initialize form with current data
  const blockName = dialogContainer.getAttribute('data-current-block');
  const sectionName = dialogContainer.getAttribute('data-current-section');
  const fragmentId = dialogContainer.getAttribute('data-fragment-id');
  const elementContent = dialogContainer.getAttribute('data-block-content')
                        || dialogContainer.getAttribute('data-section-content');

  if (blockName || sectionName) {
    // Format the name: convert from "banner-image" to "Banner Image Offer"
    const elementName = blockName || sectionName;
    const formattedName = `${elementName
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')} Offer`;

    offerNameInput.value = formattedName;
    blockHtmlInput.value = elementContent ? formatHTMLForDisplay(elementContent) : getElementHtml();
    blockHtmlInput.classList.add('formatted-html');
  }

  // Event Listeners
  offerNameInput.addEventListener('input', () => {
    offerNameInput.classList.remove('error');
    clearMessage();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Validate form
    if (!offerNameInput.value.trim()) {
      offerNameInput.classList.add('error');
      showMessage('Offer Name is required', 'error');
      return;
    }

    try {
      // Create offer object with proper structure
      const params = {
        offer: {
          name: offerNameInput.value.trim(),
          content: formatHTMLForAPI(blockHtmlInput.value),
          workspace: TARGET_WORKSPACE_ID,
        },
        fragmentId,
        path: window.location.pathname,
      };

      // Call the exportoffers action
      const response = await fetch(`https://${RUNTIME_NAMESPACE}.adobeioruntime.net/api/v1/web/sling-da/exportoffers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Export error:', errorData);
        throw new Error(errorData.error || 'Failed to export offer');
      }

      const result = await response.json();
      showMessage(`  Offer ${result.name} successfully exported`);
      console.log('Exported offer:', result);
    } catch (err) {
      showMessage(err.message || 'An error occurred while processing the offer', 'error');
      console.error('Export error:', err);
    }
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