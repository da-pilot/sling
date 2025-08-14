# Media Scanner

A dedicated HTML entry point for performing initial full scans of media libraries without the complexity of the full UI.

## Overview

The Media Scanner provides a simplified interface for:
- Discovery of all folders and documents in a repository
- Scanning of all pages for media content
- Population of media.json with discovered media
- Update of checkpoint files for progress tracking

## Files

- `media-scanner.html` - Main HTML interface
- `media-scanner.css` - Styling for the scanner interface
- `media-scanner.js` - JavaScript logic for scanning operations

## Usage

1. Navigate to `/tools/media-library/media-scanner.html`
2. Enter the organization name (default: `da-sites`)
3. Enter the repository name (default: `bacom`)
4. Click "Start Full Scan" to begin the scanning process

## Features

### Progress Tracking
- Real-time discovery progress (folders processed)
- Real-time scanning progress (pages scanned)
- Detailed statistics (total folders, pages, media items)
- Current scan status

### Logging
- Timestamped log entries
- Color-coded log levels (info, success, warning, error)
- Export log functionality
- Clear log option

### Controls
- Start/Stop scan buttons
- Progress visualization with progress bars
- Real-time status updates

## Technical Details

The scanner reuses the existing media library infrastructure:
- Discovery engine for folder/document discovery
- Queue orchestrator for scanning coordination
- Processing state manager for checkpoint tracking
- Session manager for multi-user coordination
- Media processor for content analysis

## Browser Compatibility

This scanner is designed to work in modern browsers and avoids the UI complexity that can cause browser crashes during large scans.

## Error Handling

- Graceful error handling with user-friendly messages
- Automatic retry mechanisms for transient failures
- Detailed error logging for debugging

## Performance

- Optimized for large-scale scanning operations
- Minimal UI overhead to prevent browser crashes
- Efficient progress updates without blocking the main thread
