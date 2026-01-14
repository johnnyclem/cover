import { execa } from 'execa';
import { logger } from './ui';

export const getChangedFiles = async (baseBranch: string = 'main'): Promise<string[]> => {
  try {
    const { stdout } = await execa('git', ['diff', '--name-only', `${baseBranch}...HEAD`]);
    const files = stdout.split('\n').filter(Boolean);
    return files.filter(f => f.endsWith('.swift') || f.endsWith('.m') || f.endsWith('.mm'));
  } catch (error) {
    logger.error(`Failed to get git diff against ${baseBranch}. Ensure you have fetched remote branches.`);
    throw error;
  }
};

export const getCurrentBranch = async (): Promise<string> => {
  const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
};
