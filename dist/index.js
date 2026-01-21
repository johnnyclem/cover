#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const git_1 = require("./git");
const xcode_1 = require("./xcode");
const coverage_1 = require("./coverage");
const ui_1 = require("./ui");
const agent_1 = require("./agent");
const fixer_1 = require("./fixer");
const llm_1 = require("./llm");
const init_1 = require("./init");
const results_1 = require("./results");
const frameworks_1 = require("./frameworks");
const test_runner_1 = require("./test-runner");
const config_1 = require("./config");
const inquirer_1 = __importDefault(require("inquirer"));
const test_plan_1 = require("./test-plan");
const execa_1 = require("execa");
const glob_1 = require("glob");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const program = new commander_1.Command();
program
    .name('cover')
    .description('Automated TDD/Coverage loop for iOS/macOS and JavaScript/TypeScript')
    .version('1.0.0');
program.command('init [path]')
    .description('Initialize Cover in a project directory')
    .action(async (path) => {
    try {
        await (0, init_1.runInit)(path || '.');
    }
    catch (error) {
        ui_1.logger.error(error.message || error);
        process.exit(1);
    }
});
program.command('fix')
    .description('Run tests and autonomously fix failures using AI')
    .option('-s, --scheme <scheme>', 'Xcode scheme to test')
    .option('-d, --destination <destination>', 'Simulator destination')
    .option('-r, --retries <number>', 'Max retries', '3')
    .option('-f, --framework <framework>', 'Testing framework (auto-detected if not specified)')
    .option('-t, --test-files <files...>', 'Specific test files to run')
    .option('--refresh-destinations', 'Refresh the cached list of Xcode run destinations')
    .action(async (options) => {
    try {
        await (0, llm_1.setupLLM)();
        // Detect framework
        const config = (0, config_1.loadConfig)();
        let framework = options.framework || config?.framework;
        if (!framework) {
            const detected = await (0, frameworks_1.detectFramework)();
            if (detected) {
                framework = detected;
                ui_1.logger.info(`Detected framework: ${framework}`);
            }
        }
        if (framework && framework !== 'XCTest') {
            // JS/TS framework - use JSTestRunner
            const runner = new test_runner_1.JSTestRunner();
            await runner.initialize({ framework });
            // Run tests and fix failures
            const result = await runner.runTests({
                coverage: true,
                testFiles: options.testFiles,
                additionalArgs: []
            });
            if (!result.passed && result.failures) {
                ui_1.logger.info(`${result.failures.length} test failures found. Starting auto-fix...`);
                for (const failure of result.failures.slice(0, parseInt(options.retries))) {
                    const agent = await (0, agent_1.selectAgent)();
                    const prompt = `Fix this test failure:\n\nFile: ${failure.file}\nError: ${failure.message}\n\n${failure.fullMessage}`;
                    await (0, agent_1.runAgent)(agent, prompt);
                    ui_1.logger.info(`Applied fix for: ${failure.message}`);
                }
            }
        }
        else {
            // Xcode framework - use existing logic
            let scheme = options.scheme;
            if (!scheme) {
                const answers = await inquirer_1.default.prompt([{
                        type: 'input',
                        name: 'scheme',
                        message: 'Enter Xcode Scheme to test:',
                        validate: (input) => input ? true : 'Scheme is required'
                    }]);
                scheme = answers.scheme;
            }
            await (0, fixer_1.runTestFixLoop)(scheme, options.destination, parseInt(options.retries), options.refreshDestinations);
        }
    }
    catch (error) {
        ui_1.logger.error(error.message || error);
        process.exit(1);
    }
});
program
    .command('check', { isDefault: true })
    .description('Check code coverage (default)')
    .option('-s, --scheme <scheme>', 'Xcode scheme to test')
    .option('-f, --framework <framework>', 'Testing framework (auto-detected if not specified)')
    .option('-b, --branch <branch>', 'Base branch to compare against', 'main')
    .option('-t, --threshold <number>', 'Coverage threshold percentage', '80')
    .option('-w, --workspace <path>', 'Path to .xcworkspace')
    .option('-p, --project <path>', 'Path to .xcodeproj')
    .option('--no-coverage', 'Skip coverage generation')
    .option('--refresh-destinations', 'Refresh the cached list of Xcode run destinations')
    .action(async (options) => {
    try {
        ui_1.logger.info('Starting Cover...');
        // 1. Analyze Git
        const currentBranch = await (0, git_1.getCurrentBranch)();
        const changedFiles = await (0, git_1.getChangedFiles)(options.branch);
        if (changedFiles.length === 0) {
            ui_1.logger.success('No changed source files found to check.');
            return;
        }
        ui_1.logger.info(`Found ${changedFiles.length} changed file(s) on ${currentBranch} vs ${options.branch}`);
        // Detect framework
        const config = (0, config_1.loadConfig)();
        let framework = options.framework || config?.framework;
        if (!framework) {
            const detected = await (0, frameworks_1.detectFramework)();
            if (detected) {
                framework = detected;
                ui_1.logger.info(`Detected framework: ${framework}`);
            }
        }
        // Setup LLM early if user wants to use agent features
        await (0, llm_1.setupLLM)();
        if (framework && framework !== 'XCTest') {
            // JS/TS framework - use JSTestRunner
            const runner = new test_runner_1.JSTestRunner();
            await runner.initialize({ framework });
            // Run tests for changed files
            const result = await runner.runTestsForChangedFiles(changedFiles, {
                coverage: options.coverage !== false,
                gitDiff: { changedFiles }
            });
            if (!result.passed && result.failures) {
                ui_1.logger.error(`Found ${result.failures.length} test failure(s).`);
                const { fixAction } = await inquirer_1.default.prompt([{
                        type: 'list',
                        name: 'fixAction',
                        message: 'Tests failed. What would you like to do?',
                        choices: [
                            'Auto-Fix Failures with AI',
                            'Generate Missing Tests',
                            'Exit'
                        ]
                    }]);
                if (fixAction === 'Exit')
                    return;
                if (fixAction === 'Auto-Fix Failures with AI') {
                    for (const failure of result.failures) {
                        const agent = await (0, agent_1.selectAgent)();
                        const prompt = `Fix this test failure:\n\nFile: ${failure.file}\nError: ${failure.message}\n\n${failure.fullMessage}`;
                        await (0, agent_1.runAgent)(agent, prompt);
                    }
                }
                else if (fixAction === 'Generate Missing Tests') {
                    if (result.coverage && result.coverage.files.length > 0) {
                        const agent = await (0, agent_1.selectAgent)();
                        const targetFile = result.coverage.files.sort((a, b) => a.lineCoverage - b.lineCoverage)[0];
                        ui_1.logger.info(`Generating tests for: ${targetFile.path} (${targetFile.lineCoverage.toFixed(1)}%)`);
                        const prompt = (0, agent_1.generatePrompt)(targetFile.path);
                        await (0, agent_1.runAgent)(agent, prompt);
                    }
                }
            }
            // Show coverage if available
            if (result.coverage) {
                (0, ui_1.printCoverageTable)(result.coverage.files.filter(f => changedFiles.some(cf => f.path.includes(cf))));
                // Check threshold
                const failedFiles = result.coverage.files.filter(f => changedFiles.some(cf => f.path.includes(cf)) && f.lineCoverage < parseFloat(options.threshold));
                if (failedFiles.length === 0) {
                    ui_1.logger.success('All changed files meet the coverage threshold!');
                }
                else {
                    ui_1.logger.warn(`${failedFiles.length} file(s) are below the ${options.threshold}% threshold.`);
                }
            }
        }
        else {
            // Xcode framework - use existing logic
            // Main Loop
            let allPassed = false;
            let destination = undefined;
            while (!allPassed) {
                // 2. Ask user for Scheme if not provided
                let scheme = options.scheme;
                if (!scheme) {
                    const answers = await inquirer_1.default.prompt([{
                            type: 'input',
                            name: 'scheme',
                            message: 'Enter Xcode Scheme to test:',
                            validate: (input) => input ? true : 'Scheme is required'
                        }]);
                    scheme = answers.scheme;
                    options.scheme = scheme;
                }
                // 3. Run Tests
                const result = await (0, xcode_1.runXcodeTests)(scheme, destination, options.project, options.workspace, options.refreshDestinations);
                const xcresultPath = result.xcresultPath;
                destination = result.selectedDestination;
                // 4. Check for Failures
                let testFailures = await (0, results_1.getTestFailures)(xcresultPath);
                // If build failed, we might not have test results, or they might be stale.
                // Prioritize build errors if success is false.
                if (!result.success) {
                    const buildFailures = (0, results_1.getBuildFailures)(result.log);
                    if (buildFailures.length > 0) {
                        testFailures = buildFailures;
                    }
                    else if (testFailures.length === 0) {
                        ui_1.logger.error('Build failed but no structured errors found.');
                    }
                }
                if (testFailures.length > 0) {
                    ui_1.logger.error(`Found ${testFailures.length} failure(s).`);
                    // Check if these are build failures or test failures
                    const isBuildFailure = testFailures.some(f => f.testCaseName === 'Build Failure');
                    // Ask user if they want to fix failures first
                    const { fixAction } = await inquirer_1.default.prompt([{
                            type: 'list',
                            name: 'fixAction',
                            message: isBuildFailure ? 'Build failed. What would you like to do?' : 'Tests failed. What would you like to do?',
                            choices: [
                                'Auto-Fix Failures with AI',
                                'Ignore and Check Coverage',
                                'Exit'
                            ]
                        }]);
                    if (fixAction === 'Exit')
                        break;
                    if (fixAction === 'Auto-Fix Failures with AI') {
                        // Try to fix the first failure
                        const failure = testFailures[0];
                        ui_1.logger.info(`Attempting to fix: ${failure.testCaseName} in ${failure.fileName}`);
                        const fixed = await (0, fixer_1.fixFailure)(failure);
                        if (fixed) {
                            ui_1.logger.success('Fix applied! Re-running tests...');
                            continue; // Loop again
                        }
                        else {
                            ui_1.logger.warn('Could not fix failure.');
                        }
                    }
                }
                // Determine if we should block coverage generation
                // Block if: !success AND (no failures found OR failures are build failures)
                const isRealBuildFailure = !result.success && (testFailures.length === 0 || testFailures.some(f => f.testCaseName === 'Build Failure'));
                if (isRealBuildFailure) {
                    ui_1.logger.error('Cannot generate coverage data because the build failed.');
                    const { retry } = await inquirer_1.default.prompt([{
                            type: 'confirm',
                            name: 'retry',
                            message: 'Retry?',
                            default: true
                        }]);
                    if (retry)
                        continue;
                    else
                        break;
                }
                // 5. Get Data
                const coverageJson = await (0, xcode_1.getCoverageData)(xcresultPath);
                // 6. Evaluate
                const report = (0, coverage_1.processCoverage)(coverageJson, changedFiles);
                (0, ui_1.printCoverageTable)(report);
                // 7. Check Threshold
                const failedFiles = report.filter(f => f.lineCoverage < parseFloat(options.threshold));
                if (failedFiles.length === 0) {
                    ui_1.logger.success('All changed files meet the coverage threshold!');
                    allPassed = true;
                    break;
                }
                ui_1.logger.warn(`${failedFiles.length} file(s) are below the ${options.threshold}% threshold.`);
                // 8. Iterate / Agent
                const { action } = await inquirer_1.default.prompt([
                    {
                        type: 'list',
                        name: 'action',
                        message: 'What would you like to do?',
                        choices: [
                            'Generate Tests with Agent',
                            'Retry (I manually updated tests)',
                            'Exit'
                        ]
                    }
                ]);
                if (action === 'Exit') {
                    break;
                }
                else if (action === 'Generate Tests with Agent') {
                    const agent = await (0, agent_1.selectAgent)();
                    const targetFile = failedFiles.sort((a, b) => a.lineCoverage - b.lineCoverage)[0];
                    ui_1.logger.info(`Targeting ${targetFile.path} (${targetFile.lineCoverage.toFixed(1)}%)`);
                    const prompt = (0, agent_1.generatePrompt)(targetFile.path);
                    await (0, agent_1.runAgent)(agent, prompt);
                }
            }
        }
    }
    catch (error) {
        ui_1.logger.error(error.message || error);
        process.exit(1);
    }
});
program.command('test-plan <path>')
    .description('Run tests from an Xcode testing plan JSON file')
    .option('-d, --destination <destination>', 'Simulator destination')
    .option('-w, --workspace <path>', 'Path to .xcworkspace')
    .option('-p, --project <path>', 'Path to .xcodeproj')
    .option('--no-coverage', 'Skip coverage generation')
    .action(async (planPath, options) => {
    try {
        const plan = (0, test_plan_1.parseTestPlan)(planPath);
        ui_1.logger.info(`Loaded test plan: ${planPath}`);
        ui_1.logger.info(`Targets: ${plan.testTargets.map(t => t.target.name).join(', ')}`);
        const result = await (0, test_plan_1.runTestPlan)(planPath, options.destination, options.project, options.workspace);
        if (!result.success) {
            ui_1.logger.error('Tests failed.');
            process.exit(1);
        }
        if (options.coverage !== false) {
            ui_1.logger.info('Processing coverage...');
            const coverageJson = await (0, xcode_1.getCoverageData)(result.xcresultPath);
            const report = (0, coverage_1.processCoverage)(coverageJson, []);
            (0, ui_1.printCoverageTable)(report);
        }
        ui_1.logger.success('Test plan completed successfully.');
    }
    catch (error) {
        ui_1.logger.error(error.message || error);
        process.exit(1);
    }
});
program.command('run-targets <targets...>')
    .description('Run specific test targets (e.g., cover run-targets MyTests MyOtherTests)')
    .option('-s, --scheme <scheme>', 'Xcode scheme (required if no .xcscheme found)')
    .option('-d, --destination <destination>', 'Simulator destination')
    .option('-w, --workspace <path>', 'Path to .xcworkspace')
    .option('-p, --project <path>', 'Path to .xcodeproj')
    .option('--no-coverage', 'Skip coverage generation')
    .action(async (targets, options) => {
    try {
        ui_1.logger.info(`Running targets: ${targets.join(', ')}`);
        const derivedDataPath = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'cover-targets-'));
        const resultBundlePath = path_1.default.join(derivedDataPath, 'TestResult.xcresult');
        let baseArgs = [];
        if (options.workspace) {
            baseArgs.push('-workspace', options.workspace);
        }
        else if (options.project) {
            baseArgs.push('-project', options.project);
        }
        else {
            const workspaces = await (0, glob_1.glob)('*.xcworkspace');
            if (workspaces.length > 0) {
                baseArgs.push('-workspace', workspaces[0]);
            }
            else {
                const projects = await (0, glob_1.glob)('*.xcodeproj');
                if (projects.length > 0) {
                    baseArgs.push('-project', projects[0]);
                }
            }
        }
        if (options.scheme) {
            baseArgs.push('-scheme', options.scheme);
        }
        const testArgs = ['test', ...baseArgs, '-enableCodeCoverage', 'YES', '-resultBundlePath', resultBundlePath];
        if (options.destination) {
            testArgs.push('-destination', options.destination);
        }
        for (const target of targets) {
            testArgs.push('-only-testing', target);
        }
        const testSpin = (0, ui_1.spinner)(`Running tests for ${targets.length} target(s)...`).start();
        const subprocess = (0, execa_1.execa)('xcodebuild', testArgs, {
            all: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        if (subprocess.stdout) {
            subprocess.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                if (text.includes('Compiling'))
                    testSpin.text = 'Compiling...';
                else if (text.includes('Testing'))
                    testSpin.text = 'Testing...';
            });
        }
        const { all } = await subprocess;
        testSpin.succeed(`Tests completed for ${targets.length} target(s).`);
        if (options.coverage !== false) {
            ui_1.logger.info('Processing coverage...');
            const coverageJson = await (0, xcode_1.getCoverageData)(resultBundlePath);
            const report = (0, coverage_1.processCoverage)(coverageJson, []);
            (0, ui_1.printCoverageTable)(report);
        }
        ui_1.logger.success('Test run completed successfully.');
    }
    catch (error) {
        ui_1.logger.error(error.message || error);
        process.exit(1);
    }
});
program.parse(process.argv);
