"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.printCoverageTable = exports.spinner = exports.logger = void 0;
exports.printXcsiftSummary = printXcsiftSummary;
exports.printErrors = printErrors;
exports.printWarnings = printWarnings;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const cli_table3_1 = __importDefault(require("cli-table3"));
exports.logger = {
    info: (msg) => console.log(chalk_1.default.blue(msg)),
    success: (msg) => console.log(chalk_1.default.green(msg)),
    warn: (msg) => console.log(chalk_1.default.yellow(msg)),
    error: (msg) => console.log(chalk_1.default.red(msg)),
    step: (msg) => console.log(chalk_1.default.cyan(`\n➤ ${msg}`)),
};
const spinner = (text) => {
    return (0, ora_1.default)(text);
};
exports.spinner = spinner;
const printCoverageTable = (files) => {
    const table = new cli_table3_1.default({
        head: ['File', 'Line Coverage', 'Func Coverage', 'Status'],
        style: { head: ['cyan'] },
    });
    files.forEach((file) => {
        const isPassing = file.lineCoverage >= 80; // Default threshold, configurable later
        table.push([
            file.path,
            `${file.lineCoverage.toFixed(2)}%`,
            `${file.functionCoverage.toFixed(2)}%`,
            isPassing ? chalk_1.default.green('PASS') : chalk_1.default.red('FAIL'),
        ]);
    });
    console.log(table.toString());
};
exports.printCoverageTable = printCoverageTable;
function printXcsiftSummary(result) {
    const { summary } = result;
    console.log('\nBuild Summary:');
    console.log(`  Status: ${result.status === 'success' ? chalk_1.default.green('SUCCESS') : chalk_1.default.red('FAILED')}`);
    console.log(`  Errors: ${summary.errors}`);
    console.log(`  Warnings: ${summary.warnings}`);
    if (summary.passed_tests !== undefined) {
        console.log(`  Tests: ${summary.passed_tests} passed, ${summary.failed_tests} failed`);
    }
    if (summary.test_time) {
        console.log(`  Test Time: ${summary.test_time}`);
    }
}
function printErrors(errors) {
    // Group errors by file
    const byFile = {};
    for (const error of errors) {
        if (!byFile[error.file])
            byFile[error.file] = [];
        byFile[error.file].push(error);
    }
    for (const [file, fileErrors] of Object.entries(byFile)) {
        console.log(chalk_1.default.red(`\n${file}:`));
        for (const error of fileErrors) {
            console.log(`  ${chalk_1.default.gray(`Line ${error.line}:`)} ${error.message}`);
        }
    }
}
function printWarnings(warnings) {
    // Group warnings by file
    const byFile = {};
    for (const warning of warnings) {
        if (!byFile[warning.file])
            byFile[warning.file] = [];
        byFile[warning.file].push(warning);
    }
    for (const [file, fileWarnings] of Object.entries(byFile)) {
        console.log(chalk_1.default.yellow(`\n${file}:`));
        for (const warning of fileWarnings) {
            console.log(`  ${chalk_1.default.gray(`Line ${warning.line}:`)} ${warning.message}`);
        }
    }
}
