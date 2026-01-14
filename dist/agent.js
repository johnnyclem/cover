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
const llm_1 = require("./llm");
const selectAgent = async () => {
    const answer = await inquirer_1.default.prompt([
        {
            type: 'list',
            name: 'agent',
            message: 'Select an AI agent to generate tests:',
            choices: [
                'Internal Auto-Generate',
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
    if (agentName === 'Internal Auto-Generate') {
        await generateInternal(prompt);
        return;
    }
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
        if (agentName === 'opencode') {
            ui_1.logger.warn(`Launching ${agentName}. Please paste the prompt if needed or interact naturally.`);
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
const generateInternal = async (prompt) => {
    try {
        const fixer = (0, llm_1.getFixerClient)();
        const spin = (0, ui_1.spinner)(`Generating tests with ${fixer.model}...`).start();
        const response = await fixer.client.chat.completions.create({
            model: fixer.model,
            messages: [{ role: 'user', content: prompt }]
        });
        let code = response.choices[0].message.content || '';
        code = code.replace(/```swift/g, '').replace(/```/g, '').trim();
        spin.succeed('Tests generated.');
        // Ask where to save
        const answer = await inquirer_1.default.prompt([{
                type: 'input',
                name: 'path',
                message: 'Where should I save the test file?',
                default: 'Tests/GeneratedTests.swift',
                validate: (input) => input.endsWith('.swift') ? true : 'Must be a .swift file'
            }]);
        // Ensure directory exists
        const dir = answer.path.substring(0, answer.path.lastIndexOf('/'));
        if (dir && !fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(answer.path, code);
        ui_1.logger.success(`Tests saved to ${answer.path}`);
    }
    catch (e) {
        ui_1.logger.error(`Generation failed: ${e.message}`);
    }
};
