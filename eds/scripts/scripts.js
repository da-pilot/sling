import {
  buildBlock,
  loadFooter,
  decorateIcons,
  decorateSections,
  decorateTemplateAndTheme,
  waitForLCP,
  loadBlocks,
  loadCSS,
  getMetadata,
  decorateBlock,
  loadBlock,
  toClassName,
  loadScript,
} from './aem.js';

import {
  buildBlogBreadcrumb,
  buildPopularBlogs,
  getPageType,
  buildFragmentBlocks,
  createTag,
  loadGameFinders,
  loadPackageCards,
  centerHeadlines,
  configSideKick,
  buildVideoBlocks,
  setFragmentIds,
  getPictureUrlByScreenWidth,
} from './utils.js';

// Analytics utils imported dynamically when needed

/**
 * Lightweight environment detection for scripts loading
 * @returns {boolean} true if production environment
 */
// function isProduction() {
//   const { hostname } = window.location;
//   return hostname.includes('sling.com') || hostname.includes('.aem.live');
// }

const LCP_BLOCKS = ['category']; // add your LCP blocks to the list
const TEMPLATES = ['blog-article', 'blog-category']; // add your templates here
const TEMPLATE_META = 'template';
const EXT_IMAGE_URL = /dish\.scene7\.com|\/eds\/svgs\/|delivery-p\d+-e\d+\.adobeaemcloud\.com\/adobe\/assets\//;

/**
 * Decorates all blocks in a container element.
 * Overwriting the function in aem.js to avoid decorating fragment-wrapper blocks
 * @param {Element} main The container element
 */
function decorateBlocks(main) {
  main.querySelectorAll('div.section > div > div').forEach((block) => {
    if (!block.classList.contains('fragment-wrapper')) {
      decorateBlock(block);
    }
  });
}

/**
 * Builds hero block and prepends to main in a new section.
 * @param {Element} main The container element
 */
function buildHeroBlock(main) {
  const pictures = main.querySelectorAll('picture');
  if ((getPageType() === 'blog' && pictures?.length > 0) || (getPageType() === 'category' && pictures?.length > 0)) {
    const h1 = main.querySelector('h1');
    const images = [];
    if (h1) {
      h1.classList.add('blog-primary-title');
      if (pictures.length >= 2) {
        main.querySelectorAll('picture').forEach((image, idx) => {
          // eslint-disable-next-line no-bitwise
          if (h1 && (h1.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_PRECEDING)) {
            images.push(image);
            if (idx === 0) {
              image.classList.add('desktop');
              // load desktop image eager on desktop
              const mquery = window.matchMedia('(min-width: 769px)');
              if (mquery.matches) {
                image.querySelector('img').setAttribute('loading', 'eager');
              } else {
                image.querySelector('img').setAttribute('loading', 'lazy');
              }
            }
            if (idx === 1) {
              image.classList.add('mobile');
              // load mobile image eager on mobile
              const mquery = window.matchMedia('(max-width: 768px)');
              if (mquery.matches) {
                image.querySelector('img').setAttribute('loading', 'eager');
              } else {
                image.querySelector('img').setAttribute('loading', 'lazy');
              }
            }
          }
        });
      } else if (pictures.length === 1) {
        const image = main.querySelector('picture');
        if (h1 && (h1.compareDocumentPosition(image) && Node.DOCUMENT_POSITION_PRECEDING)) {
          images.push(image);

          image.classList.add('desktop,mobile');
          // load desktop image eager on desktop
          const mquery = window.matchMedia('(min-width: 769px)');
          if (mquery.matches) {
            image.querySelector('img').setAttribute('loading', 'eager');
          } else {
            image.querySelector('img').setAttribute('loading', 'lazy');
          }
        }
      }
      if (getPageType() === 'blog') {
        const section = document.createElement('div');
        section.append(buildBlock('blog-hero', { elems: images }));
        const breadCrumb = buildBlogBreadcrumb();
        if (breadCrumb) {
          breadCrumb.classList.add('blog-details-breadcrumb');
          section.append(breadCrumb);
        }
        section.append(h1);
        main.prepend(section);
      }
    } else if (pictures.length >= 2) {
      main.querySelectorAll('picture').forEach((image, idx) => {
        // eslint-disable-next-line no-bitwise
        images.push(image);
        if (idx === 0) {
          image.classList.add('desktop');
          // load desktop image eager on desktop
          const mquery = window.matchMedia('(min-width: 769px)');
          if (mquery.matches) {
            image.querySelector('img').setAttribute('loading', 'eager');
          } else {
            image.querySelector('img').setAttribute('loading', 'lazy');
          }
        }
        if (idx === 1) {
          image.classList.add('mobile');
          // load mobile image eager on mobile
          const mquery = window.matchMedia('(max-width: 768px)');
          if (mquery.matches) {
            image.querySelector('img').setAttribute('loading', 'eager');
          } else {
            image.querySelector('img').setAttribute('loading', 'lazy');
          }
        }
      });
    } else if (pictures.length === 1) {
      const image = main.querySelector('picture');

      images.push(image);

      image.classList.add('desktop,mobile');
      // load desktop image eager on desktop
      const mquery = window.matchMedia('(min-width: 769px)');
      if (mquery.matches) {
        image.querySelector('img').setAttribute('loading', 'eager');
      } else {
        image.querySelector('img').setAttribute('loading', 'lazy');
      }
    }
  }
}

function autolinkModals(element) {
  element.addEventListener('click', async (e) => {
    const origin = e.target.closest('a');

    if (origin && origin.href && origin.href.includes('/modals/')) {
      e.preventDefault();
      const { openModal } = await import(`${window.hlx.codeBasePath}/blocks/modal/modal.js`);
      openModal(origin.href);
    }
  });
}

export function buildMultipleButtons(main) {
  // Detect all button pairs to identify sibling buttons
  const buttons = main.querySelectorAll('.button-container:not(.subtext)');
  buttons.forEach((button) => {
    const parent = button.parentElement;
    const siblingButton = button.nextElementSibling;

    // If siblingButton is subtext, create a combined button container
    if (siblingButton && siblingButton.classList.contains('subtext') && !parent.classList.contains('combined')) {
      const buttonContainer = createTag('div', { class: 'button-container combined' });
      parent.insertBefore(buttonContainer, button);
      buttonContainer.append(button, siblingButton);
    }

    // If siblingButton is a regular button and not subtext, check for nextSibling
    if (siblingButton && siblingButton.classList.contains('button-container') && !siblingButton.classList.contains('subtext')) {
      const nextSibling = siblingButton.nextElementSibling;

      // If nextSibling exists and not subtext or parent isn't already buttons-container,
      // then create a new buttons container
      if (nextSibling && !nextSibling.classList.contains('subtext') && !parent.classList.contains('buttons-container')) {
        const buttonContainer = createTag('div', { class: 'buttons-container' });
        parent.insertBefore(buttonContainer, button);
        buttonContainer.append(button, siblingButton);
      }

      // If no nextSibling, create a new buttons container
      if (!nextSibling && !parent.classList.contains('buttons-container')) {
        const buttonContainer = createTag('div', { class: 'buttons-container' });
        parent.insertBefore(buttonContainer, button);
        buttonContainer.append(button, siblingButton);
      }
    }
  });

  // Combine buttons with subtext into single vertical container div to place by sibling button
  const combinedButtonGroups = main.querySelectorAll('div.button-container.combined');
  combinedButtonGroups.forEach((buttonGroup) => {
    const parent = buttonGroup.parentElement;
    const siblingButton = buttonGroup.nextElementSibling;
    const siblingUp = buttonGroup.previousElementSibling;

    if (!parent.classList.contains('buttons-container')) {
      if (siblingButton && siblingButton.classList.contains('combined')) {
        const buttonContainer = createTag('div', { class: 'buttons-container' });
        parent.insertBefore(buttonContainer, buttonGroup);
        buttonContainer.append(buttonGroup, siblingButton);
      }
      if (siblingButton && siblingButton.classList.contains('button-container') && !siblingButton.classList.contains('combined')) {
        const buttonContainer = createTag('div', { class: 'buttons-container' });
        parent.insertBefore(buttonContainer, buttonGroup);
        buttonContainer.append(buttonGroup, siblingButton);
      }
      if (siblingUp && siblingUp.classList.contains('button-container') && !siblingUp.classList.contains('combined')) {
        const buttonContainer = createTag('div', { class: 'buttons-container' });
        parent.insertBefore(buttonContainer, buttonGroup);
        buttonContainer.append(siblingUp, buttonGroup);
      }
    }
  });
}

/**
 * Sets an optimized background image for a given section element.
 * This function takes into account the device's viewport width and device pixel ratio
 * to choose the most appropriate image from the provided breakpoints.
 *
 * @param {HTMLElement} section - The section element to which the background image will be applied.
 * @param {string} bgImage - The base URL of the background image.
 * @param {Array<{width: string, media?: string}>} [breakpoints=[
 *  { width: '450' },
 *   { media: '(min-width: 450px)', width: '750' },
 *   { media: '(min-width: 768px)', width: '1024' },
 *   { media: '(min-width: 1024px)', width: '1600' },
 *   { media: '(min-width: 1600px)', width: '2200' },
 * ]] - An array of breakpoint objects. Each object contains a `width` which is the width of the
 * image to request, and an optional `media` which is a media query string indicating when this
 * breakpoint should be used.
 */

export const resizeListeners = new WeakMap();
export function getBackgroundImage(element) {
  const sectionData = element.dataset.background;
  const bgImages = sectionData.split(',').map((img) => img.trim());
  return getPictureUrlByScreenWidth(bgImages);
}

export function createOptimizedBackgroundImage(element, breakpoints = [
  { width: '450' },
  { media: '(min-width: 450px)', width: '768' },
  { media: '(min-width: 768px)', width: '1024' },
  { media: '(min-width: 1024px)', width: '1600' },
  { media: '(min-width: 1600px)', width: '2000' },
]) {
  const updateBackground = () => {
    const bgImage = getBackgroundImage(element);
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (element.dataset.backgroundFit) {
      element.style.backgroundSize = element.dataset.backgroundFit;
    }
    if (element.dataset.backgroundPosition) {
      element.style.backgroundPosition = element.dataset.backgroundPosition;
    }
    if (hexColorRegex.test(bgImage)) {
      element.style.backgroundColor = bgImage;
      return;
    }
    const matchedBreakpoint = breakpoints
      .filter((br) => !br.media || window.matchMedia(br.media).matches)
      .reduce((acc, curr) => (parseInt(curr.width, 10)
      > parseInt(acc.width, 10) ? curr : acc), breakpoints[0]);

    const adjustedWidth = matchedBreakpoint.width * window.devicePixelRatio;
    let imageUrl = bgImage;
    if (!EXT_IMAGE_URL.test(bgImage)) {
      try {
        const urlObj = new URL(bgImage, window.location.href);
        imageUrl = urlObj.href;
      } catch (e) {
        imageUrl = bgImage;
      }
      imageUrl = `${imageUrl}?width=${adjustedWidth}&format=webply&optimize=highest`;
    }
    element.style.backgroundImage = `url(${imageUrl})`;
  };

  if (resizeListeners.has(element)) {
    window.removeEventListener('resize', resizeListeners.get(element));
  }
  resizeListeners.set(element, updateBackground);
  window.addEventListener('resize', updateBackground);
  updateBackground();
}

function decorateStyledSections(main) {
  Array.from(main.querySelectorAll('.section[data-background]')).forEach((section) => {
    createOptimizedBackgroundImage(section);
  });
  Array.from(main.querySelectorAll('.section[data-background-color]')).forEach((section) => {
    section.style.backgroundColor = section.dataset.backgroundColor;
  });
}

/**
 * consolidate the first two divs in a section into two columns
 * Special case for when there is 1 fragment-wrapper
 * @param main
 */

function makeTwoColumns(main) {
  const sections = main.querySelectorAll('.section.columns-2');
  let columnTarget;
  let columnTwoItems;
  sections.forEach((section) => {
    const fragmentSections = section.querySelector('.fragment-wrapper');
    const columnOne = document.createElement('div');
    columnOne.classList.add('column-1');
    const columnTwo = document.createElement('div');
    columnTwo.classList.add('column-2');

    if (!fragmentSections) {
      const children = Array.from(section.children);
      children.forEach((child, index) => {
        if (index % 2 === 0) {
          columnOne.append(child);
        } else {
          columnTwo.append(child);
        }
      });

      // section.innerHTML = ''; // any extra divs are removed
      section.append(columnOne, columnTwo);
    } else {
      // 1 fragment-wrapper div plus 1 default content div only
      columnTarget = section.querySelector('.fragment-wrapper');
      columnOne.append(...columnTarget.children);
      columnTwoItems = section.querySelector('div');
      columnTwo.append(columnTwoItems);
      section.append(columnOne, columnTwo);
    }
  });
}

async function buildGlobalBanner(main) {
  const banner = getMetadata('global-banner');
  if (banner) {
    const bannerURL = new URL(banner);
    const bannerPath = bannerURL.pathname;
    if (bannerURL) {
      const bannerLink = createTag('a', { href: bannerPath }, bannerPath);
      const fragment = buildBlock('fragment', [[bannerLink]]);
      const section = createTag('div', { class: 'section' });
      const wrapper = document.createElement('div');
      wrapper.append(fragment);
      section.append(wrapper);
      main.prepend(section);
      decorateBlock(fragment);
      await loadBlock(fragment);
    }
  }
}

async function setNavType() {
  const nav = getMetadata('nav');
  if (nav && nav.includes('nav-without-topnav')) {
    const header = document.querySelector('header');
    header?.classList.add('nav-without-topnav');
  }
}

/*  BUTTONS DECORATION */
export function replaceTildesWithDel() {
  // Only process block-level elements where tildes might wrap HTML
  const elements = document.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');
  const tildeRegex = /~~([\s\S]*?)~~/g; // [\s\S] allows matching across tags and newlines

  elements.forEach((element) => {
    // Only replace if there are tildes present
    if (element.innerHTML.includes('~~')) {
      element.innerHTML = element.innerHTML.replace(tildeRegex, '<del>$1</del>');
    }
  });
}

/**
 * Decorates paragraphs containing a single link as buttons.
 * @param {Element} element container element
 */

export function decorateButtons(element) {
  element.querySelectorAll('a').forEach((a) => {
    a.title = a.title || a.textContent;
    if (a.href !== a.textContent && !a.href.includes('/fragments/') && !EXT_IMAGE_URL.test(a.href)) {
      const hasIcon = a.querySelector('.icon');
      if (hasIcon || a.querySelector('img')) return;

      const up = a.parentElement;
      const twoup = up.parentElement;
      const threeup = twoup.parentElement;
      const childTag = a?.firstChild?.tagName?.toLowerCase();
      const isSubscript = childTag === 'sub';
      const isSuperscript = childTag === 'sup';
      const isEm = up.tagName === 'EM';

      if (isSubscript && !isEm) {
        a.classList.add('blue');
        up.classList.add('button-container', 'subtext');
      } else if (isSubscript && isEm) {
        a.classList.add('white');
        twoup.classList.add('button-container', 'subtext');
      } else if (isSuperscript) {
        a.classList.add('black');
        up.classList.add('button-container', 'subtext');
      } else {
        const linkText = a.textContent;
        const linkTextEl = document.createElement('span');
        linkTextEl.classList.add('link-button-text');
        linkTextEl.textContent = linkText;
        a.setAttribute('aria-label', linkText);

        // Check for tilde-wrapped content in different contexts
        const checkAndRemoveTildes = (nodes) => Array.from(nodes).some((node, index, arr) => {
          if (node === a) {
            const prevNode = arr[index - 1];
            const nextNode = arr[index + 1];
            if (prevNode?.textContent === '~~' && nextNode?.textContent === '~~') {
              prevNode.remove();
              nextNode.remove();
              return true;
            }
          }
          return false;
        });

        if (up.childNodes.length === 1 && (up.tagName === 'P' || up.tagName === 'DIV')) {
          // Fragment Case 1: Link text is wrapped in tildes
          const linkTextHasTildes = /^~~[\s\S]*~~$/.test(a.textContent);

          // Remove tildes if they exist
          if (linkTextHasTildes) {
            const cleanText = linkTextEl.textContent.replace(/^~~([\s\S]*)~~$/, '$1');
            linkTextEl.textContent = cleanText;
            a.title = cleanText;
            a.setAttribute('aria-label', cleanText);
          }

          a.textContent = '';
          a.className = linkTextHasTildes ? 'button primary' : 'button text';
          up.classList.add('button-container');
          a.append(linkTextEl);
        } else if (up.childNodes.length === 3) {
          if (up.tagName === 'P' && checkAndRemoveTildes(up.childNodes)) {
            a.className = 'button primary';
            up.classList.add('button-container');
          } else if (up.tagName === 'EM' && checkAndRemoveTildes(up.childNodes)) {
            a.className = 'button secondary';
            up.classList.add('button-container');
          }
        } else if (up.childNodes.length === 1 && up.tagName === 'EM' && threeup.childNodes.length === 1 && twoup.tagName === 'DEL' && (threeup.tagName === 'P' || threeup.tagName === 'DIV')) {
          a.className = 'button secondary';
          threeup.classList.add('button-container');
        }

        const pageType = getPageType();
        if (pageType === 'blog') {
          if (up.childNodes.length === 1 && up.tagName === 'DEL' && twoup.childNodes.length === 1 && (twoup.tagName === 'P' || twoup.tagName === 'DIV')) {
            a.className = 'button primary';
            if (a.href.includes('/cart/')) a.target = '_blank';
            twoup.classList.add('button-container');
          }
          if (up.childNodes.length === 1 && up.tagName === 'EM' && threeup.childNodes.length === 1 && twoup.tagName === 'DEL' && (threeup.tagName === 'P' || threeup.tagName === 'DIV')) {
            a.className = 'button secondary';
            if (a.href.includes('/cart/')) a.target = '_blank';
            threeup.classList.add('button-container');
          }
        } else {
          if (up.childNodes.length === 1 && up.tagName === 'DEL' && twoup.childNodes.length === 1 && (twoup.tagName === 'P' || twoup.tagName === 'DIV')) {
            a.className = 'button primary';
            twoup.classList.add('button-container');
          }

          if (up.childNodes.length === 1 && up.tagName === 'EM' && threeup.childNodes.length === 1 && twoup.tagName === 'DEL' && (threeup.tagName === 'P' || threeup.tagName === 'DIV')) {
            a.className = 'button secondary';
            threeup.classList.add('button-container');
          }
        }
      }
    }
  });
}

// On blog pages, make the last primary button sticky in mobile
export function makeLastButtonSticky() {
  if (getPageType() === 'blog') {
    const buttons = document.querySelectorAll('a.button.primary');
    if (buttons.length > 0) {
      buttons[buttons.length - 1].classList.add('sticky');
    }
  }
}

/* LOOKING FOR CURLY BRACES */

/**
 * Extracts color + number information from text content in curly braces.
 * @returns {Object|null} - An object containing the extracted color
 * or null if no color information is found.
 */
export function extractStyleVariables() {
  const textNodes = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, li, p'));
  textNodes.forEach((node) => {
    const up = node.parentElement;
    const isParagraph = node.tagName === 'P';
    const text = node.textContent;
    const numberRegex = text && /\{width-(\d{1,2})?}/; // width-60, etc. 2 digits or less (percentage)
    const sizeRegex = text && /\{size-([^}]*)\}/; // size-xl, etc.
    const alignRegex = text && /\{align-([^}]*)\}/; // align-right, align-center, align-left
    const valignRegex = text && /\{valign-([^}]*)\}/; // valign-top, valign-middle, valign-bottom
    const targetRegex = text && /\{target-([^}]*)\}/; // target-blank, target-self
    const idRegex = text && /\{id-([^}]*)\}/; // id-coolsection, etc
    const aspectRatioRegex = text && /\{aspect-([^}]*)\}/; // aspect-square, aspect-landscape, aspect-none, aspect-portrait (default)
    const colorRegex = text && /\{(?!size-|align-|valign-|spacer-|target-|id-|aspect-)([a-zA-Z-\s]+)?\}/;
    const spanRegex = new RegExp(`\\[([\\s\\S]*?)\\]${colorRegex.source}`); // [plain text]{color}

    const spacerMatch = text.match(/\{spacer-(\d+)}/); // {spacer-5}
    const numberMatches = text.match(numberRegex);
    const spanMatches = text.match(spanRegex);
    const sizeMatches = text.match(sizeRegex);
    const alignMatches = text.match(alignRegex);
    const valignMatches = text.match(valignRegex);
    const colorMatches = text.match(colorRegex);
    const targetMatches = text.match(targetRegex);
    const idMatches = text.match(idRegex);
    const aspectRatioMatches = text.match(aspectRatioRegex);

    // case where size, align are to be added to the node
    if (sizeMatches && sizeMatches[1] !== undefined) {
      const size = sizeMatches[1];
      node.classList.add(`size-${size}`);
      node.innerHTML = node.innerHTML.replace(sizeRegex, '');
    }
    if (alignMatches && alignMatches[1] !== undefined) {
      const align = alignMatches[1];
      node.classList.add(`align-${align}`);
      node.innerHTML = node.innerHTML.replace(alignRegex, '');
    }
    // case where id is in the P tag, replace the P with an A id=.
    if (isParagraph && idMatches && idMatches[1] !== undefined) {
      const id = idMatches[1];
      // Create a new <a> element
      const a = document.createElement('a');
      a.id = id;
      a.innerHTML = '';
      node.parentNode.replaceChild(a, node);
    }
    // case where new spacer node is created
    if (isParagraph && spacerMatch) {
      const spacerHeight = parseInt(spacerMatch[1], 10);
      node.style.height = `${spacerHeight * 10}px`;
      node.className = 'spacer';
      node.innerHTML = '';
    } else
      // case where width, valign and/or color are in the first P of a column or table cell
      if (isParagraph && up.tagName === 'DIV' && up.firstElementChild === node && text.startsWith('{') && text.endsWith('}')) {
        if (numberMatches) {
          const percentWidth = numberMatches[1];
          up.style.maxWidth = `${percentWidth}%`;
        }
        if (alignMatches) {
          const align = alignMatches[1];
          up.classList.add(`align-${align}`);
        }
        if (valignMatches) {
          const valign = valignMatches[1];
          up.classList.add(`valign-${valign}`);
        }
        if (colorMatches) {
          const backgroundColor = colorMatches[1];
          up.classList.add(`bg-${toClassName(backgroundColor)}`);
        }
        // pass aspect ratio through in class for styling carousels
        if (aspectRatioMatches && aspectRatioMatches[1] !== undefined) {
          const aspectRatioMatch = aspectRatioMatches[1];
          up.classList.add(`aspect-${aspectRatioMatch}`);
        }
        node.remove();
      }

    // handle span wrapping for plain text
    if (spanMatches) {
      const currentHTML = node.innerHTML;
      node.innerHTML = currentHTML.replace(new RegExp(spanRegex, 'g'), (match, spanText, color) => {
        const span = createTag('span', { class: `${toClassName(color)}` }, spanText);
        return span.outerHTML;
      });
    }

    // Then handle anchor tag color and target
    const anchor = node.querySelector('a');
    if (anchor) {
      if (colorMatches && colorMatches[1] !== undefined) {
        anchor.classList.add(`bg-${toClassName(colorMatches[1])}`);
        [anchor.textContent, anchor.title] = [anchor.textContent, anchor.title].map((str) => str.replace(colorMatches[0], ''));
        anchor.setAttribute('aria-label', anchor.textContent);
      }
      if (targetMatches && targetMatches[1] !== undefined) {
        anchor.setAttribute('target', targetMatches[1]);
        [anchor.textContent, anchor.title] = [anchor.textContent, anchor.title].map((str) => str.replace(targetMatches[0], ''));
        anchor.setAttribute('aria-label', anchor.textContent);
      }
    }
  });
}

/**
   * load fonts.css and set a session storage flag
   */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
   * load the template specific js and css
   */
async function loadTemplate(main) {
  try {
    const template = getMetadata(TEMPLATE_META) ? toClassName(getMetadata(TEMPLATE_META)) : null;
    if ((template && TEMPLATES.includes(template) && (getPageType() === 'blog')) || (getPageType() === 'author')) {
      const templateJS = await import(`../templates/${template}/${template}.js`);
      // invoke the default export from template js
      if (templateJS.default) {
        await templateJS.default(main);
      }
      loadCSS(
        `${window.hlx.codeBasePath}/templates/${template}/${template}.css`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to load template with error : ${err}`);
  }
}

export function decorateExtImage() {
  // dynamic media link or images in /svg folder
  // not for bitmap images because we're not doing renditions here
  const fragment = document.createDocumentFragment();

  document.querySelectorAll('a[href]').forEach((a) => {
    if (EXT_IMAGE_URL.test(a.href)) {
      const extImageSrc = a.href;
      const picture = document.createElement('picture');
      const img = document.createElement('img');

      img.classList.add('svg');
      // if the link title to an external image was authored, assign as alt text, else use a default
      img.alt = a.title || 'Sling TV image';
      // making assumption it is not LCP
      img.loading = 'lazy';
      img.src = extImageSrc;
      picture.append(img);

      // Check if the link's text content matches width or align
      const alignRegex = a.textContent.match(/\{align-([^}]*)\}/);
      if (alignRegex) {
        const align = alignRegex[1];
        picture.classList.add(`align-${align}`);
      }
      const numberMatches = a.textContent.match(/\{width-(\d{1,2})?}/);
      if (numberMatches) {
        const percentWidth = numberMatches[1];
        img.style.maxWidth = `${percentWidth}%`;
        a.textContent = a.textContent.replace(numberMatches[0], '');
        a.title = a.title.replace(numberMatches[0], '');
      }

      fragment.append(picture);
      a.replaceWith(fragment);

      // After replacing the <a> with the <picture>, check for <br> and <a> sibling pattern
      // (i.e., <picture> (just inserted), <br>, <a>)
      if (picture.nextSibling && picture.nextSibling.nodeName === 'BR' && picture.nextSibling.nextSibling && picture.nextSibling.nextSibling.nodeName === 'A') {
        const br = picture.nextSibling;
        const nextA = br.nextSibling;
        const up = nextA.parentElement;
        const picClone = picture.cloneNode(true);
        const existingPic = nextA.querySelector('picture img');
        const newPicImg = picClone.querySelector('img');
        // Only replace if the <a> doesn't already have the correct <picture>
        if (!existingPic || existingPic.src !== newPicImg.src) {
          nextA.replaceChildren(picClone);
        }
        // Only insert if an identical <a> (with picture) doesn't already exist in the parent
        const duplicate = Array.from(up.children).some((child) => (
          child.nodeName === 'A'
          && child.href === nextA.href
          && child.querySelector('picture img')
          && child.querySelector('picture img').src === newPicImg.src
        ));
        if (!duplicate) {
          up.insertAdjacentHTML('beforeend', nextA.outerHTML);
        }
        br.remove();
      }
    }
  });
}

export function decorateExternalLinks(main) {
  main.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href) {
      const extension = href.split('.').pop().trim();
      if (!href.startsWith('/') && !href.startsWith('#')) {
        const url = new URL(href, window.location.href);
        const host = url.hostname;

        // Open in new tab if:
        // 1. It's a PDF
        // 2. It's not sling.com
        // 3. It is specifically watch.sling.com
        if (
          extension === 'pdf'
          || (!host.endsWith('sling.com') || host === 'watch.sling.com')
        ) {
          a.setAttribute('target', '_blank');
        } else {
          a.removeAttribute('target');
        }
      }
    }
  });
}

/**
   * Builds all synthetic blocks in a container element.
   * @param {Element} main The container element
   */
function buildAutoBlocks(main) {
  try {
    buildHeroBlock(main);
    if (getPageType() !== 'blog') buildFragmentBlocks(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

function decorateLinkedImages() {
  const pictures = document.querySelectorAll('main picture');
  pictures.forEach((picture) => {
    const next = picture.nextElementSibling;
    if (next && next.tagName === 'A') {
      const a = next;
      a.replaceChildren(picture);
    } else if (next && next.tagName === 'BR' && next.nextElementSibling && next.nextElementSibling.tagName === 'A') {
      const a = next.nextElementSibling;
      a.replaceChildren(picture);
    }
  });
}

/**
 * Handles section nesting when sections have the same fragment-id
 * @param {Element} section The section element to check
 */
function handleTargetSections(doc) {
  const main = doc.querySelector('main');
  main.querySelectorAll(':scope > div.section').forEach((section) => {
    const childSection = section.querySelector('div.section');
    if (childSection) {
      const parentFragmentId = section.getAttribute('data-fragment-id');
      const childFragmentId = childSection.getAttribute('data-fragment-id');
      if (parentFragmentId && childFragmentId && parentFragmentId === childFragmentId) {
        section.replaceWith(childSection);
      }
    }
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
export function decorateMain(main) {
  // hopefully forward compatible button decoration
  centerHeadlines();
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
  decorateButtons(main);
  replaceTildesWithDel(main);
  decorateExternalLinks(main);
  makeTwoColumns(main);
  decorateStyledSections(main);
  decorateExtImage(main);
  decorateLinkedImages();
  extractStyleVariables(main);
  decorateExtImage(main);
  buildVideoBlocks(main);
}

/**
 * Loads data layer utilities if not already loaded
 * @returns {Promise<boolean>} - True if loaded, false if already exists
 */
async function loadDataLayerUtils() {
  // Check if already loaded
  if (window.adobeDataLayer && window.adobeDataLayer.version) {
    // eslint-disable-next-line no-console
    console.log('[Scripts.js] Data layer already loaded');
    return false;
  }

  // Load the EDS analytics library (minified for production, full version for dev/staging)
  const isProduction = window.location.hostname.endsWith('.live') || window.location.hostname.includes('sling.com');
  const dataLayerScript = isProduction
    ? '/eds/scripts/analytics-lib-eds.min.js'
    : '/eds/scripts/analytics-lib-eds.js';

  try {
    await loadScript(dataLayerScript);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Scripts.js] Failed to load analytics script:', error);
    return false;
  }

  // Initialize analytics-lib-eds.js with appName
  if (window.analytics && window.analytics.getInstance) {
    // Check if analytics instance already exists (to prevent duplicates from delayed.js)
    if (!window.slingAnalytics) {
      window.slingAnalytics = window.analytics.getInstance('eds-aem-marketing-site');

      // Trigger initial page load to populate data layer
      if (window.slingAnalytics && window.slingAnalytics.screenLoad) {
        window.slingAnalytics.screenLoad({
          name: window.location.pathname,
          type: 'generic',
        });
      } else {
        // eslint-disable-next-line no-console
        console.error('[Scripts.js] screenLoad method not found on analytics instance');
      }
    }
  } else {
    // eslint-disable-next-line no-console
    console.error('[Scripts.js] analytics not found - analytics-lib-eds.js may not have loaded properly');
  }
  return true;
}

async function loadLaunchEager() {
  const targetEnabled = getMetadata('target');
  if (targetEnabled && targetEnabled.toLowerCase() === 'true') {
    await loadDataLayerUtils();

    // Load environment-specific Launch scripts to avoid bloating production analytics
    if (window.location.host.startsWith('localhost')) {
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-b69ac51c7dcd-development.min.js');
    } else if (window.location.host.includes('sling.com') || window.location.host.endsWith('.live')) {
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-c846c0e0cbc6.min.js');
    } else if (window.location.host.endsWith('.page')) {
      await loadScript('https://assets.adobedtm.com/f4211b096882/26f71ad376c4/launch-6367a8aeb307-staging.min.js');
    }
  }
}

/**
 * Loads a block named 'header' into header
 * @param {Element} header header element
 * @returns {Promise}
 */
async function loadHeader(header) {
  let block = 'header';
  const template = getMetadata('template');
  if (template
    && (template === 'blog-article'
      || template === 'blog-category' || template === 'blog-author')) {
    block = 'whatson-header';
  }
  const headerBlock = buildBlock(`${block}`, '');
  header.append(headerBlock);
  decorateBlock(headerBlock);
  return loadBlock(headerBlock);
}

/**
   * Loads everything needed to get to LCP.
   * @param {Element} doc The container element
   */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    if (getPageType() === 'blog') {
      buildPopularBlogs(main);
    }
    decorateMain(main);
    await loadTemplate(main);
    document.body.classList.add('appear');
    await waitForLCP(LCP_BLOCKS);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
  configSideKick();
  // load launch eagerly when target metadata is set to true
  await loadLaunchEager();
}

/**
   * Loads everything that doesn't need to be delayed.
   * @param {Element} doc The container element
   */
async function loadLazy(doc) {
  autolinkModals(doc);
  const main = doc.querySelector('main');
  await loadBlocks(main);
  await setFragmentIds(main);
  const gameFinders = doc.querySelectorAll('.game-finder.block');
  if (gameFinders && gameFinders.length > 0) {
    await loadGameFinders(doc);
  }
  const packageCards = doc.querySelectorAll('.package-cards.block');
  if (packageCards && packageCards.length > 0) {
    await loadPackageCards(doc);
  }
  // listen to zipcode changes and redecorate
  document.addEventListener('zipupdate', async () => {
    if (packageCards && packageCards.length > 0) {
      await loadPackageCards(doc);
    }
    if (gameFinders && gameFinders.length > 0) {
      await loadGameFinders(doc);
    }
  }, { once: true });
  buildMultipleButtons(main);
  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();
  loadHeader(doc.querySelector('header'));
  setNavType(main);
  loadFooter(doc.querySelector('footer'));
  buildGlobalBanner(main);
  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
   * Loads everything that happens a lot later,
   * without impacting the user experience.
   */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

/**
 * Sets up a MutationObserver to watch for block replacements in the DOM
 * and reinitialize them when they are replaced.
 */
function setupBlockObserver() {
  // Define an array of block names to observe
  // These are blocks that have interactive elements and need rebinding
  const blocksToObserve = [
    'carousel', // Has slide navigation and auto-scroll
    'accordion', // Has expand/collapse functionality
    'tabs', // Has tab switching functionality
    'modal', // Has dialog show/hide and close button events
    'image-slider', // Has auto-scrolling functionality
    'game-finder', // Has interactive React app elements
    'channel-lookup', // Has form submission and API interactions
    'chat', // Has interactive chat functionality
    'marquee', // Has scroll CTA and resize handlers
    'offer-cards', // Has resize event handlers
    'channel-shopper', // Has IntersectionObserver and React app
    'category', // Has media query listeners and author click handlers
  ];

  // Create a MutationObserver to watch for DOM changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Process each added node
        mutation.addedNodes.forEach((node) => {
          // Skip text nodes and nodes that are directly in header or footer
          if (node.nodeType !== Node.ELEMENT_NODE
              || (node.parentElement
               && (node.parentElement.tagName === 'HEADER'
                || node.parentElement.tagName === 'FOOTER'))) {
            return;
          }

          // Check if the added node is one of the blocks we want to observe
          const isObservedBlock = node.classList
          && blocksToObserve.some((blockName) => node.classList.contains(blockName)
            || (node.classList.contains('block') && node.classList.contains(blockName)));

          if (isObservedBlock) {
            // Determine which block type this is
            const blockType = blocksToObserve.find((blockName) => node.classList.contains(blockName)
              || (node.classList.contains('block') && node.classList.contains(blockName)));

            if (blockType) {
              // Import the block module and call rebindEvents
              const importPath = window.hlx?.codeBasePath
                ? `${window.hlx.codeBasePath}/blocks/${blockType}/${blockType}.js`
                : `/eds/blocks/${blockType}/${blockType}.js`;

              import(importPath)
                .then((module) => {
                  if (module.rebindEvents) {
                    module.rebindEvents(node);
                    node.setAttribute('data-bound', 'true');
                  }
                })
                .catch(() => {
                  // Try alternative path resolution
                  const altImportPath = `../blocks/${blockType}/${blockType}.js`;

                  import(altImportPath)
                    .then((module) => {
                      if (module.rebindEvents) {
                        module.rebindEvents(node);
                        node.setAttribute('data-bound', 'true');
                      }
                    })
                    .catch(() => {
                      // Handle error silently
                    });
                });
            }
          }
        });
      }
    });
  });

  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also set up a periodic check for blocks that need rebinding
  setInterval(() => {
    // Find all blocks in the main content area that need rebinding
    const blocksToCheck = blocksToObserve
      .map((blockName) => `main .${blockName}, main .block.${blockName}`)
      .join(', ');

    const blocks = document.querySelectorAll(blocksToCheck);

    blocks.forEach((block) => {
      // Skip if already bound
      if (block.hasAttribute('data-bound')) {
        return;
      }

      // Determine which block type this is
      const blockType = blocksToObserve.find((blockName) => block.classList.contains(blockName)
        || (block.classList.contains('block') && block.classList.contains(blockName)));

      if (blockType) {
        // Import the block module and call rebindEvents
        const importPath = window.hlx?.codeBasePath
          ? `${window.hlx.codeBasePath}/blocks/${blockType}/${blockType}.js`
          : `/eds/blocks/${blockType}/${blockType}.js`;

        import(importPath)
          .then((module) => {
            if (module.rebindEvents) {
              module.rebindEvents(block);
              block.setAttribute('data-bound', 'true');
            }
          })
          .catch(() => {
            // Try alternative path resolution
            const altImportPath = `../blocks/${blockType}/${blockType}.js`;

            import(altImportPath)
              .then((module) => {
                if (module.rebindEvents) {
                  module.rebindEvents(block);
                  block.setAttribute('data-bound', 'true');
                }
              })
              .catch(() => {
                // Handle error silently
              });
          });
      }
    });
  }, 2000); // Check every 2 seconds
}

async function loadPage() {
  // load everything that needs to be loaded eagerly
  await loadEager(document);

  // load everything that can be postponed to the latest here
  // Start observing for section changes after initial decoration
  handleTargetSections(document);
  // Set up observer for block DOM changes
  setupBlockObserver();
  // load everything that needs to be loaded later
  await loadLazy(document);

  loadDelayed();
  // make the last button sticky on blog pages
  makeLastButtonSticky();
}
loadPage();
// enable live preview in da.live
(async function loadDa() {
  if (!new URL(window.location.href).searchParams.get('dapreview')) return;
  // eslint-disable-next-line import/no-unresolved
  import('https://da.live/scripts/dapreview.js').then(({ default: daPreview }) => daPreview(loadPage));
}());
