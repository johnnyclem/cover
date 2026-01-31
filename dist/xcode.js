import { execa } from 'execa';
import { glob } from 'glob';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger, spinner } from './ui.js';
import inquirer from 'inquirer';
// Cache configuration
const CACHE_DIR = path.join(os.homedir(), '.cover');
const DESTINATIONS_CACHE_FILE = path.join(CACHE_DIR, 'xcode-destinations-cache.json');
const TEST_PLANS_CACHE_FILE = path.join(CACHE_DIR, 'xcode-test-plans-cache.json');
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const createCacheDir = () => {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
};
const getBaseArgsHash = (baseArgs) => {
    return Buffer.from(baseArgs.join('|')).toString('base64').substring(0, 16);
};
const loadDestinationsFromCache = async (scheme, baseArgs) => {
    try {
        if (!fs.existsSync(DESTINATIONS_CACHE_FILE)) {
            return null;
        }
        const cacheData = JSON.parse(fs.readFileSync(DESTINATIONS_CACHE_FILE, 'utf-8'));
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
        fs.writeFileSync(DESTINATIONS_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    }
    catch (error) {
        // Silently fail to save cache
    }
};
const loadTestPlansFromCache = async (scheme, baseArgs) => {
    try {
        if (!fs.existsSync(TEST_PLANS_CACHE_FILE)) {
            return null;
        }
        const cacheData = JSON.parse(fs.readFileSync(TEST_PLANS_CACHE_FILE, 'utf-8'));
        const baseArgsHash = getBaseArgsHash(baseArgs);
        const now = Date.now();
        // Check if cache is valid (same scheme, same base args, and not expired)
        if (cacheData.scheme === scheme &&
            cacheData.baseArgsHash === baseArgsHash &&
            (now - cacheData.timestamp) < CACHE_EXPIRY_MS) {
            return cacheData.testPlans;
        }
    }
    catch (error) {
        // If there's any error reading cache, just ignore it
    }
    return null;
};
const saveTestPlansToCache = (scheme, baseArgs, testPlans) => {
    try {
        createCacheDir();
        const cacheData = {
            testPlans,
            timestamp: Date.now(),
            scheme,
            baseArgsHash: getBaseArgsHash(baseArgs)
        };
        fs.writeFileSync(TEST_PLANS_CACHE_FILE, JSON.stringify(cacheData, null, 2));
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
        const workspaces = await glob('*.xcworkspace');
        if (workspaces.length > 0) {
            baseArgs.push('-workspace', workspaces[0]);
        }
        else {
            const deepWorkspaces = await glob('**/*.xcworkspace', { ignore: '**/node_modules/**' });
            if (deepWorkspaces.length > 0) {
                if (deepWorkspaces.length > 1) {
                    logger.warn(`Found multiple workspaces: ${deepWorkspaces.join(', ')}. Using ${deepWorkspaces[0]}`);
                }
                baseArgs.push('-workspace', deepWorkspaces[0]);
                logger.info(`Auto-detected workspace: ${deepWorkspaces[0]}`);
            }
            else {
                const projects = await glob('*.xcodeproj');
                if (projects.length > 0) {
                    baseArgs.push('-project', projects[0]);
                }
                else {
                    const deepProjects = await glob('**/*.xcodeproj', { ignore: '**/node_modules/**' });
                    if (deepProjects.length > 0) {
                        baseArgs.push('-project', deepProjects[0]);
                        logger.info(`Auto-detected project: ${deepProjects[0]}`);
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
            logger.info('Using cached destinations.');
            return cachedDestinations;
        }
    }
    try {
        logger.info('Fetching available destinations...');
        const destArgs = [...baseArgs, '-scheme', scheme, '-showdestinations'];
        const { stdout } = await execa('xcodebuild', destArgs);
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
        logger.warn('Failed to fetch destinations.');
        return [];
    }
};
const getTestPlans = async (scheme, baseArgs, forceRefresh = false) => {
    // Try to load from cache first unless force refresh is requested
    if (!forceRefresh) {
        const cachedTestPlans = await loadTestPlansFromCache(scheme, baseArgs);
        if (cachedTestPlans) {
            logger.info('Using cached test plans.');
            return cachedTestPlans;
        }
    }
    try {
        logger.info('Discovering available test plans...');
        const testPlanArgs = [...baseArgs, '-scheme', scheme, '-showTestPlans'];
        const { stdout } = await execa('xcodebuild', testPlanArgs);
        const lines = stdout.split('\n');
        const testPlans = [];
        const seenPlans = new Set();
        lines.forEach((line) => {
            const trimmed = line.trim();
            // Test plans are listed after "Test plans:" header
            // Format can be: "    TestPlanName" or lines containing .xctestplan
            if (trimmed && !trimmed.includes('Test plans:') && !trimmed.includes('---')) {
                // Remove .xctestplan extension if present
                let planName = trimmed.replace('.xctestplan', '').trim();
                if (planName && !seenPlans.has(planName)) {
                    testPlans.push(planName);
                    seenPlans.add(planName);
                }
            }
        });
        // Save to cache for future use
        if (testPlans.length > 0) {
            saveTestPlansToCache(scheme, baseArgs, testPlans);
        }
        return testPlans;
    }
    catch (error) {
        // -showTestPlans might not be supported in all Xcode versions
        // or there might be no test plans defined
        logger.info('Could not discover test plans (this is normal if none are defined).');
        return [];
    }
};
export const runXcodeTests = async (scheme, destination, projectPath, workspacePath, refreshDestinations = false, testPlan) => {
    logger.step(`Preparing tests for scheme: ${scheme}`);
    // Create a temporary derived data path to easily locate logs/results
    const derivedDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-derived-data-'));
    const resultBundlePath = path.join(derivedDataPath, 'TestResult.xcresult');
    const baseArgs = await detectBaseArgs(projectPath, workspacePath);
    // Test Plan Handling
    let selectedTestPlan = testPlan;
    if (!selectedTestPlan) {
        const testPlanSpinner = spinner('Checking available test plans...');
        testPlanSpinner.start();
        const availableTestPlans = await getTestPlans(scheme, baseArgs, false);
        testPlanSpinner.stop();
        if (availableTestPlans.length > 0) {
            const answer = await inquirer.prompt([{
                    type: 'input',
                    name: 'testPlan',
                    message: 'Enter test plan name (press Enter to skip):',
                    default: '',
                    validate: (input) => {
                        // Empty input is valid (means skip)
                        if (!input)
                            return true;
                        // Check if input matches any available test plans
                        if (availableTestPlans.includes(input))
                            return true;
                        return `Test plan "${input}" not found. Available: ${availableTestPlans.join(', ')}`;
                    }
                }]);
            selectedTestPlan = answer.testPlan || undefined;
        }
    }
    // Destination Handling
    let selectedDestination = destination;
    if (!selectedDestination) {
        const testSpinner = spinner('Checking available destinations...');
        testSpinner.start();
        const choices = await getDestinations(scheme, baseArgs, refreshDestinations);
        testSpinner.stop();
        const manualEntryValue = 'MANUAL_ENTRY';
        const refreshValue = 'REFRESH_DESTINATIONS';
        // Add options at the end
        const promptChoices = [
            ...choices,
            new inquirer.Separator(),
            { name: 'Refresh destination list...', value: refreshValue },
            { name: 'Enter destination manually...', value: manualEntryValue }
        ];
        if (choices.length === 0) {
            logger.warn('No destinations found via xcodebuild.');
            const choicesWithRefresh = [
                { name: 'Refresh destination list...', value: refreshValue },
                { name: 'Use Default (iPhone 17 Pro)', value: 'platform=iOS Simulator,name=iPhone 17 Pro' },
                { name: 'Enter destination manually...', value: manualEntryValue }
            ];
            const answer = await inquirer.prompt([{
                    type: 'rawlist',
                    name: 'destination',
                    message: 'No simulators detected. Select an action:',
                    choices: choicesWithRefresh,
                }]);
            selectedDestination = answer.destination;
            // Handle refresh option for no destinations case
            if (selectedDestination === refreshValue) {
                const refreshSpinner = spinner('Refreshing destinations...');
                refreshSpinner.start();
                const refreshedChoices = await getDestinations(scheme, baseArgs, true); // Force refresh
                refreshSpinner.stop();
                if (refreshedChoices.length > 0) {
                    const refreshedDefaultIndex = refreshedChoices.findIndex(c => c.name.includes('iPhone 17 Pro'));
                    const refreshedAnswer = await inquirer.prompt([{
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
                    logger.warn('Still no destinations found after refresh. Using default.');
                    selectedDestination = 'platform=iOS Simulator,name=iPhone 17 Pro';
                }
            }
        }
        else {
            // Find index of default choice to set as default in rawlist (indices are 0-based in config, displayed as 1-based)
            const defaultIndex = choices.findIndex(c => c.name.includes('iPhone 17 Pro'));
            const answer = await inquirer.prompt([{
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
                const refreshSpinner = spinner('Refreshing destinations...');
                refreshSpinner.start();
                const refreshedChoices = await getDestinations(scheme, baseArgs, true); // Force refresh
                refreshSpinner.stop();
                if (refreshedChoices.length === 0) {
                    logger.warn('No destinations found after refresh.');
                    // Fall back to manual entry or default
                    const fallbackAnswer = await inquirer.prompt([{
                            type: 'rawlist',
                            name: 'destination',
                            message: 'No destinations found. Select an action:',
                            choices: [{ name: 'Use Default (iPhone 17 Pro)', value: 'platform=iOS Simulator,name=iPhone 17 Pro' }, { name: 'Enter destination manually...', value: manualEntryValue }],
                        }]);
                    selectedDestination = fallbackAnswer.destination;
                }
                else {
                    const refreshedDefaultIndex = refreshedChoices.findIndex(c => c.name.includes('iPhone 17 Pro'));
                    const refreshedAnswer = await inquirer.prompt([{
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
            const manualAnswer = await inquirer.prompt([{
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
    const testSpin = spinner(`Running tests on ${selectedDestination}${selectedTestPlan ? ` with test plan: ${selectedTestPlan}` : ''}...`).start();
    try {
        const testArgs = [
            'test',
            ...baseArgs,
            '-scheme', scheme,
            '-destination', selectedDestination,
            '-enableCodeCoverage', 'YES',
            '-resultBundlePath', resultBundlePath
        ];
        // Add test plan if specified
        if (selectedTestPlan) {
            testArgs.push('-testPlan', selectedTestPlan);
        }
        const subprocess = execa('xcodebuild', testArgs, {
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
        const { all } = await subprocess;
        testSpin.succeed('Tests completed successfully.');
        return { xcresultPath: `${derivedDataPath}/TestResult.xcresult`, selectedDestination: selectedDestination, success: true, log: all || '' };
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
        // Return failure status and logs
        return {
            xcresultPath: `${derivedDataPath}/TestResult.xcresult`,
            selectedDestination: selectedDestination,
            success: false,
            log: error.all || error.message
        };
    }
};
export const getCoverageData = async (xcresultPath) => {
    try {
        const { stdout } = await execa('xcrun', ['xccov', 'view', '--report', '--json', xcresultPath]);
        return JSON.parse(stdout);
    }
    catch (error) {
        logger.error('Failed to parse coverage data from xcresult.');
        throw error;
    }
};
