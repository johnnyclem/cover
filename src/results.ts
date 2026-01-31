import { execa } from 'execa';
import { logger } from './ui.js';
import { 
    parseOutput, 
    convertToTestFailures, 
    isXcsiftAvailable,
    isBuildSuccess,
    areTestsPassing,
    getWarningsByFile,
    getErrorsByFile
} from './xcsift.js';
import { XcsiftResult, XcsiftParseOptions } from './xcsift-types.js';

export interface TestFailure {
    testCaseName: string;
    message: string;
    fileName: string;
    lineNumber: number;
}

/**
 * Extended test result that includes xcsift parsed data.
 */
export interface ExtendedTestResult {
    failures: TestFailure[];
    xcsiftResult?: XcsiftResult;
    warnings?: number;
    slowTests?: Array<{ test: string; duration: number }>;
}

/**
 * Get test failures from an xcresult bundle.
 * Uses xcresulttool to parse the structured test results.
 */
export const getTestFailures = async (xcresultPath: string): Promise<TestFailure[]> => {
    try {
        const { stdout } = await execa('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', xcresultPath, '--format', 'json']);
        const json = JSON.parse(stdout);
        
        const failures: TestFailure[] = [];

        // Navigate the JSON soup of xcresult for new API
        const tests = json.tests || [];
        function traverseTests(items: any[]) {
            for (const item of items) {
                if (item.subtests && Array.isArray(item.subtests)) {
                    traverseTests(item.subtests);
                } else if (item.result === 'failed') {
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
    } catch (error) {
        logger.error('Failed to parse test failures from xcresult.');
        return [];
    }
};

/**
 * Legacy synchronous build failure parser using regex.
 * Used as fallback when xcsift is not available.
 * 
 * @deprecated Use getBuildFailures() instead which uses xcsift
 */
export const getBuildFailuresLegacy = (log: string): TestFailure[] => {
    const failures: TestFailure[] = [];
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
export const getBuildFailures = async (
    log: string,
    options?: { 
        useXcsift?: boolean;
        xcsiftOptions?: XcsiftParseOptions;
    }
): Promise<TestFailure[]> => {
    const useXcsift = options?.useXcsift !== false;

    if (useXcsift) {
        const xcsiftAvailable = await isXcsiftAvailable();
        
        if (xcsiftAvailable) {
            try {
                const xcsiftOptions: XcsiftParseOptions = {
                    includeWarnings: true,
                    slowThreshold: 1.0,
                    ...options?.xcsiftOptions
                };

                const result = await parseOutput(log, xcsiftOptions);
                
                // Check if xcsift found any errors
                const hasErrors = (result.errors?.length ?? 0) > 0;
                const hasLinkerErrors = (result.linker_errors?.length ?? 0) > 0;
                const hasTestFailures = (result.failed_tests?.length ?? 0) > 0;

                if (hasErrors || hasLinkerErrors || hasTestFailures) {
                    return convertToTestFailures(result);
                }

                // xcsift ran but found nothing - might be empty or success
                // Return empty array (no failures)
                if (result.status === 'success') {
                    return [];
                }
            } catch (error: any) {
                logger.warn(`xcsift parsing failed, falling back to regex: ${error.message}`);
            }
        }
    }

    // Fallback to legacy regex parsing
    return getBuildFailuresLegacy(log);
};

/**
 * Parse build/test output with full xcsift analysis.
 * Returns extended information including warnings and slow tests.
 * 
 * @param log - Raw output from xcodebuild or swift command
 * @param options - Parsing options
 * @returns Extended result with failures, warnings, and slow tests
 */
export const analyzeOutput = async (
    log: string,
    options?: XcsiftParseOptions
): Promise<ExtendedTestResult> => {
    const xcsiftAvailable = await isXcsiftAvailable();

    if (!xcsiftAvailable) {
        // Fallback to legacy parsing
        return {
            failures: getBuildFailuresLegacy(log),
            warnings: 0
        };
    }

    const xcsiftOptions: XcsiftParseOptions = {
        includeWarnings: true,
        slowThreshold: 1.0,
        ...options
    };

    const result = await parseOutput(log, xcsiftOptions);
    const failures = convertToTestFailures(result);

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

/**
 * Get warnings related to a specific file from an xcsift result.
 */
export const getFileWarnings = (
    result: XcsiftResult,
    filePath: string
): Array<{ line: number; message: string }> => {
    const warningsByFile = getWarningsByFile(result);
    const fileWarnings = warningsByFile.get(filePath) || [];
    
    return fileWarnings.map(w => ({
        line: w.line,
        message: w.message
    }));
};

/**
 * Get errors related to a specific file from an xcsift result.
 */
export const getFileErrors = (
    result: XcsiftResult,
    filePath: string
): Array<{ line: number; message: string }> => {
    const errorsByFile = getErrorsByFile(result);
    const fileErrors = errorsByFile.get(filePath) || [];
    
    return fileErrors.map(e => ({
        line: e.line,
        message: e.message
    }));
};

/**
 * Check if output indicates build success.
 */
export const isBuildSuccessful = (result: XcsiftResult): boolean => {
    return isBuildSuccess(result);
};

/**
 * Check if output indicates all tests passed.
 */
export const areAllTestsPassing = (result: XcsiftResult): boolean => {
    return areTestsPassing(result);
};
