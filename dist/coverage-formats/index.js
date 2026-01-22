"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlvmCovParser = exports.JacocoParser = exports.LcovParser = exports.XccovParser = exports.BaseCoverageParser = void 0;
exports.getParser = getParser;
exports.detectFormat = detectFormat;
exports.getSupportedFormats = getSupportedFormats;
exports.resolveGlobPatterns = resolveGlobPatterns;
exports.findManifest = findManifest;
exports.loadManifest = loadManifest;
exports.findExistingXcresult = findExistingXcresult;
exports.parseCoverageArtifacts = parseCoverageArtifacts;
const xccov_parser_1 = require("./xccov-parser");
const lcov_parser_1 = require("./lcov-parser");
const jacoco_parser_1 = require("./jacoco-parser");
const llvm_cov_parser_1 = require("./llvm-cov-parser");
const glob_1 = require("glob");
const fs_1 = __importDefault(require("fs"));
// Registry of all available parsers
const parsers = [
    new xccov_parser_1.XccovParser(),
    new lcov_parser_1.LcovParser(),
    new jacoco_parser_1.JacocoParser(),
    new llvm_cov_parser_1.LlvmCovParser(),
];
/**
 * Get the appropriate parser for a given format.
 */
function getParser(format) {
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
function detectFormat(filePath) {
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
function getSupportedFormats() {
    return parsers.map(p => p.format);
}
/**
 * Resolve glob patterns to actual file paths.
 */
async function resolveGlobPatterns(patterns) {
    const results = [];
    for (const pattern of patterns) {
        if (pattern.includes('*')) {
            const matches = await (0, glob_1.glob)(pattern);
            results.push(...matches);
        }
        else {
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
function findManifest() {
    for (const location of MANIFEST_LOCATIONS) {
        if (fs_1.default.existsSync(location)) {
            return location;
        }
    }
    return null;
}
/**
 * Load and parse a coverage manifest file.
 */
function loadManifest(manifestPath) {
    const content = fs_1.default.readFileSync(manifestPath, 'utf-8');
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
async function findExistingXcresult() {
    for (const pattern of XCRESULT_LOCATIONS) {
        if (pattern.includes('*')) {
            const matches = await (0, glob_1.glob)(pattern);
            if (matches.length > 0) {
                // Return the most recently modified one
                const sorted = matches.sort((a, b) => {
                    const statA = fs_1.default.statSync(a);
                    const statB = fs_1.default.statSync(b);
                    return statB.mtimeMs - statA.mtimeMs;
                });
                return sorted[0];
            }
        }
        else if (fs_1.default.existsSync(pattern)) {
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
async function parseCoverageArtifacts(options) {
    const { parserOptions = {} } = options;
    let format = options.format;
    let paths = options.paths || [];
    // Try to load from manifest if no paths provided
    if (paths.length === 0 && options.manifestPath) {
        const manifest = loadManifest(options.manifestPath);
        if (manifest.artifacts && manifest.artifacts.length > 0) {
            // Multiple formats in manifest - parse each separately and merge
            const allResults = new Map();
            for (const artifact of manifest.artifacts) {
                const parser = getParser(artifact.format);
                const resolvedPaths = await resolveGlobPatterns([artifact.path]);
                const results = await parser.parse(resolvedPaths, parserOptions);
                for (const [path, coverage] of results) {
                    allResults.set(path, coverage);
                }
            }
            return allResults;
        }
        else if (manifest.format && manifest.paths) {
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
var base_parser_1 = require("./base-parser");
Object.defineProperty(exports, "BaseCoverageParser", { enumerable: true, get: function () { return base_parser_1.BaseCoverageParser; } });
var xccov_parser_2 = require("./xccov-parser");
Object.defineProperty(exports, "XccovParser", { enumerable: true, get: function () { return xccov_parser_2.XccovParser; } });
var lcov_parser_2 = require("./lcov-parser");
Object.defineProperty(exports, "LcovParser", { enumerable: true, get: function () { return lcov_parser_2.LcovParser; } });
var jacoco_parser_2 = require("./jacoco-parser");
Object.defineProperty(exports, "JacocoParser", { enumerable: true, get: function () { return jacoco_parser_2.JacocoParser; } });
var llvm_cov_parser_2 = require("./llvm-cov-parser");
Object.defineProperty(exports, "LlvmCovParser", { enumerable: true, get: function () { return llvm_cov_parser_2.LlvmCovParser; } });
