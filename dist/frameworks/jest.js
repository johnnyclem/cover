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
exports.JestFramework = void 0;
const base_js_1 = require("./base.js");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class JestFramework extends base_js_1.BaseFramework {
    constructor() {
        super({
            name: 'Jest',
            type: 'unit',
            command: 'npx jest',
            args: ['--verbose', '--no-coverage'],
            coverageCommand: 'npx jest --coverage --coverageReporters=json',
            coverageFormat: 'json',
            filePatterns: {
                source: ['src/**/*.js', 'src/**/*.ts', 'lib/**/*.js', 'lib/**/*.ts'],
                test: ['**/*.test.js', '**/*.test.ts', '**/*.test.jsx', '**/*.test.tsx', '**/*.spec.js', '**/*.spec.ts', '**/*.spec.jsx', '**/*.spec.tsx']
            },
            resultParser: 'json',
            configFiles: ['jest.config.js', 'jest.config.json', 'jest.config.ts', 'jest.config.mjs', 'package.json']
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
        // Parse Jest output for failures
        const lines = output.split('\n');
        let currentFile = '';
        let currentTest = '';
        let failureMessage = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Test file pattern
            if (line.match(/PASS|FAIL/) && line.includes('.test.') || line.includes('.spec.')) {
                const parts = line.split(' ');
                currentFile = parts[parts.length - 1];
            }
            // Failed test pattern
            if (line.includes('✕') || line.includes('×')) {
                currentTest = line.replace(/[✕×]\s*/, '').trim();
            }
            // Error message pattern
            if (line.includes('Error:') || line.includes('expect') || line.includes('received')) {
                failureMessage += line + '\n';
            }
            // If we have all components, add to failures
            if (currentFile && currentTest && failureMessage) {
                failures.push({
                    file: currentFile,
                    message: currentTest,
                    fullMessage: failureMessage.trim()
                });
                // Reset for next failure
                currentTest = '';
                failureMessage = '';
            }
        }
        // Check if tests passed
        const passed = !output.includes('FAIL') &&
            (output.includes('PASS') || output.includes('Test Suites: 1 passed') || !output.includes('Test Suites:'));
        return {
            passed,
            failures: failures.length > 0 ? failures : undefined
        };
    }
    async generateCoverageReport() {
        try {
            // Run Jest with coverage
            await this.executeCommand(this.config.coverageCommand, []);
            // Read coverage JSON file
            const coverageFile = 'coverage/coverage-final.json';
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
        const sourceDir = path.dirname(sourceFile);
        const sourceName = path.basename(sourceFile, path.extname(sourceFile));
        const testPatterns = [
            path.join(sourceDir, `${sourceName}.test.js`),
            path.join(sourceDir, `${sourceName}.test.ts`),
            path.join(sourceDir, `${sourceName}.test.jsx`),
            path.join(sourceDir, `${sourceName}.test.tsx`),
            path.join(sourceDir, `${sourceName}.spec.js`),
            path.join(sourceDir, `${sourceName}.spec.ts`),
            path.join(sourceDir, `${sourceName}.spec.jsx`),
            path.join(sourceDir, `${sourceName}.spec.tsx`),
            path.join('__tests__', `${sourceName}.test.js`),
            path.join('__tests__', `${sourceName}.test.ts`),
            path.join('test', `${sourceName}.test.js`),
            path.join('test', `${sourceName}.test.ts`),
            path.join('tests', `${sourceName}.test.js`),
            path.join('tests', `${sourceName}.test.ts`)
        ];
        const existingFiles = [];
        for (const pattern of testPatterns) {
            try {
                await fs.access(pattern);
                existingFiles.push(pattern);
            }
            catch {
                // File doesn't exist
            }
        }
        return existingFiles;
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
exports.JestFramework = JestFramework;
