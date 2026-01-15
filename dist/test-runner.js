"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JSTestRunner = void 0;
exports.runJSTests = runJSTests;
exports.runTestsForChangedFiles = runTestsForChangedFiles;
const index_js_1 = require("./frameworks/index.js");
const coverage_js_js_1 = require("./coverage-js.js");
const ui_js_1 = require("./ui.js");
class JSTestRunner {
    framework = null;
    coverageProcessor;
    constructor() {
        this.coverageProcessor = new coverage_js_js_1.JSCoverageProcessor();
    }
    async initialize(options) {
        if (options.framework) {
            this.framework = (0, index_js_1.createFramework)(options.framework);
        }
        else {
            const detected = await (0, index_js_1.detectFramework)();
            if (detected) {
                this.framework = (0, index_js_1.createFramework)(detected);
            }
            else {
                throw new Error('No JS/TS testing framework detected. Please specify a framework.');
            }
        }
        await this.coverageProcessor.initialize(this.framework.getConfig().name);
    }
    async runTests(options = {}) {
        if (!this.framework) {
            throw new Error('Test runner not initialized. Call initialize() first.');
        }
        const testSpinner = (0, ui_js_1.spinner)(`Running tests with ${this.framework.getConfig().name}...`);
        try {
            let testArgs = [];
            // Add specific test files if provided
            if (options.testFiles && options.testFiles.length > 0) {
                testArgs.push(...options.testFiles);
            }
            // Add additional arguments
            if (options.additionalArgs) {
                testArgs.push(...options.additionalArgs);
            }
            // Run tests
            const result = await this.framework.runTests(testArgs);
            // Generate coverage if requested
            if (options.coverage) {
                testSpinner.text = 'Generating coverage report...';
                const coverage = await this.coverageProcessor.generateCoverage();
                if (coverage) {
                    result.coverage = coverage;
                }
                // Filter coverage by changed files if git diff is provided
                if (result.coverage && options.gitDiff) {
                    const filteredCoverage = await this.coverageProcessor.processCoverageWithGitFilter(options.gitDiff);
                    if (filteredCoverage) {
                        result.coverage = filteredCoverage;
                    }
                }
            }
            testSpinner.succeed(`${result.passed ? '✅' : '❌'} Tests completed`);
            return result;
        }
        catch (error) {
            testSpinner.fail(`Test execution failed: ${error}`);
            throw error;
        }
    }
    async runTestsForChangedFiles(changedFiles, options = {}) {
        if (!this.framework) {
            throw new Error('Test runner not initialized. Call initialize() first.');
        }
        // Find test files for the changed source files
        const testFilesForChanges = [];
        for (const changedFile of changedFiles) {
            if (this.framework.isSourceFile(changedFile)) {
                const relatedTests = await this.framework.findTestFiles(changedFile);
                testFilesForChanges.push(...relatedTests);
            }
            else if (this.framework.isTestFile(changedFile)) {
                testFilesForChanges.push(changedFile);
            }
        }
        // Remove duplicates
        const uniqueTestFiles = [...new Set(testFilesForChanges)];
        if (uniqueTestFiles.length === 0) {
            return {
                framework: this.framework.getConfig().name,
                passed: true,
                output: 'No tests found for changed files'
            };
        }
        return this.runTests({
            ...options,
            testFiles: uniqueTestFiles
        });
    }
    async runFailedTests(failures) {
        if (!this.framework) {
            throw new Error('Test runner not initialized. Call initialize() first.');
        }
        // Extract unique test files from failures
        const failedFiles = [...new Set(failures.map(failure => failure.file).filter(Boolean))];
        if (failedFiles.length === 0) {
            return {
                framework: this.framework.getConfig().name,
                passed: true,
                output: 'No failed tests to rerun'
            };
        }
        const testSpinner = (0, ui_js_1.spinner)(`Rerunning ${failedFiles.length} failed test files...`);
        try {
            const result = await this.framework.runTests(failedFiles);
            testSpinner.succeed(`Rerun completed: ${result.passed ? 'All passed' : 'Some still failing'}`);
            return result;
        }
        catch (error) {
            testSpinner.fail(`Rerun failed: ${error}`);
            throw error;
        }
    }
    async findTestFiles(sourceFile) {
        if (!this.framework) {
            throw new Error('Test runner not initialized. Call initialize() first.');
        }
        return await this.framework.findTestFiles(sourceFile);
    }
    getFrameworkName() {
        if (!this.framework) {
            throw new Error('Test runner not initialized. Call initialize() first.');
        }
        return this.framework.getConfig().name;
    }
    getFrameworkType() {
        if (!this.framework) {
            throw new Error('Test runner not initialized. Call initialize() first.');
        }
        return this.framework.getConfig().type;
    }
    isTestFile(filePath) {
        if (!this.framework) {
            throw new Error('Test runner not initialized. Call initialize() first.');
        }
        return this.framework.isTestFile(filePath);
    }
    isSourceFile(filePath) {
        if (!this.framework) {
            throw new Error('Test runner not initialized. Call initialize() first.');
        }
        return this.framework.isSourceFile(filePath);
    }
    async detectFramework() {
        return await (0, index_js_1.detectFramework)();
    }
}
exports.JSTestRunner = JSTestRunner;
// Convenience function for quick test execution
async function runJSTests(options = {}) {
    const runner = new JSTestRunner();
    await runner.initialize(options);
    return await runner.runTests(options);
}
// Convenience function for running tests for changed files
async function runTestsForChangedFiles(changedFiles, options = {}) {
    const runner = new JSTestRunner();
    await runner.initialize(options);
    return await runner.runTestsForChangedFiles(changedFiles, options);
}
