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
exports.MochaFramework = void 0;
const base_js_1 = require("./base.js");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class MochaFramework extends base_js_1.BaseFramework {
    constructor() {
        super({
            name: 'Mocha',
            type: 'unit',
            command: 'npx mocha',
            args: ['--reporter', 'json'],
            coverageCommand: 'npx nyc report --reporter=json',
            coverageFormat: 'json',
            filePatterns: {
                source: ['src/**/*.js', 'src/**/*.ts', 'lib/**/*.js', 'lib/**/*.ts'],
                test: ['**/*.test.js', '**/*.test.ts', '**/*.spec.js', '**/*.spec.ts']
            },
            resultParser: 'json',
            configFiles: ['test/mocha.opts', '.mocharc.json', '.mocharc.js', 'mocha.config.js']
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
        try {
            const jsonOutput = JSON.parse(output);
            const failures = [];
            if (jsonOutput.tests && Array.isArray(jsonOutput.tests)) {
                jsonOutput.tests.forEach((test) => {
                    if (test.err) {
                        failures.push({
                            file: test.file || '',
                            line: test.err?.estack?.match(/:(\d+):\d+/)?.[1] ? parseInt(test.err.estack.match(/:(\d+):\d+/)[1]) : undefined,
                            message: test.err?.message || 'Test failed',
                            fullMessage: test.err?.estack || test.err?.message || 'Test failed'
                        });
                    }
                });
            }
            return {
                passed: failures.length === 0 && jsonOutput.failures === 0,
                failures
            };
        }
        catch (error) {
            return {
                passed: false,
                failures: [{
                        file: '',
                        message: 'Failed to parse Mocha output',
                        fullMessage: output
                    }]
            };
        }
    }
    async generateCoverageReport() {
        try {
            const result = await this.executeCommand(this.config.coverageCommand, []);
            const coverageData = JSON.parse(result.stdout);
            return this.parseCoverageData(coverageData);
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
            path.join(sourceDir, `${sourceName}.spec.js`),
            path.join(sourceDir, `${sourceName}.spec.ts`),
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
                if (fileData && typeof fileData === 'object') {
                    const lines = fileData.l || {};
                    const lineNumbers = Object.keys(lines).map(Number);
                    const uncoveredLines = lineNumbers.filter(line => lines[line] === 0);
                    const lineCoverage = lineNumbers.length > 0
                        ? ((lineNumbers.length - uncoveredLines.length) / lineNumbers.length) * 100
                        : 0;
                    totalLines += lineNumbers.length;
                    coveredLines += lineNumbers.length - uncoveredLines.length;
                    files.push({
                        path: filename,
                        lineCoverage: Math.round(lineCoverage * 100) / 100,
                        functionCoverage: 0, // TODO: Parse function coverage from nyc data
                        uncoveredLines,
                        uncoveredFunctions: []
                    });
                }
            });
        }
        return {
            files,
            totalCoverage: totalLines > 0 ? Math.round((coveredLines / totalLines) * 100 * 100) / 100 : 0
        };
    }
}
exports.MochaFramework = MochaFramework;
