import fs from 'fs';
const CONFIG_FILE = '.coverrc';
export const loadConfig = () => {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        }
        catch (e) {
            return null;
        }
    }
    return null;
};
export const saveConfig = (config) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};
export const updateConfig = (partial) => {
    const current = loadConfig() || {};
    saveConfig({ ...current, ...partial });
};
