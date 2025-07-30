
/**
 * Media Library Constants
 * Centralized constants for DA storage paths and configuration
 */

export const CONTENT_DA_LIVE_BASE = 'https://content.da.live';

export const DA_STORAGE = {
  DIR: '.media',
  PAGES_DIR: '.media/.pages',
  PROCESSING_DIR: '.media/.processing',
  SESSIONS_DIR: '.media/.sessions',
  FILES: {
    DISCOVERY_QUEUE: 'media-discovery-queue.json',
    SCAN_RESULTS: 'media-scan-results.json',
    MEDIA_DATA: 'media.json',
    CONFIG: 'config.json',
    SESSION_STATE: 'session-state.json',
    DISCOVERY_PROGRESS: 'discovery-progress.json',
    SCANNING_PROGRESS: 'scanning-progress.json',
    ACTIVE_SESSIONS: 'active-sessions.json',
    DISCOVERY_CHECKPOINT: 'discovery-checkpoint.json',
    SCANNING_CHECKPOINT: 'scanning-checkpoint.json',
    UPLOAD_CHECKPOINT: 'upload-checkpoint.json',
    SESSION_CHECKPOINT: 'session-checkpoint.json',
    SESSION_STATUS: 'session-status.json',
    SESSION_HISTORY: 'session-history.json',
    STRUCTURE_BASELINE: 'structure-baseline.json',
  },
};

export const DA_PATHS = {
  getStorageDir: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}`,
  getDiscoveryQueueFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.DISCOVERY_QUEUE}`,
  getScanResultsFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.SCAN_RESULTS}`,
  getMediaDataFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.MEDIA_DATA}`,
  getConfigFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.CONFIG}`,
  getProcessingDir: (org, repo) => `/${org}/${repo}/${DA_STORAGE.PROCESSING_DIR}`,
  getSessionsDir: (org, repo) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}`,
  getSessionStateFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/${DA_STORAGE.FILES.SESSION_STATE}`,
  getDiscoveryProgressFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.PROCESSING_DIR}/${DA_STORAGE.FILES.DISCOVERY_PROGRESS}`,
  getScanningProgressFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.PROCESSING_DIR}/${DA_STORAGE.FILES.SCANNING_PROGRESS}`,
  getActiveSessionsFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/${DA_STORAGE.FILES.ACTIVE_SESSIONS}`,
  getDiscoveryCheckpointFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.PROCESSING_DIR}/${DA_STORAGE.FILES.DISCOVERY_CHECKPOINT}`,
  getScanningCheckpointFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.PROCESSING_DIR}/${DA_STORAGE.FILES.SCANNING_CHECKPOINT}`,
  getUploadCheckpointFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.PROCESSING_DIR}/${DA_STORAGE.FILES.UPLOAD_CHECKPOINT}`,
  getSessionFile: (org, repo, sessionId) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/session-${sessionId}.json`,
  getSessionCheckpointFile: (org, repo, sessionId) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/session-checkpoint-${sessionId}.json`,
  getSessionStatusFile: (org, repo, sessionId) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/session-status-${sessionId}.json`,
  getSessionHistoryFile: (org, repo, sessionId) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/session-history-${sessionId}.json`,
  getStructureBaselineFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.STRUCTURE_BASELINE}`,
};

export const SCAN_CONFIG = {
  HEARTBEAT_INTERVAL_MS: 30000,
  STALE_LOCK_THRESHOLD_MS: 5 * 60 * 1000,
  MAX_WORKERS: 4,
  BATCH_SIZE: 10,
  PROGRESS_UPDATE_INTERVAL: 2000,
  POLLING_INTERVAL: 10000,
  MEDIA_POLLING_INTERVAL: 5000,
};

// Core processing configuration
export const PROCESSING_CONFIG = {
  HEARTBEAT_INTERVAL: 5000, // 5 seconds
  STALE_SESSION_THRESHOLD: 5 * 60 * 1000, // 5 minutes
  SESSION_CLEANUP_INTERVAL: 60 * 1000, // 1 minute
  MAX_CONCURRENT_SESSIONS: 5,
  CHECKPOINT_INTERVAL: 30 * 1000, // 30 seconds
  CHANGE_DETECTION_INTERVAL: 30 * 1000, // 30 seconds
  PROGRESS_UPDATE_INTERVAL: 2000, // 2 seconds
};

export const PROCESSING_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
  PROCESSING: 'processing',
  UPLOADING: 'uploading',
  UPLOAD_PAUSED: 'upload_paused',
  UPLOAD_FAILED: 'upload_failed',
};

export const SESSION_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  STALE: 'stale',
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
  SESSION_CONFLICT: 'Another user is already processing. Coordinating sessions...',
  SESSION_STALE: 'Previous session was stale. Starting fresh session.',
};

export const STORAGE_KEYS = {
  SCAN_LOCK: 'da_media_scan_lock',
  SCAN_STATE: 'da_media_scan_state',
  SCAN_RESULTS: 'da_media_scan_results',
  DISCOVERY_QUEUE: 'da_media_discovery_queue',
  BACKGROUND_STATE: 'discoveryState',
  SESSION_ID: 'da_media_session_id',
  USER_ID: 'da_media_user_id',
  BROWSER_ID: 'da_media_browser_id',
};

export const DB_CONFIG = {
  NAME: 'MediaLibraryBackground',
  VERSION: 1,
  STORES: {
    BACKGROUND_STATE: 'backgroundState',
    MEDIA_MEDIA: 'mediaMedia',
  },
};

export const UPLOAD_CONFIG = {
  BATCH_SIZE: 20,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 2000,
  CONFIRMATION_DELAY_MS: 500,
  PROGRESS_UPDATE_INTERVAL: 1000,
  MAX_CONCURRENT_BATCHES: 1,
};

export const LOCALSTORAGE_KEYS = {
  CHECKPOINT: 'media-discovery-checkpoint',
  DISCOVERY_PROGRESS: 'media-discovery-progress',
  DISCOVERY_CHECKPOINT: 'media-discovery-checkpoint',
  SCANNING_CHECKPOINT: 'media-scanning-checkpoint',
  UPLOAD_CHECKPOINT: 'media-upload-checkpoint',
};

export const SESSION_PREFIX = 'session_';

export const DISCOVERY_FILE_NAMING = {
  FOLDER_BASED: true,
  SESSION_BASED: false,
};