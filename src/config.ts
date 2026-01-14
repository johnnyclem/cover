import fs from 'fs';
import path from 'path';

export interface CoverConfig {
    framework?: string;
    llm?: {
        provider: 'local' | 'openai' | 'anthropic';
        baseUrl?: string;
        apiKey?: string;
        model: string;
    };
    paths?: {
        source: string;
        tests: string;
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
