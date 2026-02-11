import { CoverageFormat, LineCoverageData } from '../types.js';
import { glob } from 'glob';

/**
 * Abstract base class for coverage format parsers.
 * Each parser implementation handles a specific coverage format.
 */
export abstract class BaseCoverageParser {
  /**
   * The coverage format this parser handles.
   */
  abstract readonly format: CoverageFormat;

  /**
   * File extensions this parser can handle.
   */
  abstract readonly fileExtensions: string[];

  /**
   * Parse coverage artifact(s) into line-level coverage data.
   * 
   * @param artifactPaths - Paths to coverage artifacts (already resolved, no globs)
   * @param options - Parser-specific options
   * @returns Map of file paths to their line coverage data
   */
  abstract parse(
    artifactPaths: string[],
    options?: ParserOptions
  ): Promise<Map<string, LineCoverageData>>;

  /**
   * Check if this parser can handle the given file based on extension.
   */
  canHandle(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    return this.fileExtensions.some(ext => lowerPath.endsWith(ext.toLowerCase()));
  }

  /**
   * Resolve glob patterns to actual file paths.
   */
  protected async resolveGlobs(patterns: string[]): Promise<string[]> {
    const results: string[] = [];
    
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        const matches = await glob(pattern);
        results.push(...matches);
      } else {
        results.push(pattern);
      }
    }
    
    // Deduplicate
    return [...new Set(results)];
  }

  /**
   * Normalize a file path for consistent comparison.
   * Removes common prefixes and standardizes separators.
   */
  protected normalizePath(filePath: string): string {
    return filePath
      .replace(/\\/g, '/')                    // Normalize separators
      .replace(/^\/Users\/[^/]+\//, '')       // Remove /Users/username/
      .replace(/^\/private\//, '')            // Remove /private/ prefix
      .replace(/^~\//, '');                   // Remove ~/
  }

  /**
   * Create a LineCoverageData object with empty sets.
   */
  protected createEmptyLineCoverage(filePath: string): LineCoverageData {
    return {
      filePath,
      coveredLines: new Set<number>(),
      uncoveredLines: new Set<number>(),
      executableLines: new Set<number>(),
    };
  }
}

export interface ParserOptions {
  /**
   * Enable verbose/debug logging.
   */
  verbose?: boolean;

  /**
   * Fast mode - skip line-level parsing where possible.
   */
  fast?: boolean;

  /**
   * Use cached data if available.
   */
  useCache?: boolean;

  /**
   * Use xccov --archive mode for coverage data extraction.
   * This matches the approach used by xccov-to-sonarqube.sh and produces
   * coverage numbers consistent with SonarQube.
   * Defaults to true for xccov format.
   */
  useArchive?: boolean;
}
