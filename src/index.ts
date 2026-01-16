#!/usr/bin/env node
import { Command } from 'commander';
import { getChangedFiles, getCurrentBranch } from './git';
import { runXcodeTests, getCoverageData } from './xcode';
import { processCoverage } from './coverage';
import { printCoverageTable, logger, spinner } from './ui';
import { selectAgent, generatePrompt, runAgent } from './agent';
import { runTestFixLoop, fixFailure } from './fixer';
import { setupLLM } from './llm';
import { runInit } from './init';
import { getTestFailures, getBuildFailures } from './results';
import { detectFramework, createFramework, getAvailableFrameworks } from './frameworks';
import { JSTestRunner, runJSTests, runTestsForChangedFiles } from './test-runner';
import { loadConfig } from './config';
import inquirer from 'inquirer';

const program = new Command();

program
  .name('cover')
  .description('Automated TDD/Coverage loop for iOS/macOS and JavaScript/TypeScript')
  .version('1.0.0');

program.command('init [path]')
  .description('Initialize Cover in a project directory')
  .action(async (path) => {
      try {
          await runInit(path || '.');
      } catch (error: any) {
          logger.error(error.message || error);
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
        await setupLLM();
        
        // Detect framework
        const config = loadConfig();
        let framework = options.framework || config?.framework;
        if (!framework) {
            const detected = await detectFramework();
            if (detected) {
                framework = detected;
                logger.info(`Detected framework: ${framework}`);
            }
        }

        if (framework && framework !== 'XCTest') {
            // JS/TS framework - use JSTestRunner
            const runner = new JSTestRunner();
            await runner.initialize({ framework });
            
            // Run tests and fix failures
            const result = await runner.runTests({
                coverage: true,
                testFiles: options.testFiles,
                additionalArgs: []
            });
            
            if (!result.passed && result.failures) {
                logger.info(`${result.failures.length} test failures found. Starting auto-fix...`);
                
                for (const failure of result.failures.slice(0, parseInt(options.retries))) {
                    const agent = await selectAgent();
                    const prompt = `Fix this test failure:\n\nFile: ${failure.file}\nError: ${failure.message}\n\n${failure.fullMessage}`;
                    
                    await runAgent(agent, prompt);
                    logger.info(`Applied fix for: ${failure.message}`);
                }
            }
        } else {
            // Xcode framework - use existing logic
            let scheme = options.scheme;
            if (!scheme) {
                const answers = await inquirer.prompt([{
                    type: 'input',
                    name: 'scheme',
                    message: 'Enter Xcode Scheme to test:',
                    validate: (input) => input ? true : 'Scheme is required'
                }]);
                scheme = answers.scheme;
            }

            await runTestFixLoop(scheme, options.destination, parseInt(options.retries), options.refreshDestinations);
        }
        
    } catch (error: any) {
        logger.error(error.message || error);
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
      logger.info('Starting Cover...');

      // 1. Analyze Git
      const currentBranch = await getCurrentBranch();
      const changedFiles = await getChangedFiles(options.branch);

      if (changedFiles.length === 0) {
        logger.success('No changed source files found to check.');
        return;
      }

      logger.info(`Found ${changedFiles.length} changed file(s) on ${currentBranch} vs ${options.branch}`);
      
      // Detect framework
      const config = loadConfig();
      let framework = options.framework || config?.framework;
      if (!framework) {
        const detected = await detectFramework();
        if (detected) {
            framework = detected;
            logger.info(`Detected framework: ${framework}`);
        }
      }

      // Setup LLM early if user wants to use agent features
      await setupLLM();

      if (framework && framework !== 'XCTest') {
        // JS/TS framework - use JSTestRunner
        const runner = new JSTestRunner();
        await runner.initialize({ framework });

        // Run tests for changed files
        const result = await runner.runTestsForChangedFiles(changedFiles, {
          coverage: options.coverage !== false,
          gitDiff: { changedFiles }
        });

        if (!result.passed && result.failures) {
          logger.error(`Found ${result.failures.length} test failure(s).`);
          
          const { fixAction } = await inquirer.prompt([{
            type: 'list',
            name: 'fixAction',
            message: 'Tests failed. What would you like to do?',
            choices: [
              'Auto-Fix Failures with AI',
              'Generate Missing Tests',
              'Exit'
            ]
          }]);
          
          if (fixAction === 'Exit') return;
          
          if (fixAction === 'Auto-Fix Failures with AI') {
            for (const failure of result.failures) {
              const agent = await selectAgent();
              const prompt = `Fix this test failure:\n\nFile: ${failure.file}\nError: ${failure.message}\n\n${failure.fullMessage}`;
              await runAgent(agent, prompt);
            }
          } else if (fixAction === 'Generate Missing Tests') {
            if (result.coverage && result.coverage.files.length > 0) {
              const agent = await selectAgent();
              const targetFile = result.coverage.files.sort((a, b) => a.lineCoverage - b.lineCoverage)[0];
              
              logger.info(`Generating tests for: ${targetFile.path} (${targetFile.lineCoverage.toFixed(1)}%)`);
              const prompt = generatePrompt(targetFile.path); 
              await runAgent(agent, prompt);
            }
          }
        }

        // Show coverage if available
        if (result.coverage) {
          printCoverageTable(result.coverage.files.filter(f => changedFiles.some(cf => f.path.includes(cf))));
          
          // Check threshold
          const failedFiles = result.coverage.files.filter(f => 
            changedFiles.some(cf => f.path.includes(cf)) && f.lineCoverage < parseFloat(options.threshold)
          );
          
          if (failedFiles.length === 0) {
            logger.success('All changed files meet the coverage threshold!');
          } else {
            logger.warn(`${failedFiles.length} file(s) are below the ${options.threshold}% threshold.`);
          }
        }

      } else {
        // Xcode framework - use existing logic
        // Main Loop
        let allPassed = false;
        let destination: string | undefined = undefined;

        while (!allPassed) {
          // 2. Ask user for Scheme if not provided
          let scheme = options.scheme;
          if (!scheme) {
              const answers = await inquirer.prompt([{
                  type: 'input',
                  name: 'scheme',
                  message: 'Enter Xcode Scheme to test:',
                  validate: (input) => input ? true : 'Scheme is required'
              }]);
              scheme = answers.scheme;
              options.scheme = scheme; 
          }

          // 3. Run Tests
          const result = await runXcodeTests(scheme, destination, options.project, options.workspace, options.refreshDestinations);
          const xcresultPath = result.xcresultPath;
          destination = result.selectedDestination;
          
          // 4. Check for Failures
          let testFailures = await getTestFailures(xcresultPath);
          
          // If build failed, we might not have test results, or they might be stale.
          // Prioritize build errors if success is false.
          if (!result.success) {
              const buildFailures = getBuildFailures(result.log);
              if (buildFailures.length > 0) {
                  testFailures = buildFailures;
              } else {
                  logger.error('Build failed but no structured errors found.');
              }
          }

          if (testFailures.length > 0) {
              logger.error(`Found ${testFailures.length} failure(s).`);
              
              // Ask user if they want to fix failures first
              const { fixAction } = await inquirer.prompt([{
                  type: 'list',
                  name: 'fixAction',
                  message: 'Tests/Build failed. What would you like to do?',
                  choices: [
                      'Auto-Fix Failures with AI',
                      'Ignore and Check Coverage',
                      'Exit'
                  ]
              }]);
              
              if (fixAction === 'Exit') break;
              
              if (fixAction === 'Auto-Fix Failures with AI') {
                  // Try to fix the first failure
                  const failure = testFailures[0];
                  logger.info(`Attempting to fix: ${failure.testCaseName} in ${failure.fileName}`);
                  const fixed = await fixFailure(failure);
                  if (fixed) {
                      logger.success('Fix applied! Re-running tests...');
                      continue; // Loop again
                  } else {
                      logger.warn('Could not fix failure.');
                  }
              }
          }
          
          if (!result.success) {
              logger.error('Cannot generate coverage data because the build failed.');
              const { retry } = await inquirer.prompt([{
                  type: 'confirm',
                  name: 'retry',
                  message: 'Retry?',
                  default: true
              }]);
              if (retry) continue;
              else break;
          }

          // 5. Get Data
          const coverageJson = await getCoverageData(xcresultPath);
          
          // 6. Evaluate
          const report = processCoverage(coverageJson, changedFiles);
          printCoverageTable(report);

          // 7. Check Threshold
          const failedFiles = report.filter(f => f.lineCoverage < parseFloat(options.threshold));
          
          if (failedFiles.length === 0) {
            logger.success('All changed files meet the coverage threshold!');
            allPassed = true;
            break;
          }

          logger.warn(`${failedFiles.length} file(s) are below the ${options.threshold}% threshold.`);

          // 8. Iterate / Agent
          const { action } = await inquirer.prompt([
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
          } else if (action === 'Generate Tests with Agent') {
              const agent = await selectAgent();
              const targetFile = failedFiles.sort((a, b) => a.lineCoverage - b.lineCoverage)[0];
              
              logger.info(`Targeting ${targetFile.path} (${targetFile.lineCoverage.toFixed(1)}%)`);
              const prompt = generatePrompt(targetFile.path); 
              
              await runAgent(agent, prompt);
          }
        }
      }
      
    } catch (error: any) {
      logger.error(error.message || error);
      process.exit(1);
    }
  });

program.parse(process.argv);
