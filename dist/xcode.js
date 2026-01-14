"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCoverageData = exports.runXcodeTests = void 0;
const execa_1 = require("execa");
const glob_1 = require("glob");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const ui_1 = require("./ui");
const inquirer_1 = __importDefault(require("inquirer"));
const detectBaseArgs = async (projectPath, workspacePath) => {
    const baseArgs = [];
    if (workspacePath) {
        baseArgs.push('-workspace', workspacePath);
    }
    else if (projectPath) {
        baseArgs.push('-project', projectPath);
    }
    else {
        // Auto-discovery logic...
        const workspaces = await (0, glob_1.glob)('*.xcworkspace');
        if (workspaces.length > 0) {
            baseArgs.push('-workspace', workspaces[0]);
        }
        else {
            const deepWorkspaces = await (0, glob_1.glob)('**/*.xcworkspace', { ignore: '**/node_modules/**' });
            if (deepWorkspaces.length > 0) {
                if (deepWorkspaces.length > 1) {
                    ui_1.logger.warn(`Found multiple workspaces: ${deepWorkspaces.join(', ')}. Using ${deepWorkspaces[0]}`);
                }
                baseArgs.push('-workspace', deepWorkspaces[0]);
                ui_1.logger.info(`Auto-detected workspace: ${deepWorkspaces[0]}`);
            }
            else {
                const projects = await (0, glob_1.glob)('*.xcodeproj');
                if (projects.length > 0) {
                    baseArgs.push('-project', projects[0]);
                }
                else {
                    const deepProjects = await (0, glob_1.glob)('**/*.xcodeproj', { ignore: '**/node_modules/**' });
                    if (deepProjects.length > 0) {
                        baseArgs.push('-project', deepProjects[0]);
                        ui_1.logger.info(`Auto-detected project: ${deepProjects[0]}`);
                    }
                    else {
                        throw new Error('No Xcode project or workspace found (searched recursively).');
                    }
                }
            }
        }
    }
    return baseArgs;
};
const getDestinations = async (scheme, baseArgs) => {
    try {
        const destArgs = [...baseArgs, '-scheme', scheme, '-showdestinations'];
        const { stdout } = await (0, execa_1.execa)('xcodebuild', destArgs);
        const lines = stdout.split('\n');
        const choices = [];
        const seenNames = new Set();
        lines.forEach((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('{') && trimmed.includes('platform:iOS Simulator')) {
                // Extract name
                // Regex: name: then capture until comma or closing brace
                const nameMatch = trimmed.match(/name:(.+?)(?:,|}|\s*$)/);
                if (nameMatch) {
                    const name = nameMatch[1].trim();
                    if (!seenNames.has(name)) {
                        choices.push({
                            name: name,
                            value: `platform=iOS Simulator,name=${name}`
                        });
                        seenNames.add(name);
                    }
                }
            }
        });
        return choices;
    }
    catch (error) {
        ui_1.logger.warn('Failed to fetch destinations.');
        return [];
    }
};
const runXcodeTests = async (scheme, destination, projectPath, workspacePath) => {
    ui_1.logger.step(`Preparing tests for scheme: ${scheme}`);
    // Create a temporary derived data path to easily locate logs/results
    const derivedDataPath = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'cover-derived-data-'));
    const resultBundlePath = path_1.default.join(derivedDataPath, 'TestResult.xcresult');
    const baseArgs = await detectBaseArgs(projectPath, workspacePath);
    // Destination Handling
    let selectedDestination = destination;
    if (!selectedDestination) {
        const testSpinner = (0, ui_1.spinner)('Checking available destinations...');
        testSpinner.start();
        const choices = await getDestinations(scheme, baseArgs);
        testSpinner.stop();
        const manualEntryValue = 'MANUAL_ENTRY';
        // Add "Manual Entry" option
        const promptChoices = [
            ...choices,
            new inquirer_1.default.Separator(),
            { name: 'Enter destination manually...', value: manualEntryValue }
        ];
        if (choices.length === 0) {
            ui_1.logger.warn('No destinations found via xcodebuild.');
            // If no destinations found, prompt for manual entry directly or default?
            // Let's still show the manual entry prompt to avoid blocking the user
            const answer = await inquirer_1.default.prompt([{
                    type: 'list',
                    name: 'destination',
                    message: 'No simulators detected. Select an action:',
                    choices: [{ name: 'Use Default (iPhone 17 Pro)', value: 'platform=iOS Simulator,name=iPhone 17 Pro' }, { name: 'Enter destination manually...', value: manualEntryValue }],
                }]);
            selectedDestination = answer.destination;
        }
        else {
            const defaultChoice = choices.find(c => c.name.includes('iPhone 17 Pro'));
            const answer = await inquirer_1.default.prompt([{
                    type: 'list',
                    name: 'destination',
                    message: 'Select a simulator destination:',
                    choices: promptChoices,
                    default: defaultChoice ? defaultChoice.value : undefined,
                    pageSize: 10
                }]);
            selectedDestination = answer.destination;
        }
        if (selectedDestination === manualEntryValue) {
            const manualAnswer = await inquirer_1.default.prompt([{
                    type: 'input',
                    name: 'customDestination',
                    message: 'Enter destination string (e.g., "platform=iOS Simulator,name=iPhone 17 Pro"):',
                    validate: (input) => input.trim().length > 0 ? true : 'Destination cannot be empty.'
                }]);
            selectedDestination = manualAnswer.customDestination;
        }
    }
    const testSpin = (0, ui_1.spinner)(`Running tests on ${selectedDestination}...`).start();
    try {
        const subprocess = (0, execa_1.execa)('xcodebuild', [
            'test',
            ...baseArgs,
            '-scheme', scheme,
            '-destination', selectedDestination,
            '-enableCodeCoverage', 'YES',
            '-resultBundlePath', resultBundlePath
        ], {
            all: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        if (subprocess.stdout) {
            subprocess.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                // Update spinner based on output without flooding
                if (text.includes('Compiling'))
                    testSpin.text = 'Compiling...';
                else if (text.includes('Linking'))
                    testSpin.text = 'Linking...';
                else if (text.includes('Testing'))
                    testSpin.text = 'Testing...';
                else if (text.includes('Signing'))
                    testSpin.text = 'Signing...';
                else if (text.includes('Building'))
                    testSpin.text = 'Building...';
            });
        }
        await subprocess;
        testSpin.succeed('Tests completed successfully.');
    }
    catch (error) {
        testSpin.fail('Tests failed.');
        // If it fails, users need to see why.
        // Since we suppressed stdio, we should print the captured output on error.
        if (error.all) {
            console.log(error.all);
        }
        else {
            if (error.stdout)
                console.log(error.stdout);
            if (error.stderr)
                console.error(error.stderr);
        }
        throw new Error('xcodebuild failed. See output above for details.');
    }
    return { xcresultPath: `${derivedDataPath}/TestResult.xcresult`, selectedDestination: selectedDestination };
};
exports.runXcodeTests = runXcodeTests;
const getCoverageData = async (xcresultPath) => {
    try {
        const { stdout } = await (0, execa_1.execa)('xcrun', ['xccov', 'view', '--report', '--json', xcresultPath]);
        return JSON.parse(stdout);
    }
    catch (error) {
        ui_1.logger.error('Failed to parse coverage data from xcresult.');
        throw error;
    }
};
exports.getCoverageData = getCoverageData;
