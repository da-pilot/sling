import { getPalette } from '../../../aemedge/scripts/tags.js';
import { createTag } from '../../../aemedge/scripts/utils.js';

function clickToCopyList(items) {
  items.forEach((item) => {
    item.addEventListener('click', () => {
      // Get the attribute you want to copy
      const attribute = 'data-name';
      const value = item.getAttribute(attribute);
      // Copy the attribute value to the clipboard
      navigator.clipboard.writeText(value)
        .then(() => {
          item.classList.add('copied');
          setTimeout(() => {
            item.classList.remove('copied');
          }, 2000);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('Failed to copy attribute:', err);
        });
    });
  });
}

async function initPalette() {
  const palette = await getPalette();
  if (!palette) return;
  const palletList = document.querySelector('#palette > ul');
  palette.forEach((color) => {
    const brandName = color['brand-name'];
    const colorValue = color['color-value'];
    const uses = color.application;
    const swatch = createTag('div', { class: 'swatch', style: `background: ${colorValue};` });
    const label = createTag('div', { class: 'label' }, `<p><strong>${brandName}</strong></p><p>Uses: ${uses}</p><p class="value">${colorValue}</p>`);
    const colorElem = createTag('li', { class: brandName, 'data-color': colorValue, 'data-name': brandName }, label);
    colorElem.prepend(swatch);
    palletList.append(colorElem);
  });
  const items = palletList.querySelectorAll('li');
  if (items) clickToCopyList(items);
}

initPalette();