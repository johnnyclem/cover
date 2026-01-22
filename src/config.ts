import fs from 'fs';
import path from 'path';
import { TestingFrameworkConfig } from './types.js';

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
