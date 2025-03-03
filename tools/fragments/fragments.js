/* eslint-disable import/no-absolute-path */
/* eslint-disable import/no-unresolved */

// Import SDK for Document Authoring
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { crawl } from 'https://da.live/nx/public/utils/tree.js';

// Base path for fragments
const FRAGMENTS_BASE = '/aemedge/fragments';

/**
 * Shows a message in the feedback container with optional error styling
 * @param {string} text - Message text to display
 * @param {boolean} [isError=false] - Whether to style as error message
 * @param {boolean} [isFragment=false] - Whether this is a fragment insertion message
 */
function showMessage(text, isError = false, isFragment = false) {
  const message = document.querySelector('.feedback-message');
  const msgContainer = document.querySelector('.message-wrapper');
  const indicator = document.querySelector('.message-indicator');

  if (isFragment) {
    // Initialize or get existing fragment list
    let fragmentList = message.querySelector('.fragment-list');
    if (!fragmentList) {
      message.innerHTML = 'Inserted fragments:<br>';
      fragmentList = document.createElement('ul');
      fragmentList.className = 'fragment-list';
      message.appendChild(fragmentList);
    }

    // Add new fragment to list with clickable link
    const listItem = document.createElement('li');
    const fragmentUrl = text.replace('Inserted fragment link: ', '');
    const link = document.createElement('a');
    link.href = fragmentUrl;
    link.textContent = fragmentUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    listItem.appendChild(link);
    fragmentList.appendChild(listItem);

    // Show indicator when messages exist
    indicator.classList.remove('hidden');
  } else {
    // Regular message display
    message.innerHTML = text.replace(/\r?\n/g, '<br>');
    message.classList.toggle('error', isError);
    msgContainer.classList.remove('hidden');
  }
}

/**
 * Creates a tree structure from file paths
 * @param {Array} files - Array of file objects with paths
 * @param {string} basePath - Base path to remove from display
 * @returns {Object} Tree structure
 */
function createFileTree(files, basePath) {
  const tree = {};
  files.forEach((file) => {
    // Remove the org/repo prefix from display path
    const displayPath = file.path.replace(basePath, '');
    const parts = displayPath.split('/').filter(Boolean);
    let current = tree;
    parts.forEach((part, i) => {
      if (!current[part]) {
        current[part] = {
          isFile: i === parts.length - 1 && file.path.endsWith('.html'),
          children: {},
          path: file.path, // Keep original path for link creation
        };
      }
      current = current[part].children;
    });
  });
  return tree;
}

/**
 * Hides the message container and updates indicator
 */
function hideMessageContainer() {
  const msgContainer = document.querySelector('.message-wrapper');
  const indicator = document.querySelector('.message-indicator');
  if (!msgContainer.classList.contains('hidden')) {
    msgContainer.classList.add('hidden');
    indicator.classList.remove('active');
  }
}

/**
 * Creates a tree item element
 * @param {string} name - Item name
 * @param {Object} node - Tree node data
 * @param {Function} onClick - Click handler for fragment items
 * @returns {HTMLElement} Tree item element
 */
function createTreeItem(name, node, onClick) {
  const item = document.createElement('li');
  item.className = 'tree-item';

  const content = document.createElement('div');
  content.className = 'tree-item-content';

  if (node.isFile) {
    const button = document.createElement('button');
    button.className = 'fragment-btn-item';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', `Insert link for fragment "${name.replace('.html', '')}"`);

    const fragmentIcon = document.createElement('img');
    fragmentIcon.src = '/.da/icons/fragment-icon.png';
    fragmentIcon.alt = 'Fragment';
    fragmentIcon.className = 'tree-icon';
    fragmentIcon.setAttribute('aria-hidden', 'true');

    const textSpan = document.createElement('span');
    const displayName = name.replace('.html', '');
    textSpan.textContent = displayName;

    button.appendChild(fragmentIcon);
    button.appendChild(textSpan);
    button.title = `Click to insert link for "${displayName}"`;
    button.addEventListener('click', () => onClick({ path: node.path }));
    content.appendChild(button);
  } else {
    const folderButton = document.createElement('button');
    folderButton.className = 'folder-btn';
    folderButton.setAttribute('role', 'button');
    folderButton.setAttribute('aria-expanded', 'false');
    folderButton.setAttribute('aria-label', `Folder ${name}`);

    const folderIcon = document.createElement('img');
    folderIcon.src = '/.da/icons/folder-icon.png';
    folderIcon.alt = ''; // Decorative image, using aria-hidden instead
    folderIcon.className = 'tree-icon folder-icon';
    folderIcon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'folder-name';
    label.textContent = name;

    folderButton.appendChild(folderIcon);
    folderButton.appendChild(label);

    const toggleFolder = () => {
      hideMessageContainer();
      folderButton.classList.toggle('expanded');
      folderButton.setAttribute('aria-expanded', folderButton.classList.contains('expanded'));
      folderIcon.src = folderButton.classList.contains('expanded')
        ? '/.da/icons/folder-open-icon.png'
        : '/.da/icons/folder-icon.png';
      const list = item.querySelector('.tree-list');
      if (list) {
        list.classList.toggle('hidden');
      }
    };

    folderButton.addEventListener('click', toggleFolder);
    content.appendChild(folderButton);

    if (Object.keys(node.children).length > 0) {
      const list = document.createElement('ul');
      list.className = 'tree-list hidden';

      Object.entries(node.children)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([childName, childNode]) => {
          list.appendChild(createTreeItem(childName, childNode, onClick));
        });

      item.appendChild(content);
      item.appendChild(list);
    }
  }

  if (!content.parentElement) {
    item.appendChild(content);
  }

  return item;
}

/**
 * Handles fragment selection by inserting a link
 * @param {Object} actions - SDK actions object
 * @param {Object} file - Selected fragment file
 * @param {Object} context - SDK context
 */
function handleFragmentSelect(actions, file, context) {
  if (!actions?.sendHTML) {
    showMessage('Cannot insert fragment: Editor not available', true);
    return;
  }

  // Remove org/repo prefix and .html extension from display path only
  const basePath = `/${context.org}/${context.repo}`;
  const displayPath = file.path.replace(basePath, '').replace(/\.html$/, '');
  const fragmentUrl = `https://main--${context.repo}--${context.org}.aem.live${displayPath}`;
  actions.sendHTML(`<a href="${fragmentUrl}" class="fragment">${fragmentUrl}</a>`);
  showMessage(`Inserted fragment link: ${fragmentUrl}`, false, true);
}

/**
 * Filters tree items based on search text
 * @param {string} searchText - Text to search for
 * @param {HTMLElement} fragmentsList - List container element
 */
function filterFragments(searchText, fragmentsList) {
  const items = fragmentsList.querySelectorAll('.tree-item');
  const searchLower = searchText.toLowerCase();

  // Hide message container when searching
  const msgContainer = document.querySelector('.message-wrapper');
  const indicator = document.querySelector('.message-indicator');
  if (!msgContainer.classList.contains('hidden')) {
    msgContainer.classList.add('hidden');
    indicator.classList.remove('active');
  }

  // First pass: Find matching items and their parent folders
  const matchingPaths = new Set();
  items.forEach((item) => {
    const button = item.querySelector('.fragment-btn-item');
    if (button && button.textContent.toLowerCase().includes(searchLower)) {
      // Add current item and all its parent folders to matching paths
      let current = item;
      while (current && current.classList.contains('tree-item')) {
        matchingPaths.add(current);
        current = current.parentElement.closest('.tree-item');
      }
    }
  });

  // Second pass: Show/hide items and expand folders
  items.forEach((item) => {
    const isMatching = matchingPaths.has(item);
    item.style.display = isMatching ? '' : 'none';

    // If it's a folder and it's in the matching paths, expand it
    const toggle = item.querySelector('.tree-toggle');
    const list = item.querySelector('.tree-list');
    if (toggle && list && isMatching) {
      toggle.classList.add('expanded');
      toggle.querySelector('.toggle-icon').textContent = '▼';
      list.classList.remove('hidden');
    }
  });

  // If search is cleared, collapse all folders
  if (!searchText) {
    items.forEach((item) => {
      const toggle = item.querySelector('.tree-toggle');
      const list = item.querySelector('.tree-list');
      if (toggle && list) {
        toggle.classList.remove('expanded');
        toggle.querySelector('.toggle-icon').textContent = '▶';
        list.classList.add('hidden');
      }
      item.style.display = '';
    });
  }
}

/**
 * Shows a loading message in the fragments list
 * @param {HTMLElement} fragmentsList - The fragments list container
 */
function showLoadingInList(fragmentsList) {
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'fragments-loading';
  loadingDiv.textContent = 'Loading fragments...';
  fragmentsList.appendChild(loadingDiv);
}

/**
 * Initializes the fragments interface and sets up event handlers
 * @returns {Promise<void>}
 */
(async function init() {
  const { context, token, actions } = await DA_SDK;

  // Create and style the form container
  const formContainer = document.createElement('div');
  formContainer.className = 'fragments-form-wrapper';

  const msgContainer = document.createElement('div');
  msgContainer.className = 'message-wrapper hidden';

  const message = document.createElement('div');
  message.className = 'feedback-message';
  message.textContent = '';
  msgContainer.append(message);

  // Create fragments list container
  const fragmentsList = document.createElement('ul');
  fragmentsList.className = 'fragments-list';

  // Create form element
  const form = document.createElement('form');
  form.className = 'fragments-form';

  // Prevent default form submission
  form.addEventListener('submit', (e) => e.preventDefault());

  // Create button group container
  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'button-group';

  // Create refresh button
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'fragment-btn';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.type = 'button';
  refreshBtn.title = 'Refresh the Fragments List';
  refreshBtn.setAttribute('role', 'button');
  refreshBtn.setAttribute('aria-label', 'Refresh fragments list');

  // Create cancel button (renamed from reset)
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'fragment-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.type = 'reset';
  cancelBtn.title = 'Cancel Fetching Fragments';
  cancelBtn.setAttribute('role', 'button');
  cancelBtn.setAttribute('aria-label', 'Cancel fetching fragments');

  // Add all buttons to button group
  buttonGroup.append(refreshBtn, cancelBtn);

  // Create search container
  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Type to search fragments by name...';
  searchInput.className = 'fragment-search';
  searchInput.setAttribute('role', 'searchbox');
  searchInput.setAttribute('aria-label', 'Search fragments');

  searchInput.addEventListener('input', (e) => {
    filterFragments(e.target.value, fragmentsList);
  });

  searchContainer.appendChild(searchInput);

  // Create message indicator
  const indicator = document.createElement('button');
  indicator.className = 'message-indicator hidden';
  indicator.setAttribute('role', 'button');
  indicator.setAttribute('aria-label', 'View inserted fragments');
  indicator.setAttribute('aria-expanded', 'false');
  const indicatorIcon = document.createElement('img');
  indicatorIcon.src = '/.da/icons/fragments-icon.png';
  indicatorIcon.alt = 'View inserted fragments';
  indicatorIcon.className = 'indicator-icon';
  indicatorIcon.setAttribute('aria-hidden', 'true');
  indicator.appendChild(indicatorIcon);
  indicator.title = 'View inserted fragments';

  // Add close button to message container
  const closeBtn = document.createElement('button');
  closeBtn.className = 'message-close';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('role', 'button');
  closeBtn.setAttribute('aria-label', 'Close message container');

  // Add close button to message container
  msgContainer.insertBefore(closeBtn, msgContainer.firstChild);

  // Add click handler to indicator
  indicator.addEventListener('click', () => {
    const isHidden = msgContainer.classList.toggle('hidden');
    indicator.classList.toggle('active');
    indicator.setAttribute('aria-expanded', !isHidden);
  });

  // Assemble the form
  form.append(searchContainer, fragmentsList, buttonGroup);
  formContainer.append(form);
  formContainer.appendChild(indicator);
  document.body.append(formContainer, msgContainer);

  // Function to load fragments
  async function loadFragments() {
    fragmentsList.innerHTML = '';
    showLoadingInList(fragmentsList);

    try {
      const files = [];
      const callback = (file) => {
        if (file.path.endsWith('.html')) {
          files.push(file);
        }
      };

      const path = `/${context.org}/${context.repo}${FRAGMENTS_BASE}`;
      const basePath = `/${context.org}/${context.repo}`;
      const opts = {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      const { results, getDuration, cancelCrawl } = crawl({
        path,
        callback,
        throttle: 10,
        ...opts,
      });

      cancelBtn.addEventListener('click', cancelCrawl);

      await results;

      // Clear loading message
      fragmentsList.innerHTML = '';

      const tree = createFileTree(files, basePath);
      Object.entries(tree)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, node]) => {
          fragmentsList.appendChild(
            createTreeItem(name, node, (file) => handleFragmentSelect(actions, file, context)),
          );
        });

      const duration = getDuration();
      showMessage(`Fragments loaded in ${duration} ms`);
    } catch (error) {
      showMessage('Failed to load fragments', true);
      console.error(error);
    }
  }

  // Load fragments initially
  await loadFragments();

  // Add refresh handler
  refreshBtn.addEventListener('click', loadFragments);
}());