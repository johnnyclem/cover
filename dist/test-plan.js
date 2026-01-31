import fs from 'fs';
import path from 'path';
import { execa } from 'execa';
import { logger, spinner } from './ui.js';
import os from 'os';
export const parseTestPlan = (planPath) => {
    if (!fs.existsSync(planPath)) {
        throw new Error(`Test plan not found: ${planPath}`);
    }
    const content = fs.readFileSync(planPath, 'utf-8');
    return JSON.parse(content);
};
export const getTestTargetsFromPlan = (planPath) => {
    const plan = parseTestPlan(planPath);
    return plan.testTargets.map(t => t.target.identifier);
};
export const runTestPlan = async (planPath, destination, projectPath, workspacePath, testPlanName) => {
    const plan = parseTestPlan(planPath);
    const targets = plan.testTargets.map(t => t.target.identifier);
    logger.step(`Running test plan: ${planPath}`);
    logger.info(`Test targets: ${targets.join(', ')}`);
    const derivedDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-test-plan-'));
    const resultBundlePath = path.join(derivedDataPath, 'TestResult.xcresult');
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
    if (testPlanName) {
        testArgs.push('-testPlan', testPlanName);
    }
    for (const target of targets) {
        testArgs.push('-only-testing', target);
    }
    const testSpin = spinner(`Running tests for ${targets.length} target(s)...`).start();
    try {
        const subprocess = execa('xcodebuild', testArgs, {
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
