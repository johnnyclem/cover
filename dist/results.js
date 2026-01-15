"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTestFailures = void 0;
const execa_1 = require("execa");
const ui_1 = require("./ui");
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
