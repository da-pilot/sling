/**
 * Document mapper
 * Handles document metadata mapping and transformation
 */

export default function createDocumentMapper() {
  /**
   * Check if path matches exclude patterns
   * @param {string} path - Path to check
   * @param {Array} patterns - Patterns to match against
   * @returns {boolean} True if path matches any pattern
   */
  function matchesExcludePatterns(path, patterns) {
    return patterns.some((pattern) => {
      const pathParts = path.split('/');
      if (pathParts.length >= 3) {
        const org = pathParts[1];
        const repo = pathParts[2];
        const orgRepoPrefix = `/${org}/${repo}`;

        if (pattern.endsWith('/*')) {
          const fullPattern = `${orgRepoPrefix}${pattern}`;
          return path.startsWith(fullPattern.slice(0, -1));
        }
        return path === `${orgRepoPrefix}${pattern}`;
      }
      return false;
    });
  }

  /**
   * Map file to document metadata
   * @param {Object} file - File object from DA API
   * @returns {Object} Document metadata
   */
  function mapFileToDocument(file) {
    return {
      name: file.name,
      path: file.path,
      lastModified: file.lastModified || Date.now(),
    };
  }

  /**
   * Map multiple files to document metadata array
   * @param {Array} files - Array of file objects
   * @returns {Array} Array of document metadata
   */
  function mapFilesToDocuments(files) {
    return files.map(mapFileToDocument);
  }

  /**
   * Merge existing and new documents for incremental discovery
   * @param {Array} existingDocuments - Existing documents
   * @param {Array} newDocuments - Newly discovered documents
   * @returns {Array} Merged documents
   */
  function mergeDocuments(existingDocuments, newDocuments) {
    return [...existingDocuments, ...newDocuments];
  }

  /**
   * Filter documents based on exclude patterns
   * @param {Array} documents - Documents to filter
   * @param {Array} excludePatterns - Patterns to exclude
   * @returns {Array} Filtered documents
   */
  function filterDocumentsByPatterns(documents, excludePatterns) {
    if (!excludePatterns || excludePatterns.length === 0) {
      return documents;
    }

    return documents.filter((document) => !matchesExcludePatterns(document.path, excludePatterns));
  }

  return {
    mapFileToDocument,
    mapFilesToDocuments,
    mergeDocuments,
    filterDocumentsByPatterns,
    matchesExcludePatterns,
  };
}