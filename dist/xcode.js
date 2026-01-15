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
// Cache configuration
const CACHE_DIR = path_1.default.join(os_1.default.homedir(), '.cover');
const DESTINATIONS_CACHE_FILE = path_1.default.join(CACHE_DIR, 'xcode-destinations-cache.json');
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const createCacheDir = () => {
    if (!fs_1.default.existsSync(CACHE_DIR)) {
        fs_1.default.mkdirSync(CACHE_DIR, { recursive: true });
    }
};
const getBaseArgsHash = (baseArgs) => {
    return Buffer.from(baseArgs.join('|')).toString('base64').substring(0, 16);
};
const loadDestinationsFromCache = async (scheme, baseArgs) => {
    try {
        if (!fs_1.default.existsSync(DESTINATIONS_CACHE_FILE)) {
            return null;
        }
        const cacheData = JSON.parse(fs_1.default.readFileSync(DESTINATIONS_CACHE_FILE, 'utf-8'));
        const baseArgsHash = getBaseArgsHash(baseArgs);
        const now = Date.now();
        // Check if cache is valid (same scheme, same base args, and not expired)
        if (cacheData.scheme === scheme &&
            cacheData.baseArgsHash === baseArgsHash &&
            (now - cacheData.timestamp) < CACHE_EXPIRY_MS) {
            return cacheData.destinations;
        }
    }
    catch (error) {
        // If there's any error reading cache, just ignore it
    }
    return null;
};
const saveDestinationsToCache = (scheme, baseArgs, destinations) => {
    try {
        createCacheDir();
        const cacheData = {
            destinations,
            timestamp: Date.now(),
            scheme,
            baseArgsHash: getBaseArgsHash(baseArgs)
        };
        fs_1.default.writeFileSync(DESTINATIONS_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    }
    catch (error) {
        // Silently fail to save cache
    }
};
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
const getDestinations = async (scheme, baseArgs, forceRefresh = false) => {
    // Try to load from cache first unless force refresh is requested
    if (!forceRefresh) {
        const cachedDestinations = await loadDestinationsFromCache(scheme, baseArgs);
        if (cachedDestinations) {
            ui_1.logger.info('Using cached destinations.');
            return cachedDestinations;
        }
    }
    try {
        ui_1.logger.info('Fetching available destinations...');
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
        // Save to cache for future use
        saveDestinationsToCache(scheme, baseArgs, choices);
        return choices;
    }
    catch (error) {
        ui_1.logger.warn('Failed to fetch destinations.');
        return [];
    }
};
const runXcodeTests = async (scheme, destination, projectPath, workspacePath, refreshDestinations = false) => {
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
        const choices = await getDestinations(scheme, baseArgs, refreshDestinations);
        testSpinner.stop();
        const manualEntryValue = 'MANUAL_ENTRY';
        const refreshValue = 'REFRESH_DESTINATIONS';
        // Add options at the end
        const promptChoices = [
            ...choices,
            new inquirer_1.default.Separator(),
            { name: 'Refresh destination list...', value: refreshValue },
            { name: 'Enter destination manually...', value: manualEntryValue }
        ];
        if (choices.length === 0) {
            ui_1.logger.warn('No destinations found via xcodebuild.');
            const choicesWithRefresh = [
                { name: 'Refresh destination list...', value: refreshValue },
                { name: 'Use Default (iPhone 17 Pro)', value: 'platform=iOS Simulator,name=iPhone 17 Pro' },
                { name: 'Enter destination manually...', value: manualEntryValue }
            ];
            const answer = await inquirer_1.default.prompt([{
                    type: 'rawlist',
                    name: 'destination',
                    message: 'No simulators detected. Select an action:',
                    choices: choicesWithRefresh,
                }]);
            selectedDestination = answer.destination;
            // Handle refresh option for no destinations case
            if (selectedDestination === refreshValue) {
                const refreshSpinner = (0, ui_1.spinner)('Refreshing destinations...');
                refreshSpinner.start();
                const refreshedChoices = await getDestinations(scheme, baseArgs, true); // Force refresh
                refreshSpinner.stop();
                if (refreshedChoices.length > 0) {
                    const refreshedDefaultIndex = refreshedChoices.findIndex(c => c.name.includes('iPhone 17 Pro'));
                    const refreshedAnswer = await inquirer_1.default.prompt([{
                            type: 'rawlist',
                            name: 'destination',
                            message: 'Select a simulator destination (refreshed list):',
                            choices: refreshedChoices,
                            default: refreshedDefaultIndex >= 0 ? refreshedDefaultIndex : undefined,
                            pageSize: 15
                        }]);
                    selectedDestination = refreshedAnswer.destination;
                }
                else {
                    ui_1.logger.warn('Still no destinations found after refresh. Using default.');
                    selectedDestination = 'platform=iOS Simulator,name=iPhone 17 Pro';
                }
            }
        }
        else {
            // Find index of default choice to set as default in rawlist (indices are 0-based in config, displayed as 1-based)
            const defaultIndex = choices.findIndex(c => c.name.includes('iPhone 17 Pro'));
            const answer = await inquirer_1.default.prompt([{
                    type: 'rawlist',
                    name: 'destination',
                    message: 'Select a simulator destination (type the number):',
                    choices: promptChoices,
                    default: defaultIndex >= 0 ? defaultIndex : undefined,
                    pageSize: 15
                }]);
            selectedDestination = answer.destination;
            // Handle refresh option
            if (selectedDestination === refreshValue) {
                const refreshSpinner = (0, ui_1.spinner)('Refreshing destinations...');
                refreshSpinner.start();
                const refreshedChoices = await getDestinations(scheme, baseArgs, true); // Force refresh
                refreshSpinner.stop();
                if (refreshedChoices.length === 0) {
                    ui_1.logger.warn('No destinations found after refresh.');
                    // Fall back to manual entry or default
                    const fallbackAnswer = await inquirer_1.default.prompt([{
                            type: 'rawlist',
                            name: 'destination',
                            message: 'No destinations found. Select an action:',
                            choices: [{ name: 'Use Default (iPhone 17 Pro)', value: 'platform=iOS Simulator,name=iPhone 17 Pro' }, { name: 'Enter destination manually...', value: manualEntryValue }],
                        }]);
                    selectedDestination = fallbackAnswer.destination;
                }
                else {
                    const refreshedDefaultIndex = refreshedChoices.findIndex(c => c.name.includes('iPhone 17 Pro'));
                    const refreshedAnswer = await inquirer_1.default.prompt([{
                            type: 'rawlist',
                            name: 'destination',
                            message: 'Select a simulator destination (refreshed list):',
                            choices: refreshedChoices,
                            default: refreshedDefaultIndex >= 0 ? refreshedDefaultIndex : undefined,
                            pageSize: 15
                        }]);
                    selectedDestination = refreshedAnswer.destination;
                }
            }
        }
        if (selectedDestination === manualEntryValue) {
            const manualAnswer = await inquirer_1.default.prompt([{
                    type: 'input',
                    name: 'customDestination',
                    message: 'Enter device name (e.g. "iPhone 17 Pro"):',
                    validate: (input) => input.trim().length > 0 ? true : 'Device name cannot be empty.'
                }]);
            let input = manualAnswer.customDestination.trim();
            // Smart formatting: If the user didn't provide the full platform string, build it for them.
            if (!input.includes('platform=')) {
                // Remove "platform=iOS Simulator,name=" if they half-typed it to be safe, though unlikely.
                // Just treat the whole string as the name.
                input = `platform=iOS Simulator,name=${input}`;
            }
            selectedDestination = input;
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
        // Do NOT throw if we want to analyze results. Return the path so the agent can inspect it.
        // However, for the normal CLI flow, we might want to throw?
        // Let's rely on the caller to check the status or inspect the xcresult.
        // But execa throws on exit code != 0.
        // Check if it was a build failure or test failure.
        // If build failure, xcresult might be empty/invalid?
        // Usually xcodebuild creates the result bundle even if tests fail.
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
