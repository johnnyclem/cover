import { execa } from 'execa';
import { glob } from 'glob';
import fs from 'fs';
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

const getDestinations = async (scheme: string, baseArgs: string[]): Promise<string[]> => {
  try {
      const destArgs = [...baseArgs, '-scheme', scheme, '-showdestinations'];
      const { stdout } = await execa('xcodebuild', destArgs);
      
      const lines = stdout.split('\n');
      const choices: string[] = [];
      
      lines.forEach((line: string) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.includes('platform:iOS Simulator')) {
              // Extract name
              const nameMatch = trimmed.match(/name:([^,}]+)/);
              if (nameMatch) {
                  const name = nameMatch[1];
                  choices.push(`platform=iOS Simulator,name=${name}`);
              }
          }
      });
      
      return [...new Set(choices)];
  } catch (error) {
      logger.warn('Failed to fetch destinations.');
      return [];
  }
};

export const runXcodeTests = async (scheme: string, destination: string | undefined, projectPath?: string, workspacePath?: string): Promise<{ xcresultPath: string, selectedDestination: string }> => {
  logger.step(`Preparing tests for scheme: ${scheme}`);
  
  // Create a temporary derived data path to easily locate logs/results
  const derivedDataPath = path.resolve('./derived_data_temp');
  const resultBundlePath = `${derivedDataPath}/TestResult.xcresult`;

  // Clean up previous result bundle to avoid "Existing file" error
  if (fs.existsSync(resultBundlePath)) {
    fs.rmSync(resultBundlePath, { recursive: true, force: true });
  }

  const baseArgs = await detectBaseArgs(projectPath, workspacePath);

  // Destination Handling
  let selectedDestination = destination;

  if (!selectedDestination) {
      const testSpinner = spinner('Checking available destinations...');
      testSpinner.start();
      const choices = await getDestinations(scheme, baseArgs);
      testSpinner.stop();
      
      if (choices.length === 0) {
          selectedDestination = 'platform=iOS Simulator,name=iPhone 15';
          logger.warn('No destinations found via xcodebuild. Defaulting to iPhone 15.');
      } else {
          const answer = await inquirer.prompt([{
              type: 'list',
              name: 'destination',
              message: 'Select a simulator destination:',
              choices: choices,
              default: choices.find(c => c.includes('iPhone 15'))
          }]);
          selectedDestination = answer.destination;
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
