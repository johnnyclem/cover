"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCoverageData = exports.runXcodeTests = void 0;
const execa_1 = require("execa");
const glob_1 = require("glob");
const fs_1 = __importDefault(require("fs"));
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
        lines.forEach((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('{') && trimmed.includes('platform:iOS Simulator')) {
                // Extract name
                const nameMatch = trimmed.match(/name:([^,}]+)/);
                if (nameMatch) {
                    const name = nameMatch[1];
                    choices.push(`platform=iOS Simulator,name=${name}`);
                }
            }
        });
        return [...new Set(choices)];
    }
    catch (error) {
        ui_1.logger.warn('Failed to fetch destinations.');
        return [];
    }
};
const runXcodeTests = async (scheme, destination, projectPath, workspacePath) => {
    ui_1.logger.step(`Preparing tests for scheme: ${scheme}`);
    // Create a temporary derived data path to easily locate logs/results
    const derivedDataPath = path_1.default.resolve('./derived_data_temp');
    const resultBundlePath = `${derivedDataPath}/TestResult.xcresult`;
    // Clean up previous result bundle to avoid "Existing file" error
    if (fs_1.default.existsSync(resultBundlePath)) {
        fs_1.default.rmSync(resultBundlePath, { recursive: true, force: true });
    }
    const baseArgs = await detectBaseArgs(projectPath, workspacePath);
    // Destination Handling
    let selectedDestination = destination;
    if (!selectedDestination) {
        const testSpinner = (0, ui_1.spinner)('Checking available destinations...');
        testSpinner.start();
        const choices = await getDestinations(scheme, baseArgs);
        testSpinner.stop();
        if (choices.length === 0) {
            selectedDestination = 'platform=iOS Simulator,name=iPhone 15';
            ui_1.logger.warn('No destinations found via xcodebuild. Defaulting to iPhone 15.');
        }
        else {
            const answer = await inquirer_1.default.prompt([{
                    type: 'list',
                    name: 'destination',
                    message: 'Select a simulator destination:',
                    choices: choices,
                    default: choices.find(c => c.includes('iPhone 15'))
                }]);
            selectedDestination = answer.destination;
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
