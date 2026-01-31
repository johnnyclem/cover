import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { execa } from 'execa';
import { logger, spinner } from './ui.js';
import { setupLLM } from './llm.js';
import { updateConfig } from './config.js';
import { scanProject, generateStubs } from './generator.js';
import { runTestFixLoop } from './fixer.js';
import { detectFramework, getAvailableFrameworks } from './frameworks/index.js';

export const runInit = async (targetPath: string = '.') => {
    // 0. Path & Permissions
    const absPath = path.resolve(targetPath);
    if (!fs.existsSync(absPath)) {
        logger.error(`Path does not exist: ${absPath}`);
        process.exit(1);
    }

    try {
        process.chdir(absPath);
        // Test write permission
        const testFile = path.join(absPath, '.cover-perm-test');
        fs.writeFileSync(testFile, '');
        fs.unlinkSync(testFile);
    } catch (e) {
        logger.error(`Insufficient permissions for ${absPath}`);
        process.exit(1);
    }

    logger.info(`Initialized in ${absPath}`);

    // 1. Git Check
    const isGit = fs.existsSync(path.join(absPath, '.git'));
    if (!isGit) {
        const { initGit } = await inquirer.prompt([{
            type: 'confirm',
            name: 'initGit',
            message: 'No git repository found. Initialize one?',
            default: true
        }]);

        if (initGit) {
            await execa('git', ['init']);
            logger.success('Git repository initialized.');
        } else {
            logger.warn('Proceeding without git (not recommended).');
        }
    }

    // 2. Auto-Generate Prompt
    const { autoGen } = await inquirer.prompt([{
        type: 'list',
        name: 'autoGen',
        message: 'Would you like to automatically generate unit tests for your project?',
        choices: ['Yes', 'No']
    }]);

    // Ensure LLM is set up regardless of choice if we need it (Yes needs it, No prompts for it)
    await setupLLM();
    // TODO: setupLLM should probably save to config now. 
    // For this prototype, setupLLM sets internal state in llm.ts. 
    // We should ideally sync that state to .coverrc here or inside setupLLM.
    // I'll assume setupLLM handles the in-memory setup for the session.

    if (autoGen === 'No') {
        // 2a. Configure & Infer
        // setupLLM covered the provider prompt.
        // Enhanced framework detection
        let framework = await detectFramework();
        if (!framework) {
            framework = 'XCTest'; // Default assumption for Swift projects
        }
        
        const availableFrameworks = getAvailableFrameworks();
        const frameworkChoices = [...availableFrameworks, 'XCTest', 'Other'];
        
        const { confirmFramework } = await inquirer.prompt([{
            type: 'list',
            name: 'confirmFramework',
            message: `Detected testing framework: ${framework}. Is this correct?`,
            choices: frameworkChoices
        }]);
        
        let finalFramework = confirmFramework;
        if (finalFramework === 'Other') {
            const answer = await inquirer.prompt([{ 
                type: 'list', 
                name: 'fw', 
                message: 'Select your testing framework:',
                choices: availableFrameworks.map(f => ({ name: f, value: f })).concat([{ name: 'Custom', value: 'custom' }])
            }]);
            
            if (answer.fw === 'custom') {
                const customAnswer = await inquirer.prompt([{ 
                    type: 'input', 
                    name: 'customFramework', 
                    message: 'Enter custom framework name:' 
                }]);
                finalFramework = customAnswer.customFramework;
            } else {
                finalFramework = answer.fw;
            }
        }
        
        updateConfig({ framework: finalFramework });
        logger.success('Configuration saved.');
        
    } else {
        // 2b. Yes - The Big Plan
        const scanSpin = spinner('Scanning project...').start();
        const plan = await scanProject();
        scanSpin.succeed(`Found ${plan.length} source files.`);
        
        const stubSpin = spinner('Analyzing code to generate test plan (this may take a while)...').start();
        const plannedStubs = await generateStubs(plan);
        stubSpin.succeed('Plan generated.');
        
        // Show Plan
        logger.info('\nProposed Test Plan:');
        plannedStubs.forEach(p => {
            const status = p.exists ? '(Update)' : '(Create)';
            logger.info(`${status} ${p.testPath}`);
            p.stubs.forEach(s => logger.info(`  - ${s}`));
        });
        
        const { confirmPlan } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmPlan',
            message: 'Do you want to proceed with this plan?',
            default: true
        }]);
        
        if (!confirmPlan) return;
        
        // Corktree / Branch
        try {
            await execa('git', ['checkout', '-b', 'cover/auto-tests']);
            logger.success('Created branch cover/auto-tests');
        } catch (e) {
            logger.warn('Could not create branch (maybe it exists?). Proceeding in current branch.');
        }
        
        // Write Stubs
        for (const item of plannedStubs) {
            // Write stub file
            const stubContent = `
import XCTest
@testable import ${path.basename(item.sourcePath, '.swift')} // naive module name assumption

class ${path.basename(item.testPath, '.swift')}: XCTestCase {
    ${item.stubs.map(s => `
    func ${s}() {
        XCTFail("Not implemented")
    }
    `).join('\n')}
}
`;
            // Ensure dir exists
            fs.mkdirSync(path.dirname(item.testPath), { recursive: true });
            fs.writeFileSync(item.testPath, stubContent);
        }
        
        logger.success('Stubs created. Starting Implementation & Fix Loop...');
        
        // Run Fix Loop
        // We need a scheme.
        const { scheme } = await inquirer.prompt([{
            type: 'input',
            name: 'scheme',
            message: 'Enter Xcode Scheme to run newly created tests:',
            validate: (s) => s.length > 0
        }]);
        
        await runTestFixLoop(scheme, undefined, 5); // Give it 5 retries
    }
};
