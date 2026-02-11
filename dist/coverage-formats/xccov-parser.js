import { execa } from 'execa';
import { BaseCoverageParser } from './base-parser.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
/**
 * Parser for Xcode's xccov coverage format (.xcresult bundles).
 *
 * Supports two data-source modes:
 * - Archive mode (default): Uses `xccov view --archive` to match SonarQube/shell-script output
 * - JSON mode: Uses `xccov view --report --json` (legacy behavior)
 *
 * And two detail levels:
 * - Fast mode: File-level coverage only (default, fast)
 * - Full mode: Line-level coverage (slower, more accurate)
 */
export class XccovParser extends BaseCoverageParser {
    format = 'xccov';
    fileExtensions = ['.xcresult'];
    cacheDir = path.join(os.homedir(), '.cover', 'xccov-cache');
    async parse(artifactPaths, options = {}) {
        const result = new Map();
        const { fast = true, useCache = true, verbose = false, useArchive = true } = options;
        for (const xcresultPath of artifactPaths) {
            if (verbose) {
                console.log(`Parsing xccov artifact: ${xcresultPath} (mode: ${useArchive ? 'archive' : 'json'})`);
            }
            if (useArchive) {
                await this.parseArchiveMode(xcresultPath, result, { fast, useCache, verbose });
            }
            else {
                await this.parseJsonMode(xcresultPath, result, { fast, useCache, verbose });
            }
        }
        return result;
    }
    /**
     * Archive mode: uses `xccov view --archive --file-list` and `xccov view --archive --file`
     * to match the behavior of xccov-to-sonarqube.sh.
     */
    async parseArchiveMode(xcresultPath, result, options) {
        const { fast, useCache, verbose } = options;
        const fileList = await this.getFileListFromArchive(xcresultPath, verbose);
        if (fileList.length === 0) {
            if (verbose) {
                console.log(`No files found in archive for ${xcresultPath}`);
            }
            return;
        }
        if (verbose) {
            console.log(`Archive file list: ${fileList.length} files`);
        }
        for (const filePath of fileList) {
            if (fast) {
                // Fast mode: just record that the file exists, no line data
                const coverage = this.createEmptyLineCoverage(filePath);
                result.set(filePath, coverage);
            }
            else {
                // Full mode: get line-level coverage from archive
                const lineCoverage = await this.getFileCoverageFromArchive(xcresultPath, filePath, useCache, verbose);
                if (lineCoverage) {
                    result.set(filePath, lineCoverage);
                }
            }
        }
    }
    /**
     * JSON mode: uses `xccov view --report --json` (legacy behavior).
     */
    async parseJsonMode(xcresultPath, result, options) {
        const { fast, useCache, verbose } = options;
        const report = await this.getReport(xcresultPath);
        if (!report?.targets) {
            if (verbose) {
                console.log(`No targets found in ${xcresultPath}`);
            }
            return;
        }
        for (const target of report.targets) {
            if (!target.files)
                continue;
            for (const file of target.files) {
                const filePath = file.path;
                if (fast) {
                    // Fast mode: use file-level coverage, estimate lines
                    const coverage = this.createEmptyLineCoverage(filePath);
                    coverage.coveredLines = new Set();
                    coverage.uncoveredLines = new Set();
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
    /**
     * Get the list of files from the coverage archive.
     * Equivalent to: xcrun xccov view --archive --file-list <xcresult>
     */
    async getFileListFromArchive(xcresultPath, verbose) {
        try {
            const { stdout } = await execa('xcrun', [
                'xccov', 'view', '--archive', '--file-list', xcresultPath
            ]);
            return stdout.trim().split('\n').filter(line => line.length > 0);
        }
        catch (error) {
            if (verbose) {
                console.error(`Failed to get file list from archive ${xcresultPath}:`, error);
            }
            return [];
        }
    }
    /**
     * Get line-level coverage for a file from the archive using plain-text output.
     * Equivalent to: xcrun xccov view --archive --file <file> <xcresult>
     *
     * Parses the text output format where each line looks like:
     *   <line_number>: <execution_count>|<source>
     * Lines with count 0 are uncovered, count >= 1 are covered.
     * Lines without a numeric count prefix are non-executable.
     */
    async getFileCoverageFromArchive(xcresultPath, filePath, useCache, verbose) {
        // Check cache first
        if (useCache) {
            const cached = await this.loadFromCache(xcresultPath, filePath, 'archive');
            if (cached) {
                if (verbose) {
                    console.log(`Cache hit (archive) for ${filePath}`);
                }
                return cached;
            }
        }
        try {
            if (verbose) {
                console.log(`Fetching archive line coverage for ${filePath}`);
            }
            const { stdout } = await execa('xcrun', [
                'xccov', 'view', '--archive', '--file', filePath, xcresultPath
            ]);
            const coverage = this.parseArchiveTextOutput(filePath, stdout);
            // Cache the result
            if (useCache) {
                await this.saveToCache(xcresultPath, filePath, coverage, 'archive');
            }
            return coverage;
        }
        catch (error) {
            if (verbose) {
                console.error(`Failed to get archive line coverage for ${filePath}:`, error);
            }
            return null;
        }
    }
    /**
     * Parse the plain-text output from `xccov view --archive --file`.
     *
     * Each line in the output has the format:
     *   <line_number>: <execution_count_or_blank>|<source_code>
     *
     * The sed patterns from the shell script:
     *   s/^ *([0-9]+): 0.*$/covered="false"/   -> line with count 0 = uncovered
     *   s/^ *([0-9]+): [1-9].*$/covered="true"/ -> line with count >= 1 = covered
     *
     * Lines where the count field is blank or '*' are non-executable.
     */
    parseArchiveTextOutput(filePath, output) {
        const coverage = this.createEmptyLineCoverage(filePath);
        for (const line of output.split('\n')) {
            // Match lines like: "   42: 0  ..." (uncovered) or "   42: 5  ..." (covered)
            // The format is: optional spaces, line number, colon, space, execution count
            const match = line.match(/^\s*(\d+):\s+(\d+)/);
            if (!match)
                continue;
            const lineNum = parseInt(match[1], 10);
            const execCount = parseInt(match[2], 10);
            coverage.executableLines.add(lineNum);
            if (execCount === 0) {
                coverage.uncoveredLines.add(lineNum);
            }
            else {
                coverage.coveredLines.add(lineNum);
            }
        }
        return coverage;
    }
    /**
     * Get the full coverage report from xcresult (JSON mode).
     */
    async getReport(xcresultPath) {
        try {
            const { stdout } = await execa('xcrun', [
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
     * Get line-level coverage for a specific file (JSON mode).
     * Uses caching to avoid repeated expensive xccov calls.
     */
    async getFileCoverage(xcresultPath, filePath, useCache, verbose) {
        // Check cache first
        if (useCache) {
            const cached = await this.loadFromCache(xcresultPath, filePath, 'json');
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
            const { stdout } = await execa('xcrun', [
                'xccov', 'view', '--file', filePath, '--json', xcresultPath
            ]);
            const lineData = JSON.parse(stdout);
            const coverage = this.parseLineData(filePath, lineData);
            // Cache the result
            if (useCache) {
                await this.saveToCache(xcresultPath, filePath, coverage, 'json');
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
     * Includes mode to avoid cache collisions between archive and json modes.
     */
    getCacheKey(xcresultPath, filePath, mode = 'json') {
        const stat = fs.statSync(xcresultPath);
        const content = `${mode}:${xcresultPath}:${stat.mtimeMs}:${filePath}`;
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    }
    /**
     * Get cache file path for a given key.
     */
    getCachePath(key) {
        return path.join(this.cacheDir, `${key}.json`);
    }
    /**
     * Load coverage data from cache.
     */
    async loadFromCache(xcresultPath, filePath, mode = 'json') {
        try {
            const key = this.getCacheKey(xcresultPath, filePath, mode);
            const cachePath = this.getCachePath(key);
            if (!fs.existsSync(cachePath)) {
                return null;
            }
            const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
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
    async saveToCache(xcresultPath, filePath, coverage, mode = 'json') {
        try {
            // Ensure cache directory exists
            if (!fs.existsSync(this.cacheDir)) {
                fs.mkdirSync(this.cacheDir, { recursive: true });
            }
            const key = this.getCacheKey(xcresultPath, filePath, mode);
            const cachePath = this.getCachePath(key);
            // Convert Sets to arrays for JSON serialization
            const data = {
                filePath: coverage.filePath,
                coveredLines: [...coverage.coveredLines],
                uncoveredLines: [...coverage.uncoveredLines],
                executableLines: [...coverage.executableLines],
            };
            fs.writeFileSync(cachePath, JSON.stringify(data));
        }
        catch {
            // Silently fail cache writes
        }
    }
    /**
     * Clear the xccov cache.
     */
    async clearCache() {
        if (fs.existsSync(this.cacheDir)) {
            fs.rmSync(this.cacheDir, { recursive: true });
        }
    }
}
