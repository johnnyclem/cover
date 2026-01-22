"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPRCoverageReport = formatPRCoverageReport;
exports.printPRCoverageReport = printPRCoverageReport;
exports.formatPRCoverageSummaryLine = formatPRCoverageSummaryLine;
const chalk_1 = __importDefault(require("chalk"));
const cli_table3_1 = __importDefault(require("cli-table3"));
/**
 * Format PR coverage result for display.
 *
 * @param result - The PR coverage result to format
 * @param options - Formatting options
 * @returns Formatted string ready for console output
 */
function formatPRCoverageReport(result, options = {}) {
    const { strict = false } = options;
    if (strict) {
        return formatStrictReport(result, options);
    }
    return formatStyledReport(result, options);
}
/**
 * Format in strict spec-compliant format.
 * - Plain text only
 * - No emojis
 * - No colors
 * - Deterministic ordering
 */
function formatStrictReport(result, options) {
    const lines = [];
    const { maxUncoveredLines = 50 } = options;
    // File-by-file report
    for (const file of result.files) {
        lines.push(`File: ${file.path}`);
        lines.push(`New/Updated Lines: ${file.newUpdatedLines}`);
        lines.push(`Covered Lines: ${file.coveredLines}`);
        lines.push(`Uncovered Lines:`);
        if (file.uncoveredLineNumbers.length === 0) {
            lines.push(`  (none)`);
        }
        else {
            const linesToShow = file.uncoveredLineNumbers.slice(0, maxUncoveredLines);
            for (const lineNum of linesToShow) {
                lines.push(`  - ${lineNum}`);
            }
            if (file.uncoveredLineNumbers.length > maxUncoveredLines) {
                lines.push(`  ... and ${file.uncoveredLineNumbers.length - maxUncoveredLines} more`);
            }
        }
        lines.push(`Coverage: ${file.coveragePercent.toFixed(1)}%`);
        lines.push('');
    }
    // Summary
    lines.push('=== PR Coverage Summary ===');
    lines.push(`Total New/Updated Lines: ${result.summary.totalNewUpdatedLines}`);
    lines.push(`Total Uncovered Lines: ${result.summary.totalUncoveredLines}`);
    lines.push(`Line Coverage: ${result.summary.lineCoveragePercent.toFixed(1)}%`);
    return lines.join('\n');
}
/**
 * Format with colors, tables, and styled output.
 */
function formatStyledReport(result, options) {
    const { threshold = 80, maxUncoveredLines = 10 } = options;
    const output = [];
    // Header
    output.push('');
    output.push(chalk_1.default.cyan.bold('=== PR Line Coverage Report ==='));
    output.push(chalk_1.default.gray(`Base: ${result.metadata.baseBranch} | Head: ${result.metadata.headCommit} | Format: ${result.metadata.coverageFormat}`));
    output.push('');
    // Summary first
    const summaryPassing = result.summary.lineCoveragePercent >= threshold;
    const summaryColor = summaryPassing ? chalk_1.default.green : chalk_1.default.red;
    const summaryIcon = summaryPassing ? chalk_1.default.green('PASS') : chalk_1.default.red('FAIL');
    output.push(chalk_1.default.bold('Summary:'));
    output.push(`  New/Updated Lines: ${result.summary.totalNewUpdatedLines}`);
    output.push(`  Covered Lines:     ${result.summary.totalCoveredLines}`);
    output.push(`  Uncovered Lines:   ${result.summary.totalUncoveredLines}`);
    output.push(`  Coverage:          ${summaryColor.bold(result.summary.lineCoveragePercent.toFixed(1) + '%')} ${summaryIcon}`);
    output.push('');
    // File table
    if (result.files.length > 0) {
        const table = new cli_table3_1.default({
            head: [
                chalk_1.default.cyan('File'),
                chalk_1.default.cyan('New Lines'),
                chalk_1.default.cyan('Covered'),
                chalk_1.default.cyan('Uncovered'),
                chalk_1.default.cyan('Coverage'),
                chalk_1.default.cyan('Status'),
            ],
            style: { head: [] }, // Don't double-colorize
            colWidths: [50, 12, 10, 12, 12, 8],
            wordWrap: true,
        });
        for (const file of result.files) {
            const isPassing = file.coveragePercent >= threshold;
            const statusColor = isPassing ? chalk_1.default.green : chalk_1.default.red;
            const coverageStr = file.coveragePercent.toFixed(1) + '%';
            // Truncate uncovered lines for display
            let uncoveredStr;
            if (file.uncoveredLineNumbers.length === 0) {
                uncoveredStr = '-';
            }
            else if (file.uncoveredLineNumbers.length <= 3) {
                uncoveredStr = file.uncoveredLineNumbers.join(', ');
            }
            else {
                uncoveredStr = file.uncoveredLineNumbers.slice(0, 3).join(', ') + '...';
            }
            // Shorten path for display
            const shortPath = shortenPath(file.path, 48);
            table.push([
                shortPath,
                file.newUpdatedLines.toString(),
                file.coveredLines.toString(),
                uncoveredStr,
                statusColor(coverageStr),
                isPassing ? chalk_1.default.green('PASS') : chalk_1.default.red('FAIL'),
            ]);
        }
        output.push(table.toString());
        output.push('');
    }
    // Detailed uncovered lines for failing files
    const failingFiles = result.files.filter(f => f.coveragePercent < threshold && f.uncoveredLineNumbers.length > 0);
    if (failingFiles.length > 0) {
        output.push(chalk_1.default.yellow.bold('Uncovered Lines (Failing Files):'));
        output.push('');
        for (const file of failingFiles) {
            output.push(chalk_1.default.yellow(`  ${file.path}:`));
            const linesToShow = file.uncoveredLineNumbers.slice(0, maxUncoveredLines);
            output.push(chalk_1.default.gray(`    Lines: ${linesToShow.join(', ')}${file.uncoveredLineNumbers.length > maxUncoveredLines ? ` ... (+${file.uncoveredLineNumbers.length - maxUncoveredLines} more)` : ''}`));
        }
        output.push('');
    }
    return output.join('\n');
}
/**
 * Shorten a file path for display.
 */
function shortenPath(filePath, maxLength) {
    if (filePath.length <= maxLength) {
        return filePath;
    }
    const parts = filePath.split('/');
    // Try to show filename and some parent context
    const filename = parts[parts.length - 1];
    if (filename.length >= maxLength - 3) {
        return '...' + filename.slice(-(maxLength - 3));
    }
    const remaining = maxLength - filename.length - 4; // 4 for ".../"
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
        if (prefix.length + parts[i].length + 1 <= remaining) {
            prefix += (prefix ? '/' : '') + parts[i];
        }
        else {
            break;
        }
    }
    if (prefix) {
        return prefix + '/.../' + filename;
    }
    return '.../' + filename;
}
/**
 * Print PR coverage table directly to console.
 * Convenience wrapper for quick output.
 */
function printPRCoverageReport(result, options = {}) {
    console.log(formatPRCoverageReport(result, options));
}
/**
 * Format a simple one-line summary.
 */
function formatPRCoverageSummaryLine(result) {
    const { summary } = result;
    return `PR Coverage: ${summary.lineCoveragePercent.toFixed(1)}% (${summary.totalCoveredLines}/${summary.totalNewUpdatedLines} new lines covered)`;
}
