// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

function showMessage(text, isError = false) {
  const message = document.querySelector('.feedback-message');
  const msgContainer = document.querySelector('.message-wrapper');

  message.innerHTML = text;
  message.classList.toggle('error', isError);
  msgContainer.classList.remove('hidden');

  if (!isError) {
    setTimeout(() => {
      msgContainer.classList.add('hidden');
    }, 2000);
  }
}

(async function init() {
  const { actions } = await DA_SDK;
  const insertButton = document.querySelector('.insert-property-btn');
  insertButton.addEventListener('click', () => {
    if (!actions?.sendText || !actions?.closeLibrary) {
      showMessage('Cannot insert property: Editor not available', true);
      return;
    }

    try {
      const uuid = crypto.randomUUID();
      // Try sending just the text content with a tab character
      actions.sendText(`fragment-id|${uuid}`);
      // actions.sendHTML(`<table><tr><td>fragment-id</td><td>${uuid}</td></tr></table>`);
      // Close the dialog
      actions.closeLibrary();

      showMessage('Property values inserted successfully');
    } catch (error) {
      showMessage('Failed to insert property values', true);
      console.error(error);
    }
  });
}());
