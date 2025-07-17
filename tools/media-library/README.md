# Media Library

A lightweight media library plugin for DA (Digital Asset) projects that scans HTML content to discover and manage media assets like images and videos.

## Overview

Media Library automatically scans your DA project's HTML content to find media assets (images, videos, documents) and provides a user-friendly interface to browse, search, and insert these assets into your content.

## Features

### Core Functionality
- **Automatic Asset Discovery**: Scans HTML files to find media assets
- **Queue-Based Scanning**: Handles large projects efficiently with background processing
- **Asset Browser**: Grid and list views with search and filtering
- **Asset Insertion**: One-click insertion into DA content
- **Usage Tracking**: Monitor where assets are used across the project
- **Accessibility**: Alt text warnings and validation for image accessibility

### Asset Management
- **Multiple Asset Types**: Support for images, videos, documents, and other media files
- **Metadata Extraction**: Automatic extraction of file information, dimensions, and usage data
- **Preview System**: Thumbnail generation and full-size previews
- **Search & Filter**: Find assets by name, type, usage status, and accessibility compliance
- **Category Filtering**: Filter by asset source (Internal/External), type (Images/Videos/Documents), and accessibility status

### Scanning & Discovery
- **Full Project Scan**: Comprehensive asset discovery across the entire project
- **Current Page Scan**: Targeted scanning of assets used on the current page
- **Real-time Progress**: Visual indicators for scan operations
- **Selective Rescan**: Refresh specific folders or asset types

### User Interface
- **Responsive Design**: Works across desktop and tablet devices
- **Sidebar Filters**: Organized filter categories for different asset types and statuses
- **Modal Interfaces**: Asset preview, usage tracking, and insertion modals
- **Toast Notifications**: User feedback for operations and errors

## Usage

### Prerequisites

- Access to a DA project in the DA Admin interface
- The project must contain HTML content with media assets

### Installation

1. **Open DA Admin**: Navigate to your DA project in the admin interface
2. **Access Tools**: Go to the tools section of your project
3. **Launch Plugin**: Open the Media Library plugin

### Important Note: Environment Requirements

**This plugin is designed to run within the DA Admin environment.**

- ✅ **Supported**: Running from within DA Admin interface
- ✅ **Supported**: Local development testing with `?ref=local` parameter
- ❌ **Not Supported**: Running from localhost without DA proxy

### Local Development Testing

To test the plugin locally while maintaining access to DA APIs:

1. **Add the `?ref=local` parameter** to your URL when accessing the plugin
2. **Example**: `http://localhost:3000/media-library.html?ref=local`
3. **DA Proxy**: This enables the DA proxy that forwards requests to the DA platform
4. **Full Functionality**: All features work as if running in the DA Admin interface

The plugin will automatically detect the local development mode and show a "Local Development (Connected)" status indicator.

### How It Works

1. **Initialization**: The plugin connects to your DA project and loads existing metadata
2. **Content Scanning**: Scans all HTML files in your project to discover media assets
3. **Asset Discovery**: Identifies images, videos, and documents referenced in your content
4. **Metadata Creation**: Builds a searchable index of all discovered assets
5. **Browser Interface**: Provides a user-friendly interface to browse and manage assets

### Asset Types Supported

- **Images**: JPG, PNG, GIF, SVG, WebP
- **Videos**: MP4, WebM, OGV
- **Documents**: PDF, DOC, DOCX, XLS, XLSX

### Interface Features

- **Search**: Find assets by name or path
- **Filters**: Filter by asset type (images, videos, documents)
- **Folder Tree**: Browse assets organized by folder structure
- **Grid/List Views**: Switch between different viewing modes
- **Asset Preview**: Preview assets before insertion
- **One-Click Insertion**: Insert assets directly into your content

## Troubleshooting

### CORS Errors

If you see CORS errors in the browser console:

```
Access to fetch at 'https://content.da.live/...' from origin 'http://localhost:3000' has been blocked by CORS policy
```

**Solution**: Add the `?ref=local` parameter to your URL to enable the DA proxy:
- ❌ `http://localhost:3000/media-library.html`
- ✅ `http://localhost:3000/media-library.html?ref=local`

This enables the DA proxy that forwards requests to the DA platform, allowing full functionality in local development.

### No Assets Found

If the plugin reports "No assets found":

1. **Check Content**: Ensure your DA project contains HTML files with media assets
2. **Verify Paths**: Make sure image/video paths in your HTML are correct
3. **Rescan**: Use the scan icon in the sidebar to trigger a new scan
4. **Check Logs**: Look for any error messages in the browser console

### Scanning Issues

If scanning fails or gets stuck:

1. **Check Permissions**: Ensure you have read access to all project files
2. **Network Issues**: Verify your connection to the DA platform
3. **Large Projects**: For very large projects, scanning may take several minutes
4. **Retry**: Use the scan icon to restart the scanning process

## Limitations

### Not Currently Supported
- **Direct Upload**: No drag-and-drop or file upload functionality
- **Asset Editing**: No built-in image editing or metadata modification
- **Batch Operations**: No bulk selection or batch processing capabilities
- **Advanced Search**: No fuzzy search, tags, or advanced filtering options
- **Version Control**: No asset versioning or rollback capabilities
- **Custom Metadata**: No user-defined metadata fields or tagging system
- **Mobile UI**: Interface not optimized for mobile devices
- **Direct Download**: No one-click download functionality for assets
- **Folder Navigation**: No actual folder tree browsing (only filter categories)

### Technical Constraints
- **Vanilla Implementation**: Built with vanilla JavaScript, CSS, and HTML (no frameworks)
- **Browser Storage**: Uses localStorage for state management
- **No Backend**: Client-side only implementation
- **File System Access**: Limited to assets discoverable within the project structure

## Technical Details

### Architecture

- **Queue-Based Scanning**: Uses web workers for background processing
- **State Management**: Persistent scan state and progress tracking
- **Metadata Storage**: JSON-based metadata files in `.da/` folder
- **Event-Driven**: Real-time updates and progress notifications

### File Structure

```
.da/
├── media.json              # Main metadata file
├── media-scan-state.json   # Scan state and progress
├── media-scan-results.json # Detailed scan results
└── media-discovery-queue.json # Discovery queue
```

### API Integration

The plugin uses the official DA SDK and API to:
- List project files and folders
- Read HTML content
- Save metadata files
- Insert assets into content

## Development

### Local Development

For development and testing:

1. The plugin detects when running outside the DA environment
2. Shows a helpful message explaining the requirements
3. Prevents CORS errors by gracefully handling environment detection

### Building

The plugin is designed to run directly in the browser without build steps. Simply include the HTML file in your DA project's tools section.

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Verify you're running from within the DA Admin interface
3. Check browser console for error messages
4. Ensure your DA project contains HTML content with media assets

## License

This plugin is part of the DA Media Library project and follows the same licensing terms. 