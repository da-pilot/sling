// tools/media-library/modules/sheet-utils.js

// Constants for DA endpoints
export const CONTENT_DA_LIVE_BASE = 'https://content.da.live';
export const ADMIN_DA_LIVE_BASE = 'https://admin.da.live';

export function parseSheet(json) {
  if (json[':type'] === 'sheet') {
    return {
      data: {
        data: Array.isArray(json.data) ? json.data.map((row) => ({ ...row })) : [],
      },
    };
  }
  if (json[':type'] === 'multi-sheet') {
    const out = {};
    for (const name of json[':names'] || []) {
      out[name] = {
        data: Array.isArray(json[name]?.data) ? json[name].data.map((row) => ({ ...row })) : [],
      };
    }
    return out;
  }
  throw new Error('Unknown DA sheet type');
}

export function buildSingleSheet(rows) {
  return {
    total: rows.length,
    limit: rows.length,
    offset: 0,
    data: rows,
    ':type': 'sheet',
  };
}

export function buildMultiSheet(sheetMap, version = 3) {
  const out = {};
  const names = Object.keys(sheetMap);
  for (const name of names) {
    const rows = sheetMap[name];
    out[name] = {
      total: rows.length,
      limit: rows.length,
      offset: 0,
      data: rows,
    };
  }
  out[':version'] = version;
  out[':names'] = names;
  out[':type'] = 'multi-sheet';
  return out;
}

export function addRowsToSheet(sheet, newRows) {
  const updatedRows = [...(sheet.data || []), ...newRows];
  return buildSingleSheet(updatedRows);
}

export function addRowsToMultiSheet(multiSheet, sheetName, newRows) {
  // Handle both raw multi-sheet format and parsed format
  let sheetRows;
  if (multiSheet[sheetName] && Array.isArray(multiSheet[sheetName])) {
    // Raw format: { sheetName: [...] }
    sheetRows = multiSheet[sheetName];
  } else if (multiSheet[sheetName] && multiSheet[sheetName].data && Array.isArray(multiSheet[sheetName].data)) {
    // Parsed format: { sheetName: { data: [...] } }
    sheetRows = multiSheet[sheetName].data;
  } else {
    // No existing data
    sheetRows = [];
  }

  const updatedRows = [...sheetRows, ...newRows];
  const updatedSheetMap = { ...multiSheet };
  updatedSheetMap[sheetName] = updatedRows;
  return buildMultiSheet(updatedSheetMap, multiSheet[':version'] || 3);
}

export function removeRowsByColumn(sheet, column, value) {
  const filteredRows = (sheet.data || []).filter((row) => row[column] !== value);
  return buildSingleSheet(filteredRows);
}

export function removeRowsByColumnMultiSheet(multiSheet, sheetName, column, value) {
  // Handle both raw multi-sheet format and parsed format
  let sheetRows;
  if (multiSheet[sheetName] && Array.isArray(multiSheet[sheetName])) {
    // Raw format: { sheetName: [...] }
    sheetRows = multiSheet[sheetName];
  } else if (multiSheet[sheetName] && multiSheet[sheetName].data && Array.isArray(multiSheet[sheetName].data)) {
    // Parsed format: { sheetName: { data: [...] } }
    sheetRows = multiSheet[sheetName].data;
  } else {
    // No existing data
    sheetRows = [];
  }

  const filteredRows = sheetRows.filter((row) => row[column] !== value);
  const updatedSheetMap = { ...multiSheet };
  updatedSheetMap[sheetName] = filteredRows;
  return buildMultiSheet(updatedSheetMap, multiSheet[':version'] || 3);
}

export function findRowsByColumn(sheet, column, value) {
  return (sheet.data || []).filter((row) => row[column] === value);
}

export function findRowsByColumnMultiSheet(multiSheet, sheetName, column, value) {
  // Handle both raw multi-sheet format and parsed format
  let sheetRows;
  if (multiSheet[sheetName] && Array.isArray(multiSheet[sheetName])) {
    // Raw format: { sheetName: [...] }
    sheetRows = multiSheet[sheetName];
  } else if (multiSheet[sheetName] && multiSheet[sheetName].data && Array.isArray(multiSheet[sheetName].data)) {
    // Parsed format: { sheetName: { data: [...] } }
    sheetRows = multiSheet[sheetName].data;
  } else {
    // No existing data
    sheetRows = [];
  }

  return sheetRows.filter((row) => row[column] === value);
}

export async function saveSheetFile(url, sheetData, token, method = 'POST') {
  const formData = new FormData();
  const jsonBlob = new Blob([JSON.stringify(sheetData, null, 2)], { type: 'application/json' });
  formData.append('data', jsonBlob);

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '2', 10) * 1000;
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save sheet: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
    }
  }
}

export async function loadSheetFile(url, token, method = 'GET') {
  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '2', 10) * 1000;
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to load sheet: ${response.status} ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
    }
  }
}

/**
 * Get the full DA API URL for a given sheet file
 */
function getSheetUrl(apiConfig, fileName) {
  // Always use content.da.live for JSON GET requests
  const baseUrl = CONTENT_DA_LIVE_BASE;
  const org = apiConfig?.org;
  const repo = apiConfig?.repo;
  return `${baseUrl}/${org}/${repo}/.da/${fileName}`;
}

/**
 * Fetch and parse a DA sheet JSON file
 */
async function fetchSheetJson(apiConfig, fileName) {
  const url = getSheetUrl(apiConfig, fileName);
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    return null;
  }
}

export { getSheetUrl, fetchSheetJson };
