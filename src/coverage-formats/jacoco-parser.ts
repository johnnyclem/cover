import { CoverageFormat, LineCoverageData } from '../types.js';
import { BaseCoverageParser, ParserOptions } from './base-parser.js';
import fs from 'fs';

/**
 * Parser for JaCoCo XML coverage format.
 * 
 * JaCoCo XML format reference:
 * ```xml
 * <report name="...">
 *   <package name="com/example">
 *     <sourcefile name="Example.java">
 *       <line nr="1" mi="0" ci="5" mb="0" cb="0"/>
 *       <line nr="2" mi="3" ci="0" mb="0" cb="0"/>
 *     </sourcefile>
 *   </package>
 * </report>
 * ```
 * 
 * Where:
 * - nr: line number
 * - mi: missed instructions
 * - ci: covered instructions
 * - mb: missed branches
 * - cb: covered branches
 * 
 * A line is considered covered if ci > 0.
 * A line is considered uncovered if ci = 0 and mi > 0.
 */
export class JacocoParser extends BaseCoverageParser {
  readonly format: CoverageFormat = 'jacoco';
  readonly fileExtensions = ['.xml'];

  async parse(
    artifactPaths: string[],
    options: ParserOptions = {}
  ): Promise<Map<string, LineCoverageData>> {
    const result = new Map<string, LineCoverageData>();
    const { verbose = false } = options;

    for (const filePath of artifactPaths) {
      if (verbose) {
        console.log(`Parsing JaCoCo XML file: ${filePath}`);
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Check if this is actually a JaCoCo file
        if (!content.includes('<report') || !content.includes('</report>')) {
          if (verbose) {
            console.log(`Skipping ${filePath} - not a JaCoCo report`);
          }
          continue;
        }

        const fileResults = this.parseJacocoXml(content, verbose);
        
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
          console.error(`Failed to parse JaCoCo file ${filePath}:`, error);
        }
      }
    }

    return result;
  }

  /**
   * Parse JaCoCo XML content using regex (lightweight, no XML lib needed).
   * For production use, consider using fast-xml-parser.
   */
  private parseJacocoXml(
    content: string,
    verbose: boolean
  ): Map<string, LineCoverageData> {
    const result = new Map<string, LineCoverageData>();

    // Match package elements to get the package name
    const packageRegex = /<package\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/package>/g;
    let packageMatch;

    while ((packageMatch = packageRegex.exec(content)) !== null) {
      const packageName = packageMatch[1].replace(/\//g, '.');
      const packageContent = packageMatch[2];

      // Match sourcefile elements within the package
      const sourcefileRegex = /<sourcefile\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/sourcefile>/g;
      let sourcefileMatch;

      while ((sourcefileMatch = sourcefileRegex.exec(packageContent)) !== null) {
        const fileName = sourcefileMatch[1];
        const sourcefileContent = sourcefileMatch[2];

        // Construct full path (package + filename)
        const fullPath = `${packageName.replace(/\./g, '/')}/${fileName}`;
        const coverage = this.createEmptyLineCoverage(fullPath);

        // Match line elements
        const lineRegex = /<line\s+nr="(\d+)"\s+mi="(\d+)"\s+ci="(\d+)"/g;
        let lineMatch;

        while ((lineMatch = lineRegex.exec(sourcefileContent)) !== null) {
          const lineNum = parseInt(lineMatch[1], 10);
          const missedInstructions = parseInt(lineMatch[2], 10);
          const coveredInstructions = parseInt(lineMatch[3], 10);

          // Only consider lines with instructions (executable lines)
          if (missedInstructions > 0 || coveredInstructions > 0) {
            coverage.executableLines.add(lineNum);

            if (coveredInstructions > 0) {
              coverage.coveredLines.add(lineNum);
            } else {
              coverage.uncoveredLines.add(lineNum);
            }
          }
        }

        if (coverage.executableLines.size > 0) {
          result.set(fullPath, coverage);

          if (verbose) {
            const covered = coverage.coveredLines.size;
            const total = coverage.executableLines.size;
            console.log(`  ${fullPath}: ${covered}/${total} lines covered`);
          }
        }
      }
    }

    return result;
  }
}
