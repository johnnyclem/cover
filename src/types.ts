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
