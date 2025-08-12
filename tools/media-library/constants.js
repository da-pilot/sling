
/**
 * Media Library Constants
 * Centralized constants for media types and other commonly used values
 */

// DA Storage and Configuration
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
    SESSION_CHECKPOINT: 'session-checkpoint.json',
    SESSION_STATUS: 'session-status.json',
    SESSION_HISTORY: 'session-history.json',
    STRUCTURE_BASELINE: 'structure-baseline.json',
    SITE_STRUCTURE: 'site-structure.json',
    AUDIT_LOG: 'media-scan-audit.json',
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
  getSessionFile: (org, repo, sessionId) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/session-${sessionId}.json`,
  getSessionCheckpointFile: (org, repo, sessionId) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/session-checkpoint-${sessionId}.json`,
  getSessionStatusFile: (org, repo, sessionId) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/session-status-${sessionId}.json`,
  getSessionHistoryFile: (org, repo, sessionId) => `/${org}/${repo}/${DA_STORAGE.SESSIONS_DIR}/session-history-${sessionId}.json`,
  getStructureBaselineFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.STRUCTURE_BASELINE}`,
  getSiteStructureFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.DIR}/${DA_STORAGE.FILES.SITE_STRUCTURE}`,
  getAuditLogFile: (org, repo) => `/${org}/${repo}/${DA_STORAGE.PROCESSING_DIR}/${DA_STORAGE.FILES.AUDIT_LOG}`,
};

// Scan Configuration
export const SCAN_CONFIG = {
  HEARTBEAT_INTERVAL_MS: 30000,
  STALE_LOCK_THRESHOLD_MS: 5 * 60 * 1000,
  MAX_WORKERS: 4,
  BATCH_SIZE: 10,
  PROGRESS_UPDATE_INTERVAL: 2000,
  POLLING_INTERVAL: 10000,
  MEDIA_POLLING_INTERVAL: 5000,
  INITIAL_LOAD_COUNT: 20,
  PROGRESSIVE_LOAD_BATCH_SIZE: 50,
  SCAN_PROGRESS_UPDATE_INTERVAL: 5000,
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

export const DISCOVERY_TYPE = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
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
  NOT_INITIALIZED: 'Media processor not initialized',
  NO_WORKER_AVAILABLE: 'No worker available for processing',
  FILE_NOT_FOUND: 'File not found on server',
  NETWORK_ERROR: 'Network request failed',
  TIMEOUT_ERROR: 'Network request timed out',
  VALIDATION_ERROR: 'Validation failed',
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
};

export const SESSION_PREFIX = 'session_';

export const DISCOVERY_FILE_NAMING = {
  FOLDER_BASED: true,
  SESSION_BASED: false,
};

// Media Types and Related Constants
export const MEDIA_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
  DOCUMENT: 'document',
  LINK: 'link',
};

export const MEDIA_TYPE_VALUES = Object.values(MEDIA_TYPES);

export const MEDIA_TYPE_LABELS = {
  [MEDIA_TYPES.IMAGE]: 'Image',
  [MEDIA_TYPES.VIDEO]: 'Video',
  [MEDIA_TYPES.DOCUMENT]: 'Document',
  [MEDIA_TYPES.LINK]: 'Link',
};

export const MEDIA_CONTEXTS = {
  IMG_TAG: 'img-tag',
  PICTURE: 'picture',
  VIDEO_SOURCE: 'video-source',
  EXTERNAL_LINK: 'external-link',
  INTERNAL_LINK: 'internal-link',
  MEDIA_LINK: 'media-link',
  BACKGROUND: 'background',
  CSS_BACKGROUND: 'css-background',
};

export const OCCURRENCE_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
  LINK: 'link',
};

export const MEDIA_EXTENSIONS = {
  IMAGE: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff'],
  VIDEO: ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv'],
  DOCUMENT: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt'],
};

export const DEFAULT_MEDIA_TYPE = MEDIA_TYPES.IMAGE;

export const UNTITLED_MEDIA = 'Untitled Media';

export const CHECKPOINT_TYPES = {
  DISCOVERY: 'discovery',
  SCANNING: 'scanning',
  UPLOAD: 'upload',
};

export const BATCH_SIZE = {
  DEFAULT: 10,
  UPLOAD: 20,
};

export const CACHE_DURATION = {
  MEDIA_DATA: 5 * 60 * 1000, // 5 minutes
};

export const TIMEOUTS = {
  WORKER_PROCESSING: 1000,
  DISCOVERY_WAIT: 10000,
};

export const FILE_PATHS = {
  MEDIA_JSON: 'media.json',
  SITE_STRUCTURE: 'site-structure.json',
  CHANGE_HISTORY: 'change-history.json',
  STRUCTURE_BASELINE: 'structure-baseline.json',
};

export const API_ENDPOINTS = {
  SOURCE: '/source',
  LIST: '/list',
};

export const UI_STATES = {
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
  SCANNING: 'scanning',
  COMPLETED: 'completed',
};

export const FILTER_TYPES = {
  ALL: 'all',
  IMAGE: 'image',
  VIDEO: 'video',
  DOCUMENT: 'document',
  INTERNAL: 'internal',
  EXTERNAL: 'external',
  USED_ON_PAGE: 'used-on-page',
  MISSING_ALT: 'missing-alt',
  USED_MISSING_ALT: 'used-missing-alt',
};

export const SORT_TYPES = {
  DISCOVERY: 'discovery',
  NAME: 'name',
  TYPE: 'type',
  MODIFIED: 'modified',
  USAGE: 'usage',
};

export const VIEW_TYPES = {
  GRID: 'grid',
  LIST: 'list',
};

export const EVENT_TYPES = {
  MEDIA_UPDATED: 'mediaUpdated',
  SCANNING_STARTED: 'scanningStarted',
  SCANNING_COMPLETED: 'scanningCompleted',
  SCANNING_FAILED: 'scanningFailed',
  BATCH_COMPLETE: 'batchComplete',
  PAGE_SCANNED: 'pageScanned',
  MEDIA_DISCOVERED: 'mediaDiscovered',
  ERROR: 'error',
};

export const LOG_PREFIXES = {
  MEDIA_PROCESSOR: '[Media Processor]',
  MEDIA_SCAN_WORKER: '[Media Scan Worker]',
  PROCESSING_STATE_MANAGER: '[Processing State Manager]',
  DISCOVERY_COORDINATOR: '[Discovery Coordinator]',
  QUEUE_ORCHESTRATOR: '[Queue Orchestrator]',
  MEDIA_BROWSER: '[Media Browser]',
  MEDIA_INFO_MODAL: '[Media Info Modal]',
  INDEXED_DB: '[IndexedDB]',
  MEDIA_LOADER: '[Media Loader]',
  MEDIA_LIBRARY: '[Media Library]',
};

export const VALIDATION_RULES = {
  ALT_TEXT_MIN_LENGTH: 3,
  ALT_TEXT_MAX_LENGTH: 125,
  ALT_TEXT_MIN_WORDS: 2,
  TOUCH_TARGET_MIN_SIZE: 44,
  CACHE_TOLERANCE_MS: 5000,
};

export const AI_FEATURES = {
  ALT_TEXT_GENERATION: 'alt-text-generation',
  CONTEXT_ANALYSIS: 'context-analysis',
  MEDIA_DESCRIPTION: 'media-description',
};

export const ACCESSIBILITY_FEATURES = {
  ALT_TEXT: 'alt-text',
  ARIA_LABEL: 'aria-label',
  TITLE: 'title',
  CAPTIONS: 'captions',
  TRANSCRIPTS: 'transcripts',
};

export const MEDIA_PROCESSING = {
  UNTITLED_MEDIA: 'Untitled Media',
  GOOGLE_DOCS_IMAGE: 'Google Docs Image',
  SLING_LOGO_DEFAULT: 'SLING Television Logo',
  NO_CONTEXT_AVAILABLE: 'No context available',
  IMG_CONTEXT_PREFIX: 'img-',
  PICTURE_CONTEXT_PREFIX: 'picture-',
  PICTURE_SOURCE_CONTEXT_PREFIX: 'picture-source-',
  VIDEO_CONTEXT_PREFIX: 'video-',
  LINK_CONTEXT_PREFIX: 'link-',
  CSS_BACKGROUND_CONTEXT_PREFIX: 'css-bg-',
  HASH_PATTERN: /^[a-f0-9]{40,}$/i,
  GOOGLE_URLS: ['googleusercontent.com', 'docs.google.com'],
  HTML_TAG_PATTERN: /<[^>]*>/g,
  HTML_ENTITY_PATTERN: /&[a-zA-Z0-9#]+;/g,
  WHITESPACE_PATTERN: /\s+/g,
  MEDIA_PREFIX: 'media ',
  UNDERSCORE_DASH_PATTERN: /[_-]/g,
  SPACE_REPLACEMENT: ' ',
  CONTEXTUAL_TEXT_OPTIONS: {
    beforeChars: 50,
    afterChars: 50,
  },
};

export default {
  CONTENT_DA_LIVE_BASE,
  DA_STORAGE,
  DA_PATHS,
  SCAN_CONFIG,
  PROCESSING_CONFIG,
  PROCESSING_STATUS,
  SESSION_STATUS,
  WORKER_CONFIG,
  DISCOVERY_CONFIG,
  UI_CONFIG,
  SCAN_STATUS,
  STAGE_STATUS,
  FILE_EXTENSIONS,
  ERROR_MESSAGES,
  STORAGE_KEYS,
  DB_CONFIG,
  UPLOAD_CONFIG,
  LOCALSTORAGE_KEYS,
  SESSION_PREFIX,
  DISCOVERY_FILE_NAMING,
  MEDIA_TYPES,
  MEDIA_TYPE_VALUES,
  MEDIA_TYPE_LABELS,
  MEDIA_CONTEXTS,
  OCCURRENCE_TYPES,
  MEDIA_EXTENSIONS,
  DEFAULT_MEDIA_TYPE,
  UNTITLED_MEDIA,
  CHECKPOINT_TYPES,
  BATCH_SIZE,
  CACHE_DURATION,
  TIMEOUTS,
  FILE_PATHS,
  API_ENDPOINTS,
  UI_STATES,
  FILTER_TYPES,
  SORT_TYPES,
  VIEW_TYPES,
  EVENT_TYPES,
  LOG_PREFIXES,
  VALIDATION_RULES,
  AI_FEATURES,
  ACCESSIBILITY_FEATURES,
  MEDIA_PROCESSING,
};