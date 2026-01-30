"use strict";
/**
 * TypeScript type definitions for xcsift output.
 * These types match the JSON output from the xcsift CLI tool.
 *
 * xcsift parses xcodebuild/swift build output and returns structured JSON
 * containing errors, warnings, test failures, coverage data, and more.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_XCSIFT_CONFIG = void 0;
/** Default xcsift configuration */
exports.DEFAULT_XCSIFT_CONFIG = {
    enabled: true,
    mode: 'auto',
    slowThreshold: 1.0,
    includeWarnings: true,
    includeBuildInfo: false,
    mcpCommand: 'xcsift-mcp',
    mcpArgs: []
};
