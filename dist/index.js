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
const coverage_formats_1 = require("./coverage-formats");
const pr_coverage_1 = require("./pr-coverage");
const pr_coverage_report_1 = require("./pr-coverage-report");
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
    .option('-tp, --test-plan <plan>', 'Xcode test plan name (optional)')
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
            await (0, fixer_1.runTestFixLoop)(scheme, options.destination, parseInt(options.retries), options.refreshDestinations, options.testPlan);
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
    .option('-w, --workspace <path>', '.xcworkspace path')
    .option('-p, --project <path>', '.xcodeproj path')
    .option('-tp, --test-plan <plan>', 'Xcode test plan name (optional)')
    .option('--no-coverage', 'Skip coverage generation')
    .option('--refresh-destinations', 'Refresh the cached list of Xcode run destinations')
    .option('-v, --verbose', 'Verbose output')
    .option('--pr-lines-only', 'Show only PR-changed lines in coverage report')
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
                const result = await (0, xcode_1.runXcodeTests)(scheme, destination, options.project, options.workspace, options.refreshDestinations, options.testPlan);
                const xcresultPath = result.xcresultPath;
                destination = result.selectedDestination;
                // 4. Check for Failures
                let testFailures = await (0, results_1.getTestFailures)(xcresultPath);
                // If xcodebuild exited with non-zero, check for build errors.
                // Note: xcodebuild exits non-zero for BOTH build failures AND test failures.
                // Prioritize build errors (compilation/linker) over test failures.
                if (!result.success) {
                    const buildFailures = (0, results_1.getBuildFailures)(result.log);
                    if (buildFailures.length > 0) {
                        testFailures = buildFailures;
                    }
                    else if (testFailures.length === 0) {
                        // No build errors and no test failures parsed - likely a test failure
                        // that we couldn't extract from xcresult. Don't block coverage.
                        ui_1.logger.warn('Tests failed but no structured failure details found in xcresult.');
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
                // Block only if there are actual build failures (compilation/linker errors)
                // Test failures (assertions) should NOT block coverage - xcodebuild exits non-zero for test failures too
                const hasBuildErrors = testFailures.some(f => f.testCaseName === 'Build Failure') || (0, results_1.getBuildFailures)(result.log).length > 0;
                const isRealBuildFailure = !result.success && hasBuildErrors;
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
                const report = (0, coverage_1.processCoverageLegacy)(coverageJson, changedFiles);
                (0, ui_1.printCoverageTable)(report);
                // 6b. Show PR line-level coverage if requested
                if (options.prLinesOnly) {
                    try {
                        const diffResult = await (0, git_1.getChangedSwiftLines)(options.branch);
                        if (diffResult.files.length > 0) {
                            const lineCoverageData = await (0, coverage_formats_1.parseCoverageArtifacts)({
                                format: 'xccov',
                                paths: [xcresultPath],
                                parserOptions: { verbose: options.verbose }
                            });
                            const headCommit = await (0, git_1.getHeadCommit)();
                            const prResult = await (0, pr_coverage_1.calculatePRCoverage)(diffResult, lineCoverageData, { verbose: options.verbose });
                            prResult.metadata.baseBranch = options.branch;
                            prResult.metadata.headCommit = headCommit;
                            prResult.metadata.coverageFormat = 'xccov';
                            console.log(''); // Separator
                            (0, pr_coverage_report_1.printPRCoverageReport)(prResult, { threshold: parseFloat(options.threshold), verbose: options.verbose });
                        }
                    }
                    catch (prError) {
                        if (options.verbose) {
                            ui_1.logger.warn(`Could not calculate PR line coverage: ${prError.message}`);
                        }
                    }
                }
                // 7. Check Threshold
                const failedFiles = report.filter((f) => f.lineCoverage < parseFloat(options.threshold));
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
    .option('-tp, --test-plan <plan>', 'Xcode test plan name (optional)')
    .option('-w, --workspace <path>', 'Path to .xcworkspace')
    .option('-p, --project <path>', 'Path to .xcodeproj')
    .option('--no-coverage', 'Skip coverage generation')
    .action(async (planPath, options) => {
    try {
        const plan = (0, test_plan_1.parseTestPlan)(planPath);
        ui_1.logger.info(`Loaded test plan: ${planPath}`);
        ui_1.logger.info(`Targets: ${plan.testTargets.map(t => t.target.name).join(', ')}`);
        const result = await (0, test_plan_1.runTestPlan)(planPath, options.destination, options.project, options.workspace, options.testPlan);
        if (!result.success) {
            ui_1.logger.error('Tests failed.');
            process.exit(1);
        }
        if (options.coverage !== false) {
            ui_1.logger.info('Processing coverage...');
            const coverageJson = await (0, xcode_1.getCoverageData)(result.xcresultPath);
            const report = (0, coverage_1.processCoverageLegacy)(coverageJson, []);
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
    .option('-tp, --test-plan <plan>', 'Xcode test plan name (optional)')
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
        if (options.testPlan) {
            testArgs.push('-testPlan', options.testPlan);
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
            const report = (0, coverage_1.processCoverageLegacy)(coverageJson, []);
            (0, ui_1.printCoverageTable)(report);
        }
        ui_1.logger.success('Test run completed successfully.');
    }
    catch (error) {
        ui_1.logger.error(error.message || error);
        process.exit(1);
    }
});
program.command('pr-coverage')
    .description('Calculate line coverage for PR changes only')
    .option('-b, --base <branch>', 'Base branch to compare against', 'main')
    .option('--coverage-format <format>', 'Coverage format (xccov, lcov, jacoco, llvm-cov)')
    .option('--coverage-path <paths...>', 'Path(s) to coverage artifacts (supports globs)')
    .option('--manifest <path>', 'Path to coverage manifest JSON file')
    .option('-s, --scheme <scheme>', 'Xcode scheme (if generating coverage via xcodebuild)')
    .option('-t, --threshold <number>', 'Minimum coverage threshold percentage', '80')
    .option('--strict', 'Spec-compliant plain text output (no colors/emojis)')
    .option('--fast', 'Skip line-level coverage parsing, use file-level heuristics')
    .option('-v, --verbose', 'Show detailed debug output')
    .action(async (options) => {
    try {
        const verbose = options.verbose || false;
        const threshold = parseFloat(options.threshold);
        const strict = options.strict || false;
        ui_1.logger.info('Calculating PR line coverage...');
        // 1. Validate base branch exists
        if (verbose)
            ui_1.logger.info(`Validating base branch: ${options.base}`);
        const branchExists = await (0, git_1.validateBranchExists)(options.base);
        if (!branchExists) {
            ui_1.logger.error(`Base branch '${options.base}' does not exist. Try 'git fetch origin ${options.base}' first.`);
            process.exit(1);
        }
        // 2. Get line-level diff
        if (verbose)
            ui_1.logger.info('Getting line-level diff...');
        const diffResult = await (0, git_1.getChangedSwiftLines)(options.base);
        if (diffResult.files.length === 0) {
            ui_1.logger.success('No changed Swift/ObjC files found.');
            return;
        }
        ui_1.logger.info(`Found ${diffResult.files.length} changed file(s) with ${diffResult.totalAddedLines} new/updated lines`);
        // 3. Find or generate coverage data
        let coverageData;
        let coverageFormat = 'xccov';
        if (options.manifest) {
            // Use manifest file
            if (verbose)
                ui_1.logger.info(`Loading manifest: ${options.manifest}`);
            coverageData = await (0, coverage_formats_1.parseCoverageArtifacts)({
                manifestPath: options.manifest,
                parserOptions: { verbose, fast: options.fast }
            });
        }
        else if (options.coveragePath && options.coveragePath.length > 0) {
            // Use explicit coverage paths
            if (options.coverageFormat) {
                coverageFormat = options.coverageFormat;
            }
            if (verbose)
                ui_1.logger.info(`Parsing coverage from: ${options.coveragePath.join(', ')}`);
            coverageData = await (0, coverage_formats_1.parseCoverageArtifacts)({
                format: coverageFormat,
                paths: options.coveragePath,
                parserOptions: { verbose, fast: options.fast }
            });
        }
        else {
            // Try to auto-detect coverage source
            const manifest = (0, coverage_formats_1.findManifest)();
            if (manifest) {
                if (verbose)
                    ui_1.logger.info(`Found manifest: ${manifest}`);
                coverageData = await (0, coverage_formats_1.parseCoverageArtifacts)({
                    manifestPath: manifest,
                    parserOptions: { verbose, fast: options.fast }
                });
            }
            else {
                // Try to find existing xcresult
                const xcresult = await (0, coverage_formats_1.findExistingXcresult)();
                if (xcresult) {
                    if (verbose)
                        ui_1.logger.info(`Found xcresult: ${xcresult}`);
                    coverageData = await (0, coverage_formats_1.parseCoverageArtifacts)({
                        format: 'xccov',
                        paths: [xcresult],
                        parserOptions: { verbose, fast: options.fast }
                    });
                }
                else if (options.scheme) {
                    // Run tests to generate coverage
                    ui_1.logger.info('No coverage found. Running tests to generate coverage...');
                    const result = await (0, xcode_1.runXcodeTests)(options.scheme, undefined);
                    if (!result.success) {
                        ui_1.logger.error('Tests failed. Cannot generate coverage data.');
                        process.exit(1);
                    }
                    coverageData = await (0, coverage_formats_1.parseCoverageArtifacts)({
                        format: 'xccov',
                        paths: [result.xcresultPath],
                        parserOptions: { verbose, fast: options.fast }
                    });
                }
                else {
                    ui_1.logger.error('No coverage data found. Provide --coverage-path, --manifest, or --scheme to generate coverage.');
                    ui_1.logger.info(`Supported formats: ${(0, coverage_formats_1.getSupportedFormats)().join(', ')}`);
                    process.exit(1);
                }
            }
        }
        if (verbose)
            ui_1.logger.info(`Coverage data loaded for ${coverageData.size} files`);
        // 4. Calculate PR coverage
        const headCommit = await (0, git_1.getHeadCommit)();
        const prCoverageResult = await (0, pr_coverage_1.calculatePRCoverage)(diffResult, coverageData, { verbose });
        // Fill in metadata
        prCoverageResult.metadata.baseBranch = options.base;
        prCoverageResult.metadata.headCommit = headCommit;
        prCoverageResult.metadata.coverageFormat = coverageFormat;
        prCoverageResult.metadata.fast = options.fast || false;
        // 5. Output report
        (0, pr_coverage_report_1.printPRCoverageReport)(prCoverageResult, { strict, threshold, verbose });
        // 6. Check threshold
        const passing = prCoverageResult.summary.lineCoveragePercent >= threshold;
        if (passing) {
            ui_1.logger.success(`PR coverage ${prCoverageResult.summary.lineCoveragePercent.toFixed(1)}% meets threshold of ${threshold}%`);
        }
        else {
            ui_1.logger.error(`PR coverage ${prCoverageResult.summary.lineCoveragePercent.toFixed(1)}% is below threshold of ${threshold}%`);
            process.exit(1);
        }
    }
    catch (error) {
        ui_1.logger.error(error.message || error);
        process.exit(1);
    }
});
program.parse(process.argv);
