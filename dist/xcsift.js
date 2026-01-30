"use strict";
/**
 * xcsift integration module for Cover.
 *
 * This module provides a wrapper around the xcsift CLI tool for parsing
 * xcodebuild and swift build/test output into structured JSON.
 *
 * It supports multiple parsing modes:
 * - CLI: Uses the xcsift binary (brew install xcsift)
 * - MCP: Uses the xcsift-mcp server via Model Context Protocol
 * - Auto: Tries CLI first, falls back to MCP if available
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isXcsiftAvailable = isXcsiftAvailable;
exports.getXcsiftVersion = getXcsiftVersion;
exports.parseWithXcsiftCLI = parseWithXcsiftCLI;
exports.parseWithXcsiftMCP = parseWithXcsiftMCP;
exports.parseOutput = parseOutput;
exports.convertErrorsToFailures = convertErrorsToFailures;
exports.convertLinkerErrorsToFailures = convertLinkerErrorsToFailures;
exports.convertTestFailuresToFailures = convertTestFailuresToFailures;
exports.convertToTestFailures = convertToTestFailures;
exports.getWarningsByFile = getWarningsByFile;
exports.getErrorsByFile = getErrorsByFile;
exports.getSlowTests = getSlowTests;
exports.isBuildSuccess = isBuildSuccess;
exports.areTestsPassing = areTestsPassing;
exports.getTotalTestCount = getTotalTestCount;
exports.parseTestTime = parseTestTime;
exports.getXcsiftConfig = getXcsiftConfig;
exports.configToParseOptions = configToParseOptions;
const execa_1 = require("execa");
const ui_1 = require("./ui");
const config_1 = require("./config");
const mcp_client_1 = require("./mcp-client");
const xcsift_types_1 = require("./xcsift-types");
// Cache xcsift availability check
let xcsiftAvailableCache = null;
/**
 * Check if xcsift CLI is available on the system.
 * Result is cached after first check.
 */
async function isXcsiftAvailable() {
    if (xcsiftAvailableCache !== null) {
        return xcsiftAvailableCache;
    }
    try {
        await (0, execa_1.execa)('which', ['xcsift']);
        xcsiftAvailableCache = true;
        return true;
    }
    catch {
        xcsiftAvailableCache = false;
        return false;
    }
}
/**
 * Get xcsift version string.
 */
async function getXcsiftVersion() {
    try {
        const { stdout } = await (0, execa_1.execa)('xcsift', ['--version']);
        return stdout.trim();
    }
    catch {
        return null;
    }
}
/**
 * Build CLI arguments from parse options.
 */
function buildXcsiftArgs(options) {
    const args = [];
    if (options.includeWarnings) {
        args.push('-w');
    }
    if (options.warningsAsErrors) {
        args.push('-W');
    }
    if (options.includeCoverage) {
        args.push('-c');
        if (options.includeCoverageDetails) {
            args.push('--coverage-details');
        }
        if (options.coveragePath) {
            args.push('--coverage-path', options.coveragePath);
        }
    }
    if (options.includeBuildInfo) {
        args.push('--build-info');
    }
    if (options.includeExecutables) {
        args.push('-e');
    }
    if (options.slowThreshold !== undefined && options.slowThreshold > 0) {
        args.push('--slow-threshold', options.slowThreshold.toString());
    }
    if (options.format === 'toon') {
        args.push('-f', 'toon');
    }
    if (options.quiet) {
        args.push('-q');
    }
    return args;
}
/**
 * Parse xcodebuild/swift output using the xcsift CLI tool.
 *
 * @param rawOutput - Raw stdout/stderr from xcodebuild or swift command
 * @param options - Parser options
 * @returns Structured parse result
 */
async function parseWithXcsiftCLI(rawOutput, options = {}) {
    const args = buildXcsiftArgs(options);
    try {
        const { stdout } = await (0, execa_1.execa)('xcsift', args, {
            input: rawOutput,
            timeout: 60000, // 60 second timeout
            reject: false // Don't throw on non-zero exit
        });
        if (!stdout || stdout.trim() === '') {
            // Empty output - likely no meaningful content to parse
            return createEmptyResult('success');
        }
        const result = JSON.parse(stdout);
        return result;
    }
    catch (error) {
        // Parse error or xcsift failed
        ui_1.logger.warn(`xcsift CLI parsing failed: ${error.message}`);
        return createEmptyResult('failed');
    }
}
/**
 * Parse xcodebuild/swift output using xcsift-mcp server.
 *
 * This is an optional integration that uses the MCP protocol.
 * Returns null if MCP is not available.
 *
 * @param rawOutput - Raw stdout/stderr from xcodebuild or swift command
 * @param options - Parser options
 * @returns Structured parse result, or null if MCP not available
 */
async function parseWithXcsiftMCP(rawOutput, options = {}) {
    const config = (0, config_1.loadConfig)();
    const xcsiftConfig = getXcsiftConfig(config);
    const command = xcsiftConfig.mcpCommand || 'xcsift-mcp';
    const args = xcsiftConfig.mcpArgs || [];
    const client = new mcp_client_1.MCPClient(command, args);
    const connected = await client.connect();
    if (!connected) {
        return null;
    }
    try {
        const result = await client.callTool('parse_xcodebuild_output', {
            output: rawOutput,
            format: options.format || 'json',
            include_warnings: options.includeWarnings,
            include_coverage: options.includeCoverage
        });
        if (!result || !result.content || result.content.length === 0) {
            return null;
        }
        const contentItem = result.content[0];
        if (contentItem.type !== 'text') {
            return null;
        }
        return JSON.parse(contentItem.text);
    }
    catch (error) {
        ui_1.logger.warn(`xcsift MCP parsing failed: ${error.message}`);
        return null;
    }
    finally {
        await client.close();
    }
}
/**
 * Parse xcodebuild/swift output with automatic mode selection.
 *
 * Tries the best available parser based on the mode:
 * - 'cli': Only uses xcsift CLI
 * - 'mcp': Only uses xcsift-mcp server
 * - 'auto': Tries CLI first, falls back to MCP
 *
 * @param rawOutput - Raw stdout/stderr from xcodebuild or swift command
 * @param options - Parser options
 * @param mode - Parser mode selection
 * @returns Structured parse result
 */
async function parseOutput(rawOutput, options = {}, mode = 'auto') {
    // MCP-only mode
    if (mode === 'mcp') {
        const mcpResult = await parseWithXcsiftMCP(rawOutput, options);
        if (mcpResult) {
            return mcpResult;
        }
        ui_1.logger.warn('xcsift-mcp not available');
        return createEmptyResult('failed');
    }
    // CLI or auto mode - try CLI first
    if (mode === 'cli' || mode === 'auto') {
        if (await isXcsiftAvailable()) {
            return parseWithXcsiftCLI(rawOutput, options);
        }
        if (mode === 'cli') {
            ui_1.logger.warn('xcsift CLI not found. Install with: brew install xcsift');
            return createEmptyResult('failed');
        }
        // Auto mode - CLI not available, try MCP
        ui_1.logger.info('xcsift CLI not found, trying MCP fallback...');
        const mcpResult = await parseWithXcsiftMCP(rawOutput, options);
        if (mcpResult) {
            return mcpResult;
        }
        ui_1.logger.warn('Neither xcsift CLI nor MCP available. Install xcsift with: brew install xcsift');
    }
    return createEmptyResult('failed');
}
/**
 * Create an empty/default xcsift result.
 */
function createEmptyResult(status) {
    return {
        status,
        summary: {
            errors: 0,
            warnings: 0,
            failed_tests: 0,
            linker_errors: 0
        }
    };
}
// === Conversion Functions ===
/**
 * Convert xcsift errors to Cover's TestFailure format.
 * Used for build failures (compiler errors).
 */
function convertErrorsToFailures(errors) {
    return errors.map(error => ({
        testCaseName: 'Build Failure',
        message: error.message,
        fileName: error.file,
        lineNumber: error.line
    }));
}
/**
 * Convert xcsift linker errors to Cover's TestFailure format.
 */
function convertLinkerErrorsToFailures(linkerErrors) {
    return linkerErrors.map(error => ({
        testCaseName: 'Linker Failure',
        message: error.message,
        fileName: error.file || error.symbol || 'Unknown',
        lineNumber: 0
    }));
}
/**
 * Convert xcsift test failures to Cover's TestFailure format.
 */
function convertTestFailuresToFailures(testFailures) {
    return testFailures.map(failure => ({
        testCaseName: failure.test,
        message: failure.message,
        fileName: failure.file,
        lineNumber: failure.line
    }));
}
/**
 * Convert all failures from an xcsift result to Cover's TestFailure format.
 * Combines compiler errors, linker errors, and test failures.
 */
function convertToTestFailures(result) {
    const failures = [];
    // Add compiler errors
    if (result.errors && result.errors.length > 0) {
        failures.push(...convertErrorsToFailures(result.errors));
    }
    // Add linker errors
    if (result.linker_errors && result.linker_errors.length > 0) {
        failures.push(...convertLinkerErrorsToFailures(result.linker_errors));
    }
    // Add test failures
    if (result.failed_tests && result.failed_tests.length > 0) {
        failures.push(...convertTestFailuresToFailures(result.failed_tests));
    }
    return failures;
}
// === Analysis Helpers ===
/**
 * Get warnings grouped by file.
 */
function getWarningsByFile(result) {
    const byFile = new Map();
    for (const warning of result.warnings || []) {
        const existing = byFile.get(warning.file) || [];
        existing.push(warning);
        byFile.set(warning.file, existing);
    }
    return byFile;
}
/**
 * Get errors grouped by file.
 */
function getErrorsByFile(result) {
    const byFile = new Map();
    for (const error of result.errors || []) {
        const existing = byFile.get(error.file) || [];
        existing.push(error);
        byFile.set(error.file, existing);
    }
    return byFile;
}
/**
 * Get slow tests from the result.
 */
function getSlowTests(result) {
    return result.slow_tests || [];
}
/**
 * Check if the build succeeded (no errors, no linker errors).
 */
function isBuildSuccess(result) {
    return result.status === 'success' &&
        result.summary.errors === 0 &&
        result.summary.linker_errors === 0;
}
/**
 * Check if all tests passed.
 */
function areTestsPassing(result) {
    return result.summary.failed_tests === 0;
}
/**
 * Get total test count (passed + failed).
 */
function getTotalTestCount(result) {
    const passed = result.summary.passed_tests || 0;
    const failed = result.summary.failed_tests || 0;
    return passed + failed;
}
/**
 * Parse test time string to seconds.
 * Handles formats like "2.503s", "1m 30s", etc.
 */
function parseTestTime(timeString) {
    if (!timeString)
        return null;
    // Simple seconds format: "2.503s"
    const secondsMatch = timeString.match(/^([\d.]+)s$/);
    if (secondsMatch) {
        return parseFloat(secondsMatch[1]);
    }
    // Minutes and seconds: "1m 30s" or "1m30s"
    const minSecMatch = timeString.match(/^(\d+)m\s*(\d+(?:\.\d+)?)s$/);
    if (minSecMatch) {
        return parseInt(minSecMatch[1]) * 60 + parseFloat(minSecMatch[2]);
    }
    return null;
}
// === Config Helpers ===
/**
 * Get xcsift configuration from Cover config or use defaults.
 */
function getXcsiftConfig(coverConfig) {
    const xcsiftConfig = coverConfig?.xcsift;
    if (!xcsiftConfig) {
        return xcsift_types_1.DEFAULT_XCSIFT_CONFIG;
    }
    return {
        enabled: xcsiftConfig.enabled ?? xcsift_types_1.DEFAULT_XCSIFT_CONFIG.enabled,
        mode: xcsiftConfig.mode ?? xcsift_types_1.DEFAULT_XCSIFT_CONFIG.mode,
        slowThreshold: xcsiftConfig.slowThreshold ?? xcsift_types_1.DEFAULT_XCSIFT_CONFIG.slowThreshold,
        includeWarnings: xcsiftConfig.includeWarnings ?? xcsift_types_1.DEFAULT_XCSIFT_CONFIG.includeWarnings,
        includeBuildInfo: xcsiftConfig.includeBuildInfo ?? xcsift_types_1.DEFAULT_XCSIFT_CONFIG.includeBuildInfo,
        mcpCommand: xcsiftConfig.mcpCommand ?? xcsift_types_1.DEFAULT_XCSIFT_CONFIG.mcpCommand,
        mcpArgs: xcsiftConfig.mcpArgs ?? xcsift_types_1.DEFAULT_XCSIFT_CONFIG.mcpArgs
    };
}
/**
 * Convert xcsift config to parse options.
 */
function configToParseOptions(config) {
    return {
        includeWarnings: config.includeWarnings,
        includeBuildInfo: config.includeBuildInfo,
        slowThreshold: config.slowThreshold
    };
}
