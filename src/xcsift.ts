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

import { execa } from 'execa';
import { logger } from './ui';
import { TestFailure } from './results';
import { loadConfig } from './config';
import { MCPClient } from './mcp-client';
import {
    XcsiftResult,
    XcsiftParseOptions,
    XcsiftMode,
    XcsiftConfig,
    XcsiftError,
    XcsiftWarning,
    XcsiftTestFailure,
    XcsiftSlowTest,
    DEFAULT_XCSIFT_CONFIG
} from './xcsift-types';

// Cache xcsift availability check
let xcsiftAvailableCache: boolean | null = null;

/**
 * Check if xcsift CLI is available on the system.
 * Result is cached after first check.
 */
export async function isXcsiftAvailable(): Promise<boolean> {
    if (xcsiftAvailableCache !== null) {
        return xcsiftAvailableCache;
    }

    try {
        await execa('which', ['xcsift']);
        xcsiftAvailableCache = true;
        return true;
    } catch {
        xcsiftAvailableCache = false;
        return false;
    }
}

/**
 * Get xcsift version string.
 */
export async function getXcsiftVersion(): Promise<string | null> {
    try {
        const { stdout } = await execa('xcsift', ['--version']);
        return stdout.trim();
    } catch {
        return null;
    }
}

/**
 * Build CLI arguments from parse options.
 */
function buildXcsiftArgs(options: XcsiftParseOptions): string[] {
    const args: string[] = [];

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
export async function parseWithXcsiftCLI(
    rawOutput: string,
    options: XcsiftParseOptions = {}
): Promise<XcsiftResult> {
    const args = buildXcsiftArgs(options);

    try {
        const { stdout } = await execa('xcsift', args, {
            input: rawOutput,
            timeout: 60000, // 60 second timeout
            reject: false   // Don't throw on non-zero exit
        });

        if (!stdout || stdout.trim() === '') {
            // Empty output - likely no meaningful content to parse
            return createEmptyResult('success');
        }

        const result = JSON.parse(stdout) as XcsiftResult;
        return result;
    } catch (error: any) {
        // Parse error or xcsift failed
        logger.warn(`xcsift CLI parsing failed: ${error.message}`);
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
export async function parseWithXcsiftMCP(
    rawOutput: string,
    options: XcsiftParseOptions = {}
): Promise<XcsiftResult | null> {
    const config = loadConfig();
    const xcsiftConfig = getXcsiftConfig(config);
    
    const command = xcsiftConfig.mcpCommand || 'xcsift-mcp';
    const args = xcsiftConfig.mcpArgs || [];

    const client = new MCPClient(command, args);
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

        return JSON.parse(contentItem.text) as XcsiftResult;
    } catch (error: any) {
        logger.warn(`xcsift MCP parsing failed: ${error.message}`);
        return null;
    } finally {
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
export async function parseOutput(
    rawOutput: string,
    options: XcsiftParseOptions = {},
    mode: XcsiftMode = 'auto'
): Promise<XcsiftResult> {
    // MCP-only mode
    if (mode === 'mcp') {
        const mcpResult = await parseWithXcsiftMCP(rawOutput, options);
        if (mcpResult) {
            return mcpResult;
        }
        logger.warn('xcsift-mcp not available');
        return createEmptyResult('failed');
    }

    // CLI or auto mode - try CLI first
    if (mode === 'cli' || mode === 'auto') {
        if (await isXcsiftAvailable()) {
            return parseWithXcsiftCLI(rawOutput, options);
        }

        if (mode === 'cli') {
            logger.warn('xcsift CLI not found. Install with: brew install xcsift');
            return createEmptyResult('failed');
        }

        // Auto mode - CLI not available, try MCP
        logger.info('xcsift CLI not found, trying MCP fallback...');
        const mcpResult = await parseWithXcsiftMCP(rawOutput, options);
        if (mcpResult) {
            return mcpResult;
        }

        logger.warn('Neither xcsift CLI nor MCP available. Install xcsift with: brew install xcsift');
    }

    return createEmptyResult('failed');
}

/**
 * Create an empty/default xcsift result.
 */
function createEmptyResult(status: 'success' | 'failed'): XcsiftResult {
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
export function convertErrorsToFailures(errors: XcsiftError[]): TestFailure[] {
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
export function convertLinkerErrorsToFailures(
    linkerErrors: Array<{ symbol?: string; message: string; file?: string }>
): TestFailure[] {
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
export function convertTestFailuresToFailures(testFailures: XcsiftTestFailure[]): TestFailure[] {
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
export function convertToTestFailures(result: XcsiftResult): TestFailure[] {
    const failures: TestFailure[] = [];

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
export function getWarningsByFile(result: XcsiftResult): Map<string, XcsiftWarning[]> {
    const byFile = new Map<string, XcsiftWarning[]>();

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
export function getErrorsByFile(result: XcsiftResult): Map<string, XcsiftError[]> {
    const byFile = new Map<string, XcsiftError[]>();

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
export function getSlowTests(result: XcsiftResult): XcsiftSlowTest[] {
    return result.slow_tests || [];
}

/**
 * Check if the build succeeded (no errors, no linker errors).
 */
export function isBuildSuccess(result: XcsiftResult): boolean {
    return result.status === 'success' &&
           result.summary.errors === 0 &&
           result.summary.linker_errors === 0;
}

/**
 * Check if all tests passed.
 */
export function areTestsPassing(result: XcsiftResult): boolean {
    return result.summary.failed_tests === 0;
}

/**
 * Get total test count (passed + failed).
 */
export function getTotalTestCount(result: XcsiftResult): number {
    const passed = result.summary.passed_tests || 0;
    const failed = result.summary.failed_tests || 0;
    return passed + failed;
}

/**
 * Parse test time string to seconds.
 * Handles formats like "2.503s", "1m 30s", etc.
 */
export function parseTestTime(timeString: string | undefined): number | null {
    if (!timeString) return null;

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
export function getXcsiftConfig(coverConfig: any): XcsiftConfig {
    const xcsiftConfig = coverConfig?.xcsift;

    if (!xcsiftConfig) {
        return DEFAULT_XCSIFT_CONFIG;
    }

    return {
        enabled: xcsiftConfig.enabled ?? DEFAULT_XCSIFT_CONFIG.enabled,
        mode: xcsiftConfig.mode ?? DEFAULT_XCSIFT_CONFIG.mode,
        slowThreshold: xcsiftConfig.slowThreshold ?? DEFAULT_XCSIFT_CONFIG.slowThreshold,
        includeWarnings: xcsiftConfig.includeWarnings ?? DEFAULT_XCSIFT_CONFIG.includeWarnings,
        includeBuildInfo: xcsiftConfig.includeBuildInfo ?? DEFAULT_XCSIFT_CONFIG.includeBuildInfo,
        mcpCommand: xcsiftConfig.mcpCommand ?? DEFAULT_XCSIFT_CONFIG.mcpCommand,
        mcpArgs: xcsiftConfig.mcpArgs ?? DEFAULT_XCSIFT_CONFIG.mcpArgs
    };
}

/**
 * Convert xcsift config to parse options.
 */
export function configToParseOptions(config: XcsiftConfig): XcsiftParseOptions {
    return {
        includeWarnings: config.includeWarnings,
        includeBuildInfo: config.includeBuildInfo,
        slowThreshold: config.slowThreshold
    };
}
