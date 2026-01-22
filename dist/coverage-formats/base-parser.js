"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseCoverageParser = void 0;
const glob_1 = require("glob");
/**
 * Abstract base class for coverage format parsers.
 * Each parser implementation handles a specific coverage format.
 */
class BaseCoverageParser {
    /**
     * Check if this parser can handle the given file based on extension.
     */
    canHandle(filePath) {
        const lowerPath = filePath.toLowerCase();
        return this.fileExtensions.some(ext => lowerPath.endsWith(ext.toLowerCase()));
    }
    /**
     * Resolve glob patterns to actual file paths.
     */
    async resolveGlobs(patterns) {
        const results = [];
        for (const pattern of patterns) {
            if (pattern.includes('*')) {
                const matches = await (0, glob_1.glob)(pattern);
                results.push(...matches);
            }
            else {
                results.push(pattern);
            }
        }
        // Deduplicate
        return [...new Set(results)];
    }
    /**
     * Normalize a file path for consistent comparison.
     * Removes common prefixes and standardizes separators.
     */
    normalizePath(filePath) {
        return filePath
            .replace(/\\/g, '/') // Normalize separators
            .replace(/^\/Users\/[^/]+\//, '') // Remove /Users/username/
            .replace(/^\/private\//, '') // Remove /private/ prefix
            .replace(/^~\//, ''); // Remove ~/
    }
    /**
     * Create a LineCoverageData object with empty sets.
     */
    createEmptyLineCoverage(filePath) {
        return {
            filePath,
            coveredLines: new Set(),
            uncoveredLines: new Set(),
            executableLines: new Set(),
        };
    }
}
exports.BaseCoverageParser = BaseCoverageParser;
