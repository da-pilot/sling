/**
 * Creates a new stats manager instance
 * @param {Object} initialStats - Initial statistics object
 * @returns {Object} - Stats manager with resetStats, getStats, updateStats methods
 */
export default function createStatsManager(initialStats = {}) {
  let stats = { ...initialStats };

  function resetStats(newInitialStats = null) {
    if (newInitialStats) {
      stats = { ...newInitialStats };
    } else {
      stats = {};
    }
  }

  function getStats() {
    return { ...stats };
  }

  function updateStats(updates) {
    stats = { ...stats, ...updates };
  }

  function incrementStat(statName, amount = 1) {
    if (typeof stats[statName] === 'number') {
      stats[statName] += amount;
    } else {
      stats[statName] = amount;
    }
  }

  function decrementStat(statName, amount = 1) {
    if (typeof stats[statName] === 'number') {
      stats[statName] = Math.max(0, stats[statName] - amount);
    } else {
      stats[statName] = 0;
    }
  }

  function setStat(statName, value) {
    stats[statName] = value;
  }

  function getStat(statName) {
    return stats[statName];
  }

  function calculatePercentage(completedStat, totalStat) {
    const completed = stats[completedStat] || 0;
    const total = stats[totalStat] || 0;
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  }

  function getStatsSummary() {
    const summary = { ...stats };
    if (stats.completedFolders !== undefined && stats.totalFolders !== undefined) {
      summary.folderProgress = calculatePercentage('completedFolders', 'totalFolders');
    }
    if (stats.scannedPages !== undefined && stats.totalPages !== undefined) {
      summary.scanProgress = calculatePercentage('scannedPages', 'totalPages');
    }
    return summary;
  }

  return {
    resetStats,
    getStats,
    updateStats,
    incrementStat,
    decrementStat,
    setStat,
    getStat,
    calculatePercentage,
    getStatsSummary,
  };
}