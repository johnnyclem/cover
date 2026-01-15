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
exports.JSCoverageProcessor = void 0;
const index_js_1 = require("./frameworks/index.js");
const fs = __importStar(require("fs/promises"));
class JSCoverageProcessor {
    framework = null;
    async initialize(frameworkName) {
        if (frameworkName) {
            this.framework = (0, index_js_1.createFramework)(frameworkName);
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
    }
    async generateCoverage() {
        if (!this.framework) {
            throw new Error('Framework not initialized. Call initialize() first.');
        }
        return await this.framework.generateCoverageReport();
    }
    async processCoverageWithGitFilter(gitDiff) {
        const fullCoverage = await this.generateCoverage();
        if (!fullCoverage) {
            return null;
        }
        return this.filterCoverageByChangedFiles(fullCoverage, gitDiff.changedFiles);
    }
    filterCoverageByChangedFiles(coverage, changedFiles) {
        const filteredFiles = coverage.files.filter((file) => changedFiles.some(changedFile => this.isRelatedFile(file.path, changedFile)));
        // Recalculate total coverage for filtered files
        const totalLines = filteredFiles.reduce((sum, file) => {
            // Estimate total lines based on coverage data
            const uncoveredLines = file.uncoveredLines.length;
            const coveredLines = Math.round((file.lineCoverage / 100) * (uncoveredLines + Math.round((file.lineCoverage / 100) * uncoveredLines)));
            return sum + uncoveredLines + coveredLines;
        }, 0);
        const totalCoveredLines = filteredFiles.reduce((sum, file) => {
            const uncoveredLines = file.uncoveredLines.length;
            const coveredLines = Math.round((file.lineCoverage / 100) * (uncoveredLines + Math.round((file.lineCoverage / 100) * uncoveredLines)));
            return sum + coveredLines;
        }, 0);
        const totalCoverage = totalLines > 0 ? Math.round((totalCoveredLines / totalLines) * 100 * 100) / 100 : 0;
        return {
            files: filteredFiles,
            totalCoverage
        };
    }
    isRelatedFile(coverageFile, changedFile) {
        // Direct match
        if (coverageFile === changedFile) {
            return true;
        }
        // Check if coverage file is a test file for the changed source file
        const coverageBase = coverageFile.replace(/\.(test|spec)\.(js|ts|jsx|tsx)$/, '');
        const changedBase = changedFile.replace(/\.(js|ts|jsx|tsx)$/, '');
        if (coverageBase.includes(changedBase) || changedBase.includes(coverageBase)) {
            return true;
        }
        // Check for common directory patterns
        const coveragePath = coverageFile.split('/');
        const changedPath = changedFile.split('/');
        // If they're in the same directory or related directories
        const coverageDir = coveragePath.slice(0, -1).join('/');
        const changedDir = changedPath.slice(0, -1).join('/');
        if (coverageDir === changedDir) {
            // Check file name similarity
            const coverageName = coveragePath[coveragePath.length - 1];
            const changedName = changedPath[changedPath.length - 1];
            const coverageBaseName = coverageName.replace(/\.(test|spec)\.(js|ts|jsx|tsx)$/, '');
            const changedBaseName = changedName.replace(/\.(js|ts|jsx|tsx)$/, '');
            if (coverageBaseName.includes(changedBaseName) || changedBaseName.includes(coverageBaseName)) {
                return true;
            }
        }
        return false;
    }
    async parseCoverageFile(filePath) {
        try {
            const coverageData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            return this.parseCoverageData(coverageData);
        }
        catch (error) {
            console.error(`Failed to parse coverage file ${filePath}:`, error);
            return null;
        }
    }
    parseCoverageData(coverageData) {
        const files = [];
        let totalLines = 0;
        let coveredLines = 0;
        if (coverageData && typeof coverageData === 'object') {
            Object.keys(coverageData).forEach(filename => {
                const fileData = coverageData[filename];
                if (fileData && typeof fileData === 'object') {
                    let lineCoverage = 0;
                    let functionCoverage = 0;
                    let uncoveredLines = [];
                    let uncoveredFunctions = [];
                    // Handle different coverage formats
                    if (fileData.s) {
                        // Istanbul/NYC format
                        const statements = fileData.s;
                        const statementKeys = Object.keys(statements).map(Number);
                        uncoveredLines = statementKeys.filter(key => statements[key] === 0);
                        lineCoverage = statementKeys.length > 0
                            ? ((statementKeys.length - uncoveredLines.length) / statementKeys.length) * 100
                            : 0;
                        functionCoverage = fileData.f ? this.calculateFunctionCoverage(fileData.f) : 0;
                        uncoveredFunctions = this.getUncoveredFunctions(fileData.f);
                    }
                    else if (fileData.lines) {
                        // LCOV format or similar
                        const lines = fileData.lines;
                        const lineKeys = Object.keys(lines).map(Number);
                        uncoveredLines = lineKeys.filter(key => lines[key] === 0);
                        lineCoverage = lineKeys.length > 0
                            ? ((lineKeys.length - uncoveredLines.length) / lineKeys.length) * 100
                            : 0;
                        functionCoverage = fileData.functions ? this.calculateFunctionCoverage(fileData.functions) : 0;
                        uncoveredFunctions = this.getUncoveredFunctions(fileData.functions);
                    }
                    totalLines += uncoveredLines.length + Math.round((lineCoverage / 100) * uncoveredLines.length);
                    coveredLines += Math.round((lineCoverage / 100) * (uncoveredLines.length + Math.round((lineCoverage / 100) * uncoveredLines.length)));
                    files.push({
                        path: filename,
                        lineCoverage: Math.round(lineCoverage * 100) / 100,
                        functionCoverage: Math.round(functionCoverage * 100) / 100,
                        uncoveredLines,
                        uncoveredFunctions
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
    getFrameworkName() {
        return this.framework?.getConfig().name || null;
    }
}
exports.JSCoverageProcessor = JSCoverageProcessor;
