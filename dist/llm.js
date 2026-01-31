import OpenAI from 'openai';
import inquirer from 'inquirer';
import { logger } from './ui.js';
// Default to a common local setup (e.g., Ollama or LM Studio)
let localConfig = {
    provider: 'local',
    baseUrl: 'http://localhost:1234/v1', // LM Studio default
    apiKey: 'lm-studio',
    model: 'openai/gpt-oss-20b', // Example capable local mode0l
};
let activeConfig = null;
let remoteConfig = null;
export const setupLLM = async () => {
    // 1. Check if local server is running
    const isLocalRunning = await checkLocalConnection(localConfig.baseUrl);
    if (isLocalRunning) {
        logger.info('Local LLM detected at ' + localConfig.baseUrl);
        activeConfig = localConfig;
        return;
    }
    logger.warn('No local LLM detected at default port (1234).');
    const answer = await inquirer.prompt([{
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
        const custom = await inquirer.prompt([
            { type: 'input', name: 'url', message: 'Enter Base URL:', default: 'http://localhost:11434/v1' },
            { type: 'input', name: 'model', message: 'Enter Model Name:', default: 'llama3' }
        ]);
        localConfig.baseUrl = custom.url;
        localConfig.model = custom.model;
        activeConfig = localConfig;
    }
    else if (answer.choice === 'openai') {
        const confirmation = await inquirer.prompt([{
                type: 'confirm',
                name: 'agree',
                message: '⚠️  SECURITY WARNING: This will send code snippets and build logs to OpenAI. Do you agree?',
                default: false
            }]);
        if (!confirmation.agree) {
            logger.error('Permission denied. Agent disabled.');
            return;
        }
        const creds = await inquirer.prompt([{
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
const checkLocalConnection = async (url) => {
    try {
        const response = await fetch(`${url}/models`);
        return response.ok;
    }
    catch (e) {
        return false;
    }
};
export const getAnalyzerClient = () => {
    if (!activeConfig)
        throw new Error('LLM not configured.');
    // Always use the active config (which is local if available, or remote if user opted-in)
    return {
        client: new OpenAI({
            baseURL: activeConfig.baseUrl,
            apiKey: activeConfig.apiKey
        }),
        model: activeConfig.model
    };
};
export const getFixerClient = () => {
    if (!activeConfig)
        throw new Error('LLM not configured.');
    // For now, simpler to just use the same active config for both
    // unless we want to split them later.
    return {
        client: new OpenAI({
            baseURL: activeConfig.baseUrl,
            apiKey: activeConfig.apiKey
        }),
        model: activeConfig.model
    };
};
