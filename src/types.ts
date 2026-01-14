export interface CoverageReport {
  files: CoveredFile[];
  totalCoverage: number;
}

export interface CoveredFile {
  path: string;
  lineCoverage: number; // percentage 0-100
  functionCoverage: number; // percentage 0-100
  uncoveredLines: number[];
  uncoveredFunctions: string[];
}

export interface GitDiff {
  changedFiles: string[];
}

export interface TestResult {
  passed: boolean;
  output: string;
}

export interface AgentConfig {
  name: string;
  command: string;
}

export interface TestingFrameworkConfig {
  name: string;
  type: 'unit' | 'integration' | 'e2e';
  command: string;
  args: string[];
  coverageCommand?: string;
  coverageFormat?: 'json' | 'lcov' | 'clover';
  filePatterns: {
    source: string[];
    test: string[];
  };
  resultParser: 'json' | 'junit' | 'custom';
  configFiles?: string[];
}

export interface TestRunResult extends TestResult {
  framework: string;
  coverage?: CoverageReport;
  failures?: TestFailure[];
}

export interface TestFailure {
  file: string;
  line?: number;
  message: string;
  fullMessage: string;
}
