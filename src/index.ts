#!/usr/bin/env node
import { Command } from 'commander';
import { getChangedFiles, getCurrentBranch } from './git';
import { runXcodeTests, getCoverageData } from './xcode';
import { processCoverage } from './coverage';
import { printCoverageTable, logger, spinner } from './ui';
import { selectAgent, generatePrompt, runAgent } from './agent';
import { runTestFixLoop } from './fixer';
import { setupLLM } from './llm';
import { runInit } from './init';
import inquirer from 'inquirer';

const program = new Command();

program
  .name('cover')
  .description('Automated TDD/Coverage loop for iOS/macOS')
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
  .action(async (options) => {
    try {
        await setupLLM();
        
        let scheme = options.scheme;
        if (!scheme) {
            const answers = await inquirer.prompt([{
                type: 'input',
                name: 'scheme',
                message: 'Enter the Xcode Scheme to test:',
                validate: (input) => input ? true : 'Scheme is required'
            }]);
            scheme = answers.scheme;
        }

        await runTestFixLoop(scheme, options.destination, parseInt(options.retries));
        
    } catch (error: any) {
        logger.error(error.message || error);
        process.exit(1);
    }
  });

program
  .command('check', { isDefault: true })
  .description('Check code coverage (default)')
  .option('-s, --scheme <scheme>', 'Xcode scheme to test')

  .option('-b, --branch <branch>', 'Base branch to compare against', 'main')
  .option('-t, --threshold <number>', 'Coverage threshold percentage', '80')
  .option('-w, --workspace <path>', 'Path to .xcworkspace')
  .option('-p, --project <path>', 'Path to .xcodeproj')
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

      // Main Loop
      let allPassed = false;
      let destination: string | undefined = undefined;

      while (!allPassed) {
        // 2. Ask user for Scheme if not provided
        let scheme = options.scheme;
        if (!scheme) {
            // In a real app we'd parse .xcodeproj to list schemes, 
            // but for now we ask the user to type it or we default if possible.
            const answers = await inquirer.prompt([{
                type: 'input',
                name: 'scheme',
                message: 'Enter the Xcode Scheme to test:',
                validate: (input) => input ? true : 'Scheme is required'
            }]);
            scheme = answers.scheme;
            // save for next loop iteration to avoid re-asking
            options.scheme = scheme; 
        }

        // 3. Run Tests
        const result = await runXcodeTests(scheme, destination, options.project, options.workspace);
        const xcresultPath = result.xcresultPath;
        destination = result.selectedDestination;
        
        // 4. Get Data
        const coverageJson = await getCoverageData(xcresultPath);
        
        // 5. Evaluate
        const report = processCoverage(coverageJson, changedFiles);
        printCoverageTable(report);

        // 6. Check Threshold
        const failedFiles = report.filter(f => f.lineCoverage < parseFloat(options.threshold));
        
        if (failedFiles.length === 0) {
          logger.success('All changed files meet the coverage threshold!');
          allPassed = true;
          break;
        }

        logger.warn(`${failedFiles.length} file(s) are below the ${options.threshold}% threshold.`);

        // 7. Iterate / Agent
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
            // We can only handle one file at a time effectively in this loop prototype
            // or loop through them. Let's pick the worst one first.
            const targetFile = failedFiles.sort((a, b) => a.lineCoverage - b.lineCoverage)[0];
            
            logger.info(`Targeting ${targetFile.path} (${targetFile.lineCoverage.toFixed(1)}%)`);
            const prompt = generatePrompt(targetFile.path); // path might be relative/absolute issue here.
            
            await runAgent(agent, prompt);
        }
      }
      
    } catch (error: any) {
      logger.error(error.message || error);
      process.exit(1);
    }
  });

program.parse(process.argv);
