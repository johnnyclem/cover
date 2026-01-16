import { execa } from 'execa';
import { logger } from './ui';

export interface TestFailure {
    testCaseName: string;
    message: string;
    fileName: string;
    lineNumber: number;
}

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

export const getBuildFailures = (log: string): TestFailure[] => {
    const failures: TestFailure[] = [];
    const lines = log.split('\n');
    
    // Regex for standard Swift/ObjC errors: /path/to/file:line:col: error: message
    const errorRegex = /^(.+):(\d+):(\d+): error: (.+)$/;

    for (const line of lines) {
        const match = line.match(errorRegex);
        if (match) {
            const [_, filePath, lineStr, colStr, message] = match;
            failures.push({
                testCaseName: 'Build Failure',
                message: message.trim(),
                fileName: filePath.trim(),
                lineNumber: parseInt(lineStr, 10)
            });
        }
    }

    return failures;
};
