"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixFailure = exports.runTestFixLoop = void 0;
const fs_1 = __importDefault(require("fs"));
const xcode_1 = require("./xcode");
const results_1 = require("./results");
const llm_1 = require("./llm");
const ui_1 = require("./ui");
const runTestFixLoop = async (scheme, destination, maxRetries = 3, refreshDestinations = false, testPlan) => {
    let retries = 0;
    let currentDestination = destination;
    // Use a set to track which files we've already fixed to avoid infinite loops on the same file if the fix doesn't work
    // or maybe just limit total retries.
    // For now, simple retry count.
    while (retries < maxRetries) {
        ui_1.logger.info(`\n--- Test Run ${retries + 1}/${maxRetries} ---`);
        // runXcodeTests now returns the path even on failure, thanks to the recent fix
        const { xcresultPath, selectedDestination, success, log } = await (0, xcode_1.runXcodeTests)(scheme, currentDestination, undefined, undefined, refreshDestinations, testPlan);
        // Update destination for next run so we don't ask again
        currentDestination = selectedDestination;
        let failures = [];
        if (!success) {
            ui_1.logger.error('Build failed. Analyzing build logs...');
            failures = (0, results_1.getBuildFailures)(log);
            if (failures.length === 0) {
                ui_1.logger.warn('Build failed but no standard error messages found in log.');
                // Fallback to generic error if possible, or just break
                ui_1.logger.warn('Full log tail: ' + log.slice(-500));
            }
        }
        else {
            // Check for failures
            failures = await (0, results_1.getTestFailures)(xcresultPath);
        }
        if (failures.length === 0) {
            if (success) {
                ui_1.logger.success('All tests passed!');
                return;
            }
            else {
                ui_1.logger.error('Build failed and no structured errors could be parsed. Stopping.');
                break;
            }
        }
        ui_1.logger.error(`Found ${failures.length} failure(s).`);
        // Fix the first one
        const failure = failures[0];
        ui_1.logger.info(`Attempting to fix: ${failure.testCaseName} in ${failure.fileName}`);
        const fixed = await (0, exports.fixFailure)(failure);
        if (!fixed) {
            ui_1.logger.warn('Could not fix failure. Stopping loop.');
            break;
        }
        retries++;
    }
    if (retries >= maxRetries) {
        ui_1.logger.error('Max retries reached. Tests still failing.');
    }
};
exports.runTestFixLoop = runTestFixLoop;
const fixFailure = async (failure) => {
    if (!fs_1.default.existsSync(failure.fileName)) {
        ui_1.logger.warn(`File not found: ${failure.fileName}`);
        return false;
    }
    const fileContent = fs_1.default.readFileSync(failure.fileName, 'utf-8');
    // 1. Analyze (Local)
    try {
        const analyzer = (0, llm_1.getAnalyzerClient)();
        const analyzePrompt = `
You are an expert iOS developer.
Analyze this Swift test file and the failure message.
Explain why the test failed and what code needs to be changed.
Be concise.

File Content:
${fileContent}

Failure Message:
${failure.message}
at line ${failure.lineNumber}
        `;
        const spin = (0, ui_1.spinner)(`Analyzing failure with ${analyzer.model}...`).start();
        const analysis = await analyzer.client.chat.completions.create({
            model: analyzer.model,
            messages: [{ role: 'user', content: analyzePrompt }]
        });
        const reason = analysis.choices[0].message.content;
        spin.succeed('Analysis complete.');
        ui_1.logger.info(`Reason: ${reason}`);
        // 2. Fix (Remote/Local)
        const fixer = (0, llm_1.getFixerClient)();
        const fixPrompt = `
You are an expert iOS developer.
The following test file has a failure.
Reason: ${reason}

Rewrite the ENTIRE file with the fix applied.
Output ONLY the valid Swift code. No markdown blocks, no commentary.

File Content:
${fileContent}
        `;
        const fixSpin = (0, ui_1.spinner)(`Generating fix with ${fixer.model}...`).start();
        const fixResponse = await fixer.client.chat.completions.create({
            model: fixer.model,
            messages: [{ role: 'user', content: fixPrompt }]
        });
        let fixedCode = fixResponse.choices[0].message.content || '';
        // Strip markdown if present
        fixedCode = fixedCode.replace(/```swift/g, '').replace(/```/g, '').trim();
        if (fixedCode.length < 10) {
            fixSpin.fail('Generated code seems invalid (too short).');
            return false;
        }
        fixSpin.succeed('Fix generated.');
        fs_1.default.writeFileSync(failure.fileName, fixedCode);
        ui_1.logger.success(`Applied fix to ${failure.fileName}`);
        return true;
    }
    catch (e) {
        ui_1.logger.error(`LLM Error: ${e.message}`);
        return false;
    }
};
exports.fixFailure = fixFailure;
