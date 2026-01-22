import { CoveredFile, ProcessedCoverageResult, NotFoundFile, NotFoundReason, CoverageDebugInfo, MatchAttempt } from './types';
import { CoverConfig } from './config';
import path from 'path';

// Default patterns to identify test files
const DEFAULT_TEST_FILE_PATTERNS = [
  /Tests?\.swift$/i,
  /Spec\.swift$/i,
  /_tests?\.swift$/i,
  /\.test\.swift$/i,
];

// Default patterns to identify test utility/mock files
const DEFAULT_TEST_UTIL_PATTERNS = [
  /TestUtil/i,
  /TestHelper/i,
  /TestSupport/i,
  /Mock[A-Z]/i,
  /Stub[A-Z]/i,
  /Fake[A-Z]/i,
  /Spy[A-Z]/i,
  /Testing\//i,
];

/**
 * Check if a file path matches any of the given patterns
 */
const matchesPatterns = (filePath: string, patterns: (RegExp | string)[]): boolean => {
  return patterns.some(pattern => {
    if (pattern instanceof RegExp) {
      return pattern.test(filePath);
    }
    return filePath.includes(pattern);
  });
};

/**
 * Determine if a file is a test file (not subject to coverage)
 */
export const isTestFile = (filePath: string, config?: CoverConfig): boolean => {
  const patterns = config?.xcode?.testFilePatterns?.map(p => new RegExp(p, 'i')) || DEFAULT_TEST_FILE_PATTERNS;
  return matchesPatterns(filePath, patterns);
};

/**
 * Determine if a file is a test utility file (mocks, stubs, helpers)
 */
export const isTestUtilFile = (filePath: string, config?: CoverConfig): boolean => {
  const patterns = config?.xcode?.testUtilPatterns?.map(p => new RegExp(p, 'i')) || DEFAULT_TEST_UTIL_PATTERNS;
  return matchesPatterns(filePath, patterns);
};

/**
 * Normalize a path for comparison by extracting meaningful components.
 * Handles differences between absolute xccov paths and relative git paths.
 */
const normalizePath = (filePath: string): string => {
  // Remove common absolute path prefixes
  let normalized = filePath
    .replace(/^\/Users\/[^/]+\//, '')           // Remove /Users/username/
    .replace(/^\/private\//, '')                 // Remove /private/ prefix
    .replace(/^~\//, '');                        // Remove ~/
  
  return normalized;
};

/**
 * Extract just the filename from a path
 */
const getFilename = (filePath: string): string => {
  return path.basename(filePath);
};

/**
 * Get the parent directory name
 */
const getParentDir = (filePath: string): string => {
  return path.basename(path.dirname(filePath));
};

/**
 * Calculate similarity between two paths (0-1 score)
 */
const pathSimilarity = (path1: string, path2: string): number => {
  const normalized1 = normalizePath(path1).toLowerCase();
  const normalized2 = normalizePath(path2).toLowerCase();
  
  // Exact match after normalization
  if (normalized1 === normalized2) return 1.0;
  
  // One ends with the other
  if (normalized1.endsWith(normalized2) || normalized2.endsWith(normalized1)) return 0.9;
  
  // Same filename
  const filename1 = getFilename(path1);
  const filename2 = getFilename(path2);
  if (filename1 === filename2) {
    // Same filename, check parent directory
    const parent1 = getParentDir(path1);
    const parent2 = getParentDir(path2);
    if (parent1 === parent2) return 0.8;
    return 0.5;
  }
  
  // Check if paths share common components
  const parts1 = normalized1.split('/');
  const parts2 = normalized2.split('/');
  const commonParts = parts1.filter(p => parts2.includes(p));
  const totalParts = Math.max(parts1.length, parts2.length);
  
  return commonParts.length / totalParts * 0.4;
};

/**
 * Find the best matching coverage file for a changed file
 */
const findBestMatch = (
  changedFile: string, 
  allCoveredFiles: any[],
  verbose: boolean = false
): { match: any | null; candidates: string[] } => {
  const changedFilename = getFilename(changedFile);
  const candidates: { file: any; score: number }[] = [];
  
  for (const coveredFile of allCoveredFiles) {
    const coveredPath = coveredFile.path;
    const coveredFilename = getFilename(coveredPath);
    
    // Quick filter: filename must match
    if (coveredFilename !== changedFilename) {
      continue;
    }
    
    const score = pathSimilarity(changedFile, coveredPath);
    candidates.push({ file: coveredFile, score });
  }
  
  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  
  // Return the best match if score is above threshold
  const MATCH_THRESHOLD = 0.5;
  const topCandidates = candidates.slice(0, 3).map(c => c.file.path);
  
  if (candidates.length > 0 && candidates[0].score >= MATCH_THRESHOLD) {
    return { match: candidates[0].file, candidates: topCandidates };
  }
  
  return { match: null, candidates: topCandidates };
};

/**
 * Determine why a file was not found in coverage data
 */
const determineNotFoundReason = (
  changedFile: string, 
  candidates: string[],
  config?: CoverConfig
): { reason: NotFoundReason; details?: string } => {
  // Check if it's a test file
  if (isTestFile(changedFile, config)) {
    return { reason: 'test_file', details: 'Test files are not subject to code coverage' };
  }
  
  // Check if it's a test utility file
  if (isTestUtilFile(changedFile, config)) {
    return { 
      reason: 'test_util_file', 
      details: 'Test utility files (mocks, stubs, helpers) are typically not in coverage data' 
    };
  }
  
  // If we had candidates but none matched, it's likely a path mismatch
  if (candidates.length > 0) {
    return { 
      reason: 'path_mismatch', 
      details: `Closest match: ${candidates[0]}` 
    };
  }
  
  // Check if file might be in an untested target
  if (changedFile.includes('Tests/') || changedFile.includes('TestUtil/')) {
    return { 
      reason: 'not_in_target', 
      details: 'File appears to be in a test target that was not included in coverage' 
    };
  }
  
  return { reason: 'unknown', details: 'File not found in any coverage target' };
};

/**
 * Process Xcode coverage data and match against changed files.
 * Returns categorized results with detailed information about each file.
 */
export const processCoverage = (
  coverageJson: any, 
  changedFiles: string[],
  options: { verbose?: boolean; config?: CoverConfig } = {}
): ProcessedCoverageResult => {
  const { verbose = false, config } = options;
  
  const coveredFiles: CoveredFile[] = [];
  const notFoundFiles: NotFoundFile[] = [];
  const testFilesSkipped: string[] = [];
  const matchAttempts: MatchAttempt[] = [];
  
  // Flatten all files from all targets
  const allCoveredFiles: any[] = [];
  if (coverageJson?.targets) {
    for (const target of coverageJson.targets) {
      if (target.files) {
        allCoveredFiles.push(...target.files);
      }
    }
  }
  
  // Process each changed file
  for (const changedFile of changedFiles) {
    // First, check if this is a test file (flag separately)
    if (isTestFile(changedFile, config)) {
      testFilesSkipped.push(changedFile);
      if (verbose) {
        matchAttempts.push({
          changedFile,
          matched: false,
          candidatesConsidered: ['Skipped: Test file']
        });
      }
      continue;
    }
    
    // Try to find a match in the coverage data
    const { match, candidates } = findBestMatch(changedFile, allCoveredFiles, verbose);
    
    if (verbose) {
      matchAttempts.push({
        changedFile,
        matched: !!match,
        matchedPath: match?.path,
        candidatesConsidered: candidates
      });
    }
    
    if (match) {
      coveredFiles.push({
        path: changedFile,
        lineCoverage: (match.lineCoverage || 0) * 100,
        functionCoverage: (match.functionCoverage || 0) * 100,
        uncoveredLines: extractUncoveredLines(match),
        uncoveredFunctions: extractUncoveredFunctions(match)
      });
    } else {
      // File not found in coverage - determine why
      const { reason, details } = determineNotFoundReason(changedFile, candidates, config);
      notFoundFiles.push({
        path: changedFile,
        reason,
        details
      });
    }
  }
  
  // Build result
  const result: ProcessedCoverageResult = {
    coveredFiles,
    notFoundFiles,
    testFilesSkipped
  };
  
  // Add debug info if verbose
  if (verbose) {
    result.debugInfo = {
      gitChangedFiles: changedFiles,
      xccovFiles: allCoveredFiles.map(f => f.path),
      matchAttempts
    };
  }
  
  return result;
};

/**
 * Extract uncovered line numbers from xccov file data
 */
const extractUncoveredLines = (fileData: any): number[] => {
  // xccov JSON format may include line-level data in some formats
  // For now, return empty array as xccov primarily reports percentages
  // This can be enhanced to parse deeper if needed
  return [];
};

/**
 * Extract uncovered function names from xccov file data
 */
const extractUncoveredFunctions = (fileData: any): string[] => {
  // Similar to above - can be enhanced for deeper parsing
  return [];
};

/**
 * Legacy function for backward compatibility.
 * Returns just the CoveredFile[] array with 0% for unmatched files.
 * @deprecated Use processCoverage() instead for full categorization
 */
export const processCoverageLegacy = (coverageJson: any, changedFiles: string[]): CoveredFile[] => {
  const result = processCoverage(coverageJson, changedFiles);
  
  // Combine covered files with not-found files (marked as 0%)
  const allFiles: CoveredFile[] = [...result.coveredFiles];
  
  for (const notFound of result.notFoundFiles) {
    allFiles.push({
      path: notFound.path,
      lineCoverage: 0,
      functionCoverage: 0,
      uncoveredLines: [],
      uncoveredFunctions: []
    });
  }
  
  return allFiles;
};
