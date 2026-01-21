"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTestPlan = exports.getTestTargetsFromPlan = exports.parseTestPlan = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const execa_1 = require("execa");
const ui_1 = require("./ui");
const os_1 = __importDefault(require("os"));
const parseTestPlan = (planPath) => {
    if (!fs_1.default.existsSync(planPath)) {
        throw new Error(`Test plan not found: ${planPath}`);
    }
    const content = fs_1.default.readFileSync(planPath, 'utf-8');
    return JSON.parse(content);
};
exports.parseTestPlan = parseTestPlan;
const getTestTargetsFromPlan = (planPath) => {
    const plan = (0, exports.parseTestPlan)(planPath);
    return plan.testTargets.map(t => t.target.identifier);
};
exports.getTestTargetsFromPlan = getTestTargetsFromPlan;
const runTestPlan = async (planPath, destination, projectPath, workspacePath) => {
    const plan = (0, exports.parseTestPlan)(planPath);
    const targets = plan.testTargets.map(t => t.target.identifier);
    ui_1.logger.step(`Running test plan: ${planPath}`);
    ui_1.logger.info(`Test targets: ${targets.join(', ')}`);
    const derivedDataPath = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'cover-test-plan-'));
    const resultBundlePath = path_1.default.join(derivedDataPath, 'TestResult.xcresult');
    const baseArgs = [];
    if (workspacePath) {
        baseArgs.push('-workspace', workspacePath);
    }
    else if (projectPath) {
        baseArgs.push('-project', projectPath);
    }
    else {
        const workspaces = require('glob').sync('*.xcworkspace');
        if (workspaces.length > 0) {
            baseArgs.push('-workspace', workspaces[0]);
        }
        else {
            const projects = require('glob').sync('*.xcodeproj');
            if (projects.length > 0) {
                baseArgs.push('-project', projects[0]);
            }
        }
    }
    const testArgs = ['test', ...baseArgs, '-enableCodeCoverage', 'YES', '-resultBundlePath', resultBundlePath];
    if (destination) {
        testArgs.push('-destination', destination);
    }
    for (const target of targets) {
        testArgs.push('-only-testing', target);
    }
    const testSpin = (0, ui_1.spinner)(`Running tests for ${targets.length} target(s)...`).start();
    try {
        const subprocess = (0, execa_1.execa)('xcodebuild', testArgs, {
            all: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        if (subprocess.stdout) {
            subprocess.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                if (text.includes('Compiling'))
                    testSpin.text = 'Compiling...';
                else if (text.includes('Linking'))
                    testSpin.text = 'Linking...';
                else if (text.includes('Testing'))
                    testSpin.text = 'Testing...';
                else if (text.includes('Signing'))
                    testSpin.text = 'Signing...';
            });
        }
        const { all } = await subprocess;
        testSpin.succeed(`Tests completed for ${targets.length} target(s).`);
        return {
            xcresultPath: resultBundlePath,
            selectedDestination: destination || 'default',
            success: true,
            log: all || '',
            targets
        };
    }
    catch (error) {
        testSpin.fail('Tests failed.');
        if (error.all) {
            console.log(error.all);
        }
        else {
            if (error.stdout)
                console.log(error.stdout);
            if (error.stderr)
                console.error(error.stderr);
        }
        return {
            xcresultPath: resultBundlePath,
            selectedDestination: destination || 'default',
            success: false,
            log: error.all || error.message,
            targets
        };
    }
};
exports.runTestPlan = runTestPlan;
