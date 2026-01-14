"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgent = exports.generatePrompt = exports.selectAgent = void 0;
const inquirer_1 = __importDefault(require("inquirer"));
const execa_1 = require("execa");
const fs_1 = __importDefault(require("fs"));
const ui_1 = require("./ui");
const selectAgent = async () => {
    const answer = await inquirer_1.default.prompt([
        {
            type: 'list',
            name: 'agent',
            message: 'Select an AI agent to generate tests:',
            choices: [
                'opencode',
                'claude-code',
                'codex-cli',
                'gemini-cli',
                'Manual (Copy Prompt)',
                'Skip'
            ]
        }
    ]);
    return answer.agent;
};
exports.selectAgent = selectAgent;
const generatePrompt = (filePath) => {
    try {
        const content = fs_1.default.readFileSync(filePath, 'utf-8');
        return `
You are an expert iOS/macOS developer.
I need you to write unit tests for the following file: ${filePath}

The current code coverage is low.
Please write a standard XCTestCase for this file.
Do NOT modify the source file. Only provide the test code.
Assume standard project structure.

Here is the source code:
\`\`\`swift
${content}
\`\`\`

Return only the Swift code for the test file.
`;
    }
    catch (e) {
        return `Could not read file ${filePath}`;
    }
};
exports.generatePrompt = generatePrompt;
const runAgent = async (agentName, prompt) => {
    if (agentName === 'Manual (Copy Prompt)') {
        console.log('\n--- PROMPT START ---');
        console.log(prompt);
        console.log('--- PROMPT END ---\n');
        await inquirer_1.default.prompt([{ type: 'input', name: 'continue', message: 'Press Enter after you have generated the tests...' }]);
        return;
    }
    if (agentName === 'Skip')
        return;
    try {
        ui_1.logger.info(`Running ${agentName}...`);
        // This is a naive implementation assuming the agent takes the prompt as an argument or via stdin
        // Adjust based on actual CLI tool signatures.
        // For now, we assume standard "tool 'prompt'" or similar.
        // Since these tools vary wildly, we might just print the prompt for now unless we know the specific flag.
        // Fallback to manual for safety in this prototype unless user explicitly configured it
        // But the requirements asked to support it.
        // Let's assume 'opencode' takes a prompt string.
        if (agentName === 'opencode') {
            // Opencode might be interactive, so 'inherit' stdio is good.
            // But passing a prompt via CLI arg might be: opencode --prompt "..."
            // Or just opencode and let user paste.
            ui_1.logger.warn(`Launching ${agentName}. Please paste the prompt if needed or interact naturally.`);
            // We can't easily feed the prompt to an interactive session without more complex logic.
            // Copying to clipboard might be a nice touch if we had 'clipboardy'.
            console.log('\n--- PROMPT ---');
            console.log(prompt);
            console.log('--------------\n');
            await (0, execa_1.execa)(agentName, [], { stdio: 'inherit' });
        }
        else {
            // generic
            await (0, execa_1.execa)(agentName, [prompt], { stdio: 'inherit' });
        }
    }
    catch (error) {
        ui_1.logger.error(`Failed to run agent ${agentName}: ${error}`);
    }
};
exports.runAgent = runAgent;
