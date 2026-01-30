"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.areAllTestsPassing = exports.isBuildSuccessful = exports.getFileErrors = exports.getFileWarnings = exports.analyzeOutput = exports.getBuildFailures = exports.getBuildFailuresLegacy = exports.getTestFailures = void 0;
const execa_1 = require("execa");
const ui_1 = require("./ui");
const xcsift_1 = require("./xcsift");
/**
 * Get test failures from an xcresult bundle.
 * Uses xcresulttool to parse the structured test results.
 */
const getTestFailures = async (xcresultPath) => {
    try {
        const { stdout } = await (0, execa_1.execa)('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', xcresultPath, '--format', 'json']);
        const json = JSON.parse(stdout);
        const failures = [];
        // Navigate the JSON soup of xcresult for new API
        const tests = json.tests || [];
        function traverseTests(items) {
            for (const item of items) {
                if (item.subtests && Array.isArray(item.subtests)) {
                    traverseTests(item.subtests);
                }
                else if (item.result === 'failed') {
                    const summaries = item.failureSummaries || [];
                    for (const summary of summaries) {
                        const message = summary.message?._value || 'Unknown failure';
                        const testCaseName = summary.testCaseName?._value || item.identifier?._value || 'Unknown Test';
                        const docLoc = summary.documentLocationInCreatingWorkspace;
                        let fileName = 'Unknown File';
                        let lineNumber = 0;
                        if (docLoc && docLoc.url && docLoc.url._value) {
                            const url = docLoc.url._value;
                            if (url.startsWith('file://')) {
                                const cleanUrl = url.replace('file://', '');
                                const [pathPart, query] = cleanUrl.split('#');
                                fileName = pathPart;
                                if (query) {
                                    const match = query.match(/StartingLineNumber=(\d+)/);
                                    if (match) {
                                        lineNumber = parseInt(match[1], 10);
                                    }
                                }
                            }
                        }
                        failures.push({
                            testCaseName,
                            message,
                            fileName,
                            lineNumber
                        });
                    }
                }
            }
        }
        traverseTests(tests);
        return failures;
    }
    catch (error) {
        ui_1.logger.error('Failed to parse test failures from xcresult.');
        return [];
    }
};
exports.getTestFailures = getTestFailures;
/**
 * Legacy synchronous build failure parser using regex.
 * Used as fallback when xcsift is not available.
 *
 * @deprecated Use getBuildFailures() instead which uses xcsift
 */
const getBuildFailuresLegacy = (log) => {
    const failures = [];
    const lines = log.split('\n');
    // Regex for standard Swift/ObjC errors: /path/to/file:line:col: error: message
    const errorRegex = /^(.+):(\d+):(\d+): error: (.+)$/;
    // Regex for linker errors: ld: ... error: ...
    const linkerRegex = /^ld: (.+)$/;
    // Regex for undefined symbol errors
    const undefinedSymbolRegex = /Undefined symbol[s]?: (.+)/;
    for (const line of lines) {
        // Check for standard compiler errors
        const errorMatch = line.match(errorRegex);
        if (errorMatch) {
            const [_, filePath, lineStr, _colStr, message] = errorMatch;
            failures.push({
                testCaseName: 'Build Failure',
                message: message.trim(),
                fileName: filePath.trim(),
                lineNumber: parseInt(lineStr, 10)
            });
            continue;
        }
        // Check for linker errors
        const linkerMatch = line.match(linkerRegex);
        if (linkerMatch) {
            failures.push({
                testCaseName: 'Linker Failure',
                message: linkerMatch[1].trim(),
                fileName: 'Linker',
                lineNumber: 0
            });
            continue;
        }
        // Check for undefined symbols
        const symbolMatch = line.match(undefinedSymbolRegex);
        if (symbolMatch) {
            failures.push({
                testCaseName: 'Linker Failure',
                message: `Undefined symbol: ${symbolMatch[1].trim()}`,
                fileName: 'Linker',
                lineNumber: 0
            });
        }
    }
    return failures;
};
exports.getBuildFailuresLegacy = getBuildFailuresLegacy;
/**
 * Parse build failures from xcodebuild/swift output log.
 *
 * Uses xcsift for structured parsing when available, with fallback to regex.
 * This is now async to support xcsift CLI calls.
 *
 * @param log - Raw output from xcodebuild or swift command
 * @param options - Optional parsing options
 * @returns Array of test failures representing build errors
 */
const getBuildFailures = async (log, options) => {
    const useXcsift = options?.useXcsift !== false;
    if (useXcsift) {
        const xcsiftAvailable = await (0, xcsift_1.isXcsiftAvailable)();
        if (xcsiftAvailable) {
            try {
                const xcsiftOptions = {
                    includeWarnings: true,
                    slowThreshold: 1.0,
                    ...options?.xcsiftOptions
                };
                const result = await (0, xcsift_1.parseOutput)(log, xcsiftOptions);
                // Check if xcsift found any errors
                const hasErrors = (result.errors?.length ?? 0) > 0;
                const hasLinkerErrors = (result.linker_errors?.length ?? 0) > 0;
                const hasTestFailures = (result.failed_tests?.length ?? 0) > 0;
                if (hasErrors || hasLinkerErrors || hasTestFailures) {
                    return (0, xcsift_1.convertToTestFailures)(result);
                }
                // xcsift ran but found nothing - might be empty or success
                // Return empty array (no failures)
                if (result.status === 'success') {
                    return [];
                }
            }
            catch (error) {
                ui_1.logger.warn(`xcsift parsing failed, falling back to regex: ${error.message}`);
            }
        }
    }
    // Fallback to legacy regex parsing
    return (0, exports.getBuildFailuresLegacy)(log);
};
exports.getBuildFailures = getBuildFailures;
/**
 * Parse build/test output with full xcsift analysis.
 * Returns extended information including warnings and slow tests.
 *
 * @param log - Raw output from xcodebuild or swift command
 * @param options - Parsing options
 * @returns Extended result with failures, warnings, and slow tests
 */
const analyzeOutput = async (log, options) => {
    const xcsiftAvailable = await (0, xcsift_1.isXcsiftAvailable)();
    if (!xcsiftAvailable) {
        // Fallback to legacy parsing
        return {
            failures: (0, exports.getBuildFailuresLegacy)(log),
            warnings: 0
        };
    }
    const xcsiftOptions = {
        includeWarnings: true,
        slowThreshold: 1.0,
        ...options
    };
    const result = await (0, xcsift_1.parseOutput)(log, xcsiftOptions);
    const failures = (0, xcsift_1.convertToTestFailures)(result);
    return {
        failures,
        xcsiftResult: result,
        warnings: result.summary.warnings,
        slowTests: result.slow_tests?.map(t => ({
            test: t.test,
            duration: t.duration
        }))
    };
};
exports.analyzeOutput = analyzeOutput;
/**
 * Get warnings related to a specific file from an xcsift result.
 */
const getFileWarnings = (result, filePath) => {
    const warningsByFile = (0, xcsift_1.getWarningsByFile)(result);
    const fileWarnings = warningsByFile.get(filePath) || [];
    return fileWarnings.map(w => ({
        line: w.line,
        message: w.message
    }));
};
exports.getFileWarnings = getFileWarnings;
/**
 * Get errors related to a specific file from an xcsift result.
 */
const getFileErrors = (result, filePath) => {
    const errorsByFile = (0, xcsift_1.getErrorsByFile)(result);
    const fileErrors = errorsByFile.get(filePath) || [];
    return fileErrors.map(e => ({
        line: e.line,
        message: e.message
    }));
};
exports.getFileErrors = getFileErrors;
/**
 * Check if output indicates build success.
 */
const isBuildSuccessful = (result) => {
    return (0, xcsift_1.isBuildSuccess)(result);
};
exports.isBuildSuccessful = isBuildSuccessful;
/**
 * Check if output indicates all tests passed.
 */
const areAllTestsPassing = (result) => {
    return (0, xcsift_1.areTestsPassing)(result);
};
exports.areAllTestsPassing = areAllTestsPassing;
