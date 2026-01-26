#!/usr/bin/env node
import { Command } from 'commander';
import { getChangedFiles, getCurrentBranch, getHeadCommit, validateBranchExists, getChangedSwiftLines, getChangedLinesPerFile } from './git';
import { runXcodeTests, getCoverageData } from './xcode';
import { processCoverage, processCoverageLegacy } from './coverage';
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
import { runTestPlan, getTestTargetsFromPlan, parseTestPlan } from './test-plan';
import { execa } from 'execa';
import { glob } from 'glob';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseCoverageArtifacts, findManifest, findExistingXcresult, getSupportedFormats } from './coverage-formats';
import { calculatePRCoverage } from './pr-coverage';
import { formatPRCoverageReport, printPRCoverageReport, formatPRCoverageSummaryLine } from './pr-coverage-report';
import { CoverageFormat } from './types';
import { getFlakyTests, printFlakyTestReport } from './flaky';
import { parseOutput } from './xcsift';

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
  .option('-T, --test-plan <plan>', 'Xcode test plan name (optional)')
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

            await runTestFixLoop(scheme, options.destination, parseInt(options.retries), options.refreshDestinations, options.testPlan);
        }
        
    } catch (error: any) {
        logger.error(error.message || error);
        process.exit(1);
    }
  });


async function readStdin(): Promise<string> {
    const { stdin } = process;
    if (stdin.isTTY) return '';
    
    let result = '';
    stdin.setEncoding('utf8');
    
    for await (const chunk of stdin) {
        result += chunk;
    }
    
    return result;
}

program
  .command('flaky')
  .description('Detect and report flaky tests')
  .option('--project-slug <slug>', 'CircleCI project slug (e.g., gh/org/repo)')
  .option('--threshold <number>', 'Pass rate threshold for flagging (default: 95)', '95')
  .action(async (options) => {
    try {
        const report = await getFlakyTests({
            projectSlug: options.projectSlug,
            workspaceRoot: process.cwd()
        });
        printFlakyTestReport(report);
    } catch (error: any) {
        logger.error(error.message || error);
        process.exit(1);
    }
  });

program.command('parse')
  .description('Parse xcodebuild/swift output using xcsift')
  .option('-w, --warnings', 'Include warnings')
  .option('-c, --coverage', 'Include coverage')
  .option('--slow-threshold <seconds>', 'Slow test threshold')
  .action(async (options) => {
    try {
        // Read from stdin and parse
        const input = await readStdin();
        if (!input) {
            logger.error('No input provided via stdin.');
            process.exit(1);
        }
        
        const result = await parseOutput(input, {
            includeWarnings: options.warnings,
            includeCoverage: options.coverage,
            slowThreshold: options.slowThreshold ? parseFloat(options.slowThreshold) : undefined
        });
        console.log(JSON.stringify(result, null, 2));
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
  .option('-w, --workspace <path>', '.xcworkspace path')
  .option('-p, --project <path>', '.xcodeproj path')
  .option('-T, --test-plan <plan>', 'Xcode test plan name (optional)')
  .option('--no-coverage', 'Skip coverage generation')
  .option('--refresh-destinations', 'Refresh the cached list of Xcode run destinations')
  .option('-v, --verbose', 'Verbose output')
  .option('--pr-lines-only', 'Show only PR-changed lines in coverage report')
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
          const result = await runXcodeTests(scheme, destination, options.project, options.workspace, options.refreshDestinations, options.testPlan);
          const xcresultPath = result.xcresultPath;
          destination = result.selectedDestination;
          
          // 4. Check for Failures
          let testFailures = await getTestFailures(xcresultPath);
          
          // If xcodebuild exited with non-zero, check for build errors.
          // Note: xcodebuild exits non-zero for BOTH build failures AND test failures.
          // Prioritize build errors (compilation/linker) over test failures.
          if (!result.success) {
              const buildFailures = await getBuildFailures(result.log);
              if (buildFailures.length > 0) {
                  testFailures = buildFailures;
              } else if (testFailures.length === 0) {
                  // No build errors and no test failures parsed - likely a test failure
                  // that we couldn't extract from xcresult. Don't block coverage.
                  logger.warn('Tests failed but no structured failure details found in xcresult.');
              }
          }

          if (testFailures.length > 0) {
              logger.error(`Found ${testFailures.length} failure(s).`);
              
              // Check if these are build failures or test failures
              const isBuildFailure = testFailures.some(f => f.testCaseName === 'Build Failure');

              // Ask user if they want to fix failures first
              const { fixAction } = await inquirer.prompt([{
                  type: 'list',
                  name: 'fixAction',
                  message: isBuildFailure ? 'Build failed. What would you like to do?' : 'Tests failed. What would you like to do?',
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
          
          // Determine if we should block coverage generation
          // Block only if there are actual build failures (compilation/linker errors)
          // Test failures (assertions) should NOT block coverage - xcodebuild exits non-zero for test failures too
          const additionalBuildFailures = await getBuildFailures(result.log);
          const hasBuildErrors = testFailures.some(f => f.testCaseName === 'Build Failure') || additionalBuildFailures.length > 0;
          const isRealBuildFailure = !result.success && hasBuildErrors;

          if (isRealBuildFailure) {
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
          const report = processCoverageLegacy(coverageJson, changedFiles);
          printCoverageTable(report);

          // 6b. Show PR line-level coverage if requested
          if (options.prLinesOnly) {
            try {
              const diffResult = await getChangedSwiftLines(options.branch);
              if (diffResult.files.length > 0) {
                const lineCoverageData = await parseCoverageArtifacts({
                  format: 'xccov',
                  paths: [xcresultPath],
                  parserOptions: { verbose: options.verbose }
                });
                const headCommit = await getHeadCommit();
                const prResult = await calculatePRCoverage(diffResult, lineCoverageData, { verbose: options.verbose });
                prResult.metadata.baseBranch = options.branch;
                prResult.metadata.headCommit = headCommit;
                prResult.metadata.coverageFormat = 'xccov';
                
                console.log(''); // Separator
                printPRCoverageReport(prResult, { threshold: parseFloat(options.threshold), verbose: options.verbose });
              }
            } catch (prError: any) {
              if (options.verbose) {
                logger.warn(`Could not calculate PR line coverage: ${prError.message}`);
              }
            }
          }

          // 7. Check Threshold
          const failedFiles = report.filter((f: { lineCoverage: number }) => f.lineCoverage < parseFloat(options.threshold));
          
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
              const targetFile = failedFiles.sort((a: { lineCoverage: number }, b: { lineCoverage: number }) => a.lineCoverage - b.lineCoverage)[0];
              
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

program.command('test-plan <path>')
.description('Run tests from an Xcode testing plan JSON file')
.option('-d, --destination <destination>', 'Simulator destination')
.option('-T, --test-plan <plan>', 'Xcode test plan name (optional)')
.option('-w, --workspace <path>', 'Path to .xcworkspace')
.option('-p, --project <path>', 'Path to .xcodeproj')
.option('--no-coverage', 'Skip coverage generation')
.action(async (planPath, options) => {
    try {
        const plan = parseTestPlan(planPath);
        logger.info(`Loaded test plan: ${planPath}`);
        logger.info(`Targets: ${plan.testTargets.map(t => t.target.name).join(', ')}`);
        
        const result = await runTestPlan(planPath, options.destination, options.project, options.workspace, options.testPlan);
        
        if (!result.success) {
            logger.error('Tests failed.');
            process.exit(1);
        }
        
        if (options.coverage !== false) {
            logger.info('Processing coverage...');
            const coverageJson = await getCoverageData(result.xcresultPath);
            const report = processCoverageLegacy(coverageJson, []);
            printCoverageTable(report);
        }
        
        logger.success('Test plan completed successfully.');
    } catch (error: any) {
        logger.error(error.message || error);
        process.exit(1);
    }
});

program.command('run-targets <targets...>')
.description('Run specific test targets (e.g., cover run-targets MyTests MyOtherTests)')
.option('-s, --scheme <scheme>', 'Xcode scheme (required if no .xcscheme found)')
.option('-d, --destination <destination>', 'Simulator destination')
.option('-T, --test-plan <plan>', 'Xcode test plan name (optional)')
.option('-w, --workspace <path>', 'Path to .xcworkspace')
.option('-p, --project <path>', 'Path to .xcodeproj')
.option('--no-coverage', 'Skip coverage generation')
.action(async (targets, options) => {
    try {
        logger.info(`Running targets: ${targets.join(', ')}`);
        
        const derivedDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-targets-'));
        const resultBundlePath = path.join(derivedDataPath, 'TestResult.xcresult');
        
        let baseArgs: string[] = [];
        if (options.workspace) {
            baseArgs.push('-workspace', options.workspace);
        } else if (options.project) {
            baseArgs.push('-project', options.project);
        } else {
            const workspaces = await glob('*.xcworkspace');
            if (workspaces.length > 0) {
                baseArgs.push('-workspace', workspaces[0]);
            } else {
                const projects = await glob('*.xcodeproj');
                if (projects.length > 0) {
                    baseArgs.push('-project', projects[0]);
                }
            }
        }
        
        if (options.scheme) {
            baseArgs.push('-scheme', options.scheme);
        }
        
        const testArgs: string[] = ['test', ...baseArgs, '-enableCodeCoverage', 'YES', '-resultBundlePath', resultBundlePath];
        
        if (options.destination) {
            testArgs.push('-destination', options.destination);
        }
        
        if (options.testPlan) {
            testArgs.push('-testPlan', options.testPlan);
        }
        
        for (const target of targets) {
            testArgs.push('-only-testing', target);
        }
        
        const testSpin = spinner(`Running tests for ${targets.length} target(s)...`).start();
        
        const subprocess = execa('xcodebuild', testArgs, {
            all: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        if (subprocess.stdout) {
            subprocess.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                if (text.includes('Compiling')) testSpin.text = 'Compiling...';
                else if (text.includes('Testing')) testSpin.text = 'Testing...';
            });
        }
        
        const { all } = await subprocess;
        testSpin.succeed(`Tests completed for ${targets.length} target(s).`);
        
        if (options.coverage !== false) {
            logger.info('Processing coverage...');
            const coverageJson = await getCoverageData(resultBundlePath);
            const report = processCoverageLegacy(coverageJson, []);
            printCoverageTable(report);
        }
        
        logger.success('Test run completed successfully.');
    } catch (error: any) {
        logger.error(error.message || error);
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

      logger.info('Calculating PR line coverage...');

      // 1. Validate base branch exists
      if (verbose) logger.info(`Validating base branch: ${options.base}`);
      const branchExists = await validateBranchExists(options.base);
      if (!branchExists) {
        logger.error(`Base branch '${options.base}' does not exist. Try 'git fetch origin ${options.base}' first.`);
        process.exit(1);
      }

      // 2. Get line-level diff
      if (verbose) logger.info('Getting line-level diff...');
      const diffResult = await getChangedSwiftLines(options.base);
      
      if (diffResult.files.length === 0) {
        logger.success('No changed Swift/ObjC files found.');
        return;
      }

      logger.info(`Found ${diffResult.files.length} changed file(s) with ${diffResult.totalAddedLines} new/updated lines`);

      // 3. Find or generate coverage data
      let coverageData: Map<string, any>;
      let coverageFormat: CoverageFormat = 'xccov';

      if (options.manifest) {
        // Use manifest file
        if (verbose) logger.info(`Loading manifest: ${options.manifest}`);
        coverageData = await parseCoverageArtifacts({
          manifestPath: options.manifest,
          parserOptions: { verbose, fast: options.fast }
        });
      } else if (options.coveragePath && options.coveragePath.length > 0) {
        // Use explicit coverage paths
        if (options.coverageFormat) {
          coverageFormat = options.coverageFormat as CoverageFormat;
        }
        if (verbose) logger.info(`Parsing coverage from: ${options.coveragePath.join(', ')}`);
        coverageData = await parseCoverageArtifacts({
          format: coverageFormat,
          paths: options.coveragePath,
          parserOptions: { verbose, fast: options.fast }
        });
      } else {
        // Try to auto-detect coverage source
        const manifest = findManifest();
        if (manifest) {
          if (verbose) logger.info(`Found manifest: ${manifest}`);
          coverageData = await parseCoverageArtifacts({
            manifestPath: manifest,
            parserOptions: { verbose, fast: options.fast }
          });
        } else {
          // Try to find existing xcresult
          const xcresult = await findExistingXcresult();
          if (xcresult) {
            if (verbose) logger.info(`Found xcresult: ${xcresult}`);
            coverageData = await parseCoverageArtifacts({
              format: 'xccov',
              paths: [xcresult],
              parserOptions: { verbose, fast: options.fast }
            });
          } else if (options.scheme) {
            // Run tests to generate coverage
            logger.info('No coverage found. Running tests to generate coverage...');
            const result = await runXcodeTests(options.scheme, undefined);
            if (!result.success) {
              logger.error('Tests failed. Cannot generate coverage data.');
              process.exit(1);
            }
            coverageData = await parseCoverageArtifacts({
              format: 'xccov',
              paths: [result.xcresultPath],
              parserOptions: { verbose, fast: options.fast }
            });
          } else {
            logger.error('No coverage data found. Provide --coverage-path, --manifest, or --scheme to generate coverage.');
            logger.info(`Supported formats: ${getSupportedFormats().join(', ')}`);
            process.exit(1);
          }
        }
      }

      if (verbose) logger.info(`Coverage data loaded for ${coverageData.size} files`);

      // 4. Calculate PR coverage
      const headCommit = await getHeadCommit();
      const prCoverageResult = await calculatePRCoverage(diffResult, coverageData, { verbose });
      
      // Fill in metadata
      prCoverageResult.metadata.baseBranch = options.base;
      prCoverageResult.metadata.headCommit = headCommit;
      prCoverageResult.metadata.coverageFormat = coverageFormat;
      prCoverageResult.metadata.fast = options.fast || false;

      // 5. Output report
      printPRCoverageReport(prCoverageResult, { strict, threshold, verbose });

      // 6. Check threshold
      const passing = prCoverageResult.summary.lineCoveragePercent >= threshold;
      if (passing) {
        logger.success(`PR coverage ${prCoverageResult.summary.lineCoveragePercent.toFixed(1)}% meets threshold of ${threshold}%`);
      } else {
        logger.error(`PR coverage ${prCoverageResult.summary.lineCoveragePercent.toFixed(1)}% is below threshold of ${threshold}%`);
        process.exit(1);
      }

    } catch (error: any) {
      logger.error(error.message || error);
      process.exit(1);
    }
  });

program.parse(process.argv);
