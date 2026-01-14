import { TestingFrameworkConfig, TestRunResult, CoverageReport, TestFailure } from '../types.js';

export abstract class BaseFramework {
  protected config: TestingFrameworkConfig;

  constructor(config: TestingFrameworkConfig) {
    this.config = config;
  }

  abstract runTests(args?: string[]): Promise<TestRunResult>;
  abstract parseResults(output: string): { passed: boolean; failures?: TestFailure[] };
  abstract generateCoverageReport(): Promise<CoverageReport | null>;
  abstract findTestFiles(sourceFile: string): Promise<string[]>;
  
  protected async executeCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { execa } = await import('execa');
    
    try {
      const result = await execa(command, args, { cwd: process.cwd() });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode || 0
      };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.exitCode || 1
      };
    }
  }

  getConfig(): TestingFrameworkConfig {
    return this.config;
  }

  isTestFile(filePath: string): boolean {
    return this.config.filePatterns.test.some(pattern => 
      filePath.includes(pattern) || new RegExp(pattern).test(filePath)
    );
  }

  isSourceFile(filePath: string): boolean {
    return this.config.filePatterns.source.some(pattern => 
      filePath.includes(pattern) || new RegExp(pattern).test(filePath)
    );
  }
}