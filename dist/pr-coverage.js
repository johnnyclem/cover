import { expandHunksToLines } from './git.js';
import path from 'path';
/**
 * Calculate PR coverage by intersecting diff lines with coverage data.
 *
 * This is the core algorithm for PR-specific coverage analysis:
 * 1. For each file in the diff, expand hunks to individual line numbers
 * 2. Find matching coverage data (with path normalization)
 * 3. Intersect: determine which changed lines are covered/uncovered
 * 4. Calculate coverage percentages based only on executable lines
 *
 * Non-executable lines (comments, blank lines) are counted as "covered"
 * by default, so they don't negatively impact the coverage percentage.
 */
export async function calculatePRCoverage(diffResult, coverageData, options = {}) {
    const { verbose = false, treatNonExecutableAsCovered = true } = options;
    const files = [];
    let totalNew = 0;
    let totalCovered = 0;
    let totalUncovered = 0;
    for (const fileDiff of diffResult.files) {
        // 1. Expand hunks to individual line numbers
        const changedLines = expandHunksToLines(fileDiff.addedLines);
        if (verbose) {
            console.log(`Processing ${fileDiff.path}: ${changedLines.length} changed lines`);
        }
        // 2. Find matching coverage data (with path normalization)
        const coverage = findCoverageForFile(fileDiff.path, coverageData, verbose);
        if (!coverage) {
            // File not in coverage data at all
            // This could mean:
            // - It's a new file that wasn't compiled
            // - It's in a target that wasn't tested
            // - Path matching failed
            if (verbose) {
                console.log(`  No coverage data found for ${fileDiff.path}`);
            }
            // All lines are uncovered
            files.push({
                path: fileDiff.path,
                newUpdatedLines: changedLines.length,
                coveredLines: 0,
                uncoveredLineNumbers: changedLines,
                coveragePercent: 0,
            });
            totalNew += changedLines.length;
            totalUncovered += changedLines.length;
            continue;
        }
        // 3. Intersect: classify each changed line
        const coveredLineNumbers = [];
        const uncoveredLineNumbers = [];
        let executableCount = 0;
        for (const lineNum of changedLines) {
            const isExecutable = coverage.executableLines.has(lineNum);
            const isCovered = coverage.coveredLines.has(lineNum);
            const isUncovered = coverage.uncoveredLines.has(lineNum);
            if (isCovered) {
                // Line is covered
                coveredLineNumbers.push(lineNum);
                executableCount++;
            }
            else if (isUncovered) {
                // Line is explicitly uncovered (executable but not hit)
                uncoveredLineNumbers.push(lineNum);
                executableCount++;
            }
            else if (!isExecutable && treatNonExecutableAsCovered) {
                // Non-executable line (comment, blank, etc.) - count as covered
                coveredLineNumbers.push(lineNum);
                // Don't increment executableCount - this doesn't affect the percentage
            }
            else {
                // Non-executable line and not treating as covered
                // Or line not in coverage data at all
                // Default: count as uncovered to be safe
                uncoveredLineNumbers.push(lineNum);
            }
        }
        // 4. Calculate coverage percentage
        // Only count executable lines toward the percentage
        const totalExecutable = coveredLineNumbers.length + uncoveredLineNumbers.length;
        const coveragePercent = totalExecutable > 0
            ? (coveredLineNumbers.length / totalExecutable) * 100
            : 100; // No executable lines = 100% (nothing to cover)
        if (verbose) {
            console.log(`  Covered: ${coveredLineNumbers.length}, Uncovered: ${uncoveredLineNumbers.length}, Coverage: ${coveragePercent.toFixed(1)}%`);
        }
        files.push({
            path: fileDiff.path,
            newUpdatedLines: totalExecutable,
            coveredLines: coveredLineNumbers.length,
            uncoveredLineNumbers: uncoveredLineNumbers.sort((a, b) => a - b),
            coveragePercent,
        });
        totalNew += totalExecutable;
        totalCovered += coveredLineNumbers.length;
        totalUncovered += uncoveredLineNumbers.length;
    }
    // Sort files alphabetically for deterministic output
    files.sort((a, b) => a.path.localeCompare(b.path));
    // Calculate overall summary
    const overallCoverage = totalNew > 0
        ? (totalCovered / totalNew) * 100
        : 100;
    return {
        files,
        summary: {
            totalNewUpdatedLines: totalNew,
            totalCoveredLines: totalCovered,
            totalUncoveredLines: totalUncovered,
            lineCoveragePercent: overallCoverage,
        },
        metadata: {
            baseBranch: '', // Filled in by caller
            headCommit: '', // Filled in by caller
            coverageFormat: 'xccov', // Filled in by caller
            generatedAt: new Date().toISOString(),
            fast: false, // Filled in by caller
        },
    };
}
/**
 * Find coverage data for a file, handling path normalization.
 *
 * Coverage data often uses absolute paths while git diff uses relative paths.
 * This function tries multiple matching strategies:
 * 1. Exact match
 * 2. Normalized path match
 * 3. Filename + parent directory match
 * 4. Filename-only match (with warning)
 */
function findCoverageForFile(diffPath, coverageData, verbose) {
    // 1. Try exact match first
    if (coverageData.has(diffPath)) {
        if (verbose) {
            console.log(`  Exact match found for ${diffPath}`);
        }
        return coverageData.get(diffPath);
    }
    const diffFilename = path.basename(diffPath);
    const diffParent = path.basename(path.dirname(diffPath));
    const normalizedDiff = normalizePath(diffPath);
    let bestMatch = null;
    let bestScore = 0;
    for (const [coveragePath, coverage] of coverageData) {
        // 2. Try normalized path match (endsWith)
        const normalizedCoverage = normalizePath(coveragePath);
        if (normalizedCoverage.endsWith(normalizedDiff) || normalizedDiff.endsWith(normalizedCoverage)) {
            if (verbose) {
                console.log(`  Normalized match: ${diffPath} -> ${coveragePath}`);
            }
            return coverage;
        }
        // 3. Score by filename + parent match
        const coverageFilename = path.basename(coveragePath);
        const coverageParent = path.basename(path.dirname(coveragePath));
        if (coverageFilename === diffFilename) {
            let score = 1;
            if (coverageParent === diffParent) {
                score = 2; // Higher score for parent directory match too
            }
            if (score > bestScore) {
                bestScore = score;
                bestMatch = coverage;
                if (verbose) {
                    console.log(`  Potential match (score ${score}): ${diffPath} -> ${coveragePath}`);
                }
            }
        }
    }
    if (bestMatch && bestScore >= 2) {
        // Good match (filename + parent match)
        return bestMatch;
    }
    if (bestMatch && bestScore === 1 && verbose) {
        // Filename-only match - less confident
        console.log(`  Warning: Using filename-only match for ${diffPath}`);
        return bestMatch;
    }
    return bestMatch;
}
/**
 * Normalize a path for comparison.
 */
function normalizePath(filePath) {
    return filePath
        .replace(/\\/g, '/') // Normalize separators
        .replace(/^\/Users\/[^/]+\//, '') // Remove /Users/username/
        .replace(/^\/private\//, '') // Remove /private/ prefix
        .replace(/^~\//, '') // Remove ~/
        .toLowerCase(); // Case insensitive
}
/**
 * Check if a file should be excluded from PR coverage analysis.
 * (Test files, generated files, etc.)
 */
export function shouldExcludeFromPRCoverage(filePath) {
    const excludePatterns = [
        /\.generated\./i,
        /\.pb\.swift$/i, // Protocol buffer generated files
        /Mock.*\.swift$/i, // Mock files (often in test targets)
        /Stub.*\.swift$/i, // Stub files
        /Fake.*\.swift$/i, // Fake files
    ];
    return excludePatterns.some(pattern => pattern.test(filePath));
}
