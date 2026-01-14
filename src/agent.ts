import inquirer from 'inquirer';
import { execa } from 'execa';
import fs from 'fs';
import { logger } from './ui';

export const selectAgent = async (): Promise<string> => {
  const answer = await inquirer.prompt([
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

export const generatePrompt = (filePath: string): string => {
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
  } catch (e) {
    return `Could not read file ${filePath}`;
  }
};

export const runAgent = async (agentName: string, prompt: string) => {
  if (agentName === 'Manual (Copy Prompt)') {
    console.log('\n--- PROMPT START ---');
    console.log(prompt);
    console.log('--- PROMPT END ---\n');
    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter after you have generated the tests...' }]);
    return;
  }

  if (agentName === 'Skip') return;

  try {
    logger.info(`Running ${agentName}...`);
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
      logger.warn(`Launching ${agentName}. Please paste the prompt if needed or interact naturally.`);
      // We can't easily feed the prompt to an interactive session without more complex logic.
      // Copying to clipboard might be a nice touch if we had 'clipboardy'.
      
      console.log('\n--- PROMPT ---');
      console.log(prompt);
      console.log('--------------\n');
      
      await execa(agentName, [], { stdio: 'inherit' });
    } else {
       // generic
       await execa(agentName, [prompt], { stdio: 'inherit' });
    }
    
  } catch (error) {
    logger.error(`Failed to run agent ${agentName}: ${error}`);
  }
};
