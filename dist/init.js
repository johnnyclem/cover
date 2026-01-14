"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInit = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const inquirer_1 = __importDefault(require("inquirer"));
const execa_1 = require("execa");
const ui_1 = require("./ui");
const llm_1 = require("./llm");
const config_1 = require("./config");
const generator_1 = require("./generator");
const fixer_1 = require("./fixer");
const runInit = async (targetPath = '.') => {
    // 0. Path & Permissions
    const absPath = path_1.default.resolve(targetPath);
    if (!fs_1.default.existsSync(absPath)) {
        ui_1.logger.error(`Path does not exist: ${absPath}`);
        process.exit(1);
    }
    try {
        process.chdir(absPath);
        // Test write permission
        const testFile = path_1.default.join(absPath, '.cover-perm-test');
        fs_1.default.writeFileSync(testFile, '');
        fs_1.default.unlinkSync(testFile);
    }
    catch (e) {
        ui_1.logger.error(`Insufficient permissions for ${absPath}`);
        process.exit(1);
    }
    ui_1.logger.info(`Initialized in ${absPath}`);
    // 1. Git Check
    const isGit = fs_1.default.existsSync(path_1.default.join(absPath, '.git'));
    if (!isGit) {
        const { initGit } = await inquirer_1.default.prompt([{
                type: 'confirm',
                name: 'initGit',
                message: 'No git repository found. Initialize one?',
                default: true
            }]);
        if (initGit) {
            await (0, execa_1.execa)('git', ['init']);
            ui_1.logger.success('Git repository initialized.');
        }
        else {
            ui_1.logger.warn('Proceeding without git (not recommended).');
        }
    }
    // 2. Auto-Generate Prompt
    const { autoGen } = await inquirer_1.default.prompt([{
            type: 'list',
            name: 'autoGen',
            message: 'Would you like to automatically generate unit tests for your project?',
            choices: ['Yes', 'No']
        }]);
    // Ensure LLM is set up regardless of choice if we need it (Yes needs it, No prompts for it)
    await (0, llm_1.setupLLM)();
    // TODO: setupLLM should probably save to config now. 
    // For this prototype, setupLLM sets internal state in llm.ts. 
    // We should ideally sync that state to .coverrc here or inside setupLLM.
    // I'll assume setupLLM handles the in-memory setup for the session.
    if (autoGen === 'No') {
        // 2a. Configure & Infer
        // setupLLM covered the provider prompt.
        // Infer framework
        let framework = 'XCTest'; // Default assumption
        if (fs_1.default.existsSync('package.json')) {
            const pkg = JSON.parse(fs_1.default.readFileSync('package.json', 'utf-8'));
            if (pkg.dependencies?.jest || pkg.devDependencies?.jest)
                framework = 'Jest';
            if (pkg.dependencies?.mocha || pkg.devDependencies?.mocha)
                framework = 'Mocha';
        }
        const { confirmFramework } = await inquirer_1.default.prompt([{
                type: 'list',
                name: 'confirmFramework',
                message: `Detected testing framework: ${framework}. Is this correct?`,
                choices: [framework, 'Other']
            }]);
        let finalFramework = confirmFramework;
        if (finalFramework === 'Other') {
            const answer = await inquirer_1.default.prompt([{ type: 'input', name: 'fw', message: 'Enter framework name:' }]);
            finalFramework = answer.fw;
        }
        (0, config_1.updateConfig)({ framework: finalFramework });
        ui_1.logger.success('Configuration saved.');
    }
    else {
        // 2b. Yes - The Big Plan
        const scanSpin = (0, ui_1.spinner)('Scanning project...').start();
        const plan = await (0, generator_1.scanProject)();
        scanSpin.succeed(`Found ${plan.length} source files.`);
        const stubSpin = (0, ui_1.spinner)('Analyzing code to generate test plan (this may take a while)...').start();
        const plannedStubs = await (0, generator_1.generateStubs)(plan);
        stubSpin.succeed('Plan generated.');
        // Show Plan
        ui_1.logger.info('\nProposed Test Plan:');
        plannedStubs.forEach(p => {
            const status = p.exists ? '(Update)' : '(Create)';
            ui_1.logger.info(`${status} ${p.testPath}`);
            p.stubs.forEach(s => ui_1.logger.info(`  - ${s}`));
        });
        const { confirmPlan } = await inquirer_1.default.prompt([{
                type: 'confirm',
                name: 'confirmPlan',
                message: 'Do you want to proceed with this plan?',
                default: true
            }]);
        if (!confirmPlan)
            return;
        // Corktree / Branch
        try {
            await (0, execa_1.execa)('git', ['checkout', '-b', 'cover/auto-tests']);
            ui_1.logger.success('Created branch cover/auto-tests');
        }
        catch (e) {
            ui_1.logger.warn('Could not create branch (maybe it exists?). Proceeding in current branch.');
        }
        // Write Stubs
        for (const item of plannedStubs) {
            // Write stub file
            const stubContent = `
import XCTest
@testable import ${path_1.default.basename(item.sourcePath, '.swift')} // naive module name assumption

class ${path_1.default.basename(item.testPath, '.swift')}: XCTestCase {
    ${item.stubs.map(s => `
    func ${s}() {
        XCTFail("Not implemented")
    }
    `).join('\n')}
}
`;
            // Ensure dir exists
            fs_1.default.mkdirSync(path_1.default.dirname(item.testPath), { recursive: true });
            fs_1.default.writeFileSync(item.testPath, stubContent);
        }
        ui_1.logger.success('Stubs created. Starting Implementation & Fix Loop...');
        // Run Fix Loop
        // We need a scheme.
        const { scheme } = await inquirer_1.default.prompt([{
                type: 'input',
                name: 'scheme',
                message: 'Enter Xcode Scheme to run newly created tests:',
                validate: (s) => s.length > 0
            }]);
        await (0, fixer_1.runTestFixLoop)(scheme, undefined, 5); // Give it 5 retries
    }
};
exports.runInit = runInit;
