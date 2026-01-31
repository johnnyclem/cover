/**
 * TypeScript type definitions for xcsift output.
 * These types match the JSON output from the xcsift CLI tool.
 *
 * xcsift parses xcodebuild/swift build output and returns structured JSON
 * containing errors, warnings, test failures, coverage data, and more.
 */
/** Default xcsift configuration */
export const DEFAULT_XCSIFT_CONFIG = {
    enabled: true,
    mode: 'auto',
    slowThreshold: 1.0,
    includeWarnings: true,
    includeBuildInfo: false,
    mcpCommand: 'xcsift-mcp',
    mcpArgs: []
};
