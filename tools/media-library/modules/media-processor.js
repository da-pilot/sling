// tools/da-media-basi./modules/media-processor.js
// Asset processing and utility functions for Media Library

import {
  saveSheetFile,
  loadSheetFile,
  getSheetUrl,
  buildSingleSheet,
  ADMIN_DA_LIVE_BASE,
  parseSheet,
} from './sheet-utils.js';
import { extractAssetNameFromUrl } from './media-loader.js';

function isProbablyUrl(str) {
  return typeof str === 'string' && /^@?https?:\/\//.test(str);
}

function isValidAltText(altText) {
  if (!altText || typeof altText !== 'string') return false;
  
  const trimmed = altText.trim();
  
  if (trimmed.length < 2) return false;
  
  if (trimmed.length > 200) return false;
  
  if (trimmed.includes('\n') || trimmed.includes('\r')) return false;
  
  if (/\s{3,}/.test(trimmed)) return false;
  
  if (/<[^>]*>/.test(trimmed)) return false;
  
  if (/https?:\/\/|www\./.test(trimmed)) return false;
  
  if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|doc|docx|txt)$/i.test(trimmed)) return false;
  
  return true;
}

function isValidAssetName(name) {
  if (!name || typeof name !== 'string') return false;
  
  const trimmed = name.trim();
  
  if (trimmed.length < 2) return false;
  
  if (trimmed.length > 100) return false;
  
  const specialCharRatio = (trimmed.match(/[^a-zA-Z0-9\s]/g) || []).length / trimmed.length;
  if (specialCharRatio > 0.3) return false;
  
  return true;
}

/**
 * Process scan results and convert to asset objects
 */
function processScanResults(scanResults) {
  const processedAssets = [];
  let runningIndex = 1;
  scanResults.forEach((result) => {
    if (result.assets && Array.isArray(result.assets)) {
      result.assets.forEach((asset) => {
        const pageUrl = `https://content.da.live${result.file.path}`;
        let name = '';
        if (asset.type === 'image') {
          name = asset.alt && !isProbablyUrl(asset.alt) && isValidAltText(asset.alt) ? asset.alt : extractAssetNameFromUrl(asset.src);
        } else if (asset.type === 'video') {
          name = asset.title || extractAssetNameFromUrl(asset.src);
        } else if (asset.type === 'document' || asset.type === 'other') {
          name = asset.title || extractAssetNameFromUrl(asset.src);
        } else {
          name = extractAssetNameFromUrl(asset.src);
        }
        
        if (!isValidAssetName(name)) {
          name = extractAssetNameFromUrl(asset.src);
        }
        
        const alt = asset.alt && !isProbablyUrl(asset.alt) && isValidAltText(asset.alt) ? asset.alt : '';
        const processedAsset = {
          id: asset.src,
          src: asset.src,
          name,
          alt,
          type: determineAssetType(asset.src),
          page: pageUrl,
          usedIn: [result.file.path],
          isExternal: typeof asset.isExternal === 'boolean' ? asset.isExternal : false,
          index: runningIndex,
        };
        
        // Add occurrence data if available
        if (asset.occurrenceId) {
          processedAsset.occurrences = [{
            occurrenceId: asset.occurrenceId,
            pagePath: result.file.path,
            altText: asset.alt,
            hasAltText: asset.hasAltText,
            occurrenceType: asset.occurrenceType,
            contextualText: asset.contextualText,
            context: asset.context,
          }];
        }
        
        runningIndex++;
        const existingIndex = processedAssets.findIndex((a) => a.src === processedAsset.src);
        if (existingIndex >= 0) {
          processedAssets[existingIndex].usedIn.push(...processedAsset.usedIn);
          
          // Merge occurrence data
          if (processedAsset.occurrences) {
            if (!processedAssets[existingIndex].occurrences) {
              processedAssets[existingIndex].occurrences = [];
            }
            processedAssets[existingIndex].occurrences.push(...processedAsset.occurrences);
          }
        } else {
          processedAssets.push(processedAsset);
        }
      });
    }
  });
  return processedAssets;
}

/**
 * Generate unique asset ID from source URL
 */
async function generateAssetId(src) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
  const hex = Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 42);
}

/**
 * Extract asset name from source URL
 */
function extractAssetName(src) {
  return 'Untitled';
}

/**
 * Determine asset type from source URL
 */
function determineAssetType(src) {
  const lowerSrc = src.toLowerCase();

  // Image types
  if (lowerSrc.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
    return 'image';
  }

  // Video types
  if (lowerSrc.match(/\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv)$/)) {
    return 'video';
  }

  // Document types
  if (lowerSrc.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|odt|ods|odp)$/)) {
    return 'document';
  }

  // Default to image if no clear type
  return 'image';
}

/**
 * Save a flat media sheet to media.json
 */
export async function saveMediaSheet(apiConfig, assets) {
  const normalizedAssets = await Promise.all(assets.map(async (asset) => {
    const src = asset.src || asset.id || '';
    const alt = asset.alt && !isProbablyUrl(asset.alt) && isValidAltText(asset.alt) ? asset.alt : '';
    const type = determineAssetType(src);
    let name = alt || extractAssetNameFromUrl(src);
    
    if (!isValidAssetName(name)) {
      name = extractAssetNameFromUrl(src);
    }
    
    const id = await generateAssetId(src);
    let usedIn = '';
    if (Array.isArray(asset.usedIn)) {
      usedIn = Array.from(new Set(asset.usedIn)).join(',');
    } else if (typeof asset.usedIn === 'string') {
      usedIn = asset.usedIn;
    }
    const normalizedAsset = {
      id,
      src,
      alt,
      usedIn,
      type,
      name,
      isExternal: asset.isExternal || false,
    };
    
    // Include occurrence data if available
    if (asset.occurrences && Array.isArray(asset.occurrences)) {
      normalizedAsset.occurrences = asset.occurrences;
    }
    
    return normalizedAsset;
  }));

  const mediaSheet = buildSingleSheet(normalizedAssets);
  const url = `${ADMIN_DA_LIVE_BASE}/source/${apiConfig.org}/${apiConfig.repo}/.da/media.json`;

  try {
    await saveSheetFile(url, mediaSheet, apiConfig.token);
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console -- needed for debugging
    console.error('[DA] saveMediaSheet: SAVE FAILED:', error);
    throw error;
  }
}

/**
 * Load a flat media sheet from media.json
 */
export async function loadMediaSheet(apiConfig) {
  const url = getSheetUrl(apiConfig, 'media.json');
  const data = await loadSheetFile(url, apiConfig.token);
  const parsed = parseSheet(data);

  // Extract the actual assets array from the parsed structure
  let assets = [];
  if (parsed && parsed.data && parsed.data.data && Array.isArray(parsed.data.data)) {
    assets = parsed.data.data;
  }

  return assets;
}

export {
  processScanResults,
  generateAssetId,
  extractAssetName,
  determineAssetType,
};
