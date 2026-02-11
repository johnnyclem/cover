/**
 * Escape XML special characters in attribute values.
 */
function escapeXmlAttr(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
/**
 * Check if a file path matches a simple glob pattern.
 * Supports * (any segment) and ** (any path).
 */
function matchesPattern(filePath, pattern) {
    const regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '___DOUBLESTAR___')
        .replace(/\*/g, '[^/]*')
        .replace(/___DOUBLESTAR___/g, '.*');
    return new RegExp(`^${regexStr}$`).test(filePath);
}
/**
 * Generate SonarQube Generic Coverage XML from coverage data.
 *
 * Produces the exact same XML format as xccov-to-sonarqube.sh:
 *
 * ```xml
 * <coverage version="1">
 *   <file path="path/to/File.swift">
 *     <lineToCover lineNumber="10" covered="true"/>
 *     <lineToCover lineNumber="11" covered="false"/>
 *   </file>
 * </coverage>
 * ```
 *
 * @param coverageData - Map of file paths to their line coverage data
 * @param options - Export options (strip prefix, include/exclude patterns)
 * @returns SonarQube Generic Coverage XML string
 */
export function generateSonarQubeXml(coverageData, options = {}) {
    const { stripPrefix, includePatterns, excludePatterns } = options;
    const lines = [];
    lines.push('<coverage version="1">');
    // Sort files for deterministic output
    const sortedFiles = [...coverageData.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [filePath, coverage] of sortedFiles) {
        // Apply include/exclude filters
        if (includePatterns && includePatterns.length > 0) {
            if (!includePatterns.some(p => matchesPattern(filePath, p))) {
                continue;
            }
        }
        if (excludePatterns && excludePatterns.length > 0) {
            if (excludePatterns.some(p => matchesPattern(filePath, p))) {
                continue;
            }
        }
        // Apply prefix stripping
        let outputPath = filePath;
        if (stripPrefix && outputPath.startsWith(stripPrefix)) {
            outputPath = outputPath.slice(stripPrefix.length);
        }
        // Skip files with no executable lines
        if (coverage.executableLines.size === 0) {
            continue;
        }
        lines.push(`  <file path="${escapeXmlAttr(outputPath)}">`);
        // Sort line numbers for deterministic output
        const sortedLines = [...coverage.executableLines].sort((a, b) => a - b);
        for (const lineNum of sortedLines) {
            const covered = coverage.coveredLines.has(lineNum);
            lines.push(`    <lineToCover lineNumber="${lineNum}" covered="${covered}"/>`);
        }
        lines.push('  </file>');
    }
    lines.push('</coverage>');
    return lines.join('\n');
}
