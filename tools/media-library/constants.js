/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return, no-undef, no-alert, default-case, no-case-declarations, import/prefer-default-export, no-param-reassign, no-underscore-dangle, no-prototype-builtins, no-loop-func, no-empty */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax, max-len, no-unused-vars, import/no-unresolved, consistent-return */
/* eslint-disable no-use-before-define, no-plusplus, no-continue, no-await-in-loop, no-restricted-syntax */
/* eslint-disable no-use-before-define */
/**
 * Media Library Constants
 * Centralized constants for DA storage paths and configuration
 */

export const DA_STORAGE = {
  DIR: '.da',
  PAGES_DIR: '.da/.pages',
  FILES: {
    STATE: 'media-scan-state.json',
    DISCOVERY_QUEUE: 'media-discovery-queue.json',
    SCAN_RESULTS: 'media-scan-results.json',
    MEDIA_DATA: 'media.json',
    CONFIG: 'media-library-config.json',
  },
};

export const DA_PATHS = {
  getStorageDir: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}`,
  getStateFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.STATE}`,
  getDiscoveryQueueFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.DISCOVERY_QUEUE}`,
  getScanResultsFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.SCAN_RESULTS}`,
  getMediaDataFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.MEDIA_DATA}`,
  getConfigFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.CONFIG}`,
};

export const SCAN_CONFIG = {
  HEARTBEAT_INTERVAL_MS: 30000,
  STALE_LOCK_THRESHOLD_MS: 5 * 60 * 1000,
  MAX_WORKERS: 4,
  BATCH_SIZE: 10,
  PROGRESS_UPDATE_INTERVAL: 2000,
  POLLING_INTERVAL: 10000,
  ASSET_POLLING_INTERVAL: 5000,
};

export const WORKER_CONFIG = {
  MAX_CONCURRENT_SCANS: 8,
  PROCESSING_INTERVAL: 1000,
  HEARTBEAT_INTERVAL: 15000,
};

export const DISCOVERY_CONFIG = {
  MAX_WORKERS_MULTIPLIER: 2,
  PROGRESS_UPDATE_INTERVAL: 2000,
  WORKER_TIMEOUT_MS: 300000,
};

export const UI_CONFIG = {
  PLACEHOLDER_COUNT: 6,
  HOURS_IN_DAY: 24,
  TOAST_DURATION: 3000,
};

export const SCAN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  INTERRUPTED: 'interrupted',
  DISCOVERY_INTERRUPTED: 'discovery_interrupted',
  SCANNING_INTERRUPTED: 'scanning_interrupted',
  ERROR: 'error',
  STOPPED: 'stopped',
};

export const STAGE_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  INTERRUPTED: 'interrupted',
};

export const FILE_EXTENSIONS = {
  HTML: 'html',
  JSON: 'json',
};

export const ERROR_MESSAGES = {
  SCAN_ALREADY_ACTIVE: 'Scan already in progress by another user. Please wait for it to complete.',
  SCAN_LOCK_FAILED: 'Failed to acquire scan lock',
  INITIALIZATION_FAILED: 'Failed to initialize Media Library',
  DA_SDK_MISSING: 'DA SDK not available. Make sure you are running this plugin within the DA Admin environment.',
  CONTEXT_MISSING: 'Failed to get DA context, actions, or token from SDK',
};

export const STORAGE_KEYS = {
  SCAN_LOCK: 'da_media_scan_lock',
  SCAN_STATE: 'da_media_scan_state',
  SCAN_RESULTS: 'da_media_scan_results',
  DISCOVERY_QUEUE: 'da_media_discovery_queue',
  BACKGROUND_STATE: 'discoveryState',
};

export const DB_CONFIG = {
  NAME: 'MediaLibraryBackground',
  VERSION: 1,
  STORES: {
    BACKGROUND_STATE: 'backgroundState',
    MEDIA_ASSETS: 'mediaAssets',
  },
};