// tools/media-library/modules/scan-indicator.js
// Scan indicator logic for Media Library

function showScanIndicator() {
  const indicator = document.getElementById('scanIndicator');
  if (indicator) indicator.style.display = '';
}

function hideScanIndicator() {
  const indicator = document.getElementById('scanIndicator');
  if (indicator) indicator.style.display = 'none';
}

export { showScanIndicator, hideScanIndicator };
