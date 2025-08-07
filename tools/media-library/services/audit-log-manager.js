import { DA_PATHS, CONTENT_DA_LIVE_BASE } from '../constants.js';
import {
  loadDataSafe,
  buildSingleSheet,
  saveSheetFile,
  addRowToSheet,
} from '../modules/sheet-utils.js';

const ADMIN_DA_LIVE_BASE = 'https://admin.da.live';

export default function createAuditLogManager() {
  const state = {
    config: null,
    daApi: null,
  };

  /**
   * Initialize audit log manager
   * @param {Object} config - Configuration object
   * @param {Object} daApi - DA API instance
   */
  function init(config, daApi) {
    state.config = config;
    state.daApi = daApi;
  }

  /**
   * Get audit log file path
   * @returns {string} Audit log file path
   */
  function getAuditLogPath() {
    return DA_PATHS.getAuditLogFile(state.config.org, state.config.repo);
  }

  /**
   * Cleanup old audit log entries to maintain max entries limit
   * @param {number} maxEntries - Maximum number of entries to keep
   * @returns {Promise<void>}
   */
  async function cleanupOldEntries(maxEntries = 1000) {
    try {
      const auditLogPath = getAuditLogPath();
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${auditLogPath}`;
      const existingAuditLog = await loadDataSafe(contentUrl, state.config.token);
      if (existingAuditLog.data && existingAuditLog.data.length > maxEntries) {
        const sortedEntries = existingAuditLog.data.sort((a, b) => b.timestamp - a.timestamp);
        const trimmedEntries = sortedEntries.slice(0, maxEntries);
        const updatedAuditLog = buildSingleSheet(trimmedEntries);
        const adminUrl = `${ADMIN_DA_LIVE_BASE}/source${auditLogPath}`;
        await saveSheetFile(adminUrl, updatedAuditLog, state.config.token);
      }
    } catch (error) {
      throw new Error(`Failed to cleanup old audit entries: ${error.message}`);
    }
  }

  /**
   * Save audit entry to audit log
   * @param {Object} auditEntry - Audit entry to save
   * @returns {Promise<void>}
   */
  async function saveAuditEntry(auditEntry) {
    try {
      const auditLogPath = getAuditLogPath();
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${auditLogPath}`;
      const existingAuditLog = await loadDataSafe(contentUrl, state.config.token);
      const updatedAuditLog = addRowToSheet(existingAuditLog, auditEntry);
      const adminUrl = `${ADMIN_DA_LIVE_BASE}/source${auditLogPath}`;
      await saveSheetFile(adminUrl, updatedAuditLog, state.config.token);
      if (updatedAuditLog.data.length > 1000) {
        await cleanupOldEntries();
      }
    } catch (error) {
      throw new Error(`Failed to save audit entry: ${error.message}`);
    }
  }

  /**
   * Create audit log entry from discovery and scanning checkpoints
   * @param {Object} discoveryCheckpoint - Discovery checkpoint data
   * @param {Object} scanningCheckpoint - Scanning checkpoint data
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Created audit entry
   */
  async function createAuditEntry(discoveryCheckpoint, scanningCheckpoint, sessionId) {
    try {
      const discoveryDuration = discoveryCheckpoint.discoveryEndTime
        && discoveryCheckpoint.discoveryStartTime
        ? discoveryCheckpoint.discoveryEndTime - discoveryCheckpoint.discoveryStartTime
        : 0;
      const discoveryStatus = discoveryCheckpoint.status || 'unknown';
      let scanningStatus = scanningCheckpoint.status || 'unknown';
      let scanningDuration = 0;
      if (scanningCheckpoint.totalPages === 0 && scanningCheckpoint.totalMedia === 0
          && discoveryCheckpoint.discoveryType === 'incremental') {
        scanningStatus = 'skipped';
        scanningDuration = 0;
      } else {
        scanningDuration = scanningCheckpoint.scanningEndTime
          && scanningCheckpoint.scanningStartTime
          ? scanningCheckpoint.scanningEndTime - scanningCheckpoint.scanningStartTime
          : 0;
      }
      const auditEntry = {
        sessionId: sessionId === 'unknown' ? undefined : sessionId,
        discoveryType: discoveryCheckpoint.discoveryType || 'full',
        discoveryStatus,
        scanningStatus,
        discoveryDuration,
        scanningDuration,
        totalFolders: discoveryCheckpoint.totalFolders || 0,
        totalDocuments: discoveryCheckpoint.totalDocuments || 0,
        totalPages: scanningCheckpoint.totalPages || 0,
        totalMedia: scanningCheckpoint.totalMedia || 0,
        timestamp: Date.now(),
        createdAt: Date.now(),
      };
      await saveAuditEntry(auditEntry);
      return auditEntry;
    } catch (error) {
      throw new Error(`Failed to create audit entry: ${error.message}`);
    }
  }

  /**
   * Load audit log entries
   * @returns {Promise<Array>} Audit log entries
   */
  async function loadAuditLog() {
    try {
      const auditLogPath = getAuditLogPath();
      const contentUrl = `${CONTENT_DA_LIVE_BASE}${auditLogPath}`;
      const auditLog = await loadDataSafe(contentUrl, state.config.token);
      return auditLog.data || [];
    } catch (error) {
      return [];
    }
  }

  return {
    init,
    createAuditEntry,
    loadAuditLog,
    cleanupOldEntries,
  };
}
