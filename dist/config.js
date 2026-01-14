"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateConfig = exports.saveConfig = exports.loadConfig = void 0;
const fs_1 = __importDefault(require("fs"));
const CONFIG_FILE = '.coverrc';
const loadConfig = () => {
    if (fs_1.default.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs_1.default.readFileSync(CONFIG_FILE, 'utf-8'));
        }
        catch (e) {
            return null;
        }
    }
    return null;
};
exports.loadConfig = loadConfig;
const saveConfig = (config) => {
    fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};
exports.saveConfig = saveConfig;
const updateConfig = (partial) => {
    const current = (0, exports.loadConfig)() || {};
    (0, exports.saveConfig)({ ...current, ...partial });
};
exports.updateConfig = updateConfig;
