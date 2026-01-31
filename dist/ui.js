import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
export const logger = {
    info: (msg) => console.log(chalk.blue(msg)),
    success: (msg) => console.log(chalk.green(msg)),
    warn: (msg) => console.log(chalk.yellow(msg)),
    error: (msg) => console.log(chalk.red(msg)),
    step: (msg) => console.log(chalk.cyan(`\n➤ ${msg}`)),
};
export const spinner = (text) => {
    return ora(text);
};
export const printCoverageTable = (files) => {
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
export function printXcsiftSummary(result) {
    const { summary } = result;
    console.log('\nBuild Summary:');
    console.log(`  Status: ${result.status === 'success' ? chalk.green('SUCCESS') : chalk.red('FAILED')}`);
    console.log(`  Errors: ${summary.errors}`);
    console.log(`  Warnings: ${summary.warnings}`);
    if (summary.passed_tests !== undefined) {
        console.log(`  Tests: ${summary.passed_tests} passed, ${summary.failed_tests} failed`);
    }
    if (summary.test_time) {
        console.log(`  Test Time: ${summary.test_time}`);
    }
}
export function printErrors(errors) {
    // Group errors by file
    const byFile = {};
    for (const error of errors) {
        if (!byFile[error.file])
            byFile[error.file] = [];
        byFile[error.file].push(error);
    }
    for (const [file, fileErrors] of Object.entries(byFile)) {
        console.log(chalk.red(`\n${file}:`));
        for (const error of fileErrors) {
            console.log(`  ${chalk.gray(`Line ${error.line}:`)} ${error.message}`);
        }
    }
}
export function printWarnings(warnings) {
    // Group warnings by file
    const byFile = {};
    for (const warning of warnings) {
        if (!byFile[warning.file])
            byFile[warning.file] = [];
        byFile[warning.file].push(warning);
    }
    for (const [file, fileWarnings] of Object.entries(byFile)) {
        console.log(chalk.yellow(`\n${file}:`));
        for (const warning of fileWarnings) {
            console.log(`  ${chalk.gray(`Line ${warning.line}:`)} ${warning.message}`);
        }
    }
}
