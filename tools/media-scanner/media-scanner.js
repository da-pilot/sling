/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { crawl } from 'https://da.live/nx/public/utils/tree.js';
import { daFetch } from 'https://da.live/nx/utils/daFetch.js';
import { DA_ORIGIN, SUPPORTED_FILES } from 'https://da.live/nx/public/utils/constants.js';

let daContext = null;
const METADATA_PATH = '/.media/.scan';
const CONFIG_PATH = '/.media/config.json';

/**
 * HTML patterns for media tag extraction
 */
const HTML_PATTERNS = {
  IMG_TAG: /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi,
  VIDEO_TAG: /<video[^>]*>([\s\S]*?)<\/video>/gi,
  SOURCE_TAG: /<source[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi,
  PICTURE_TAG: /<picture[^>]*>.*?<\/picture>/gis,
};

/**
 * Scan HTML content for media tags and count occurrences
 * @param {string} html - HTML content to scan
 * @returns {Object} Media count information
 */
function scanHTMLForMedia(html) {
  const mediaCount = {
    img: 0,
    video: 0,
    total: 0,
  };

  // Count img tags
  const imgMatches = html.match(HTML_PATTERNS.IMG_TAG);
  if (imgMatches) {
    mediaCount.img = imgMatches.length;
  }

  // Count video tags and their source elements
  const videoMatches = html.match(HTML_PATTERNS.VIDEO_TAG);
  if (videoMatches) {
    mediaCount.video = videoMatches.length;
    // Count source elements within videos
    videoMatches.forEach((videoTag) => {
      const sourceMatches = videoTag.match(HTML_PATTERNS.SOURCE_TAG);
      if (sourceMatches) {
        mediaCount.video += sourceMatches.length;
      }
    });
  }

  // Count picture elements (they contain img tags)
  const pictureMatches = html.match(HTML_PATTERNS.PICTURE_TAG);
  if (pictureMatches) {
    pictureMatches.forEach((pictureTag) => {
      const imgInPicture = pictureTag.match(HTML_PATTERNS.IMG_TAG);
      if (imgInPicture) {
        mediaCount.img += imgInPicture.length;
      }
    });
  }

  mediaCount.total = mediaCount.img + mediaCount.video;
  return mediaCount;
}

/**
 * Fetch HTML content from a page and scan for media
 * @param {string} pagePath - Path to the HTML page
 * @returns {Promise<Object>} Page information with media count
 */
async function scanPageForMedia(pagePath) {
  try {
    const response = await daFetch(`${DA_ORIGIN}/source${pagePath}`);
    if (!response.ok) {
      return { path: pagePath, mediaCount: { img: 0, video: 0, total: 0 }, error: 'Failed to fetch page' };
    }

    const html = await response.text();
    const mediaCount = scanHTMLForMedia(html);

    return {
      path: pagePath,
      mediaCount,
      lastModified: response.headers.get('last-modified') || new Date().toISOString(),
    };
  } catch (error) {
    return {
      path: pagePath,
      mediaCount: { img: 0, video: 0, total: 0 },
      error: error.message,
    };
  }
}

function matchesExcludePatterns(path, patterns) {
  return patterns.some((pattern) => {
    const pathParts = path.split('/');
    if (pathParts.length >= 3) {
      const org = pathParts[1];
      const repo = pathParts[2];
      const orgRepoPrefix = `/${org}/${repo}`;

      if (pattern.endsWith('/*')) {
        const patternWithoutWildcard = pattern.slice(0, -1);
        const fullPattern = `${orgRepoPrefix}${patternWithoutWildcard}`;
        const matches = path.startsWith(fullPattern) || path === fullPattern.slice(0, -1);
        return matches;
      }
      const matches = path === `${orgRepoPrefix}${pattern}`;
      return matches;
    }
    return false;
  });
}

/**
 * Load exclusion patterns from config.json
 * @param {string} org - Organization name
 * @param {string} repo - Repository name
 * @returns {Promise<Array>} Array of exclusion patterns
 */
async function loadExclusionPatterns(org, repo) {
  try {
    const configUrl = `${DA_ORIGIN}/source/${org}/${repo}${CONFIG_PATH}`;
    const response = await daFetch(configUrl);

    if (!response.ok) {
      return [];
    }

    const configData = await response.json();
    const excludePatterns = [];

    if (configData && configData.data && Array.isArray(configData.data)) {
      configData.data.forEach((row) => {
        if (row.key === 'excludes' && typeof row.value === 'string') {
          const patterns = row.value.split(',').map((s) => s.trim()).filter(Boolean);
          excludePatterns.push(...patterns);
        }
      });
    }

    return excludePatterns;
  } catch (error) {
    return [];
  }
}

async function saveToJson(data, filename) {
  const rows = Array.isArray(data) ? data : [data];
  const sheetMeta = {
    total: rows.length,
    limit: rows.length,
    offset: 0,
    data: rows,
    ':type': 'sheet',
  };
  const blob = new Blob([JSON.stringify(sheetMeta, null, 2)], { type: SUPPORTED_FILES.json });
  const formData = new FormData();
  formData.append('data', blob);
  const opts = { method: 'PUT', body: formData };
  const resp = await daFetch(`${DA_ORIGIN}/source${filename}`, opts);
  return resp.ok;
}

async function saveJSON(org, repo, rootData, folderData = {}) {
  const scanPath = `/${org}/${repo}${METADATA_PATH}`;
  const results = {
    root: null,
    folders: {},
    errors: [],
  };

  try {
    const rootFilename = `${scanPath}/root.json`;
    const rootSuccess = await saveToJson(rootData, rootFilename);
    results.root = { filename: rootFilename, success: rootSuccess };

    if (!rootSuccess) {
      results.errors.push('Failed to save root.json');
    }
  } catch (error) {
    results.errors.push(`Error saving root.json: ${error.message}`);
  }

  const folderPromises = Object.entries(folderData).map(async ([folderName, data]) => {
    try {
      const folderFilename = `${scanPath}/${folderName}.json`;
      const success = await saveToJson(data, folderFilename);
      results.folders[folderName] = { filename: folderFilename, success };

      if (!success) {
        results.errors.push(`Failed to save ${folderName}.json`);
      }

      return { folderName, success };
    } catch (error) {
      results.errors.push(`Error saving ${folderName}.json: ${error.message}`);
      return { folderName, success: false, error: error.message };
    }
  });

  await Promise.all(folderPromises);

  return results;
}

function updateUI(metrics) {
  const {
    totalPages,
    rootFolders,
    mediaFiles,
    duration,
    totalMediaCount = 0,
  } = metrics;

  document.getElementById('foldersValue').textContent = rootFolders;
  document.getElementById('pagesValue').textContent = totalPages;
  document.getElementById('scannedValue').textContent = totalPages;
  document.getElementById('mediaValue').textContent = totalMediaCount || mediaFiles;

  if (duration) {
    document.getElementById('durationValue').textContent = duration;
  }

  if (totalPages > 0) {
    const completionIndicator = document.getElementById('completionIndicator');
    if (completionIndicator) {
      completionIndicator.style.display = 'block';
    }
  }
}

async function runDiscovery(org, repo, rootFolder) {
  const basePath = `/${org}/${repo}${rootFolder}`;
  const excludePatterns = await loadExclusionPatterns(org, repo);
  // eslint-disable-next-line no-unused-vars
  let totalPages = 0;
  let totalMediaCount = 0;
  const allMedia = [];
  const folderFiles = {};
  const rootPages = [];
  const rootFolders = [];

  const callback = async (item) => {
    if (item.ext === 'html' && !matchesExcludePatterns(item.path, excludePatterns)) {
      totalPages += 1;
      const pathParts = item.path.split('/').filter(Boolean);
      const relativePathParts = pathParts.slice(2);

      // Scan the page for media content
      const pageInfo = await scanPageForMedia(item.path);
      totalMediaCount += pageInfo.mediaCount.total;

      if (relativePathParts.length === 1) {
        rootPages.push({
          path: item.path,
          lastModified: item.lastModified,
          mediaCount: pageInfo.mediaCount,
        });
      }

      if (relativePathParts.length > 1) {
        const folderName = relativePathParts[0];
        if (!rootFolders.includes(folderName)) {
          rootFolders.push(folderName);
          folderFiles[folderName] = [];
        }
        folderFiles[folderName].push({
          path: item.path,
          lastModified: item.lastModified,
          mediaCount: pageInfo.mediaCount,
        });
      }

      updateUI(
        {
          totalPages,
          rootPages: rootPages.length,
          rootFolders: rootFolders.length,
          mediaFiles: allMedia.length,
          totalMediaCount,
          duration: null,
        },
      );
    }
  };

  const { results, getDuration } = crawl({
    path: basePath,
    callback,
    concurrent: 10,
    throttle: 100,
  });

  await results;
  const duration = getDuration();

  const saveResults = await saveJSON(org, repo, rootPages, folderFiles);

  if (saveResults.errors.length > 0) {
    console.warn('Some files failed to save:', saveResults.errors);
  }

  updateUI({
    totalPages,
    rootPages: rootPages.length,
    rootFolders: rootFolders.length,
    mediaFiles: allMedia.length,
    totalMediaCount,
    duration,
  });

  return {
    totalPages,
    rootPages,
    rootFolders: rootFolders.join(','),
    mediaFiles: allMedia.length,
    folderFiles,
    duration,
  };
}

async function startScan() {
  const startScanBtn = document.getElementById('startScanBtn');
  const statusSection = document.getElementById('statusSection');
  const rootFolderInput = document.getElementById('rootFolderInput');

  startScanBtn.disabled = true;
  statusSection.style.display = 'block';

  try {
    const { org, repo } = daContext;
    const rootFolder = rootFolderInput.value || '';
    await runDiscovery(org, repo, rootFolder);
  } catch (error) {
    console.error('Scan failed:', error);
  } finally {
    startScanBtn.disabled = false;
  }
}

(async function init() {
  const { context } = await DA_SDK;
  daContext = context;
  const { org, repo } = context;
  const path = `/${org}/${repo}`;
  document.getElementById('pathInput').value = path;

  const startScanBtn = document.getElementById('startScanBtn');
  startScanBtn.addEventListener('click', startScan);
}());