# Media Library

A sophisticated, client-side plugin for DA (Digital Asset) projects that automatically discovers, organizes, and manages media assets (images, videos, documents) used throughout a website or web application.

## Overview

The **Media Library** transforms a scattered collection of media files across a project into a well-organized, searchable asset management system that integrates seamlessly with the DA content creation workflow.

### 🎯 **Core Purpose**
- **Scans HTML content** across an entire DA project to find all media assets
- **Creates a searchable index** of discovered assets with metadata
- **Provides a user interface** to browse, search, and insert these assets into content
- **Manages complex discovery workflows** with session coordination and state management

### 🔍 **Asset Discovery Process**
1. **Discovery Coordination**: Orchestrates the discovery process with session management
2. **Folder Discovery**: Recursively scans project folders to find HTML files
3. **Content Analysis**: Parses HTML to extract media references (images, videos, documents)
4. **Metadata Processing**: Uses web workers for efficient background processing of large projects
5. **State Management**: Maintains checkpoint and progress tracking throughout the process

### 🏗️ **Technical Architecture**
- **Factory Function Pattern**: All components use factory functions for clean state management
- **Modular Design**: Organized into modules/, services/, workers/, and shared/ directories
- **Event-Driven System**: Custom event emitters for real-time communication
- **Session Coordination**: Multi-user session management with conflict resolution
- **Queue-Based Processing**: Background processing with progress tracking
- **IndexedDB Storage**: Local storage for metadata and scan state

## Features

### 🎯 **Core Functionality**
- **Automatic Asset Discovery**: Scans HTML files to find media assets
- **Queue-Based Scanning**: Handles large projects efficiently with background processing
- **Asset Browser**: Grid and list views with search and filtering
- **Asset Insertion**: One-click insertion into DA content
- **Usage Tracking**: Monitor where assets are used across the project
- **Accessibility**: Alt text warnings and validation for image accessibility
- **Session Management**: Multi-user coordination with conflict resolution

### 📁 **Asset Management**
- **Multiple Asset Types**: Support for images, videos, documents, and other media files
- **Metadata Extraction**: Automatic extraction of file information, dimensions, and usage data
- **Preview System**: Thumbnail generation and full-size previews
- **Search & Filter**: Find assets by name, type, usage status, and accessibility compliance
- **Category Filtering**: Filter by asset source (Internal/External), type (Images/Videos/Documents), and accessibility status

### 🔍 **Scanning & Discovery**
- **Full Project Scan**: Comprehensive asset discovery across the entire project
- **Current Page Scan**: Targeted scanning of assets used on the current page
- **Real-Time Progress**: Visual indicators for scan operations
- **Selective Rescan**: Refresh specific folders or asset types
- **Incremental Discovery**: Detect changes and update only modified content

### 🎨 **User Interface**
- **Responsive Design**: Works across desktop and tablet devices
- **Sidebar Filters**: Organized filter categories for different asset types and statuses
- **Modal Interfaces**: Asset preview, usage tracking, and insertion modals
- **Toast Notifications**: User feedback for operations and errors

## Architecture

### **Factory Function Pattern**
All components use factory functions for clean state management and encapsulation:

```javascript
// Example factory function pattern
export default function createMediaProcessor() {
  const state = {
    // Private state
  };
  
  function processMedia() {
    // Implementation
  }
  
  return {
    processMedia,
    // Public API
  };
}
```

### **Modular Structure**
```
tools/media-library/
├── modules/           # Core functionality modules
│   ├── discovery/     # Discovery engine components
│   ├── queue/         # Queue processing system
│   └── ui/           # User interface components
├── services/          # Business logic services
│   ├── session-manager.js
│   ├── metadata-manager.js
│   └── persistence-manager.js
├── workers/           # Background processing
│   └── media-scan-worker.js
├── shared/            # Shared utilities
│   ├── event-emitter.js
│   └── stats-manager.js
├── config/            # Configuration files
└── scripts/           # Development tools
```

### **Event-Driven Communication**
Custom event emitters for real-time communication between components:

```javascript
// Event-driven architecture
eventEmitter.on('discoveryStarted', handleDiscoveryStart);
eventEmitter.on('batchComplete', handleBatchComplete);
eventEmitter.emit('scanningStopped', { status: 'completed' });
```

### **Session Coordination**
Multi-user session management with conflict resolution:

```javascript
// Session management
const sessionManager = createSessionManager();
await sessionManager.acquireSessionLock(sessionId);
await sessionManager.coordinateSessions();
```

## Usage

### Prerequisites

- Access to a DA project in the DA Admin interface
- The project must contain HTML content with media assets

### Installation

1. **Open DA Admin**: Navigate to your DA project in the admin interface
2. **Access Tools**: Go to the tools section of your project
3. **Launch Plugin**: Open the Media Library plugin

### Important Note: Environment Requirements

**This plugin is designed to run within the DA admin environment.**

- ✅ **Supported**: Running from within DA admin interface
- ✅ **Supported**: Local development testing with `?ref=local` parameter
- ❌ **Not Supported**: Running from localhost without DA proxy

### Local Development Testing

To test the plugin locally while maintaining access to DA APIs:

1. **Add the `?ref=local` parameter** to your URL when accessing the plugin
2. **Example**: `http://localhost:3000/media-library.html?ref=local`
3. **DA Proxy**: This enables the DA proxy that forwards requests to the DA platform
4. **Full Functionality**: All features work as if running in the DA Admin interface

The plugin will automatically detect the local development mode and show a "Local Development (Connected)" status indicator.

### 🔄 **How It Works**

1. **Initialization**: The plugin connects to your DA project and loads existing metadata
2. **Discovery Coordination**: Orchestrates the discovery process with session management
3. **Content Scanning**: Scans all HTML files in your project to discover media assets
4. **Asset Discovery**: Identifies images, videos, and documents referenced in your content
5. **Metadata Creation**: Builds a searchable index of all discovered assets
6. **Browser Interface**: Provides a user-friendly interface to browse and manage assets

### 📄 **Asset Types Supported**

- **Images**: JPG, PNG, GIF, SVG, WebP
- **Videos**: MP4, WebM, OGV
- **Documents**: PDF, DOC, DOCX, XLS, XLSX

### 🎛️ **Interface Features**

- **Search**: Find assets by name or path
- **Filters**: Filter by asset type (images, videos, documents)
- **Folder Tree**: Browse assets organized by folder structure
- **Grid/List Views**: Switch between different viewing modes
- **Asset Preview**: Preview assets before insertion
- **One-Click Insertion**: Insert assets directly into your content

## 🚀 **Key Benefits**

- **Automatic Discovery**: No manual asset cataloging required
- **Content Integration**: One-click insertion into DA content
- **Project-Wide View**: See all media assets in one centralized location
- **Accessibility Support**: Helps maintain WCAG compliance
- **Performance**: Efficient scanning and caching for large projects
- **Multi-User Support**: Session coordination prevents conflicts
- **Incremental Updates**: Only processes changed content

## Development

### Code Quality

The project includes comprehensive ESLint configuration for dead code detection:

```bash
# Run ESLint for dead code detection
npm run lint:media-library

# Check for unused methods
node scripts/unused-methods-detector.js
```

### Factory Function Pattern

All components follow the factory function pattern for clean state management:

```javascript
// Example: Creating a service
const mediaProcessor = createMediaProcessor();
const sessionManager = createSessionManager();
const discoveryCoordinator = createDiscoveryCoordinator();
```

### Modular Architecture

Components are organized into logical modules:

- **Modules**: Core functionality (discovery, queue, UI)
- **Services**: Business logic (session, metadata, persistence)
- **Workers**: Background processing
- **Shared**: Common utilities

### State Management

Complex state management with checkpoint and progress tracking:

```javascript
// Checkpoint management
await processingStateManager.saveScanningCheckpoint(progress);
await processingStateManager.loadScanningCheckpoint();
```

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
5. **Session Conflicts**: Check for other users running scans simultaneously

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
- **Browser Storage**: Uses IndexedDB for state management
- **No Backend**: Client-side only implementation
- **File System Access**: Limited to assets discoverable within the project structure

## Technical Details

### Architecture

- **Factory Function Pattern**: All components use factory functions for clean state management
- **Event-Driven System**: Custom event emitters for real-time communication
- **Session Coordination**: Multi-user session management with conflict resolution
- **Queue-Based Processing**: Background processing with progress tracking
- **State Management**: Persistent scan state and progress tracking
- **Metadata Storage**: JSON-based metadata files in `.media/.pages/` folder

### File Structure

```
.media/
├── .pages/                    # Discovery files
│   ├── discovery-checkpoint.json
│   ├── site-structure.json
│   └── [folder-name].json    # Per-folder discovery files
├── media.json                 # Main metadata file
├── media-scan-state.json      # Scan state and progress
└── media-scan-results.json   # Detailed scan results
```

### Discovery Process

1. **Discovery Coordinator**: Orchestrates the entire discovery process
2. **Discovery Engine**: Core scanning logic with parallel processing
3. **Document Scanner**: Parses HTML files for media references
4. **Site Aggregator**: Builds site structure from discovery files
5. **Persistence Manager**: Saves discovery state and metadata

### Queue System

- **Queue Orchestrator**: Manages the scanning queue
- **Worker Coordinator**: Coordinates web workers
- **Batch Handler**: Processes documents in batches
- **Progress Tracking**: Real-time progress updates

### API Integration

The plugin uses the official DA SDK and API to:
- List project files and folders
- Read HTML content
- Save metadata files
- Insert assets into content
- Manage sessions and coordination

### Session Management

- **Session Locking**: Prevents conflicts between multiple users
- **Session Coordination**: Resolves conflicts when they occur
- **Progress Merging**: Combines progress from multiple sessions
- **State Synchronization**: Keeps state consistent across sessions

## Development

### Local Development

For development and testing:

1. The plugin detects when running outside the DA environment
2. Shows a helpful message explaining the requirements
3. Prevents CORS errors by gracefully handling environment detection

### Building

The plugin is designed to run directly in the browser without build steps. Simply include the HTML file in your DA project's tools section.

### Code Quality Tools

- **ESLint Configuration**: Dead code detection and code quality
- **Factory Function Pattern**: Consistent state management
- **Modular Architecture**: Clean separation of concerns
- **Event-Driven Design**: Loose coupling between components

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Verify you're running from within the DA Admin interface
3. Check browser console for error messages
4. Ensure your DA project contains HTML content with media assets
5. Check for session conflicts if scanning fails

## License

This plugin is part of the DA Media Library project and follows the same licensing terms. 