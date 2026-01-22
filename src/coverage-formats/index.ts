import { CoverageFormat, LineCoverageData, CoverageManifest } from '../types';
import { BaseCoverageParser, ParserOptions } from './base-parser';
import { XccovParser } from './xccov-parser';
import { LcovParser } from './lcov-parser';
import { JacocoParser } from './jacoco-parser';
import { LlvmCovParser } from './llvm-cov-parser';
import { glob } from 'glob';
import fs from 'fs';
import path from 'path';

// Registry of all available parsers
const parsers: BaseCoverageParser[] = [
  new XccovParser(),
  new LcovParser(),
  new JacocoParser(),
  new LlvmCovParser(),
];

/**
 * Get the appropriate parser for a given format.
 */
export function getParser(format: CoverageFormat): BaseCoverageParser {
  const parser = parsers.find(p => p.format === format);
  if (!parser) {
    throw new Error(`Unsupported coverage format: ${format}. Supported formats: ${getSupportedFormats().join(', ')}`);
  }
  return parser;
}

/**
 * Detect coverage format from file path/extension.
 * Returns null if format cannot be determined.
 */
export function detectFormat(filePath: string): CoverageFormat | null {
  for (const parser of parsers) {
    if (parser.canHandle(filePath)) {
      return parser.format;
    }
  }
  return null;
}

/**
 * Get list of supported coverage formats.
 */
export function getSupportedFormats(): CoverageFormat[] {
  return parsers.map(p => p.format);
}

/**
 * Resolve glob patterns to actual file paths.
 */
export async function resolveGlobPatterns(patterns: string[]): Promise<string[]> {
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
 * Standard locations to check for coverage manifests.
 */
const MANIFEST_LOCATIONS = [
  '.cover-manifest.json',
  'coverage/manifest.json',
  'coverage/.manifest.json',
  '.coverage-manifest.json',
];

/**
 * Try to find a manifest file in standard locations.
 */
export function findManifest(): string | null {
  for (const location of MANIFEST_LOCATIONS) {
    if (fs.existsSync(location)) {
      return location;
    }
  }
  return null;
}

/**
 * Load and parse a coverage manifest file.
 */
export function loadManifest(manifestPath: string): CoverageManifest {
  const content = fs.readFileSync(manifestPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Standard locations to check for existing xcresult bundles.
 */
const XCRESULT_LOCATIONS = [
  'build/TestResult.xcresult',
  'DerivedData/TestResult.xcresult',
  '*.xcresult',
  'build/*.xcresult',
];

/**
 * Try to find an existing xcresult bundle.
 */
export async function findExistingXcresult(): Promise<string | null> {
  for (const pattern of XCRESULT_LOCATIONS) {
    if (pattern.includes('*')) {
      const matches = await glob(pattern);
      if (matches.length > 0) {
        // Return the most recently modified one
        const sorted = matches.sort((a, b) => {
          const statA = fs.statSync(a);
          const statB = fs.statSync(b);
          return statB.mtimeMs - statA.mtimeMs;
        });
        return sorted[0];
      }
    } else if (fs.existsSync(pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Parse coverage artifacts into line-level coverage data.
 * 
 * This is the main entry point for coverage parsing. It handles:
 * - Format detection (if not specified)
 * - Glob pattern resolution
 * - Manifest loading
 * - Calling the appropriate parser
 */
export async function parseCoverageArtifacts(
  options: {
    format?: CoverageFormat;
    paths?: string[];
    manifestPath?: string;
    parserOptions?: ParserOptions;
  }
): Promise<Map<string, LineCoverageData>> {
  const { parserOptions = {} } = options;
  let format = options.format;
  let paths = options.paths || [];

  // Try to load from manifest if no paths provided
  if (paths.length === 0 && options.manifestPath) {
    const manifest = loadManifest(options.manifestPath);
    
    if (manifest.artifacts && manifest.artifacts.length > 0) {
      // Multiple formats in manifest - parse each separately and merge
      const allResults = new Map<string, LineCoverageData>();
      
      for (const artifact of manifest.artifacts) {
        const parser = getParser(artifact.format);
        const resolvedPaths = await resolveGlobPatterns([artifact.path]);
        const results = await parser.parse(resolvedPaths, parserOptions);
        
        for (const [path, coverage] of results) {
          allResults.set(path, coverage);
        }
      }
      
      return allResults;
    } else if (manifest.format && manifest.paths) {
      format = manifest.format;
      paths = manifest.paths;
    }
  }

  // Resolve globs
  const resolvedPaths = await resolveGlobPatterns(paths);
  
  if (resolvedPaths.length === 0) {
    throw new Error('No coverage artifacts found');
  }

  // Detect format if not specified
  if (!format) {
    const detected = detectFormat(resolvedPaths[0]);
    if (!detected) {
      throw new Error(`Could not detect coverage format for: ${resolvedPaths[0]}`);
    }
    format = detected;
  }

  // Get parser and parse
  const parser = getParser(format);
  return await parser.parse(resolvedPaths, parserOptions);
}

// Re-export base parser for extension
export { BaseCoverageParser, ParserOptions } from './base-parser';
export { XccovParser } from './xccov-parser';
export { LcovParser } from './lcov-parser';
export { JacocoParser } from './jacoco-parser';
export { LlvmCovParser } from './llvm-cov-parser';
