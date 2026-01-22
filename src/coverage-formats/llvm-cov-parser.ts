import { CoverageFormat, LineCoverageData } from '../types';
import { BaseCoverageParser, ParserOptions } from './base-parser';
import fs from 'fs';

/**
 * Parser for llvm-cov JSON export format.
 * 
 * llvm-cov JSON format (generated via `llvm-cov export --format=text`):
 * ```json
 * {
 *   "data": [{
 *     "files": [{
 *       "filename": "/path/to/file.cpp",
 *       "segments": [
 *         [lineStart, colStart, count, hasCount, isRegionEntry, isGapRegion],
 *         ...
 *       ],
 *       "summary": {
 *         "lines": { "count": 100, "covered": 80, "percent": 80.0 },
 *         "functions": { ... },
 *         "regions": { ... }
 *       }
 *     }]
 *   }],
 *   "type": "llvm.coverage.json.export",
 *   "version": "2.0.1"
 * }
 * ```
 * 
 * Segment format: [line, column, count, hasCount, isRegionEntry, isGapRegion]
 * - hasCount (index 3): if true, count is valid
 * - count (index 2): execution count for the region
 */
export class LlvmCovParser extends BaseCoverageParser {
  readonly format: CoverageFormat = 'llvm-cov';
  readonly fileExtensions = ['.json'];

  async parse(
    artifactPaths: string[],
    options: ParserOptions = {}
  ): Promise<Map<string, LineCoverageData>> {
    const result = new Map<string, LineCoverageData>();
    const { verbose = false } = options;

    for (const filePath of artifactPaths) {
      if (verbose) {
        console.log(`Parsing llvm-cov JSON file: ${filePath}`);
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(content);

        // Verify this is an llvm-cov export
        if (json.type !== 'llvm.coverage.json.export') {
          if (verbose) {
            console.log(`Skipping ${filePath} - not an llvm-cov export`);
          }
          continue;
        }

        const fileResults = this.parseLlvmCovJson(json, verbose);
        
        // Merge results
        for (const [path, coverage] of fileResults) {
          if (result.has(path)) {
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
          console.error(`Failed to parse llvm-cov file ${filePath}:`, error);
        }
      }
    }

    return result;
  }

  /**
   * Parse llvm-cov JSON data.
   */
  private parseLlvmCovJson(
    json: any,
    verbose: boolean
  ): Map<string, LineCoverageData> {
    const result = new Map<string, LineCoverageData>();

    if (!json.data || !Array.isArray(json.data)) {
      return result;
    }

    for (const dataEntry of json.data) {
      if (!dataEntry.files || !Array.isArray(dataEntry.files)) {
        continue;
      }

      for (const file of dataEntry.files) {
        const filePath = file.filename;
        const coverage = this.createEmptyLineCoverage(filePath);

        // Process segments to determine line coverage
        if (file.segments && Array.isArray(file.segments)) {
          // Track coverage state per line
          const lineCoverage = new Map<number, boolean>();

          for (const segment of file.segments) {
            // Segment: [line, col, count, hasCount, isRegionEntry, isGapRegion]
            const line = segment[0];
            const count = segment[2];
            const hasCount = segment[3];

            if (!hasCount || line === undefined) {
              continue;
            }

            // A line is covered if any segment on it has count > 0
            const currentCovered = lineCoverage.get(line) || false;
            lineCoverage.set(line, currentCovered || count > 0);
          }

          // Convert to LineCoverageData
          for (const [lineNum, covered] of lineCoverage) {
            coverage.executableLines.add(lineNum);
            if (covered) {
              coverage.coveredLines.add(lineNum);
            } else {
              coverage.uncoveredLines.add(lineNum);
            }
          }
        }

        // Alternative: use summary data if segments not available
        if (coverage.executableLines.size === 0 && file.summary?.lines) {
          // In fast mode, we might only have summary data
          // Store it for later use
          (coverage as any).fileLevelCoverage = file.summary.lines.percent || 0;
        }

        if (coverage.executableLines.size > 0 || (coverage as any).fileLevelCoverage !== undefined) {
          result.set(filePath, coverage);

          if (verbose) {
            const covered = coverage.coveredLines.size;
            const total = coverage.executableLines.size;
            console.log(`  ${filePath}: ${covered}/${total} lines covered`);
          }
        }
      }
    }

    return result;
  }
}
