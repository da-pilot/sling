/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
/**
 * Discovery Manager
 * Coordinates parallel folder discovery workers for optimal document discovery performance
 */

import {
  buildSingleSheet,
  saveSheetFile,
  fetchSheetJson,
  parseSheet,
  loadSheetFile,
  CONTENT_DA_LIVE_BASE,
} from './sheet-utils.js';

function createDiscoveryManager() {
  const state = {
    apiConfig: null,
    daApi: null,
    stateManager: null,
    isActive: false,
    isStopping: false,
    isRunning: false,
    maxWorkers: 4, // Default number of workers
    progressUpdateInterval: 2000, // Progress update interval
    lastProgressUpdate: 0,
    expectedWorkers: 0,
    completedWorkers: 0,
    discoveryCompleteEmitted: false,
    discoveryStartTime: 0,
    folderWorkers: new Map(),
    stats: {
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      errors: 0,
    },
    listeners: new Map(),
    activeWorkers: new Map(),
  };

  const api = {
    init,
    startDiscovery,
    stopDiscovery,
    getStats,
    on,
    off,
    emit,
  };

  async function init(apiConfig, stateManagerInstance) {
    state.apiConfig = apiConfig;
    state.stateManager = stateManagerInstance;

    // Create and initialize DA API service
    const { createDAApiService } = await import('../services/da-api.js');
    state.daApi = createDAApiService();
    await state.daApi.init(apiConfig);
  }

  /**
   * Throttled progress update to reduce excessive state saves
   */
  async function updateProgressThrottled() {
    const now = Date.now();
    if (now - state.lastProgressUpdate < state.progressUpdateInterval) {
      return;
    }

    state.lastProgressUpdate = now;

    if (state.stateManager) {
      await state.stateManager.updateDiscoveryProgress({
        completedFolders: state.stats.completedFolders,
        totalDocuments: state.stats.totalDocuments,
      });
    }
  }

  /**
   * Start multi-threaded document discovery
   */
  async function startDiscovery() {
    if (state.isRunning) {
      return;
    }

    if (state.discoveryCompleteEmitted) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log('🔍 [DISCOVERY] Starting document discovery...');

    state.isRunning = true;
    resetStats();
    state.expectedWorkers = 0;
    state.completedWorkers = 0;
    state.discoveryCompleteEmitted = false;

    // Set a timeout to ensure discovery completion is triggered even if workers get stuck
    state.discoveryTimeout = setTimeout(() => {
      if (!state.discoveryCompleteEmitted && state.completedWorkers > 0) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] ⏰ Timeout: Triggering discovery complete after timeout');
        triggerDiscoveryComplete();
      }
    }, 300000); // 5 minutes timeout

    const discoveryStartTime = Date.now();
    state.discoveryStartTime = discoveryStartTime;

    try {
      const { folders, files } = await getTopLevelItems();

      const totalFolders = folders.length + (files.length > 0 ? 1 : 0);
      const discoveryWorkers = Math.min(folders.length, state.maxWorkers * 2);

      state.stats.totalFolders = totalFolders;

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 📊 Discovery setup complete:', {
        totalFolders,
        foldersFound: folders.length,
        filesFound: files.length,
        maxWorkers: state.maxWorkers,
        discoveryWorkers,
        hasRootFiles: files.length > 0,
      });

      if (state.stateManager) {
        await state.stateManager.updateDiscoveryProgress({
          totalFolders,
          completedFolders: 0,
          totalDocuments: files.length,
        });
        state.lastProgressUpdate = 0;
      }

      emit('discoveryStarted', {
        totalFolders,
        maxWorkers: state.maxWorkers,
      });

      state.expectedWorkers = (files.length > 0 ? 1 : 0) + folders.length;

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🎯 Expected workers calculation:', {
        rootFilesWorker: files.length > 0 ? 1 : 0,
        folderWorkers: folders.length,
        totalExpectedWorkers: state.expectedWorkers,
        folders: folders.map((f) => f.path),
      });

      if (files.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 📁 Processing root files...');
        await processRootFiles(files);
      }

      if (folders.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 📂 Processing folders in parallel...');
        await processFoldersInParallel(folders);
      } else {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] ⚠️ No folders found to process');
      }

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] ✅ startDiscovery() completed');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Discovery Manager] Discovery failed:', error);
      emit('discoveryError', { error: error.message });
    } finally {
      state.isRunning = false;
    }
  }

  /**
   * Trigger discovery complete when all workers finish
   */
  function triggerDiscoveryComplete() {
    if (state.discoveryCompleteEmitted) {
      return;
    }

    const discoveryEndTime = Date.now();
    const discoveryDuration = discoveryEndTime - state.discoveryStartTime;
    const discoveryDurationSeconds = Math.round(discoveryDuration / 1000);

    const { totalDocuments } = state.stats;

    state.discoveryCompleteEmitted = true;

    // Clear the discovery timeout since we're completing
    if (state.discoveryTimeout) {
      clearTimeout(state.discoveryTimeout);
      state.discoveryTimeout = null;
    }

    // eslint-disable-next-line no-console
    console.log('✅ [DISCOVERY] Discovery complete:', {
      totalDocuments,
      duration: `${discoveryDurationSeconds}s`,
      folders: state.stats.totalFolders,
      completedFolders: state.stats.completedFolders,
    });

    emit('discoveryComplete', {
      stats: state.stats,
      totalDocuments,
      discoveryDuration,
      discoveryStartTime: state.discoveryStartTime,
      discoveryEndTime,
    });
  }

  /**
   * Process folders in parallel with immediate scanning
   */
  async function processFoldersInParallel(folders) {
    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] 🚀 Starting parallel folder processing:', {
      totalFolders: folders.length,
      maxWorkers: state.maxWorkers,
      discoveryWorkers: Math.min(folders.length, state.maxWorkers * 2),
      folderPaths: folders.map((f) => f.path),
    });

    const discoveryWorkers = Math.min(folders.length, state.maxWorkers * 2);
    const folderBatches = createBatches(folders, discoveryWorkers);

    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] 📦 Created folder batches:', {
      totalBatches: folderBatches.length,
      batchSizes: folderBatches.map((batch) => batch.length),
      batches: folderBatches.map((batch, index) => ({
        batchIndex: index,
        folders: batch.map((f) => f.path),
      })),
    });

    const batchPromises = folderBatches.map(async (batch, batchIndex) => {
      // eslint-disable-next-line no-console
      console.log(`[Discovery Manager] 🔄 Processing batch ${batchIndex + 1}/${folderBatches.length}:`, {
        batchSize: batch.length,
        folders: batch.map((f) => f.path),
      });

      const workerPromises = batch.map((folder) => processFolder(folder));
      return Promise.all(workerPromises);
    });

    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] ⏳ Waiting for all batch promises to complete...');
    await Promise.all(batchPromises);
    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] ✅ All batch promises completed');
    
    // Fallback: If all batch promises completed but discovery completion wasn't triggered,
    // check if we should trigger it now
    if (!state.discoveryCompleteEmitted && state.completedWorkers > 0) {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🔄 Fallback: All batches completed, checking discovery completion:', {
        completedWorkers: state.completedWorkers,
        expectedWorkers: state.expectedWorkers,
        totalFolders: state.stats.totalFolders,
        completedFolders: state.stats.completedFolders,
      });
      
      // If we have completed workers but discovery wasn't triggered, trigger it now
      if (state.completedWorkers > 0) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🎯 Fallback: Triggering discovery complete after batch completion');
        triggerDiscoveryComplete();
      }
    }
  }

  /**
   * Process a single folder with dedicated worker
   */
  async function processFolder(folder) {
    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] 🔧 Creating worker for folder:', {
      folderPath: folder.path,
      timestamp: new Date().toISOString(),
    });

    return new Promise((resolve, reject) => {
      const workerId = `worker_${folder.path.replace(/[/\\]/g, '_')}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const folderStartTime = Date.now();

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🏭 Creating Web Worker:', {
        workerId,
        folderPath: folder.path,
        workerScript: './workers/folder-discovery-worker.js',
      });

      let worker;
      try {
        worker = new Worker('./workers/folder-discovery-worker.js', { type: 'module' });
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] ✅ Worker created successfully:', {
          workerId,
          folderPath: folder.path,
        });
      } catch (workerError) {
        // eslint-disable-next-line no-console
        console.error('[Discovery Manager] ❌ Failed to create worker:', {
          workerId,
          folderPath: folder.path,
          error: workerError.message,
          stack: workerError.stack,
        });
        reject(workerError);
        return;
      }

      state.folderWorkers.set(workerId, {
        worker,
        folder,
        startTime: folderStartTime,
      });

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 📝 Setting up worker message handler:', {
        workerId,
        folderPath: folder.path,
        activeWorkers: state.folderWorkers.size,
      });

      worker.onmessage = async (event) => {
        const { type, data } = event.data;

        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 📨 Received worker message:', {
          workerId,
          folderPath: folder.path,
          messageType: type,
          data: data ? Object.keys(data) : 'no data',
        });

        switch (type) {
          case 'initialized':
            // eslint-disable-next-line no-console
            console.log('[Discovery Manager] 🚀 Worker initialized, starting discovery:', {
              workerId,
              folderPath: folder.path,
            });
            worker.postMessage({
              type: 'discoverFolder',
              data: {
                folderPath: folder.path,
                workerId,
              },
            });
            break;

          case 'folderProgress':
            // eslint-disable-next-line no-console
            console.log('[Discovery Manager] 📊 Folder progress update:', {
              workerId,
              folderPath: folder.path,
              progress: data,
            });
            emit('folderProgress', {
              ...data,
              workerId,
              totalFolders: state.stats.totalFolders,
              completedFolders: state.stats.completedFolders,
            });
            break;

          case 'folderDiscoveryComplete':
            // eslint-disable-next-line no-console
            console.log('[Discovery Manager] ✅ Folder discovery completed:', {
              workerId,
              folderPath: folder.path,
              documentCount: data.documentCount,
              existingCount: data.existingCount,
              currentCount: data.currentCount,
            });
            state.stats.completedFolders++;
            state.stats.totalDocuments += data.documentCount;
            state.completedWorkers++;

            const folderEndTime = Date.now();
            const folderDuration = folderEndTime - folderStartTime;
            const folderDurationSeconds = Math.round(folderDuration / 1000);

            await updateProgressThrottled();

            if (state.stateManager) {
              const folderName = folder.path === '/' ? 'root' : folder.path.split('/').pop() || 'root';
              const shortWorkerId = workerId.split('_').slice(-2).join('-');
              const fileName = `${folderName}-${shortWorkerId}.json`;

              await state.stateManager.updateDiscoveryFileStatus(fileName, 'complete', {
                totalDocuments: data.documentCount,
                completedDocuments: data.documentCount,
                lastProcessedPath: data.documents[data.documents.length - 1]?.path,
                discoveryDuration: folderDuration,
                workerId,
              });
            }

            emit('folderComplete', {
              ...data,
              workerId,
              stats: state.stats,
            });

            if (data.documents.length > 0) {
              emit('documentsDiscovered', {
                documents: data.documents,
                folder: folder.path,
              });
            }

            cleanup(workerId);

            // eslint-disable-next-line no-console
            console.log('[Discovery Manager] 📈 Worker completion stats:', {
              completedWorkers: state.completedWorkers,
              expectedWorkers: state.expectedWorkers,
              completedFolders: state.stats.completedFolders,
              totalFolders: state.stats.totalFolders,
              totalDocuments: state.stats.totalDocuments,
            });

            if (state.completedWorkers >= state.expectedWorkers && !state.discoveryCompleteEmitted) {
              // eslint-disable-next-line no-console
              console.log('[Discovery Manager] 🎯 All workers completed, triggering discovery complete');

              if (state.stateManager) {
                const checkpoint = {
                  status: 'complete',
                  totalFolders: state.stats.totalFolders,
                  completedFolders: state.stats.completedFolders,
                  totalDocuments: state.stats.totalDocuments,
                  currentFile: null,
                  currentPath: null,
                  completedAt: Date.now(),
                };

                await state.stateManager.saveDiscoveryCheckpoint(checkpoint);
              }

              triggerDiscoveryComplete();
            }

            resolve();
            break;

          case 'folderDiscoveryError':
            // eslint-disable-next-line no-console
            console.error('[Discovery Manager] ❌ Folder discovery error:', {
              workerId,
              folderPath: folder.path,
              error: data.error,
            });
            state.stats.completedFolders++;
            state.completedWorkers++;

            cleanup(workerId);

            if (state.completedWorkers >= state.expectedWorkers && !state.discoveryCompleteEmitted) {
              // eslint-disable-next-line no-console
              console.log('[Discovery Manager] 🎯 All workers completed (with errors), triggering discovery complete');
              triggerDiscoveryComplete();
            }

            reject(new Error(data.error));
            break;

          case 'error':
            // eslint-disable-next-line no-console
            console.error('[Discovery Manager] ❌ Worker error:', {
              workerId,
              folderPath: folder.path,
              error: data.error,
              originalType: data.originalType,
            });
            state.stats.completedFolders++;
            state.completedWorkers++;

            cleanup(workerId);

            if (state.completedWorkers >= state.expectedWorkers && !state.discoveryCompleteEmitted) {
              // eslint-disable-next-line no-console
              console.log('[Discovery Manager] 🎯 All workers completed (with worker errors), triggering discovery complete');
              triggerDiscoveryComplete();
            }

            reject(new Error(data.error));
            break;

          default:
            // eslint-disable-next-line no-console
            console.warn('[Discovery Manager] ⚠️ Unknown worker message type:', {
              workerId,
              folderPath: folder.path,
              messageType: type,
            });
        }
      };

      worker.onerror = (error) => {
        // eslint-disable-next-line no-console
        console.error('[Discovery Manager] ❌ Worker error event:', {
          workerId,
          folderPath: folder.path,
          error: error.message,
          filename: error.filename,
          lineno: error.lineno,
          colno: error.colno,
        });
        state.stats.completedFolders++;
        state.completedWorkers++;

        cleanup(workerId);

        if (state.completedWorkers >= state.expectedWorkers && !state.discoveryCompleteEmitted) {
          // eslint-disable-next-line no-console
          console.log('[Discovery Manager] 🎯 All workers completed (with worker errors), triggering discovery complete');
          triggerDiscoveryComplete();
        }

        reject(error);
      };

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🔄 Sending init message to worker:', {
        workerId,
        folderPath: folder.path,
      });

      worker.postMessage({
        type: 'init',
        data: {
          apiConfig: state.apiConfig,
        },
      });
    });
  }

  /**
   * Get top-level folders and HTML files for processing
   */
  async function getTopLevelItems() {
    try {
      if (!state.daApi) {
        throw new Error('DA API service not initialized');
      }

      const items = await state.daApi.listPath('/');

      // Debug: Log the API response to understand the format
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🔍 Top-level items from DA API:', {
        totalItems: items.length,
        allItems: items.map((item) => ({
          name: item.name,
          path: item.path,
          ext: item.ext,
          hasExt: item.ext !== undefined,
          isFolder: !item.ext,
          isHTML: item.ext === 'html',
        })),
        folders: items.filter((item) => !item.ext).map((item) => item.path),
        files: items.filter((item) => item.ext === 'html').map((item) => item.path),
        timestamp: new Date().toISOString(),
      });

      // Load exclude patterns from config
      const excludePatterns = [];
      try {
        const configData = await fetchSheetJson(state.apiConfig, 'media-library-config.json');
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🔧 Raw config data:', {
          configData,
          timestamp: new Date().toISOString(),
        });

        if (configData?.data) {
          for (const row of configData.data) {
            // eslint-disable-next-line no-console
            console.log('[Discovery Manager] 🔧 Processing config row:', {
              row,
              excludeValue: row.exclude,
              excludeType: typeof row.exclude,
              timestamp: new Date().toISOString(),
            });

            if (typeof row.exclude === 'string') {
              const patterns = row.exclude.split(',').map((s) => s.trim()).filter(Boolean);
              excludePatterns.push(...patterns);
              // eslint-disable-next-line no-console
              console.log('[Discovery Manager] 🔧 Parsed patterns from row:', {
                original: row.exclude,
                parsed: patterns,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[Discovery Manager] Failed to load exclusion patterns:', e);
      }

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 📋 Exclude patterns loaded:', {
        excludePatterns,
        timestamp: new Date().toISOString(),
      });

      // Check if path matches exclude patterns
      const matchesExcludePatterns = (path, patterns) => {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🔍 Checking path against patterns:', {
          path,
          patterns,
          timestamp: new Date().toISOString(),
        });

        const result = patterns.some((pattern) => {
          const pathParts = path.split('/');
          if (pathParts.length >= 3) {
            const org = pathParts[1];
            const repo = pathParts[2];
            const orgRepoPrefix = `/${org}/${repo}`;

            if (pattern.endsWith('/*')) {
              // For wildcard patterns, check if path starts with the pattern (without the *)
              // This handles both exact folder matches and subfolder matches
              const patternWithoutWildcard = pattern.slice(0, -1);
              const fullPattern = `${orgRepoPrefix}${patternWithoutWildcard}`;
              // Check if path starts with the pattern OR if path equals the pattern without trailing slash
              const matches = path.startsWith(fullPattern) || path === fullPattern.slice(0, -1);
              // eslint-disable-next-line no-console
              console.log('[Discovery Manager] 🔍 Pattern check:', {
                pattern,
                fullPattern,
                path,
                matches,
                orgRepoPrefix,
                startsWithCheck: path.startsWith(fullPattern),
                exactMatchCheck: path === fullPattern.slice(0, -1),
              });
              return matches;
            }
            const matches = path === `${orgRepoPrefix}${pattern}`;
            // eslint-disable-next-line no-console
            console.log('[Discovery Manager] 🔍 Pattern check:', {
              pattern,
              path,
              orgRepoPrefix,
              fullPath: `${orgRepoPrefix}${pattern}`,
              matches,
            });
            return matches;
          }
          return false;
        });

        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🔍 Final result for path:', {
          path,
          patterns,
          result,
          timestamp: new Date().toISOString(),
        });

        return result;
      };

      // Filter out excluded folders and files
      const excludedFolders = items.filter((item) => !item.ext && matchesExcludePatterns(item.path, excludePatterns));
      const excludedFiles = items.filter((item) => item.ext === 'html' && matchesExcludePatterns(item.path, excludePatterns));

      if (excludedFolders.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🚫 Excluded folders:', {
          excludedFolders: excludedFolders.map((f) => f.path),
          timestamp: new Date().toISOString(),
        });
      }

      if (excludedFiles.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🚫 Excluded files:', {
          excludedFiles: excludedFiles.map((f) => f.path),
          timestamp: new Date().toISOString(),
        });
      }

      const folders = items
        .filter((item) => !item.ext && !matchesExcludePatterns(item.path, excludePatterns))
        .map((item) => ({
          path: item.path,
        }));

      const files = items
        .filter((item) => item.ext === 'html' && !matchesExcludePatterns(item.path, excludePatterns))
        .map((item) => ({
          path: item.path,
          lastModified: item.lastModified,
        }));

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 📊 Filtering results:', {
        allItems: items.map((item) => ({ name: item.name, path: item.path, isFolder: !item.ext })),
        excludedFolders: excludedFolders.map((f) => f.path),
        excludedFiles: excludedFiles.map((f) => f.path),
        includedFolders: folders.map((f) => f.path),
        includedFiles: files.map((f) => f.path),
        timestamp: new Date().toISOString(),
      });

      // Debug: Log the filtered results
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 📊 Filtered results:', {
        totalItems: items.length,
        foldersFound: folders.length,
        filesFound: files.length,
        excludedFolders: excludedFolders.length,
        excludedFiles: excludedFiles.length,
        folderPaths: folders.map((f) => f.path),
        filePaths: files.map((f) => f.path),
      });

      return { folders, files };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Discovery Manager] Failed to get top-level items:', error);

      // Return empty arrays if DA API is not available
      if (error.message.includes('DA API not available') || error.message.includes('DA API service not initialized')) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] DA API not available, returning empty results');
        return { folders: [], files: [] };
      }

      return { folders: [], files: [] };
    }
  }

  /**
   * Get existing root files from .pages directory
   */
  async function getExistingRootFiles() {
    try {
      if (!state.daApi) {
        throw new Error('DA API service not initialized');
      }

      const items = await state.daApi.listPath('.da/.pages');

      return items.filter((item) => item.name && item.name.startsWith('root-') && item.name.endsWith('.json'));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Discovery Manager] Failed to get existing root files:', error);
      return [];
    }
  }

  /**
   * Process HTML files in the root directory
   */
  async function processRootFiles(files) {
    try {
      if (files && files.length > 0) {
        const existingRootFiles = await getExistingRootFiles();

        if (existingRootFiles.length > 0) {
          // eslint-disable-next-line no-console
          console.log('[Discovery Manager] 📁 Found existing root files:', {
            existingFiles: existingRootFiles.map((f) => f.name),
            timestamp: new Date().toISOString(),
          });

          const existingFile = existingRootFiles[0];

          // eslint-disable-next-line no-console
          console.log('[Discovery Manager] 📁 Using existing root file:', {
            fileName: existingFile.name,
            timestamp: new Date().toISOString(),
          });
        } else {
          const rootWorkerId = `root_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const shortWorkerId = rootWorkerId.split('_').slice(-2).join('-');

          const documentsWithMetadata = files.map((file) => ({
            path: file.path,
            lastModified: file.lastModified,
            discoveredAt: new Date().toISOString(),
            discoveryComplete: true,
          }));

          const jsonToWrite = buildSingleSheet(documentsWithMetadata);
          const filePath = `/${state.apiConfig.org}/${state.apiConfig.repo}/.da/.pages/root-${shortWorkerId}.json`;
          const url = `${state.apiConfig.baseUrl}/source${filePath}`;

          await saveSheetFile(url, jsonToWrite, state.apiConfig.token);

          // eslint-disable-next-line no-console
          console.log('[Discovery Manager] 📁 Root files discovery complete:', {
            rootFiles: files.length,
            workerId: rootWorkerId,
            shortWorkerId,
            filePath,
            timestamp: new Date().toISOString(),
          });
        }
      }

      state.stats.completedFolders++;
      state.stats.totalDocuments += files?.length || 0;
      state.completedWorkers++;

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] ✅ Root files worker completed:', {
        completedWorkers: state.completedWorkers,
        expectedWorkers: state.expectedWorkers,
        documentCount: files?.length || 0,
        timestamp: new Date().toISOString(),
      });

      emit('documentsDiscovered', {
        documents: files || [],
        folder: '/',
      });

      emit('folderComplete', {
        documentCount: files?.length || 0,
        documents: files || [],
        workerId: 'root',
        stats: state.stats,
      });

      if (state.completedWorkers >= state.expectedWorkers) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🎯 All workers completed, triggering discovery complete');
        triggerDiscoveryComplete();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Discovery Manager] Failed to process root files:', error);
      state.stats.completedFolders++;
      state.stats.totalDocuments += files?.length || 0;
      state.completedWorkers++;

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] ❌ Root files worker error:', {
        completedWorkers: state.completedWorkers,
        expectedWorkers: state.expectedWorkers,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      emit('documentsDiscovered', {
        documents: files || [],
        folder: '/',
      });

      emit('folderComplete', {
        documentCount: files?.length || 0,
        documents: files || [],
        workerId: 'root',
        stats: state.stats,
      });

      if (state.completedWorkers >= state.expectedWorkers) {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] 🎯 All workers completed (with errors), triggering discovery complete');
        triggerDiscoveryComplete();
      }
    }
  }

  /**
   * Calculate total page count from all discovery files
   */
  async function calculateTotalPageCount() {
    try {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🔍 Calculating total page count...');

      const { listPath } = await import('../services/da-api.js');
      const items = await listPath('.da/.pages');

      const jsonFiles = items.filter((item) => item.name && item.ext === 'json');

      let totalCount = 0;

      for (const file of jsonFiles) {
        try {
          const fileUrl = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/.da/.pages/${file.name}.json`;

          const rawFileData = await loadSheetFile(fileUrl, state.apiConfig.token);
          const parsedData = parseSheet(rawFileData);

          if (parsedData.data && parsedData.data.data) {
            totalCount += parsedData.data.data.length;
          } else if (parsedData.data) {
            totalCount += parsedData.data.length;
          }
        } catch (fileError) {
          // eslint-disable-next-line no-console
          console.log('[Discovery Manager] ⚠️ Error reading file for count:', {
            fileName: file.name,
            error: fileError.message,
          });
        }
      }

      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 📊 Total page count calculated:', {
        totalFiles: jsonFiles.length,
        totalPages: totalCount,
        timestamp: new Date().toISOString(),
      });

      return totalCount;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] ⚠️ Could not calculate total page count, using fallback count:', state.stats.totalDocuments);
      return state.stats.totalDocuments;
    }
  }

  /**
   * Stop all discovery workers
   */
  async function stopDiscovery() {
    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] 🛑 Stop discovery called:', {
      isRunning: state.isRunning,
      activeWorkers: state.folderWorkers.size,
      timestamp: new Date().toISOString(),
      stack: new Error().stack,
    });

    if (!state.isRunning) {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🛑 Discovery not running, skipping stop');
      return;
    }

    cleanupDiscovery();

    for (const [workerId, workerInfo] of state.folderWorkers) {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] 🛑 Stopping worker:', {
        workerId,
        folderPath: workerInfo.folder.path,
        timestamp: new Date().toISOString(),
      });
      workerInfo.worker.postMessage({ type: 'stopDiscovery' });
      cleanup(workerId);
    }

    emit('discoveryStopped', { stats: state.stats });

    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] 🛑 Discovery stopped');
  }

  /**
   * Resume discovery with specific pending folders (delta discovery)
   */
  async function resumeDiscovery(pendingFolders, completedFolders = []) {
    if (state.isRunning) {
      return;
    }

    if (state.discoveryCompleteEmitted) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log('🔄 [DISCOVERY] Resuming discovery with delta processing...', {
      pendingFolders: pendingFolders.length,
      completedFolders: completedFolders.length,
    });

    state.isRunning = true;
    state.expectedWorkers = 0;
    state.completedWorkers = 0;
    state.discoveryCompleteEmitted = false;

    const discoveryStartTime = Date.now();
    state.discoveryStartTime = discoveryStartTime;

    try {
      const totalFolders = pendingFolders.length + completedFolders.length;

      state.stats.totalFolders = totalFolders;
      state.stats.completedFolders = completedFolders.length;

      let totalDocuments = 0;
      for (const folder of completedFolders) {
        const folderName = folder.path === '/' ? 'root' : folder.path.split('/').pop() || 'root';
        try {
          const { listPath } = await import('../services/da-api.js');
          const items = await listPath('.da/.pages');

          const existingFile = items.find((item) => item.name && item.name.startsWith(`${folderName}-`) && item.name.endsWith('.json'));

          if (existingFile) {
            const fileUrl = `${CONTENT_DA_LIVE_BASE}/${state.apiConfig.org}/${state.apiConfig.repo}/.da/.pages/${existingFile.name}.json`;

            const rawFileData = await loadSheetFile(fileUrl, state.apiConfig.token);
            const parsedData = parseSheet(rawFileData);

            if (parsedData.data && parsedData.data.data) {
              totalDocuments += parsedData.data.data.length;
            } else if (parsedData.data) {
              totalDocuments += parsedData.data.length;
            }
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.log('[Discovery Manager] ⚠️ Could not get document count for completed folder:', folder.path);
        }
      }

      state.stats.totalDocuments = totalDocuments;

      if (state.stateManager) {
        await state.stateManager.updateDiscoveryProgress({
          totalFolders,
          completedFolders: completedFolders.length,
          totalDocuments,
        });
        state.lastProgressUpdate = 0;
      }

      emit('discoveryStarted', {
        totalFolders,
        maxWorkers: state.maxWorkers,
        resumed: true,
        pendingFolders: pendingFolders.length,
        completedFolders: completedFolders.length,
      });

      if (pendingFolders.length > 0) {
        state.expectedWorkers = pendingFolders.length;
        await processFoldersInParallel(pendingFolders);
      } else {
        // eslint-disable-next-line no-console
        console.log('[Discovery Manager] ✅ No pending folders, discovery already complete');
        triggerDiscoveryComplete();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Discovery Manager] Delta discovery failed:', error);
      emit('discoveryError', { error: error.message });
    } finally {
      state.isRunning = false;
    }
  }

  /**
   * Cleanup worker resources
   */
  function cleanup(workerId) {
    const workerInfo = state.folderWorkers.get(workerId);
    if (workerInfo) {
      workerInfo.worker.terminate();
      state.folderWorkers.delete(workerId);
    }
  }

  function cleanupDiscovery() {
    if (state.discoveryTimeout) {
      clearTimeout(state.discoveryTimeout);
      state.discoveryTimeout = null;
    }
    state.isRunning = false;
    state.discoveryCompleteEmitted = false;
  }

  /**
   * Reset discovery state for new scan
   */
  function resetDiscoveryState() {
    // eslint-disable-next-line no-console
    console.log('[Discovery Manager] 🔄 Resetting discovery state for new scan');
    cleanupDiscovery();
    resetStats();
  }

  /**
   * Reset statistics
   */
  function resetStats() {
    state.stats = {
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      errors: 0,
    };
  }

  /**
   * Get current statistics
   */
  function getStats() {
    return { ...state.stats };
  }

  /**
   * Add event listener
   */
  function on(event, callback) {
    if (!state.listeners.has(event)) {
      state.listeners.set(event, []);
    }
    state.listeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   */
  function off(event, callback) {
    const callbacks = state.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to listeners
   */
  function emit(event, data) {
    const callbacks = state.listeners.get(event);

    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[Discovery Manager] ❌ Error in event listener:', error);
        }
      });
    } else {
      // eslint-disable-next-line no-console
      console.log('[Discovery Manager] ⚠️ No listeners for event:', event);
    }
  }

  /**
   * Utility functions
   */
  function createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  return {
    init,
    startDiscovery,
    stopDiscovery,
    resetDiscoveryState,
    getStats,
    on,
    off,
    resumeDiscovery,
  };
}

export { createDiscoveryManager };
