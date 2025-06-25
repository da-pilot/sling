/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { getTags } from '../../../eds/scripts/tags.js';

let selectedOrder = [];

function renderItem(item, catId) {
  const pathStr = item.name.split('/').slice(0, -1).join('<span class="psep"> / </span>');
  return `
  <span class="path">${pathStr}
    <span data-title="${item.title}" class="tag cat-${catId}">${item.title}</span>
  </span>
`;
}

function renderItems(item, catId) {
  const html = item.hide ? '' : renderItem(item, catId);
  let lvlhtml = '<div class="subcategory">';
  lvlhtml += `<h2>${item.title}</h2>`;
  const results = document.getElementById('results');
  Object.keys(item).forEach((key) => {
    if (!['title', 'name', 'path', 'hide'].includes(key)) {
      lvlhtml += renderItems(item[key], catId);
    }
  });
  lvlhtml += '</div>';
  if (lvlhtml.indexOf('span') > 1) results.insertAdjacentHTML('beforeend', lvlhtml);
  return html;
}

function initTaxonomy(tags) {
  let html = '';
  const results = document.getElementById('results');
  if (results) {
    Object.values(tags).forEach((tag, idx) => {
      html += '<div class="category">';
      html += `<h2>${tag.title}</h2>`;
      Object.keys(tag).forEach((key) => {
        if (!['title', 'name', 'path', 'hide'].includes(key)) {
          html += renderItems(tag[key], idx);
        }
      });

      html += '</div>';
    });
  }
  results.insertAdjacentHTML('afterbegin', html);
}

function filter() {
  const searchTerm = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('#results .tag').forEach((tag) => {
    const { title } = tag.dataset;
    const offset = title.toLowerCase().indexOf(searchTerm);
    if (offset >= 0) {
      const before = title.substring(0, offset);
      const term = title.substring(offset, offset + searchTerm.length);
      const after = title.substring(offset + searchTerm.length);
      tag.innerHTML = `${before}<span class="highlight">${term}</span>${after}`;
      tag.closest('.path').classList.remove('filtered');
    } else {
      tag.closest('.path').classList.add('filtered');
    }
  });
}

function toggleTag(target) {
  target.classList.toggle('selected');
  const { title } = target.querySelector('.tag').dataset;
  const category = target.closest('.category')
    ?.querySelector('h2')?.textContent;
  const subcategory = target.closest('.subcategory')
    ?.querySelector('h2')?.textContent;

  const tagIdentifier = {
    title,
    category,
    subcategory,
  };

  if (target.classList.contains('selected')) {
    selectedOrder.push(tagIdentifier);
  } else {
    selectedOrder = selectedOrder.filter(
      (item) => item.title !== title || item.category !== category,
    );
  }
  // eslint-disable-next-line no-use-before-define
  displaySelected();
}

function displaySelected() {
  const selEl = document.getElementById('selected');
  const selTagsEl = selEl.querySelector('.selected-tags');
  const toCopyBuffer = [];
  selTagsEl.innerHTML = '';
  selectedOrder.forEach(({
    title,
    category,
    subcategory,
  }) => {
    let categories;
    if (subcategory) categories = document.querySelectorAll('#results .subcategory');
    else categories = document.querySelectorAll('#results .category');
    let path;
    categories.forEach((cat) => {
      if (cat.querySelector('h2').textContent === category
    || cat.querySelector('h2').textContent === subcategory) {
        const tag = Array.from(cat.querySelectorAll('.tag'))
          .find((t) => t.dataset.title === title);
        if (tag) {
          path = tag.closest('.path');
        }
      }
    });

    if (path) {
      const clone = path.cloneNode(true);
      clone.classList.remove('filtered', 'selected');
      const tag = clone.querySelector('.tag');
      tag.innerHTML = tag.dataset.title;
      clone.addEventListener('click', () => {
        toggleTag(path);
      });
      toCopyBuffer.push(tag.dataset.title);
      selTagsEl.append(clone);
    }
  });

  if (selectedOrder.length > 0) {
    selEl.classList.remove('hidden');
  } else {
    selEl.classList.add('hidden');
  }

  const copybuffer = document.getElementById('copybuffer');
  copybuffer.value = toCopyBuffer.join(', ');
}

async function init() {
  const tags = await getTags();
  initTaxonomy(tags);

  const selEl = document.getElementById('selected');
  const copyButton = selEl.querySelector('button.copy');
  copyButton.addEventListener('click', async () => {
    const copyText = document.getElementById('copybuffer');
    const { actions } = await DA_SDK;
    if (actions?.sendHTML) {
      actions.sendHTML(copyText.value);
      copyButton.disabled = true;
    }
  });

  const clearButton = selEl.querySelector('button.clear');
  clearButton.addEventListener('click', () => {
    document.querySelectorAll('#results .tag')
      .forEach((tag) => {
        tag.closest('.path')
          .classList
          .remove('filtered');
      });

    document.querySelectorAll('.selected')
      .forEach((selectedTag) => {
        selectedTag.classList.remove('selected');
      });

    selectedOrder = [];
    displaySelected();
    copyButton.disabled = false;
  });

  document.querySelector('#search').addEventListener('keyup', filter);

  document.addEventListener('click', (e) => {
    const target = e.target.closest('.category .path');
    if (target) {
      toggleTag(target);
    }
  });
  document.addEventListener('click', (e) => {
    const target = e.target.closest('.subcategory .path');
    if (target) {
      toggleTag(target);
    }
  });
}

init();
