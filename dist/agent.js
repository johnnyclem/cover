import inquirer from 'inquirer';
import { execa } from 'execa';
import fs from 'fs';
import { logger, spinner } from './ui.js';
import { getFixerClient } from './llm.js';
export const selectAgent = async () => {
    const answer = await inquirer.prompt([
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
export const generatePrompt = (filePath) => {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
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
export const runAgent = async (agentName, prompt) => {
    if (agentName === 'Internal Auto-Generate') {
        await generateInternal(prompt);
        return;
    }
    if (agentName === 'Manual (Copy Prompt)') {
        console.log('\n--- PROMPT START ---');
        console.log(prompt);
        console.log('--- PROMPT END ---\n');
        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter after you have generated the tests...' }]);
        return;
    }
    if (agentName === 'Skip')
        return;
    try {
        logger.info(`Running ${agentName}...`);
        if (agentName === 'opencode') {
            logger.warn(`Launching ${agentName}. Please paste the prompt if needed or interact naturally.`);
            console.log('\n--- PROMPT ---');
            console.log(prompt);
            console.log('--------------\n');
            await execa(agentName, [], { stdio: 'inherit' });
        }
        else {
            // generic
            await execa(agentName, [prompt], { stdio: 'inherit' });
        }
    }
    catch (error) {
        logger.error(`Failed to run agent ${agentName}: ${error}`);
    }
};
const generateInternal = async (prompt) => {
    try {
        const fixer = getFixerClient();
        const spin = spinner(`Generating tests with ${fixer.model}...`).start();
        const response = await fixer.client.chat.completions.create({
            model: fixer.model,
            messages: [{ role: 'user', content: prompt }]
        });
        let code = response.choices[0].message.content || '';
        code = code.replace(/```swift/g, '').replace(/```/g, '').trim();
        spin.succeed('Tests generated.');
        // Ask where to save
        const answer = await inquirer.prompt([{
                type: 'input',
                name: 'path',
                message: 'Where should I save the test file?',
                default: 'Tests/GeneratedTests.swift',
                validate: (input) => input.endsWith('.swift') ? true : 'Must be a .swift file'
            }]);
        // Ensure directory exists
        const dir = answer.path.substring(0, answer.path.lastIndexOf('/'));
        if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(answer.path, code);
        logger.success(`Tests saved to ${answer.path}`);
    }
    catch (e) {
        logger.error(`Generation failed: ${e.message}`);
    }
};
