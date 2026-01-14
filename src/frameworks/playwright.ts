import { BaseFramework } from './base.js';
import { TestingFrameworkConfig, TestRunResult, CoverageReport, TestFailure } from '../types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export class PlaywrightFramework extends BaseFramework {
  constructor() {
    super({
      name: 'Playwright',
      type: 'e2e',
      command: 'npx playwright',
      args: ['test', '--reporter=line'],
      coverageCommand: 'npx playwright test --coverage',
      coverageFormat: 'json',
      filePatterns: {
        source: ['src/**/*.js', 'src/**/*.ts', 'src/**/*.jsx', 'src/**/*.tsx', 'tests/**/*.js', 'tests/**/*.ts'],
        test: ['tests/**/*.spec.js', 'tests/**/*.spec.ts', 'tests/**/*.test.js', 'tests/**/*.test.ts', 'e2e/**/*.spec.js', 'e2e/**/*.spec.ts', 'e2e/**/*.test.js', 'e2e/**/*.test.ts']
      },
      resultParser: 'json',
      configFiles: ['playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs']
    });
  }

  async runTests(additionalArgs: string[] = []): Promise<TestRunResult> {
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

  parseResults(output: string): { passed: boolean; failures?: TestFailure[] } {
    const failures: TestFailure[] = [];
    
    // Parse Playwright output for failures
    const lines = output.split('\n');
    let currentFile = '';
    let currentTest = '';
    let failureMessage = '';
    let inFailureBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Test file pattern
      if (line.includes('Running') && (line.includes('.spec.') || line.includes('.test.'))) {
        const match = line.match(/Running\s+(\d+\.\d+)\s+(.+?\.spec\.[jt]s|.+?\.test\.[jt]s)/);
        if (match) {
          currentFile = match[2];
        }
      }
      
      // Failed test pattern
      if (line.includes('×') || line.includes('✗') || line.includes('failed')) {
        // Extract test name from the line
        const testMatch = line.match(/[×✗]\s+(.+)/);
        if (testMatch) {
          currentTest = testMatch[1].trim();
          inFailureBlock = true;
        }
      }
      
      // Error message pattern
      if (inFailureBlock && (line.includes('Error:') || line.includes('AssertionError') || line.includes('expected') || line.includes('received'))) {
        failureMessage += line.trim() + '\n';
      }
      
      // End of failure block
      if (inFailureBlock && (line.trim() === '' || line.includes('retry'))) {
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
    
    // Also check for JSON reporter output
    try {
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[0]);
        if (Array.isArray(jsonData)) {
          jsonData.forEach((testResult: any) => {
            if (testResult.status === 'failed') {
              failures.push({
                file: testResult.file || '',
                message: testResult.title || testResult.name || 'Test failed',
                fullMessage: testResult.error?.message || testResult.error?.stack || 'Test failed'
              });
            }
          });
        }
      }
    } catch (error) {
      // JSON parsing failed, continue with text parsing
    }
    
    // Check if tests passed
    const passed = !output.includes('failed') && 
                   !output.includes('×') && 
                   (output.includes('passed') || output.includes('All tests passed'));
    
    return {
      passed,
      failures: failures.length > 0 ? failures : undefined
    };
  }

  async generateCoverageReport(): Promise<CoverageReport | null> {
    try {
      // Run Playwright with coverage
      await this.executeCommand(this.config.coverageCommand!, []);
      
      // Read coverage JSON file (Playwright typically outputs to coverage folder)
      const coverageFile = 'coverage/coverage-final.json';
      try {
        const coverageData = JSON.parse(await fs.readFile(coverageFile, 'utf-8'));
        return this.parseCoverageData(coverageData);
      } catch (error) {
        console.error('Failed to read coverage file:', error);
        return null;
      }
    } catch (error) {
      console.error('Failed to generate coverage report:', error);
      return null;
    }
  }

  async findTestFiles(sourceFile: string): Promise<string[]> {
    const sourceName = path.basename(sourceFile, path.extname(sourceFile));
    
    const testPatterns = [
      `tests/${sourceName}.spec.js`,
      `tests/${sourceName}.spec.ts`,
      `tests/${sourceName}.test.js`,
      `tests/${sourceName}.test.ts`,
      `e2e/${sourceName}.spec.js`,
      `e2e/${sourceName}.spec.ts`,
      `e2e/${sourceName}.test.js`,
      `e2e/${sourceName}.test.ts`,
      `tests/**/*${sourceName}*.spec.js`,
      `tests/**/*${sourceName}*.spec.ts`,
      `tests/**/*${sourceName}*.test.js`,
      `tests/**/*${sourceName}*.test.ts`
    ];
    
    const existingFiles: string[] = [];
    for (const pattern of testPatterns) {
      try {
        // For patterns with wildcards, we need to use glob
        if (pattern.includes('*')) {
          const { glob } = await import('glob');
          const matches = await glob(pattern);
          existingFiles.push(...matches);
        } else {
          await fs.access(pattern);
          existingFiles.push(pattern);
        }
      } catch {
        // File doesn't exist
      }
    }
    
    return [...new Set(existingFiles)]; // Remove duplicates
  }

  private parseCoverageData(coverageData: any): CoverageReport {
    const files: any[] = [];
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

  private calculateFunctionCoverage(functions: any): number {
    if (!functions) return 0;
    
    const functionKeys = Object.keys(functions);
    const coveredFunctions = functionKeys.filter(key => functions[key] > 0);
    
    return functionKeys.length > 0 ? (coveredFunctions.length / functionKeys.length) * 100 : 0;
  }

  private getUncoveredFunctions(functions: any): string[] {
    if (!functions) return [];
    
    return Object.keys(functions)
      .filter(key => functions[key] === 0)
      .map(key => `F${key}`);
  }
}