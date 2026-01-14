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
        const { stdout } = await execa('xcrun', ['xcresulttool', 'get', '--format', 'json', '--path', xcresultPath]);
        const json = JSON.parse(stdout);
        
        const failures: TestFailure[] = [];

        // Navigate the JSON soup of xcresult
        // Root -> actions -> actionResult -> issues -> testFailureSummaries
        
        const actions = json.actions?._values || [];
        for (const action of actions) {
            const result = action.actionResult;
            const summaries = result.issues?.testFailureSummaries?._values || [];
            
            for (const summary of summaries) {
                const message = summary.message?._value || 'Unknown failure';
                const testCaseName = summary.testCaseName?._value || 'Unknown Test';
                
                // Location is usually in documentLocationInCreatingWorkspace
                const docLoc = summary.documentLocationInCreatingWorkspace;
                let fileName = 'Unknown File';
                let lineNumber = 0;

                if (docLoc && docLoc.url && docLoc.url._value) {
                    // url format: file:///path/to/file#CharacterRangeLen=0&EndingLineNumber=42&StartingLineNumber=42
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
        
        return failures;
    } catch (error) {
        logger.error('Failed to parse test failures from xcresult.');
        return [];
    }
};
