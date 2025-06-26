import {
  getMetadata, buildBlock, decorateBlock, createOptimizedPicture, toCamelCase,
} from './aem.js';

import { getTag } from './tags.js';

export const PRODUCTION_DOMAINS = ['sling.com'];

const domainCheckCache = {};
export const ZIPCODE_KEY = 'user_zip';
export const DMA_KEY = 'user_dma';
/**
 * Checks a url to determine if it is a known domain.
 * @param {string | URL} url the url to check
 * @returns {Object} an object with properties indicating the urls domain types.
 */
export function checkDomain(url) {
  const urlToCheck = typeof url === 'string' ? new URL(url) : url;

  let result = domainCheckCache[urlToCheck.hostname];
  if (!result) {
    const isProd = PRODUCTION_DOMAINS.some((host) => urlToCheck.hostname.includes(host));
    const isHlx = ['hlx.page', 'hlx.live', 'aem.page', 'aem.live'].some((host) => urlToCheck.hostname.includes(host));
    const isLocal = urlToCheck.hostname.includes('localhost');
    const isPreview = isLocal || urlToCheck.hostname.includes('hlx.page') || urlToCheck.hostname.includes('aem.page');
    const isKnown = isProd || isHlx || isLocal;
    const isExternal = !isKnown;
    result = {
      isProd,
      isHlx,
      isLocal,
      isKnown,
      isExternal,
      isPreview,
    };

    domainCheckCache[urlToCheck.hostname] = result;
  }

  return result;
}
/**
 * check if link text is same as the href
 * @param {Element} link the link element
 * @returns {boolean} true or false
 */
export function linkTextIncludesHref(link) {
  const href = link.getAttribute('href');
  const textcontent = link.textContent;

  return textcontent.includes(href);
}

/**
 * Create an HTML tag in one line of code
 * @param {string} tag Tag to create
 * @param {object} attributes Key/value object of attributes
 * @param {Element} html html to append to tag
 * @returns {HTMLElement} The created tag
 */
export function createTag(tag, attributes, html = undefined) {
  const element = document.createElement(tag);
  if (html) {
    if (html instanceof HTMLElement || html instanceof SVGElement) {
      element.append(html);
    } else {
      element.insertAdjacentHTML('beforeend', html);
    }
  }
  if (attributes) {
    Object.entries(attributes)
      .forEach(([key, val]) => {
        element.setAttribute(key, val);
      });
  }
  return element;
}
const TAGS_NOT_TO_BE_TRANSLATED = ['latino-es', 'sci-fi'];
export const pathToTag = (
  (name) => {
    let path = name;
    if (!TAGS_NOT_TO_BE_TRANSLATED.includes(name)) {
      if (name.toLowerCase().includes('-')) {
        path = name.toLowerCase().replace('-', ' ');
      }
    }
    if (name.toLowerCase().includes('-and-')) {
      path = name.toLowerCase().replace('-and-', ' & ');
    }
    return path.toLowerCase();
  }
);
// blog details related functions

/**
 * function to build the breadcrumb for blog details page
 * @returns blobsdiv element for whatson pages, otherwise null
 */
export function buildBlogBreadcrumb() {
  const urlPath = window.location.pathname;

  if (urlPath.includes('/whatson')) {
    const bcWrapper = createTag('div', { class: 'blog-breadcrumb' });
    const breamCrumbs = ['BLOG'];
    let pathElements = urlPath.split('/');
    pathElements = pathElements.slice(2, pathElements.length - 1);
    pathElements.forEach((path) => (breamCrumbs.push(pathToTag(path).toUpperCase())));

    breamCrumbs.map((breadCrumb, index) => {
      const href = urlPath.substring(0, urlPath.indexOf(urlPath.split('/')[index + 2]) - 1);
      const breadCrumbLink = createTag('a', {
        class: 'blog-breadcrumb-link',
        href,
      });
      breadCrumbLink.innerHTML = breadCrumb === 'ANIMATION' ? 'ADULT ANIMATION' : breadCrumb;
      const arrowSpan = createTag('span', { class: 'icon icon-fw-arrow' });
      return bcWrapper.append(breadCrumbLink, arrowSpan);
    });
    const pageTitle = getMetadata('og:title');
    if (pageTitle) {
      // generate span tag with title
      const titleSpan = createTag('span', { class: 'blog-breadcrumb-active-article' });
      titleSpan.innerHTML = pageTitle.toUpperCase();
      bcWrapper.append(titleSpan);
    }
    return bcWrapper;
  }
  return null;
}

/**
 * Builds video and social media blocks when those links are encountered
 * @param {Element} main The container element
  */

export function buildVideoBlocks(main) {
  const videoPlatforms = /youtu|vimeo|twitter\.com|facebook\.com|instagram\.com|watch\.sling\.com/;
  main.querySelectorAll('a[href]').forEach((a) => {
    if (videoPlatforms.test(a.href) && linkTextIncludesHref(a)) {
      const embedBlock = buildBlock('embed', a.cloneNode(true));
      a.replaceWith(embedBlock);
      decorateBlock(embedBlock);
    }
  });
}

/**
   * Builds fragment blocks from links to fragments
   * @param {Element} main The container element
   */
export function buildFragmentBlocks(main) {
  main.querySelectorAll('a[href]').forEach((a) => {
    const url = new URL(a.href);
    const domainCheck = checkDomain(url);
    if (domainCheck.isKnown && linkTextIncludesHref(a) && url.pathname.includes('/fragments/')) {
      const block = buildBlock('fragment', url.pathname);
      const parent = a.parentElement;
      a.replaceWith(block);
      decorateBlock(block);
      if (parent.tagName === 'P' && parent.querySelector('.block')) {
        const div = document.createElement('div');
        div.className = parent.className;
        while (parent.firstChild) div.appendChild(parent.firstChild);
        parent.replaceWith(div);
      }
    }
  });
}

/**
 * Function to build the Mostpopular blogs
 * @returns popular blogs block
 */
export function buildPopularBlogs(main) {
  const section = createTag('div');
  const popularBlogs = createTag('div', { class: 'slides-container' });
  const block = buildBlock('popular-blogs', { elems: [popularBlogs] });
  section.append(block);
  main.append(section);
}

/**
 * Function to check whether the page is of type blog-article
 * @returns {string} - The type of the page based on template
 */
export function getPageType() {
  const template = getMetadata('template');
  if (template === 'blog-article') return 'blog';
  if (template === 'blog-category') return 'category';
  if (template === 'blog-author') return 'author';
  return '';
}

export function centerHeadlines() {
  const headlines = document.querySelectorAll('h1 > strong, h2 > strong, h3 > strong, h4 > strong');
  headlines.forEach((headline) => {
    headline.parentElement.classList.add('center');
  });
}

/**
 * Fetches and transforms data from a JSON file
 * @param {string} path - The path to the JSON file
 * @returns {Promise<Array>} - A promise resolving to the transformed data array
 */
export async function fetchData(path) {
  const response = await fetch(path);
  const json = await response.json();

  return json.data.map((row) => {
    if (row.image.startsWith('/default-meta-image.png')) {
      row.image = `/${window.hlx.codeBasePath}${row.image}`;
    }
    return row;
  });
}

/**
 * Converts excel date into JS date.
 * @param {number} excelDate date to convert.
 */
export function convertExcelDate(excelDate) {
  const jsDate = +excelDate > 99999
    ? new Date(+excelDate * 1000)
    : new Date(Math.round((+excelDate - (1 + 25567 + 1)) * 86400 * 1000));
  jsDate.setTime(jsDate.getTime() + 12 * 60 * 60 * 1000); // add 12 hrs
  return jsDate;
}

function compareArrays(arr, arr2) {
  return arr.every((i) => arr2.includes(i));
}

/**
 * Retrieves blogs matching specific tags
 * @param {Array} categories - An array of categories to filter by
 * @param {number} num - The number of blogs to retrieve
 * @param {string} limit - The limit of blogs to retrieve from the query-index
 * @returns {Promise<Array>} - A promise resolving to the filtered blogs array
 */
export async function getBlogs(categories, num, limit = '') {
  if (!window.allBlogs) {
    window.allBlogs = await fetchData(`/whatson/query-index.json${limit ? `?limit=${limit}` : ''}`);
  }
  const isBlogsHome = (window.location.pathname === '/whatson' || window.location.pathname === '/whatson/');
  const blogArticles = isBlogsHome
    ? window.allBlogs.filter(
      (e) => (e.template === 'blog-article'
        && e.image !== ''
        && !e.image.startsWith('//eds/default-meta-image.png')
        && (e.hideFromHome !== 'yes')),
    )
    : window.allBlogs.filter(
      (e) => (e.template === 'blog-article'
        && e.image !== ''
        && !e.image.startsWith('//eds/default-meta-image.png')),
    );

  if ((categories && categories.length > 0)) {
    const filteredList = blogArticles.filter((e) => {
      const rawTags = JSON.parse(e.tags);
      const tags = rawTags.map((tag) => tag.trim().toLowerCase());
      return compareArrays(categories, tags);
    });
    if (num) {
      return filteredList.slice(0, num);
    }
    return filteredList;
  }
  if (num) {
    return blogArticles.slice(0, num);
  }
  return blogArticles;
}

export async function getBlogsByPaths(paths, limit = '') {
  if (!window.allBlogs) {
    window.allBlogs = await fetchData(`/whatson/query-index.json${limit ? `?limit=${limit}` : ''}`);
  }
  const blogArticles = window.allBlogs.filter(
    (e) => (e.template !== 'blog-category' && e.image !== '' && !e.image.startsWith('//eds/default-meta-image.png')),
  );
  let filterArticles = [];
  if (paths && paths.length > 0) {
    filterArticles = blogArticles.filter((b) => (paths.includes(b.path)));
  }
  return filterArticles;
}

// Adding tags
function addTags(container, tags) {
  const tagsDiv = createTag('div', { class: 'card-tags' });
  tags.forEach(async (tag) => {
    const tagObject = await getTag(tag.trim());
    const tagElement = createTag('a', {
      class: 'card-tag-link',
      href: `/whatson/${tagObject.name}`,
    }, tag.toUpperCase());
    tagsDiv.append(tagElement);
  });
  container.append(tagsDiv);
}

function addTagsOnLargeCards(container, tags, lastSegmentOfURL) {
  const tagsDiv = createTag('div', { class: 'card-tags' });
  tags.forEach(async (tag) => {
    if (tag.trim() === lastSegmentOfURL.trim().toUpperCase().replace(/-/g, ' ')) {
      const tagObject = await getTag(tag.trim());
      const tagElement = createTag('a', {
        class: 'card-tag-link',
        href: `/whatson/${tagObject.name}`,
      }, tag.toUpperCase());
      tagsDiv.append(tagElement);
    }
  });
  container.append(tagsDiv);
}

// Adding title
function addTitle(container, title) {
  const titleDiv = createTag('div', { class: 'card-title' }, title);
  container.append(titleDiv);
}

// Adding description
function addDescription(container, description) {
  const descriptionDiv = createTag('div', { class: 'card-description' }, `${description.substring(0, 100)}…`);
  container.append(descriptionDiv);
}

// Adding author + publish date
function addAuthorAndDate(container, authorName, publishDate) {
  const authorDateDiv = createTag('div', { class: 'card-author-date' });
  const author = createTag('span', { class: 'card-author' }, authorName || 'Sling Staff');
  authorDateDiv.append(author);
  if (publishDate) {
    const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = publishDate.toLocaleDateString('en-US', dateOptions);
    const date = createTag('span', { class: 'card-date' }, formattedDate);
    authorDateDiv.append(date);
  }
  container.append(authorDateDiv);
}

// Creating card content
export async function addCardContent(container, lastSegmentOfURL, {
  tags, title, description, author, date,
}) {
  const cardContent = createTag('div', { class: 'card-content' });
  container.append(cardContent);

  if (tags) {
    if (typeof lastSegmentOfURL !== 'undefined' && lastSegmentOfURL != null) {
      addTagsOnLargeCards(cardContent, tags, lastSegmentOfURL);
    } else {
      addTags(cardContent, tags);
    }
  }
  if (title) {
    addTitle(cardContent, title);
  }
  if (description) {
    addDescription(cardContent, description);
  }
  addAuthorAndDate(cardContent, author, date);
}

// Create card images using default thumbnail image
export async function addCardImage(row, style, eagerImage = false) {
  if (row.image !== '' && row.image !== '0' && row.title !== '0') {
    const cardImageDiv = createTag('div', { class: 'card-image' });
    cardImageDiv.append(createOptimizedPicture(
      row.image,
      row.title,
      eagerImage,
      [{ width: '600' }], // good enough because 795 is the max card width
    ));
    return cardImageDiv;
  }
  return null;
}

/**
 * utility to create a tag with link to author page
 * @param {*} authName - author name mentioned in the page metadata
 * @returns a element
 */
export function buildAuthorLink(authName) {
  const authLink = createTag('a', {
    href: `${window.location.origin}/whatson/author/${authName.trim().toLowerCase().replace(' ', '-')}`,
  });
  return authLink;
}

/**
 * Gets placeholders object.
 * @param {string} [prefix] Location of placeholders
 * @param {string} [sheet] Sheet name to fetch placeholders from
 * @returns {object} Window placeholders object
 */
// eslint-disable-next-line import/prefer-default-export, default-param-last
export async function fetchPlaceholders(prefix = 'default', sheet = '') {
  window.placeholders = window.placeholders || {};
  if (!window.placeholders[`${prefix}-${sheet}`]) {
    window.placeholders[`${prefix}-${sheet}`] = new Promise((resolve) => {
      fetch(`/${prefix === 'default' ? '' : prefix}/placeholders.json${sheet === '' ? '' : `?sheet=${sheet}`}`)
        .then((resp) => {
          if (resp.ok) {
            return resp.json();
          }
          return {};
        })
        .then((json) => {
          const placeholders = {};
          if (sheet !== '') {
            const jsonData = json.data;
            jsonData
              .filter((placeholder) => placeholder.Key)
              .forEach((placeholder) => {
                placeholders[toCamelCase(placeholder.Key)] = placeholder.Text;
              });
          } else {
            json[':names'].forEach((sheetname) => {
              json[sheetname].data.forEach((item) => {
                placeholders[toCamelCase(item.Key)] = item.Text;
              });
            });
          }
          window.placeholders[prefix] = placeholders;
          resolve(window.placeholders[prefix]);
        })
        .catch(() => {
          // error loading placeholders
          window.placeholders[`${prefix}-${sheet}`] = {};
          resolve(window.placeholders[`${prefix}-${sheet}`]);
        });
    });
  }
  return window.placeholders[`${prefix}-${sheet}`];
}

/**
 * Data from Commerce GraphQL endpoint to populate the plan offer block
 */

export const GRAPHQL_ENDPOINT = 'https://www.slingcommerce.com/graphql';

export const GQL_QUERIES = Object.freeze({
  zipcodeAddressVerificationV2: {
    operationName: 'zipcodeAddressVerificationV2',
    query: `
      query zipcodeAddressVerificationV2($zipcode: String!) {
        zipcodeAddressVerificationV2(zipcode: $zipcode) {
          zipcode_matched
          zipcode
          dma
          latitude
          longitude
          city
          state
          __typename
        }
      }
    `,
    variables: (zipCode) => `{"zipcode":"${zipCode}"}`,
  },
  packagesPerZipCode: {
    operationName: 'packagesPerZipCode',
    query: `
      query packagesPerZipcode($zipcode: String!) {
        packagesPerZipcode(zipcode: $zipcode) {
          id
          identifier
          name
          guid
          sku
          package_type
          csr_required
          amount
          description
          migrated_to
          enabled
          priority
          __typename
        }
      }
    `,
    variables: (zipCode) => `{"zipcode":"${zipCode}"}`,
  },
  getPackage: {
    operationName: 'getPackage',
    query: `
      query GetPackage($filter: PackageAttributeFilterInput) {
        packages(filter: $filter) {
          items {
            plan {
              plan_code
              plan_identifier
              plan_name
              __typename
            }
            planOffer {
              plan_offer_identifier
              discount
              discount_type
              plan_offer_name
              offer_identifier
              description
              __typename
            }
            package {
              name
              base_price
              sku
              channels {
                identifier
                call_sign
                name
                __typename
              }
              plan_offer_price
              canonical_identifier
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `,
    variables: (packageType, isChannelRequired, tagIn, zipCode, planOfferIdentifier, planIdentifier) => `{"filter":{"pck_type":{"in":["${packageType}"]},"is_channel_required":{"eq":${isChannelRequired}},"tag":{"in":["${tagIn}"]},"zipcode":{"eq":"${zipCode}"},"plan_offer_identifier":{"eq":"${planOfferIdentifier}"},"plan_identifier":{"eq":"${planIdentifier}"}}}`,
  },
});

export function cleanGQLParam(param) {
  return param.replace(/\s+/g, ' ').trim();
}

/** Make GraphQL query to fetch data */
/**
 * Fetches data from the GraphQL endpoint
 * @param {*} query GraphQL Query
 * @param variables
 * @param operationName
 * @returns JSON response from the GraphQL endpoint
 */
export async function fetchGQL(query, variables, operationName) {
  if (!query || !variables || !operationName) return null;
  const params = new URLSearchParams({
    query: cleanGQLParam(query),
    variables: cleanGQLParam(variables),
    operationName: cleanGQLParam(operationName),
  });
  const res = await fetch(`${GRAPHQL_ENDPOINT}?${params}`);
  const gqlResponse = await res.json();
  return gqlResponse;
}

export async function loadScript(src, attrs, container) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    if (attrs) {
      // eslint-disable-next-line no-restricted-syntax, guard-for-in
      for (const attr in attrs) {
        script.setAttribute(attr, attrs[attr]);
      }
    }
    script.onload = resolve;
    script.onerror = reject;
    container.append(script);
  });
}

const gmoptions = {
  rootMargin: '0px 0px 500px 0px',
  threshold: 0,
};
// eslint-disable-next-line no-use-before-define
const gmobserver = new IntersectionObserver(loadGameFinderApp, gmoptions);

function loadGameFinderApp(entries) {
  if (entries.some(async (entry) => {
    if (entry.isIntersecting) {
      await loadScript('/eds/scripts/sling-react/game-finder-build.js', {}, entry.target);
      gmobserver.unobserve(entry.target);
    }
  }));
}

export async function loadGameFinders() {
  const gameFinderBlock = document.querySelector('.game-finder.block');
  gmobserver.observe(gameFinderBlock);
}

const pcoptions = {
  threshold: 0,
};
// eslint-disable-next-line no-use-before-define
const pcobserver = new IntersectionObserver(loadPackageCard, pcoptions);

function loadPackageCard(entries) {
  if (entries.some(async (entry) => {
    if (entry.isIntersecting) {
      await loadScript('/eds/scripts/sling-react/package-cards-build.js', {}, entry.target);
      pcobserver.unobserve(entry.target);
    }
  }));
}

export async function loadPackageCards() {
  const pcBlock = document.querySelector('.package-cards.block');
  pcobserver.observe(pcBlock);
}

function toPropName(name) {
  return typeof name === 'string'
    ? name
      .replace(/[^0-9a-z]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    : '';
}

export async function readBlockConfig(block) {
  const config = {};
  block.querySelectorAll(':scope > div:not([id])').forEach((row) => {
    if (row.children) {
      const cols = [...row.children];
      if (cols[1]) {
        const col = cols[1];
        const name = toPropName(cols[0].textContent);
        let value = '';
        if (col.querySelector('a')) {
          const as = [...col.querySelectorAll('a')];
          if (as.length === 1) {
            value = as[0].href;
          } else {
            value = as.map((a) => a.href);
          }
        } else if (col.querySelector('img')) {
          const imgs = [...col.querySelectorAll('img')];
          if (imgs.length === 1) {
            value = imgs[0].src;
          } else {
            value = imgs.map((img) => img.src);
          }
        } else if (col.querySelector('p')) {
          const ps = [...col.querySelectorAll('p')];
          if (ps.length === 1) {
            value = ps[0].innerHTML;
          } else {
            value = ps.map((p) => p.textContent);
          }
        } else value = row.children[1].textContent;
        config[name] = value;
      }
    }
  });
  return config;
}

export function getVideoUrlByScreenWidth(videoLinks) {
  const screenWidth = window.innerWidth;
  if (!videoLinks.length) return null;
  if (videoLinks.length === 1) return videoLinks[0].getAttribute('href');
  if (videoLinks.length === 2) {
    // 0: desktop/tablet, 1: mobile
    return screenWidth >= 1024 ? videoLinks[0].getAttribute('href') : videoLinks[1].getAttribute('href');
  }
  // 3+ links: 0: desktop, 1: tablet, 2: mobile
  if (screenWidth >= 1024) return videoLinks[0].getAttribute('href');
  if (screenWidth >= 768) return videoLinks[1].getAttribute('href');
  return videoLinks[2].getAttribute('href');
}

export function getPictureUrlByScreenWidth(pictures) {
  const screenWidth = window.innerWidth;
  if (!pictures.length) return null;
  if (pictures.length === 1) return pictures[0];
  if (pictures.length === 2) {
    // 0: desktop/tablet, 1: mobile
    return screenWidth >= 1024 ? pictures[0] : pictures[1];
  }
  // 3+ images: 0: desktop, 1: tablet, 2: mobile
  if (screenWidth >= 1024) return pictures[0];
  if (screenWidth >= 768) return pictures[1];
  return pictures[2];
}

/**
 * Fetches zipcode and DMA from the geo endpoint (IP-based)
 * @returns {Promise<Object>} Object containing zipcode and dma
 */
export async function fetchZipcodeAndDMA() {
  const ZIPCODE_ENDPOINT = 'https://p-geo.movetv.com/geo';
  const DEFAULT_ZIPCODE = '90020';
  const DEFAULT_DMA = '803';

  try {
    const response = await fetch(ZIPCODE_ENDPOINT);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return {
      zipcode: data?.zip_code || DEFAULT_ZIPCODE,
      dma: data?.dma || DEFAULT_DMA,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch geo data, using defaults:', error);
    return {
      zipcode: DEFAULT_ZIPCODE,
      dma: DEFAULT_DMA,
    };
  }
}

/**
 * Fetches DMA for a specific zipcode using GraphQL
 * @param {string} zipcode - The zipcode to get DMA for
 * @returns {Promise<string>} The DMA value
 */
export async function fetchDMAForZipcode(zipcode) {
  const DEFAULT_DMA = '803';

  try {
    const { query, variables, operationName } = GQL_QUERIES.zipcodeAddressVerificationV2;
    const response = await fetchGQL(query, variables(zipcode), operationName);

    if (response?.data?.zipcodeAddressVerificationV2?.dma) {
      return response.data.zipcodeAddressVerificationV2.dma;
    }

    return DEFAULT_DMA;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch DMA for zipcode, using default:', error);
    return DEFAULT_DMA;
  }
}

export async function getZipcode() {
  let zipcode = localStorage.getItem(ZIPCODE_KEY);
  if (!zipcode) {
    const { zipcode: fetchedZipcode, dma } = await fetchZipcodeAndDMA();
    zipcode = fetchedZipcode;
    localStorage.setItem(ZIPCODE_KEY, zipcode);
    localStorage.setItem(DMA_KEY, dma);
  }
  return zipcode;
}

/**
 * Gets the current DMA value from localStorage
 * @returns {string} The DMA value
 */
export function getDMA() {
  return localStorage.getItem(DMA_KEY) || '803';
}

export function configSideKick() {
  const createStyleLink = (href) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    return link;
  };

  const setupDialog = (container) => {
    Object.assign(container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: '9999',
    });

    container.addEventListener('click', (e) => {
      if (e.target === container) {
        document.body.removeChild(container);
      }
    });

    document.body.appendChild(container);
  };

  const loadDialogScript = (src) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      document.dispatchEvent(new Event('DOMContentLoaded'));
    };
    return script;
  };

  const handleExportClick = async (event) => {
    event.preventDefault();

    // Find the closest block or section element
    const currentElement = event.currentTarget.closest('.block, .section');
    if (!currentElement) {
      // eslint-disable-next-line no-console
      console.error('No block or section found for export');
      return;
    }

    // Get login status from the most recent payload
    const isLoggedIn = window.lastSidekickPayload?.status?.profile !== undefined;

    // Determine if it's a block or section and get the appropriate attributes
    const isBlock = currentElement.classList.contains('block');
    const elementName = isBlock
      ? currentElement.getAttribute('data-block-name')
      : Array.from(currentElement.classList).pop();
    const fragmentId = currentElement.getAttribute('data-fragment-id');

    if (!elementName) {
      // eslint-disable-next-line no-console
      console.error('No name found for element');
      return;
    }

    // Create a clone of the element for export
    const elementClone = isBlock
      ? currentElement.parentElement.cloneNode(true)
      : currentElement.cloneNode(true);

    // Remove header from the clone
    const headerToRemove = elementClone.querySelector(isBlock ? '.block-header' : '.section-header');
    if (headerToRemove) {
      headerToRemove.remove();
    }

    // Remove 'highlight' class from the clone
    elementClone.classList.remove('highlight');

    const dialogContainer = document.createElement('div');
    dialogContainer.className = 'html-offer-dialog-container';
    dialogContainer.setAttribute(`data-current-${isBlock ? 'block' : 'section'}`, elementName);
    dialogContainer.setAttribute('data-fragment-id', fragmentId);
    // Store the cleaned element clone for later use
    dialogContainer.setAttribute(`data-${isBlock ? 'block' : 'section'}-content`, elementClone.outerHTML);
    // Store login status
    dialogContainer.setAttribute('data-user-logged-in', isLoggedIn);

    try {
      const [response, styleLink] = await Promise.all([
        fetch('/tools/htmloffer/htmloffer.html'),
        createStyleLink('/tools/htmloffer/htmloffer.css'),
      ]);

      const html = await response.text();
      dialogContainer.innerHTML = html;

      document.head.appendChild(styleLink);
      setupDialog(dialogContainer);

      const script = await loadDialogScript('/tools/htmloffer/htmloffer.js');
      document.body.appendChild(script);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error loading HTML offer dialog:', error);
    }
  };

  const createExportButton = () => {
    const exportBtn = document.createElement('button');
    exportBtn.className = 'export-button';

    const exportIcon = document.createElement('img');
    exportIcon.src = '/.da/icons/export-to-target.png';
    exportIcon.className = 'export-icon';
    exportIcon.alt = '';

    const exportText = document.createElement('span');
    exportText.textContent = 'Export to Target';

    exportBtn.append(exportIcon, exportText);
    exportBtn.addEventListener('click', handleExportClick);
    return exportBtn;
  };

  const formatElementName = (name) => name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const showBlocks = ({ detail: payload }) => {
    // eslint-disable-next-line no-console
    console.info('showblocks event triggered with payload:', payload);
    // Store the payload for login status check
    window.lastSidekickPayload = payload;

    const blocks = document.querySelectorAll('div.block');
    const excludedBlockList = ['header', 'zipcode', 'footer'];

    blocks.forEach((block) => {
      const name = block.getAttribute('data-block-name');
      if (!name || excludedBlockList.includes(name)) {
        return;
      }

      block.classList.toggle('highlight');
      // Only add header if it doesn't exist and block has a fragment ID
      if (!block.querySelector('.block-header')) {
        const header = document.createElement('div');
        header.className = 'block-header';

        const blockName = document.createElement('h2');
        blockName.className = 'block-name';
        blockName.textContent = formatElementName(name);
        header.append(blockName);
        if (block.getAttribute('data-fragment-id')) {
          header.append(createExportButton());
        }
        block.prepend(header);
      } else {
        const existingHeader = block.querySelector('.block-header');
        if (existingHeader) {
          existingHeader.remove();
        }
      }
    });
  };

  const showSections = ({ detail: payload }) => {
    // eslint-disable-next-line no-console
    console.info('showsections event:', payload);
    // Store the payload for login status check
    window.lastSidekickPayload = payload;

    const sections = document.querySelectorAll('div.section');
    const excludedParents = ['header', 'footer'];
    sections.forEach((section) => {
      // Skip if section is within a fragment-wrapper or any excluded parent
      if (section.closest('.fragment-wrapper') || excludedParents.some((parent) => section.closest(`.${parent}`))) {
        return;
      }

      const name = Array.from(section.classList).pop();

      if (!name || excludedParents.includes(name)) {
        return;
      }

      // Only add header if it doesn't exist and section has a fragment ID
      if (!section.querySelector('.section-header')) {
        const header = document.createElement('div');
        header.className = 'section-header';

        const sectionName = document.createElement('h2');
        sectionName.className = 'section-name';
        sectionName.textContent = formatElementName(name);
        header.append(sectionName);
        if (section.getAttribute('data-fragment-id')) {
          header.append(createExportButton());
        }
        section.prepend(header);
      } else {
        section.classList.remove('highlight');
        // Remove header if it exists
        const existingHeader = section.querySelector('.section-header');
        if (existingHeader) {
          existingHeader.remove();
        }
      }
    });
  };

  const initSideKick = (sk) => {
    // Existing event listeners
    const events = ['showblocks', 'showsections', 'eventdetials'];
    const handlers = {
      showblocks: showBlocks,
      showsections: showSections,
      eventdetials: (e) => {
        // eslint-disable-next-line no-console
        console.info(e.detail);
      },
    };

    events.forEach((event) => {
      sk.addEventListener(`custom:${event}`, handlers[event]);
    });
  };

  const sk = document.querySelector('aem-sidekick');
  if (sk) {
    initSideKick(sk);
  } else {
    document.addEventListener('sidekick-ready', () => {
      initSideKick(document.querySelector('aem-sidekick'));
    }, { once: true });
  }
}

/**
 * Sets fragment IDs on blocks and sections based on their CSS classes
 * @param {Element} main The container element
 */
export async function setFragmentIds(main) {
  // Handle blocks
  const blocks = [...main.querySelectorAll('div.block')];
  blocks.forEach((block) => {
    const classes = Array.from(block.classList);
    const fragmentClass = classes.find((cls) => cls.startsWith('fragment-id-'));
    if (fragmentClass) {
      const fragmentId = fragmentClass.replace('fragment-id-', '');
      block.setAttribute('data-fragment-id', fragmentId);
      block.classList.remove(fragmentClass);
    }
  });
}

/**
 * Replaces all occurrences of &amp; and &amp%3B with &
 * @param {string} value
 * @returns {string}
 */
export function decodeAmpersand(value) {
  return value.replace(/&amp%3B/g, '&').replace(/&amp;/g, '&');
}

/**
 * Ensures that all <a> links matching a given path pattern will redirect to sling.com
 * when accessed from localhost, .aem.page, or .aem.live domains.
 *
 * @param {Element} container - The DOM element to scope the delegation to (e.g., block or document)
 * @param {RegExp} pathPattern - RegExp to match the href (e.g., /^\/cart/)
 */
export function rewriteLinksForSlingDomain(container, pathPattern = /^\/cart/) {
  const shouldRewrite = window.location.hostname === 'localhost'
    || window.location.hostname.endsWith('.aem.page')
    || window.location.hostname.endsWith('.aem.live');

  if (!shouldRewrite) return;

  // Attach event listener in capture phase
  container.addEventListener('click', (e) => {
    // Handle <a> tags
    const anchor = e.target.closest('a');
    if (
      anchor
      && anchor.getAttribute('href')
      && pathPattern.test(anchor.getAttribute('href'))
      && !anchor.getAttribute('href').startsWith('//')
    ) {
      e.preventDefault();
      window.location.replace(`https://sling.com${anchor.getAttribute('href')}`);
    }
  }, true);
}
