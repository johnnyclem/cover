import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { CoveredFile } from './types';

export const logger = {
  info: (msg: string) => console.log(chalk.blue(msg)),
  success: (msg: string) => console.log(chalk.green(msg)),
  warn: (msg: string) => console.log(chalk.yellow(msg)),
  error: (msg: string) => console.log(chalk.red(msg)),
  step: (msg: string) => console.log(chalk.cyan(`\n➤ ${msg}`)),
};

export const spinner = (text: string) => {
  return ora(text);
};

export const printCoverageTable = (files: CoveredFile[]) => {
  const table = new Table({
    head: ['File', 'Line Coverage', 'Func Coverage', 'Status'],
    style: { head: ['cyan'] },
  });

  files.forEach((file) => {
    const isPassing = file.lineCoverage >= 80; // Default threshold, configurable later
    table.push([
      file.path,
      `${file.lineCoverage.toFixed(2)}%`,
      `${file.functionCoverage.toFixed(2)}%`,
      isPassing ? chalk.green('PASS') : chalk.red('FAIL'),
    ]);
  });

  console.log(table.toString());
};
