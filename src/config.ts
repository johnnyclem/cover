import fs from 'fs';
import path from 'path';
import { TestingFrameworkConfig } from './types.js';
import { XcsiftConfig, XcsiftMode, DEFAULT_XCSIFT_CONFIG } from './xcsift-types';

export interface CoverConfig {
    framework?: string;
    testingFrameworks?: TestingFrameworkConfig[];
    llm?: {
        provider: 'local' | 'openai' | 'anthropic';
        baseUrl?: string;
        apiKey?: string;
        model: string;
    };
    paths?: {
        source: string;
        tests: string;
        projectRoot?: string;  // Root path for normalizing coverage paths
    };
    js?: {
        enableCoverage?: boolean;
        coverageThreshold?: number;
        testPatterns?: string[];
        sourcePatterns?: string[];
    };
    xcode?: {
        // Patterns to identify test files (excluded from coverage checks)
        testFilePatterns?: string[];
        // Patterns to identify test utility files (flagged separately)
        testUtilPatterns?: string[];
    };
    xcsift?: {
        // Whether xcsift integration is enabled (default: true)
        enabled?: boolean;
        // Parser mode: 'cli' uses xcsift binary, 'mcp' uses xcsift-mcp server, 'auto' tries both
        mode?: XcsiftMode;
        // Slow test threshold in seconds (default: 1.0)
        slowThreshold?: number;
        // Include warnings in output (default: true)
        includeWarnings?: boolean;
        // Include build timing info (default: false)
        includeBuildInfo?: boolean;
    };
    circleci?: {
        // CircleCI project slug for flaky test detection (e.g., 'gh/org/repo')
        projectSlug?: string;
        // Command to run the CircleCI MCP server
        mcpCommand?: string;
        // Arguments for the MCP server command
        mcpArgs?: string[];
    };
}

const CONFIG_FILE = '.coverrc';

export const loadConfig = (): CoverConfig | null => {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        } catch (e) {
            return null;
        }
    }
    return null;
};

export const saveConfig = (config: CoverConfig) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};

export const updateConfig = (partial: Partial<CoverConfig>) => {
    const current = loadConfig() || {};
    saveConfig({ ...current, ...partial });
};
