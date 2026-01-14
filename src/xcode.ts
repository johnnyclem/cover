import { execa } from 'execa';
import { glob } from 'glob';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger, spinner } from './ui';
import inquirer from 'inquirer';

const detectBaseArgs = async (projectPath?: string, workspacePath?: string): Promise<string[]> => {
  const baseArgs: string[] = [];
  if (workspacePath) {
    baseArgs.push('-workspace', workspacePath);
  } else if (projectPath) {
    baseArgs.push('-project', projectPath);
  } else {
    // Auto-discovery logic...
    const workspaces = await glob('*.xcworkspace');
    if (workspaces.length > 0) {
        baseArgs.push('-workspace', workspaces[0]);
    } else {
        const deepWorkspaces = await glob('**/*.xcworkspace', { ignore: '**/node_modules/**' });
        if (deepWorkspaces.length > 0) {
            if (deepWorkspaces.length > 1) {
                logger.warn(`Found multiple workspaces: ${deepWorkspaces.join(', ')}. Using ${deepWorkspaces[0]}`);
            }
            baseArgs.push('-workspace', deepWorkspaces[0]);
            logger.info(`Auto-detected workspace: ${deepWorkspaces[0]}`);
        } else {
            const projects = await glob('*.xcodeproj');
            if (projects.length > 0) {
                baseArgs.push('-project', projects[0]);
            } else {
                const deepProjects = await glob('**/*.xcodeproj', { ignore: '**/node_modules/**' });
                if (deepProjects.length > 0) {
                    baseArgs.push('-project', deepProjects[0]);
                    logger.info(`Auto-detected project: ${deepProjects[0]}`);
                } else {
                    throw new Error('No Xcode project or workspace found (searched recursively).');
                }
            }
        }
    }
  }
  return baseArgs;
};

const getDestinations = async (scheme: string, baseArgs: string[]): Promise<{ name: string, value: string }[]> => {
  try {
      const destArgs = [...baseArgs, '-scheme', scheme, '-showdestinations'];
      const { stdout } = await execa('xcodebuild', destArgs);
      
      const lines = stdout.split('\n');
      const choices: { name: string, value: string }[] = [];
      const seenNames = new Set<string>();
      
      lines.forEach((line: string) => {
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
      
      return choices;
  } catch (error) {
      logger.warn('Failed to fetch destinations.');
      return [];
  }
};

export const runXcodeTests = async (scheme: string, destination: string | undefined, projectPath?: string, workspacePath?: string): Promise<{ xcresultPath: string, selectedDestination: string }> => {
  logger.step(`Preparing tests for scheme: ${scheme}`);
  
  // Create a temporary derived data path to easily locate logs/results
  const derivedDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-derived-data-'));
  const resultBundlePath = path.join(derivedDataPath, 'TestResult.xcresult');

  const baseArgs = await detectBaseArgs(projectPath, workspacePath);

  // Destination Handling
  let selectedDestination = destination;

  if (!selectedDestination) {
      const testSpinner = spinner('Checking available destinations...');
      testSpinner.start();
      const choices = await getDestinations(scheme, baseArgs);
      testSpinner.stop();
      
      const manualEntryValue = 'MANUAL_ENTRY';

      // Add "Manual Entry" option
      const promptChoices = [
          ...choices,
          new inquirer.Separator(),
          { name: 'Enter destination manually...', value: manualEntryValue }
      ];

      if (choices.length === 0) {
          logger.warn('No destinations found via xcodebuild.');
          const answer = await inquirer.prompt([{
              type: 'rawlist',
              name: 'destination',
              message: 'No simulators detected. Select an action:',
              choices: [{ name: 'Use Default (iPhone 17 Pro)', value: 'platform=iOS Simulator,name=iPhone 17 Pro' }, { name: 'Enter destination manually...', value: manualEntryValue }],
          }]);
          selectedDestination = answer.destination;
      } else {
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
  
  const testSpin = spinner(`Running tests on ${selectedDestination}...`).start();

  try {
     const subprocess = execa('xcodebuild', [
        'test',
        ...baseArgs,
        '-scheme', scheme,
        '-destination', selectedDestination!,
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
              if (text.includes('Compiling')) testSpin.text = 'Compiling...';
              else if (text.includes('Linking')) testSpin.text = 'Linking...';
              else if (text.includes('Testing')) testSpin.text = 'Testing...';
              else if (text.includes('Signing')) testSpin.text = 'Signing...';
              else if (text.includes('Building')) testSpin.text = 'Building...';
          });
      }
      
      await subprocess;
      testSpin.succeed('Tests completed successfully.');
     
  } catch (error: any) {
    testSpin.fail('Tests failed.');
    
    // If it fails, users need to see why.
    // Since we suppressed stdio, we should print the captured output on error.
    if (error.all) {
        console.log(error.all);
    } else {
        if (error.stdout) console.log(error.stdout);
        if (error.stderr) console.error(error.stderr);
    }
    
    throw new Error('xcodebuild failed. See output above for details.');
  }

  return { xcresultPath: `${derivedDataPath}/TestResult.xcresult`, selectedDestination: selectedDestination! };
};

export const getCoverageData = async (xcresultPath: string) => {
  try {
    const { stdout } = await execa('xcrun', ['xccov', 'view', '--report', '--json', xcresultPath]);
    return JSON.parse(stdout);
  } catch (error) {
    logger.error('Failed to parse coverage data from xcresult.');
    throw error;
  }
};
