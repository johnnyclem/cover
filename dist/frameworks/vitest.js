import { BaseFramework } from './base.js';
import * as fs from 'fs/promises';
import * as path from 'path';
export class VitestFramework extends BaseFramework {
    constructor() {
        super({
            name: 'Vitest',
            type: 'unit',
            command: 'npx vitest',
            args: ['run', '--reporter=verbose'],
            coverageCommand: 'npx vitest run --coverage --reporter=json',
            coverageFormat: 'json',
            filePatterns: {
                source: ['src/**/*.js', 'src/**/*.ts', 'src/**/*.jsx', 'src/**/*.tsx', 'lib/**/*.js', 'lib/**/*.ts'],
                test: ['**/*.test.js', '**/*.test.ts', '**/*.test.jsx', '**/*.test.tsx', '**/*.spec.js', '**/*.spec.ts', '**/*.spec.jsx', '**/*.spec.tsx']
            },
            resultParser: 'json',
            configFiles: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs', 'vite.config.js', 'vite.config.ts']
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
        // Parse Vitest output for failures
        const lines = output.split('\n');
        let currentFile = '';
        let currentTest = '';
        let failureMessage = '';
        let inFailureBlock = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Test file pattern
            if (line.includes('FAIL') && (line.includes('.test.') || line.includes('.spec.'))) {
                const parts = line.trim().split(' ');
                currentFile = parts[parts.length - 1];
            }
            // Failed test pattern (❌ or ×)
            if (line.match(/^[│\s]*[❌×]\s+/)) {
                currentTest = line.replace(/[│\s]*[❌×]\s+/, '').trim();
                inFailureBlock = true;
            }
            // Error message pattern
            if (inFailureBlock && (line.includes('Error:') || line.includes('AssertionError') || line.includes('Expected') || line.includes('Received'))) {
                failureMessage += line.trim() + '\n';
            }
            // End of failure block
            if (inFailureBlock && line.trim() === '') {
                if (currentFile && currentTest && failureMessage) {
                    failures.push({
                        file: currentFile,
                        message: currentTest,
                        fullMessage: failureMessage.trim()
                    });
                }
                currentTest = '';
                failureMessage = '';
                inFailureBlock = false;
            }
        }
        // Check if tests passed
        const passed = !output.includes('FAIL') &&
            (output.includes('PASS') || output.includes('Test Files') || !output.includes('Test Files:'));
        return {
            passed,
            failures: failures.length > 0 ? failures : undefined
        };
    }
    async generateCoverageReport() {
        try {
            // Run Vitest with coverage
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
