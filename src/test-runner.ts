import { BaseFramework } from './frameworks/base.js';
import { TestRunResult, TestFailure, GitDiff } from './types.js';
import { detectFramework, createFramework } from './frameworks/index.js';
import { JSCoverageProcessor } from './coverage-js.js';
import { spinner } from './ui.js';

export interface TestRunnerOptions {
  framework?: string;
  coverage?: boolean;
  changedFiles?: string[];
  gitDiff?: GitDiff;
  testFiles?: string[];
  additionalArgs?: string[];
}

export class JSTestRunner {
  private framework: BaseFramework | null = null;
  private coverageProcessor: JSCoverageProcessor;
  
  constructor() {
    this.coverageProcessor = new JSCoverageProcessor();
  }
  
  async initialize(options: TestRunnerOptions): Promise<void> {
    if (options.framework) {
      this.framework = createFramework(options.framework);
    } else {
      const detected = await detectFramework();
      if (detected) {
        this.framework = createFramework(detected);
      } else {
        throw new Error('No JS/TS testing framework detected. Please specify a framework.');
      }
    }
    
    await this.coverageProcessor.initialize(this.framework.getConfig().name);
  }
  
  async runTests(options: TestRunnerOptions = {}): Promise<TestRunResult> {
    if (!this.framework) {
      throw new Error('Test runner not initialized. Call initialize() first.');
    }
    
    const testSpinner = spinner(`Running tests with ${this.framework.getConfig().name}...`);
    
    try {
      let testArgs: string[] = [];
      
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
      
    } catch (error) {
      testSpinner.fail(`Test execution failed: ${error}`);
      throw error;
    }
  }
  
  async runTestsForChangedFiles(changedFiles: string[], options: TestRunnerOptions = {}): Promise<TestRunResult> {
    if (!this.framework) {
      throw new Error('Test runner not initialized. Call initialize() first.');
    }
    
    // Find test files for the changed source files
    const testFilesForChanges: string[] = [];
    
    for (const changedFile of changedFiles) {
      if (this.framework.isSourceFile(changedFile)) {
        const relatedTests = await this.framework.findTestFiles(changedFile);
        testFilesForChanges.push(...relatedTests);
      } else if (this.framework.isTestFile(changedFile)) {
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
  
  async runFailedTests(failures: TestFailure[]): Promise<TestRunResult> {
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
    
    const testSpinner = spinner(`Rerunning ${failedFiles.length} failed test files...`);
    
    try {
      const result = await this.framework.runTests(failedFiles);
      testSpinner.succeed(`Rerun completed: ${result.passed ? 'All passed' : 'Some still failing'}`);
      return result;
    } catch (error) {
      testSpinner.fail(`Rerun failed: ${error}`);
      throw error;
    }
  }
  
  async findTestFiles(sourceFile: string): Promise<string[]> {
    if (!this.framework) {
      throw new Error('Test runner not initialized. Call initialize() first.');
    }
    
    return await this.framework.findTestFiles(sourceFile);
  }
  
  getFrameworkName(): string {
    if (!this.framework) {
      throw new Error('Test runner not initialized. Call initialize() first.');
    }
    
    return this.framework.getConfig().name;
  }
  
  getFrameworkType(): 'unit' | 'integration' | 'e2e' {
    if (!this.framework) {
      throw new Error('Test runner not initialized. Call initialize() first.');
    }
    
    return this.framework.getConfig().type;
  }
  
  isTestFile(filePath: string): boolean {
    if (!this.framework) {
      throw new Error('Test runner not initialized. Call initialize() first.');
    }
    
    return this.framework.isTestFile(filePath);
  }
  
  isSourceFile(filePath: string): boolean {
    if (!this.framework) {
      throw new Error('Test runner not initialized. Call initialize() first.');
    }
    
    return this.framework.isSourceFile(filePath);
  }
  
  async detectFramework(): Promise<string | null> {
    return await detectFramework();
  }
}

// Convenience function for quick test execution
export async function runJSTests(options: TestRunnerOptions = {}): Promise<TestRunResult> {
  const runner = new JSTestRunner();
  await runner.initialize(options);
  return await runner.runTests(options);
}

// Convenience function for running tests for changed files
export async function runTestsForChangedFiles(changedFiles: string[], options: TestRunnerOptions = {}): Promise<TestRunResult> {
  const runner = new JSTestRunner();
  await runner.initialize(options);
  return await runner.runTestsForChangedFiles(changedFiles, options);
}