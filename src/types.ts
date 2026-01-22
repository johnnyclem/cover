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

export interface TestPlanTarget {
    target: {
        containerPath: string;
        identifier: string;
        name: string;
    };
}

export interface TestPlanConfig {
    configurations: Array<{
        id: string;
        name: string;
        options: Record<string, any>;
    }>;
    defaultOptions: {
        codeCoverage?: {
            targets?: Array<{
                containerPath: string;
                identifier: string;
                name: string;
            }>;
        };
    };
    testTargets: TestPlanTarget[];
    version: number;
}

// Reason why a file was not found in coverage data
export type NotFoundReason = 
  | 'test_file'           // File is a test file (not subject to coverage)
  | 'test_util_file'      // File is a test utility/mock file
  | 'path_mismatch'       // File exists but path matching failed
  | 'not_in_target'       // File not in any tested target
  | 'new_file'            // File is new and wasn't compiled
  | 'unknown';            // Unknown reason

export interface NotFoundFile {
  path: string;
  reason: NotFoundReason;
  details?: string;       // Additional debug info (e.g., closest match found)
}

export interface ProcessedCoverageResult {
  coveredFiles: CoveredFile[];           // Files found in coverage with actual coverage data
  notFoundFiles: NotFoundFile[];         // Files not found in coverage data
  testFilesSkipped: string[];            // Test files that were in changed files (flagged separately)
  debugInfo?: CoverageDebugInfo;         // Verbose debugging information
}

export interface CoverageDebugInfo {
  gitChangedFiles: string[];             // Raw list from git
  xccovFiles: string[];                  // Raw list from xccov
  matchAttempts: MatchAttempt[];         // Details of matching attempts
}

export interface MatchAttempt {
  changedFile: string;
  matched: boolean;
  matchedPath?: string;                  // The xccov path that matched
  candidatesConsidered?: string[];       // Top candidates that were close but didn't match
}

// === Line-Level Diff Types ===

export interface DiffHunk {
  startLine: number;
  lineCount: number;
}

export interface FileDiff {
  path: string;
  addedLines: DiffHunk[];  // Only additions (not deletions)
}

export interface PRDiffResult {
  files: FileDiff[];
  totalAddedLines: number;
}

// === Line-Level Coverage Types ===

export type CoverageFormat = 'xccov' | 'lcov' | 'jacoco' | 'llvm-cov';

export interface LineCoverageData {
  filePath: string;
  coveredLines: Set<number>;
  uncoveredLines: Set<number>;
  executableLines: Set<number>;  // All lines that can be covered (covered + uncovered)
}

export interface CoverageArtifactConfig {
  format: CoverageFormat;
  paths: string[];  // Supports globs
}

export interface CoverageManifest {
  format?: CoverageFormat;
  paths?: string[];
  artifacts?: Array<{
    format: CoverageFormat;
    path: string;
  }>;
}

// === PR Coverage Result Types ===

export interface PRFileCoverage {
  path: string;
  newUpdatedLines: number;           // Total new/modified executable lines
  coveredLines: number;              // Number of covered new lines
  uncoveredLineNumbers: number[];    // Specific uncovered line numbers
  coveragePercent: number;           // 0-100
}

export interface PRCoverageSummary {
  totalNewUpdatedLines: number;
  totalCoveredLines: number;
  totalUncoveredLines: number;
  lineCoveragePercent: number;       // 0-100
}

export interface PRCoverageMetadata {
  baseBranch: string;
  headCommit: string;
  coverageFormat: CoverageFormat;
  generatedAt: string;
  fast: boolean;                     // Whether line-level was skipped
}

export interface PRCoverageResult {
  files: PRFileCoverage[];           // Sorted alphabetically
  summary: PRCoverageSummary;
  metadata: PRCoverageMetadata;
}
