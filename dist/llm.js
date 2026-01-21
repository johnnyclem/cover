"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFixerClient = exports.getAnalyzerClient = exports.setupLLM = void 0;
const openai_1 = __importDefault(require("openai"));
const inquirer_1 = __importDefault(require("inquirer"));
const ui_1 = require("./ui");
// Default to a common local setup (e.g., Ollama or LM Studio)
let localConfig = {
    provider: 'local',
    baseUrl: 'http://localhost:1234/v1', // LM Studio default
    apiKey: 'lm-studio',
    model: 'glm-4.7-flash', // Example capable local model
};
let activeConfig = null;
let remoteConfig = null;
const setupLLM = async () => {
    // 1. Check if local server is running
    const isLocalRunning = await checkLocalConnection(localConfig.baseUrl);
    if (isLocalRunning) {
        ui_1.logger.info('Local LLM detected at ' + localConfig.baseUrl);
        activeConfig = localConfig;
        return;
    }
    ui_1.logger.warn('No local LLM detected at default port (1234).');
    const answer = await inquirer_1.default.prompt([{
            type: 'list',
            name: 'choice',
            message: 'How would you like to run the AI agent?',
            choices: [
                { name: 'Configure different Local LLM URL (Recommended)', value: 'local_custom' },
                { name: 'Use OpenAI (Requires API Key & Egress Permission)', value: 'openai' },
                { name: 'Skip (Agent features disabled)', value: 'skip' }
            ]
        }]);
    if (answer.choice === 'local_custom') {
        const custom = await inquirer_1.default.prompt([
            { type: 'input', name: 'url', message: 'Enter Base URL:', default: 'http://localhost:11434/v1' },
            { type: 'input', name: 'model', message: 'Enter Model Name:', default: 'llama3' }
        ]);
        localConfig.baseUrl = custom.url;
        localConfig.model = custom.model;
        activeConfig = localConfig;
    }
    else if (answer.choice === 'openai') {
        const confirmation = await inquirer_1.default.prompt([{
                type: 'confirm',
                name: 'agree',
                message: '⚠️  SECURITY WARNING: This will send code snippets and build logs to OpenAI. Do you agree?',
                default: false
            }]);
        if (!confirmation.agree) {
            ui_1.logger.error('Permission denied. Agent disabled.');
            return;
        }
        const creds = await inquirer_1.default.prompt([{
                type: 'password',
                name: 'key',
                message: 'Enter OpenAI API Key:'
            }]);
        remoteConfig = {
            provider: 'openai',
            apiKey: creds.key,
            model: 'gpt-4-turbo'
        };
        activeConfig = remoteConfig;
    }
};
exports.setupLLM = setupLLM;
const checkLocalConnection = async (url) => {
    try {
        const response = await fetch(`${url}/models`);
        return response.ok;
    }
    catch (e) {
        return false;
    }
};
const getAnalyzerClient = () => {
    if (!activeConfig)
        throw new Error('LLM not configured.');
    // Always use the active config (which is local if available, or remote if user opted-in)
    return {
        client: new openai_1.default({
            baseURL: activeConfig.baseUrl,
            apiKey: activeConfig.apiKey
        }),
        model: activeConfig.model
    };
};
exports.getAnalyzerClient = getAnalyzerClient;
const getFixerClient = () => {
    if (!activeConfig)
        throw new Error('LLM not configured.');
    // For now, simpler to just use the same active config for both
    // unless we want to split them later.
    return {
        client: new openai_1.default({
            baseURL: activeConfig.baseUrl,
            apiKey: activeConfig.apiKey
        }),
        model: activeConfig.model
    };
};
exports.getFixerClient = getFixerClient;
