import fs from 'fs';
import { runXcodeTests } from './xcode';
import { getTestFailures, TestFailure } from './results';
import { getAnalyzerClient, getFixerClient } from './llm';
import { logger, spinner } from './ui';

export const runTestFixLoop = async (scheme: string, destination: string | undefined, maxRetries: number = 3) => {
    let retries = 0;

    // Use a set to track which files we've already fixed to avoid infinite loops on the same file if the fix doesn't work
    // or maybe just limit total retries.
    // For now, simple retry count.

    while (retries < maxRetries) {
        logger.info(`\n--- Test Run ${retries + 1}/${maxRetries} ---`);
        
        // runXcodeTests now returns the path even on failure, thanks to the recent fix
        const { xcresultPath, selectedDestination } = await runXcodeTests(scheme, destination);
        
        // Check for failures
        const failures = await getTestFailures(xcresultPath);
        
        if (failures.length === 0) {
            // No failures? Great!
            // But wait, if xcodebuild failed due to compilation error, getTestFailures might return empty.
            // runXcodeTests logs the error output to console if it fails.
            // For this agent, we only handle *test* failures for now.
            logger.success('All tests passed!');
            return;
        }

        logger.error(`Found ${failures.length} test failure(s).`);
        
        // Fix the first one
        const failure = failures[0];
        logger.info(`Attempting to fix: ${failure.testCaseName} in ${failure.fileName}`);
        
        const fixed = await fixFailure(failure);
        
        if (!fixed) {
            logger.warn('Could not fix failure. Stopping loop.');
            break;
        }
        
        retries++;
    }
    
    if (retries >= maxRetries) {
        logger.error('Max retries reached. Tests still failing.');
    }
};

export const fixFailure = async (failure: TestFailure): Promise<boolean> => {
    if (!fs.existsSync(failure.fileName)) {
        logger.warn(`File not found: ${failure.fileName}`);
        return false;
    }

    const fileContent = fs.readFileSync(failure.fileName, 'utf-8');
    
    // 1. Analyze (Local)
    try {
        const analyzer = getAnalyzerClient();
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

        const spin = spinner(`Analyzing failure with ${analyzer.model}...`).start();
        const analysis = await analyzer.client.chat.completions.create({
            model: analyzer.model,
            messages: [{ role: 'user', content: analyzePrompt }]
        });
        const reason = analysis.choices[0].message.content;
        spin.succeed('Analysis complete.');
        logger.info(`Reason: ${reason}`);

        // 2. Fix (Remote/Local)
        const fixer = getFixerClient();
        const fixPrompt = `
You are an expert iOS developer.
The following test file has a failure.
Reason: ${reason}

Rewrite the ENTIRE file with the fix applied.
Output ONLY the valid Swift code. No markdown blocks, no commentary.

File Content:
${fileContent}
        `;

        const fixSpin = spinner(`Generating fix with ${fixer.model}...`).start();
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
        
        fs.writeFileSync(failure.fileName, fixedCode);
        logger.success(`Applied fix to ${failure.fileName}`);
        return true;

    } catch (e: any) {
        logger.error(`LLM Error: ${e.message}`);
        return false;
    }
};
