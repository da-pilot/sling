/**
 * Stats tracker
 * Handles progress tracking and statistics management with localStorage persistence
 */

import { createStatsManager } from '../../shared/index.js';
import { LOCALSTORAGE_KEYS } from '../../constants.js';

export default function createStatsTracker() {
  const statsManager = createStatsManager({
    totalFolders: 0,
    completedFolders: 0,
    totalDocuments: 0,
    errors: 0,
  });
  const state = {
    processingStateManager: null,
    currentSessionId: null,
  };

  /**
   * Load progress from localStorage
   * @returns {Object} Progress data from localStorage
   */
  function loadProgressFromStorage() {
    try {
      const stored = localStorage.getItem(LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT);
      if (stored) {
        const data = JSON.parse(stored);
        return {
          totalFolders: data.totalfolders || 0,
          completedFolders: data.completedfolders || 0,
          totalDocuments: data.totaldocuments || 0,
          errors: data.errors || 0,
        };
      }
    } catch (error) {
      console.warn('[Stats Tracker] Failed to load from localStorage:', error);
    }

    return {
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      errors: 0,
    };
  }

  /**
   * Save progress to localStorage
   * @param {Object} progressData - Progress data to save
   */
  function saveProgressToStorage(progressData) {
    try {
      const current = loadProgressFromStorage();
      const updated = { ...current, ...progressData, lastUpdated: Date.now() };
      localStorage.setItem(LOCALSTORAGE_KEYS.DISCOVERY_CHECKPOINT, JSON.stringify(updated));
    } catch (error) {
      console.warn('[Stats Tracker] Failed to save to localStorage:', error);
    }
  }

  /**
   * Initialize the stats tracker
   * @param {Object} processingStateManager - Processing state manager
   * @param {string} sessionId - Current session ID
   */
  function init(processingStateManager, sessionId) {
    state.processingStateManager = processingStateManager;
    state.currentSessionId = sessionId;

    // Load initial progress from localStorage
    const storedProgress = loadProgressFromStorage();
    statsManager.updateStats(storedProgress);
  }

  /**
   * Reset progress statistics
   */
  function resetProgress() {
    statsManager.resetStats();
    saveProgressToStorage({
      totalFolders: 0,
      completedFolders: 0,
      totalDocuments: 0,
      errors: 0,
    });
  }

  /**
   * Increment completed folders count
   */
  function incrementCompletedFolders() {
    statsManager.incrementStat('completedFolders');
    const stats = statsManager.getStats();
    saveProgressToStorage({
      completedFolders: stats.completedFolders,
    });
  }

  /**
   * Increment total folders count
   */
  function incrementTotalFolders() {
    statsManager.incrementStat('totalFolders');
    const stats = statsManager.getStats();
    saveProgressToStorage({
      totalFolders: stats.totalFolders,
    });
  }

  /**
   * Increment total documents count
   * @param {number} amount - Amount to increment
   */
  function incrementTotalDocuments(amount = 1) {
    statsManager.incrementStat('totalDocuments', amount);
    const stats = statsManager.getStats();
    saveProgressToStorage({
      totalDocuments: stats.totalDocuments,
    });
  }

  /**
   * Increment errors count
   */
  function incrementErrors() {
    statsManager.incrementStat('errors');
    const stats = statsManager.getStats();
    saveProgressToStorage({
      errors: stats.errors,
    });
  }

  /**
   * Set total folders count
   * @param {number} count - Total folders count
   */
  function setTotalFolders(count) {
    statsManager.setStat('totalFolders', count);
    saveProgressToStorage({
      totalFolders: count,
    });
  }

  /**
   * Set completed folders count
   * @param {number} count - Completed folders count
   */
  function setCompletedFolders(count) {
    statsManager.setStat('completedFolders', count);
    saveProgressToStorage({
      completedFolders: count,
    });
  }

  /**
   * Set total documents count
   * @param {number} count - Total documents count
   */
  function setTotalDocuments(count) {
    statsManager.setStat('totalDocuments', count);
    saveProgressToStorage({
      totalDocuments: count,
    });
  }

  /**
   * Get current progress statistics from localStorage
   * @returns {Object} Progress statistics
   */
  function getProgress() {
    return loadProgressFromStorage();
  }

  /**
   * Get progress summary
   * @returns {Object} Progress summary
   */
  function getProgressSummary() {
    const stats = loadProgressFromStorage();
    const summary = { ...stats };
    if (stats.completedFolders !== undefined && stats.totalFolders !== undefined) {
      summary.folderProgress = stats.totalFolders > 0
        ? Math.round((stats.completedFolders / stats.totalFolders) * 100)
        : 0;
    }
    return summary;
  }

  /**
   * Calculate completion percentage
   * @returns {number} Completion percentage
   */
  function calculateCompletionPercentage() {
    const stats = loadProgressFromStorage();
    if (stats.totalFolders === 0) return 0;
    return Math.round((stats.completedFolders / stats.totalFolders) * 100);
  }

  /**
   * Get discovery statistics
   * @returns {Object} Discovery statistics
   */
  function getDiscoveryStats() {
    const stats = loadProgressFromStorage();
    return {
      totalFolders: stats.totalFolders,
      completedFolders: stats.completedFolders,
      totalDocuments: stats.totalDocuments,
      errors: stats.errors,
      completionPercentage: calculateCompletionPercentage(),
      isComplete: stats.completedFolders >= stats.totalFolders && stats.totalFolders > 0,
    };
  }

  /**
   * Update progress with new data
   * @param {Object} progressData - Progress data to update
   */
  function updateProgress(progressData) {
    if (progressData.totalFolders !== undefined) {
      setTotalFolders(progressData.totalFolders);
    }
    if (progressData.completedFolders !== undefined) {
      setCompletedFolders(progressData.completedFolders);
    }
    if (progressData.totalDocuments !== undefined) {
      setTotalDocuments(progressData.totalDocuments);
    }
    if (progressData.errors !== undefined) {
      statsManager.setStat('errors', progressData.errors);
      saveProgressToStorage({
        errors: progressData.errors,
      });
    }
  }

  /**
   * Get session information
   * @returns {Object} Session information
   */
  function getSessionInfo() {
    return {
      sessionId: state.currentSessionId,
      processingStateManager: state.processingStateManager,
    };
  }

  return {
    init,
    resetProgress,
    incrementCompletedFolders,
    incrementTotalFolders,
    incrementTotalDocuments,
    incrementErrors,
    setTotalFolders,
    setCompletedFolders,
    setTotalDocuments,
    getProgress,
    getProgressSummary,
    calculateCompletionPercentage,
    getDiscoveryStats,
    updateProgress,
    getSessionInfo,
  };
}