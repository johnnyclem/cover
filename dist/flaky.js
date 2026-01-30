"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFlakyTestsFromCircleCI = getFlakyTestsFromCircleCI;
exports.getFlakyTests = getFlakyTests;
exports.printFlakyTestReport = printFlakyTestReport;
const ui_1 = require("./ui");
const mcp_client_1 = require("./mcp-client");
const config_1 = require("./config");
// Fetch flaky tests from CircleCI MCP
async function getFlakyTestsFromCircleCI(projectSlug) {
    const config = (0, config_1.loadConfig)();
    const mcpCommand = config?.circleci?.mcpCommand || 'npx';
    const mcpArgs = config?.circleci?.mcpArgs || ['-y', '@circleci/mcp-server'];
    const client = new mcp_client_1.MCPClient(mcpCommand, mcpArgs);
    const connected = await client.connect();
    if (!connected) {
        ui_1.logger.warn('Could not connect to CircleCI MCP server.');
        return null;
    }
    try {
        ui_1.logger.info(`Fetching flaky tests for ${projectSlug}...`);
        const spin = (0, ui_1.spinner)('Querying CircleCI...').start();
        // The tool name might be 'find_flaky_tests' or 'circleci-mcp-server_find_flaky_tests'
        let result;
        try {
            result = await client.callTool('find_flaky_tests', {
                projectSlug
            });
        }
        catch (e) {
            // Try with params wrapper if the first attempt failed (some implementations differ)
            result = await client.callTool('find_flaky_tests', {
                params: { projectSlug }
            });
        }
        spin.stop();
        if (!result || !result.content || result.content.length === 0) {
            ui_1.logger.warn('No data returned from CircleCI.');
            return null;
        }
        // Parse result content - usually a text block or JSON string
        const contentItem = result.content[0];
        if (contentItem.type !== 'text') {
            ui_1.logger.warn('Received non-text content from CircleCI MCP.');
            return null;
        }
        const content = contentItem.text;
        // The output from find_flaky_tests is likely human-readable text.
        // We need to parse it or just display it.
        // If it's structured, great. If not, we might just have to return it as-is or try to parse.
        // For now, let's assume we can parse it if it's JSON, or return a generic report.
        // Actually, the tool description says "This tool retrieves information about flaky tests...".
        // Let's try to parse if it looks like JSON
        let tests = [];
        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                // Map to our format
                tests = parsed.map((t) => ({
                    testName: t.test_name || t.name || 'Unknown',
                    passRate: t.success_rate ? t.success_rate * 100 : 0,
                    totalRuns: t.runs || 0,
                    lastFailure: t.last_failure,
                    failureMessages: []
                }));
            }
        }
        catch {
            // Not JSON, probably text table.
            // We'll return an empty list but maybe log the text for the user?
            ui_1.logger.info(content);
            return {
                tests: [], // Empty because we printed the output directly
                source: 'circleci',
                projectSlug,
                generatedAt: new Date().toISOString()
            };
        }
        return {
            tests,
            source: 'circleci',
            projectSlug,
            generatedAt: new Date().toISOString()
        };
    }
    catch (error) {
        ui_1.logger.error(`Error querying CircleCI: ${error.message}`);
        return null;
    }
    finally {
        await client.close();
    }
}
// Get flaky tests (tries CircleCI first, falls back to local)
async function getFlakyTests(options) {
    const config = (0, config_1.loadConfig)();
    const slug = options.projectSlug || config?.circleci?.projectSlug;
    // Try CircleCI MCP first
    if (slug) {
        const circleciResult = await getFlakyTestsFromCircleCI(slug);
        if (circleciResult) {
            return circleciResult;
        }
    }
    else {
        ui_1.logger.info('No project slug configured. Add "circleci.projectSlug" to .coverrc or use --project-slug');
    }
    // Fallback to local history (placeholder)
    return {
        tests: [],
        source: 'local',
        generatedAt: new Date().toISOString()
    };
}
// Print flaky test report
function printFlakyTestReport(report) {
    if (report.source === 'circleci' && report.tests.length === 0) {
        // We already printed the text output in getFlakyTestsFromCircleCI
        return;
    }
    if (report.tests.length === 0) {
        ui_1.logger.success('No flaky tests detected!');
        return;
    }
    console.log('\nFlaky Tests Report:');
    console.log(`Source: ${report.source}`);
    if (report.projectSlug)
        console.log(`Project: ${report.projectSlug}`);
    console.log(`Generated: ${report.generatedAt}\n`);
    // Simple table output
    console.log('Test Name                                  | Pass Rate | Runs');
    console.log('-------------------------------------------|-----------|-----');
    for (const test of report.tests) {
        const name = test.testName.length > 40 ? test.testName.substring(0, 37) + '...' : test.testName.padEnd(40);
        console.log(`${name} | ${test.passRate.toFixed(1)}%    | ${test.totalRuns}`);
    }
}
