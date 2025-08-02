/* eslint-disable no-use-before-define */
/**
 * Sheet Utilities - Handles Google Sheets integration and data processing
 * Provides comprehensive sheet management capabilities for media data
 */

export const ADMIN_DA_LIVE_BASE = 'https://admin.da.live';
export const CONTENT_DA_LIVE_BASE = 'https://content.da.live';

/**
 * Save data to Google Sheets
 */
export async function saveSheetFile(url, data, token) {
  try {
    const formData = new FormData();
    const jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    formData.append('data', jsonBlob);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to save sheet: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error saving sheet file:', error);
    throw error;
  }
}

/**
 * Load data from Google Sheets
 */
export async function loadSheetFile(url, token) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to load sheet: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Load and parse sheet data in one operation
 */
export async function loadData(url, token) {
  const rawData = await loadSheetFile(url, token);
  return parseSheet(rawData);
}

/**
 * Save data to Google Sheets in one operation
 * Combines buildSingleSheet and saveSheetFile for convenience
 */
export async function saveData(url, data, token) {
  const sheetData = buildSingleSheet(data);
  return await saveSheetFile(url, sheetData, token);
}

/**
 * Get sheet URL for a specific file
 */
export function getSheetUrl(config, fileName) {
  return `${ADMIN_DA_LIVE_BASE}/source/${config.org}/${config.repo}/${fileName}.json`;
}

/**
 * Build single sheet data structure
 */
export function buildSingleSheet(data) {
  // Always ensure data is an array
  const rows = Array.isArray(data) ? data : [data];

  return {
    total: rows.length,
    limit: rows.length,
    offset: 0,
    data: rows,
    ':type': 'sheet',
  };
}

/**
 * Parse sheet data into structured format
 */
export function parseSheet(sheetData) {
  if (!sheetData || typeof sheetData !== 'object') {
    return {};
  }

  // Handle single sheet format
  if (sheetData[':type'] === 'sheet' && sheetData.data) {
    return {
      data: sheetData.data,
    };
  }

  // Handle multi-sheet format
  const result = {};
  Object.keys(sheetData).forEach((key) => {
    if (sheetData[key] && typeof sheetData[key] === 'object') {
      result[key] = parseSheetData(sheetData[key]);
    }
  });

  return result;
}

/**
 * Parse individual sheet data
 */
function parseSheetData(sheet) {
  if (!sheet || typeof sheet !== 'object') {
    return { data: [] };
  }

  // Handle different sheet formats
  if (Array.isArray(sheet)) {
    return { data: sheet };
  }

  if (sheet.data && Array.isArray(sheet.data)) {
    return { data: sheet.data };
  }

  if (sheet.rows && Array.isArray(sheet.rows)) {
    return { data: sheet.rows };
  }

  return { data: [] };
}

/**
 * Process multiple sheets in parallel
 */
export async function processMultipleSheets(sheetUrls, token) {
  try {
    const sheetPromises = sheetUrls.map(async (url) => {
      try {
        const data = await loadSheetFile(url, token);
        return { url, data, success: true };
      } catch (error) {
        return { url, error: error.message, success: false };
      }
    });

    const results = await Promise.all(sheetPromises);
    return results;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error processing multiple sheets:', error);
    throw error;
  }
}

/**
 * Save multiple sheets in parallel
 */
export async function saveMultipleSheets(sheetData, token) {
  try {
    const savePromises = Object.entries(sheetData).map(async ([url, data]) => {
      try {
        const result = await saveSheetFile(url, data, token);
        return { url, result, success: true };
      } catch (error) {
        return { url, error: error.message, success: false };
      }
    });

    const results = await Promise.all(savePromises);
    return results;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error saving multiple sheets:', error);
    throw error;
  }
}

/**
 * Validate sheet data structure
 */
export function validateSheetData(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Data is not an object' };
  }

  if (data[':type'] !== 'sheet') {
    return { valid: false, error: 'Invalid sheet type' };
  }

  if (!data.data || !Array.isArray(data.data)) {
    return { valid: false, error: 'Data array is missing or invalid' };
  }

  return { valid: true };
}

/**
 * Transform sheet data to different formats
 */
export function transformSheetData(data, format = 'array') {
  if (!data || !data.data) {
    return [];
  }

  switch (format) {
    case 'array':
      return data.data;
    case 'object':
      return data.data.reduce((acc, item, index) => {
        acc[index] = item;
        return acc;
      }, {});
    case 'csv':
      return data.data.map((row) => row.join(',')).join('\n');
    default:
      return data.data;
  }
}

/**
 * Merge multiple sheet data
 */
export function mergeSheetData(sheets) {
  const mergedData = [];

  sheets.forEach((sheet) => {
    if (sheet && sheet.data && Array.isArray(sheet.data)) {
      mergedData.push(...sheet.data);
    }
  });

  return buildSingleSheet(mergedData);
}

/**
 * Filter sheet data based on criteria
 */
export function filterSheetData(data, filterFn) {
  if (!data || !data.data || !Array.isArray(data.data)) {
    return buildSingleSheet([]);
  }

  const filteredData = data.data.filter(filterFn);
  return buildSingleSheet(filteredData);
}

/**
 * Sort sheet data
 */
export function sortSheetData(data, sortFn) {
  if (!data || !data.data || !Array.isArray(data.data)) {
    return buildSingleSheet([]);
  }

  const sortedData = [...data.data].sort(sortFn);
  return buildSingleSheet(sortedData);
}

/**
 * Get sheet metadata
 */
export function getSheetMetadata(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  return {
    type: data[':type'] || 'unknown',
    rowCount: data.data ? data.data.length : 0,
    columnCount: data.data && data.data[0] ? data.data[0].length : 0,
    lastModified: data.lastModified || null,
  };
}

/**
 * Create empty sheet structure
 */
export function createEmptySheet() {
  return buildSingleSheet([]);
}

/**
 * Add row to sheet data
 */
export function addRowToSheet(data, row) {
  if (!data || !data.data) {
    return buildSingleSheet([row]);
  }

  const newData = [...data.data, row];
  return buildSingleSheet(newData);
}

/**
 * Update row in sheet data
 */
export function updateRowInSheet(data, index, row) {
  if (!data || !data.data || !Array.isArray(data.data)) {
    return buildSingleSheet([row]);
  }

  const newData = [...data.data];
  if (index >= 0 && index < newData.length) {
    newData[index] = row;
  }

  return buildSingleSheet(newData);
}

/**
 * Remove row from sheet data
 */
export function removeRowFromSheet(data, index) {
  if (!data || !data.data || !Array.isArray(data.data)) {
    return buildSingleSheet([]);
  }

  const newData = data.data.filter((_, i) => i !== index);
  return buildSingleSheet(newData);
}

/**
 * Batch process sheet operations
 */
export async function batchProcessSheetOperations(operations, token) {
  try {
    const operationPromises = operations.map(async (operation) => {
      try {
        let result;
        switch (operation.type) {
          case 'load':
            result = await loadSheetFile(operation.url, token);
            break;
          case 'save':
            result = await saveSheetFile(operation.url, operation.data, token);
            break;
          default:
            throw new Error(`Unknown operation type: ${operation.type}`);
        }
        return { operation, result, success: true };
      } catch (error) {
        return { operation, error: error.message, success: false };
      }
    });

    const results = await Promise.all(operationPromises);
    return results;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in batch sheet operations:', error);
    throw error;
  }
}
