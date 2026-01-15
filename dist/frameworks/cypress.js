"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CypressFramework = void 0;
const base_js_1 = require("./base.js");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class CypressFramework extends base_js_1.BaseFramework {
    constructor() {
        super({
            name: 'Cypress',
            type: 'e2e',
            command: 'npx cypress',
            args: ['run', '--reporter', 'json'],
            coverageCommand: 'npx cypress run --coverage --reporter=json',
            coverageFormat: 'json',
            filePatterns: {
                source: ['src/**/*.js', 'src/**/*.ts', 'src/**/*.jsx', 'src/**/*.tsx', 'cypress/**/*.js', 'cypress/**/*.ts'],
                test: ['cypress/e2e/**/*.cy.js', 'cypress/e2e/**/*.cy.ts', 'cypress/e2e/**/*.cy.jsx', 'cypress/e2e/**/*.cy.tsx', 'cypress/integration/**/*.js', 'cypress/integration/**/*.ts']
            },
            resultParser: 'json',
            configFiles: ['cypress.config.js', 'cypress.config.ts', 'cypress.config.mjs', 'cypress.json']
        });
    }
    async runTests(additionalArgs = []) {
        const args = [...this.config.args, ...additionalArgs];
        const result = await this.executeCommand(this.config.command, args);
        const { passed, failures } = this.parseResults(result.stdout);
        return {
            framework: this.config.name,
            passed,
            output: result.stdout + result.stderr,
            failures
        };
    }
    parseResults(output) {
        const failures = [];
        try {
            // Try to parse as JSON first
            if (output.trim().startsWith('{') || output.trim().startsWith('[')) {
                const jsonOutput = JSON.parse(output);
                if (jsonOutput.tests && Array.isArray(jsonOutput.tests)) {
                    jsonOutput.tests.forEach((test) => {
                        if (test.state === 'failed' && test.err) {
                            failures.push({
                                file: test.file || '',
                                message: test.title.join(' > ') || 'Test failed',
                                fullMessage: test.err?.message || test.err?.stack || 'Test failed'
                            });
                        }
                    });
                }
            }
        }
        catch (error) {
            // Parse as plain text output
            const lines = output.split('\n');
            let currentFile = '';
            let currentTest = '';
            let failureMessage = '';
            for (const line of lines) {
                // Test file pattern
                if (line.includes('Running:') && line.includes('.cy.')) {
                    currentFile = line.split('Running:')[1].trim();
                }
                // Failed test pattern
                if (line.includes('✗') || line.includes(' failing')) {
                    currentTest = line.replace(/[✗]\s*/, '').trim();
                }
                // Error message pattern
                if (line.includes('Error:') || line.includes('AssertionError')) {
                    failureMessage += line + '\n';
                }
                if (currentFile && currentTest && failureMessage) {
                    failures.push({
                        file: currentFile,
                        message: currentTest,
                        fullMessage: failureMessage.trim()
                    });
                    currentTest = '';
                    failureMessage = '';
                }
            }
        }
        // Check if tests passed
        const passed = !output.includes('failing') &&
            !output.includes('✗') &&
            (output.includes('All specs passed') || output.includes('passed'));
        return {
            passed,
            failures: failures.length > 0 ? failures : undefined
        };
    }
    async generateCoverageReport() {
        try {
            // Run Cypress with coverage
            await this.executeCommand(this.config.coverageCommand, []);
            // Read coverage JSON file (Cypress typically outputs to .nyc_output)
            const coverageFile = '.nyc_output/out.json';
            try {
                const coverageData = JSON.parse(await fs.readFile(coverageFile, 'utf-8'));
                return this.parseCoverageData(coverageData);
            }
            catch (error) {
                console.error('Failed to read coverage file:', error);
                return null;
            }
        }
        catch (error) {
            console.error('Failed to generate coverage report:', error);
            return null;
        }
    }
    async findTestFiles(sourceFile) {
        const sourceName = path.basename(sourceFile, path.extname(sourceFile));
        const testPatterns = [
            `cypress/e2e/${sourceName}.cy.js`,
            `cypress/e2e/${sourceName}.cy.ts`,
            `cypress/e2e/${sourceName}.cy.jsx`,
            `cypress/e2e/${sourceName}.cy.tsx`,
            `cypress/integration/${sourceName}.js`,
            `cypress/integration/${sourceName}.ts`,
            `cypress/e2e/**/*${sourceName}*.cy.js`,
            `cypress/e2e/**/*${sourceName}*.cy.ts`
        ];
        const existingFiles = [];
        for (const pattern of testPatterns) {
            try {
                // For patterns with wildcards, we need to use glob
                if (pattern.includes('*')) {
                    const { glob } = await Promise.resolve().then(() => __importStar(require('glob')));
                    const matches = await glob(pattern);
                    existingFiles.push(...matches);
                }
                else {
                    await fs.access(pattern);
                    existingFiles.push(pattern);
                }
            }
            catch {
                // File doesn't exist
            }
        }
        return [...new Set(existingFiles)]; // Remove duplicates
    }
    parseCoverageData(coverageData) {
        const files = [];
        let totalLines = 0;
        let coveredLines = 0;
        if (coverageData && typeof coverageData === 'object') {
            Object.keys(coverageData).forEach(filename => {
                const fileData = coverageData[filename];
                if (fileData && typeof fileData === 'object' && fileData.s) {
                    const statements = fileData.s;
                    const statementKeys = Object.keys(statements).map(Number);
                    const uncoveredStatements = statementKeys.filter(key => statements[key] === 0);
                    const lineCoverage = statementKeys.length > 0
                        ? ((statementKeys.length - uncoveredStatements.length) / statementKeys.length) * 100
                        : 0;
                    totalLines += statementKeys.length;
                    coveredLines += statementKeys.length - uncoveredStatements.length;
                    files.push({
                        path: filename,
                        lineCoverage: Math.round(lineCoverage * 100) / 100,
                        functionCoverage: fileData.f ? this.calculateFunctionCoverage(fileData.f) : 0,
                        uncoveredLines: uncoveredStatements,
                        uncoveredFunctions: this.getUncoveredFunctions(fileData.f)
                    });
                }
            });
        }
        return {
            files,
            totalCoverage: totalLines > 0 ? Math.round((coveredLines / totalLines) * 100 * 100) / 100 : 0
        };
    }
    calculateFunctionCoverage(functions) {
        if (!functions)
            return 0;
        const functionKeys = Object.keys(functions);
        const coveredFunctions = functionKeys.filter(key => functions[key] > 0);
        return functionKeys.length > 0 ? (coveredFunctions.length / functionKeys.length) * 100 : 0;
    }
    getUncoveredFunctions(functions) {
        if (!functions)
            return [];
        return Object.keys(functions)
            .filter(key => functions[key] === 0)
            .map(key => `F${key}`);
    }
}
exports.CypressFramework = CypressFramework;
