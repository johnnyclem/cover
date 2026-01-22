import { CoverageFormat, LineCoverageData } from '../types';
import { BaseCoverageParser, ParserOptions } from './base-parser';
import fs from 'fs';

/**
 * Parser for LCOV coverage format (.lcov, .info files).
 * 
 * LCOV format reference:
 * ```
 * TN:<test name>
 * SF:<source file path>
 * FN:<line number>,<function name>
 * FNDA:<execution count>,<function name>
 * FNF:<number of functions found>
 * FNH:<number of functions hit>
 * DA:<line number>,<execution count>[,<checksum>]
 * LF:<number of lines found>
 * LH:<number of lines hit>
 * BRDA:<line number>,<block number>,<branch number>,<taken>
 * BRF:<number of branches found>
 * BRH:<number of branches hit>
 * end_of_record
 * ```
 */
export class LcovParser extends BaseCoverageParser {
  readonly format: CoverageFormat = 'lcov';
  readonly fileExtensions = ['.lcov', '.info'];

  async parse(
    artifactPaths: string[],
    options: ParserOptions = {}
  ): Promise<Map<string, LineCoverageData>> {
    const result = new Map<string, LineCoverageData>();
    const { verbose = false } = options;

    for (const filePath of artifactPaths) {
      if (verbose) {
        console.log(`Parsing LCOV file: ${filePath}`);
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileResults = this.parseLcovContent(content, verbose);
        
        // Merge results
        for (const [path, coverage] of fileResults) {
          if (result.has(path)) {
            // Merge with existing coverage data
            const existing = result.get(path)!;
            for (const line of coverage.coveredLines) {
              existing.coveredLines.add(line);
              existing.executableLines.add(line);
            }
            for (const line of coverage.uncoveredLines) {
              if (!existing.coveredLines.has(line)) {
                existing.uncoveredLines.add(line);
              }
              existing.executableLines.add(line);
            }
          } else {
            result.set(path, coverage);
          }
        }
      } catch (error) {
        if (verbose) {
          console.error(`Failed to parse LCOV file ${filePath}:`, error);
        }
      }
    }

    return result;
  }

  /**
   * Parse LCOV content and extract line coverage data.
   */
  private parseLcovContent(
    content: string,
    verbose: boolean
  ): Map<string, LineCoverageData> {
    const result = new Map<string, LineCoverageData>();
    let currentFile: string | null = null;
    let currentCoverage: LineCoverageData | null = null;

    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Source file start
      if (trimmed.startsWith('SF:')) {
        currentFile = trimmed.substring(3);
        currentCoverage = this.createEmptyLineCoverage(currentFile);
        continue;
      }

      // Line coverage data: DA:<line>,<hits>[,<checksum>]
      if (trimmed.startsWith('DA:') && currentCoverage) {
        const parts = trimmed.substring(3).split(',');
        if (parts.length >= 2) {
          const lineNum = parseInt(parts[0], 10);
          const hits = parseInt(parts[1], 10);

          if (!isNaN(lineNum)) {
            currentCoverage.executableLines.add(lineNum);
            
            if (hits > 0) {
              currentCoverage.coveredLines.add(lineNum);
            } else {
              currentCoverage.uncoveredLines.add(lineNum);
            }
          }
        }
        continue;
      }

      // End of record
      if (trimmed === 'end_of_record' && currentFile && currentCoverage) {
        result.set(currentFile, currentCoverage);
        
        if (verbose) {
          const covered = currentCoverage.coveredLines.size;
          const total = currentCoverage.executableLines.size;
          console.log(`  ${currentFile}: ${covered}/${total} lines covered`);
        }
        
        currentFile = null;
        currentCoverage = null;
      }
    }

    // Handle case where file doesn't end with end_of_record
    if (currentFile && currentCoverage) {
      result.set(currentFile, currentCoverage);
    }

    return result;
  }
}
