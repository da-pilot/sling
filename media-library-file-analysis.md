# Media Library File Usage Analysis

## File Usage Status Table

| File Path | Status | Imported By | Notes |
|-----------|--------|-------------|-------|
| **Main Files** |
| `media-library.js` | ✅ Used | Main entry point | Primary application file |
| `constants.js` | ✅ Used | Multiple files | Shared constants |
| `ffetch.js` | ❓ Unknown | - | Need to check usage |
| `media-library.css` | ✅ Used | HTML file | Styles |
| `media-library.html` | ✅ Used | Main HTML | UI template |
| **Config Files** |
| `config/ai-config.js` | ✅ Used | media-info-modal.js | AI configuration |
| **Services** |
| `services/doc-authoring-service.js` | ✅ Used | media-library.js | Document authoring |
| `services/metadata-manager.js` | ✅ Used | media-library.js, media-loader.js, media-processor.js | Metadata management |
| `services/session-manager.js` | ✅ Used | media-library.js | Session management |
| `services/processing-state-manager.js` | ✅ Used | media-library.js | Processing state |
| `services/persistence-manager.js` | ✅ Used | media-library.js, media-loader.js, media-processor.js, scan-completion-handler.js | Data persistence |
| `services/worker-utils.js` | ✅ Used | media-scan-worker.js | Worker utilities |
| `services/media-worker-utils.js` | ✅ Used | media-scan-worker.js, media-processor.js | Media worker utilities |
| `services/checkpoint-queue-manager.js` | ✅ Used | processing-state-manager.js | Checkpoint management |
| **Modules** |
| `modules/media-processor.js` | ✅ Used | media-library.js | Media processing |
| `modules/media-browser.js` | ✅ Used | media-library.js | Media browser UI |
| `modules/media-insert.js` | ✅ Used | media-library.js | Media insertion |
| `modules/queue-manager.js` | ✅ Used | media-library.js | Queue management |
| `modules/rescan.js` | ✅ Used | media-library.js | Rescan functionality |
| `modules/ui-events.js` | ✅ Used | media-library.js | UI event handling |
| `modules/hierarchy-browser.js` | ✅ Used | media-library.js | Hierarchy browser |
| `modules/media-info-modal.js` | ✅ Used | media-library.js | Media info modal |
| `modules/toast.js` | ✅ Used | media-library.js, ui-manager.js | Toast notifications |
| `modules/media-loader.js` | ✅ Used | media-library.js | Media loading |
| `modules/sheet-utils.js` | ✅ Used | hierarchy-browser.js, discovery/site-aggregator.js, processing-state-manager.js, queue/discovery-file-handler.js, queue/delta-handler.js | Sheet utilities |
| `modules/selective-rescan.js` | ✅ Used | rescan.js | Selective rescan |
| `modules/ui-manager.js` | ✅ Used | - | UI management (needs verification) |
| `modules/scan-completion-handler.js` | ❌ Broken | - | Missing dependency: scan-status-updater.js |
| `modules/discovery-coordinator.js` | ❌ Broken | - | Missing dependency: discovery-file-manager.js |
| `modules/discovery-manager.js` | ✅ Used | discovery-coordinator.js | Discovery management |
| `modules/scan-state-manager.js` | ❓ Unknown | - | Need to check usage |
| `modules/worker-manager.js` | ❌ Unused | - | Not imported anywhere |
| `modules/upload-queue-manager.js` | ❌ Unused | - | Not imported anywhere |
| `modules/event-handlers.js` | ❌ Unused | - | Not imported anywhere |
| `modules/usage-modal.js` | ❌ Unused | - | Not imported anywhere |
| `modules/empty-state.js` | ⚠️ Duplicated | - | HTML duplicated in media-library.js |
| `modules/scan-indicator.js` | ✅ Used | media-library.js | Dynamically imported |
| **Queue Subdirectory** |
| `modules/queue/index.js` | ✅ Used | - | Queue module exports |
| `modules/queue/queue-orchestrator.js` | ✅ Used | queue-manager.js | Queue orchestration |
| `modules/queue/document-handler.js` | ✅ Used | queue-orchestrator.js | Document handling |
| `modules/queue/status-coordinator.js` | ✅ Used | queue-orchestrator.js | Status coordination |
| `modules/queue/delta-handler.js` | ✅ Used | queue-orchestrator.js | Delta handling |
| `modules/queue/batch-handler.js` | ✅ Used | queue-orchestrator.js | Batch handling |
| `modules/queue/checkpoint-handler.js` | ✅ Used | queue-orchestrator.js | Checkpoint handling |
| `modules/queue/discovery-coordinator.js` | ✅ Used | queue-orchestrator.js | Discovery coordination |
| `modules/queue/worker-coordinator.js` | ✅ Used | queue-orchestrator.js | Worker coordination |
| `modules/queue/discovery-file-handler.js` | ✅ Used | queue-orchestrator.js | Discovery file handling |
| `modules/queue/event-emitter.js` | ✅ Used | queue/index.js | Event emission |
| **Discovery Subdirectory** |
| `modules/discovery/index.js` | ✅ Used | discovery-manager.js | Discovery module exports |
| `modules/discovery/site-aggregator.js` | ✅ Used | discovery-engine.js, scan-completion-handler.js | Site aggregation |
| `modules/discovery/discovery-engine.js` | ✅ Used | discovery/index.js | Discovery engine |
| `modules/discovery/discovery-events.js` | ✅ Used | discovery-engine.js | Discovery events |
| `modules/discovery/document-scanner.js` | ✅ Used | discovery-engine.js | Document scanning |
| `modules/discovery/persistence-manager.js` | ✅ Used | discovery-engine.js | Discovery persistence |
| `modules/discovery/stats-tracker.js` | ✅ Used | discovery-engine.js | Statistics tracking |
| `modules/discovery/parallel-processor.js` | ✅ Used | discovery-engine.js | Parallel processing |
| `modules/discovery/document-mapper.js` | ❓ Unknown | - | Need to check usage |
| **Shared** |
| `shared/index.js` | ✅ Used | discovery/stats-tracker.js, discovery/discovery-events.js, queue/event-emitter.js | Shared exports |
| `shared/event-emitter.js` | ✅ Used | shared/index.js | Event emitter |
| `shared/stats-manager.js` | ✅ Used | shared/index.js | Statistics management |
| `shared/shared-modules.js` | ❌ Unused | - | Not imported anywhere |
| **Workers** |
| `workers/media-scan-worker.js` | ✅ Used | - | Media scanning worker |
| `workers/folder-discovery-worker.js` | ❓ Unknown | - | Need to check usage |
| **Documentation** |
| `README.md` | ✅ Used | Documentation | Project documentation |
| `CLOUDFLARE_AI_SETUP.md` | ✅ Used | Documentation | AI setup guide |

## Summary

### ✅ Used Files: 45
- All core functionality files
- Most modules and services
- All queue and discovery submodules
- Shared utilities

### ❌ Unused Files: 5
1. `modules/worker-manager.js`
2. `modules/upload-queue-manager.js`
3. `modules/event-handlers.js`
4. `modules/usage-modal.js`
5. `shared/shared-modules.js`

### ❌ Broken Files: 2
1. `modules/scan-completion-handler.js` - Missing `scan-status-updater.js`
2. `modules/discovery-coordinator.js` - Missing `discovery-file-manager.js`

### ⚠️ Duplicated Files: 1
1. `modules/empty-state.js` - HTML content duplicated in main file

### ❓ Unknown Status: 4
1. `ffetch.js`
2. `modules/scan-state-manager.js`
3. `modules/document-mapper.js`
4. `workers/folder-discovery-worker.js`

## Recommendations

1. **Remove unused files** (5 files)
2. **Fix broken imports** by creating missing files or updating imports
3. **Consolidate duplicated content** in empty-state.js
4. **Verify unknown status files** to determine if they're needed 