"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XccovParser = void 0;
const execa_1 = require("execa");
const base_parser_1 = require("./base-parser");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
/**
 * Parser for Xcode's xccov coverage format (.xcresult bundles).
 *
 * Supports two modes:
 * - Fast mode: File-level coverage only (default, fast)
 * - Full mode: Line-level coverage (slower, more accurate)
 */
class XccovParser extends base_parser_1.BaseCoverageParser {
    format = 'xccov';
    fileExtensions = ['.xcresult'];
    cacheDir = path_1.default.join(os_1.default.homedir(), '.cover', 'xccov-cache');
    async parse(artifactPaths, options = {}) {
        const result = new Map();
        const { fast = true, useCache = true, verbose = false } = options;
        for (const xcresultPath of artifactPaths) {
            if (verbose) {
                console.log(`Parsing xccov artifact: ${xcresultPath}`);
            }
            // Get file list from xcresult
            const report = await this.getReport(xcresultPath);
            if (!report?.targets) {
                if (verbose) {
                    console.log(`No targets found in ${xcresultPath}`);
                }
                continue;
            }
            for (const target of report.targets) {
                if (!target.files)
                    continue;
                for (const file of target.files) {
                    const filePath = file.path;
                    if (fast) {
                        // Fast mode: use file-level coverage, estimate lines
                        const coverage = this.createEmptyLineCoverage(filePath);
                        // In fast mode, we don't have line-level data
                        // Mark file as having coverage data but no line details
                        coverage.coveredLines = new Set(); // Empty - no line data
                        coverage.uncoveredLines = new Set();
                        // Store file-level percentage in a way we can use later
                        coverage.fileLevelCoverage = (file.lineCoverage || 0) * 100;
                        result.set(filePath, coverage);
                    }
                    else {
                        // Full mode: get line-level coverage
                        const lineCoverage = await this.getFileCoverage(xcresultPath, filePath, useCache, verbose);
                        if (lineCoverage) {
                            result.set(filePath, lineCoverage);
                        }
                    }
                }
            }
        }
        return result;
    }
    /**
     * Get the full coverage report from xcresult.
     */
    async getReport(xcresultPath) {
        try {
            const { stdout } = await (0, execa_1.execa)('xcrun', [
                'xccov', 'view', '--report', '--json', xcresultPath
            ]);
            return JSON.parse(stdout);
        }
        catch (error) {
            console.error(`Failed to get coverage report from ${xcresultPath}:`, error);
            return null;
        }
    }
    /**
     * Get line-level coverage for a specific file.
     * Uses caching to avoid repeated expensive xccov calls.
     */
    async getFileCoverage(xcresultPath, filePath, useCache, verbose) {
        // Check cache first
        if (useCache) {
            const cached = await this.loadFromCache(xcresultPath, filePath);
            if (cached) {
                if (verbose) {
                    console.log(`Cache hit for ${filePath}`);
                }
                return cached;
            }
        }
        try {
            if (verbose) {
                console.log(`Fetching line coverage for ${filePath}`);
            }
            // Get line-level coverage using xccov
            const { stdout } = await (0, execa_1.execa)('xcrun', [
                'xccov', 'view', '--file', filePath, '--json', xcresultPath
            ]);
            const lineData = JSON.parse(stdout);
            const coverage = this.parseLineData(filePath, lineData);
            // Cache the result
            if (useCache) {
                await this.saveToCache(xcresultPath, filePath, coverage);
            }
            return coverage;
        }
        catch (error) {
            if (verbose) {
                console.error(`Failed to get line coverage for ${filePath}:`, error);
            }
            return null;
        }
    }
    /**
     * Parse xccov line-level JSON data into LineCoverageData.
     *
     * The xccov --file output format is an array of line objects:
     * [
     *   { "line": 1, "executionCount": 5, "isExecutable": true },
     *   { "line": 2, "executionCount": 0, "isExecutable": true },
     *   { "line": 3, "executionCount": null, "isExecutable": false },
     *   ...
     * ]
     */
    parseLineData(filePath, lineData) {
        const coverage = this.createEmptyLineCoverage(filePath);
        if (!Array.isArray(lineData)) {
            return coverage;
        }
        for (const line of lineData) {
            const lineNum = line.line;
            const isExecutable = line.isExecutable === true;
            const executionCount = line.executionCount;
            if (!isExecutable || lineNum === undefined) {
                continue;
            }
            coverage.executableLines.add(lineNum);
            if (executionCount !== null && executionCount > 0) {
                coverage.coveredLines.add(lineNum);
            }
            else {
                coverage.uncoveredLines.add(lineNum);
            }
        }
        return coverage;
    }
    /**
     * Generate a cache key for an xcresult + file combination.
     */
    getCacheKey(xcresultPath, filePath) {
        const stat = fs_1.default.statSync(xcresultPath);
        const content = `${xcresultPath}:${stat.mtimeMs}:${filePath}`;
        return crypto_1.default.createHash('sha256').update(content).digest('hex').substring(0, 16);
    }
    /**
     * Get cache file path for a given key.
     */
    getCachePath(key) {
        return path_1.default.join(this.cacheDir, `${key}.json`);
    }
    /**
     * Load coverage data from cache.
     */
    async loadFromCache(xcresultPath, filePath) {
        try {
            const key = this.getCacheKey(xcresultPath, filePath);
            const cachePath = this.getCachePath(key);
            if (!fs_1.default.existsSync(cachePath)) {
                return null;
            }
            const data = JSON.parse(fs_1.default.readFileSync(cachePath, 'utf-8'));
            // Reconstruct Sets from arrays
            return {
                filePath: data.filePath,
                coveredLines: new Set(data.coveredLines),
                uncoveredLines: new Set(data.uncoveredLines),
                executableLines: new Set(data.executableLines),
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Save coverage data to cache.
     */
    async saveToCache(xcresultPath, filePath, coverage) {
        try {
            // Ensure cache directory exists
            if (!fs_1.default.existsSync(this.cacheDir)) {
                fs_1.default.mkdirSync(this.cacheDir, { recursive: true });
            }
            const key = this.getCacheKey(xcresultPath, filePath);
            const cachePath = this.getCachePath(key);
            // Convert Sets to arrays for JSON serialization
            const data = {
                filePath: coverage.filePath,
                coveredLines: [...coverage.coveredLines],
                uncoveredLines: [...coverage.uncoveredLines],
                executableLines: [...coverage.executableLines],
            };
            fs_1.default.writeFileSync(cachePath, JSON.stringify(data));
        }
        catch {
            // Silently fail cache writes
        }
    }
    /**
     * Clear the xccov cache.
     */
    async clearCache() {
        if (fs_1.default.existsSync(this.cacheDir)) {
            fs_1.default.rmSync(this.cacheDir, { recursive: true });
        }
    }
}
exports.XccovParser = XccovParser;
