"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandHunksToLines = exports.getChangedSwiftLines = exports.getChangedLinesPerFile = exports.validateBranchExists = exports.getHeadCommit = exports.getCurrentBranch = exports.getChangedFiles = void 0;
const execa_1 = require("execa");
const ui_1 = require("./ui");
/**
 * Get list of changed file names between base branch and HEAD.
 * Filters to only Swift/ObjC source files.
 */
const getChangedFiles = async (baseBranch = 'main') => {
    try {
        // Calculate merge base to compare working tree against common ancestor
        const { stdout: mergeBase } = await (0, execa_1.execa)('git', ['merge-base', baseBranch, 'HEAD']);
        const { stdout } = await (0, execa_1.execa)('git', ['diff', '--name-only', mergeBase.trim()]);
        const files = stdout.split('\n').filter(Boolean);
        return files.filter(f => f.endsWith('.swift') || f.endsWith('.m') || f.endsWith('.mm'));
    }
    catch (error) {
        ui_1.logger.error(`Failed to get git diff against ${baseBranch}. Ensure you have fetched remote branches.`);
        throw error;
    }
};
exports.getChangedFiles = getChangedFiles;
/**
 * Get the current branch name.
 */
const getCurrentBranch = async () => {
    const { stdout } = await (0, execa_1.execa)('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim();
};
exports.getCurrentBranch = getCurrentBranch;
/**
 * Get the current HEAD commit SHA (short form).
 */
const getHeadCommit = async () => {
    const { stdout } = await (0, execa_1.execa)('git', ['rev-parse', '--short', 'HEAD']);
    return stdout.trim();
};
exports.getHeadCommit = getHeadCommit;
/**
 * Validate that a branch exists (locally or as a remote tracking branch).
 */
const validateBranchExists = async (branch) => {
    try {
        // Check local branch
        await (0, execa_1.execa)('git', ['rev-parse', '--verify', branch]);
        return true;
    }
    catch {
        try {
            // Check remote branch (origin/branch)
            await (0, execa_1.execa)('git', ['rev-parse', '--verify', `origin/${branch}`]);
            return true;
        }
        catch {
            return false;
        }
    }
};
exports.validateBranchExists = validateBranchExists;
/**
 * Parse a unified diff hunk header: @@ -X,Y +A,B @@
 * Returns the new (added) line range.
 *
 * Examples:
 *   @@ -10,5 +10,7 @@  -> { startLine: 10, lineCount: 7 }
 *   @@ -10 +10,3 @@    -> { startLine: 10, lineCount: 3 }
 *   @@ -10 +10 @@      -> { startLine: 10, lineCount: 1 }
 *   @@ -0,0 +1,5 @@    -> { startLine: 1, lineCount: 5 } (new file)
 */
const parseHunkHeader = (line) => {
    // Match pattern: @@ -oldStart[,oldCount] +newStart[,newCount] @@
    const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!match) {
        return null;
    }
    const newStart = parseInt(match[3], 10);
    const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;
    // If newCount is 0, this is a pure deletion hunk - no lines to cover
    if (newCount === 0) {
        return null;
    }
    return {
        startLine: newStart,
        lineCount: newCount,
    };
};
/**
 * Get line-level diff between base branch and HEAD.
 * Uses triple-dot syntax to include all commits in the branch.
 * Uses --unified=0 to get exact line ranges without context.
 *
 * Only captures additions (not deletions) since we only care about
 * new/modified lines that need coverage.
 */
const getChangedLinesPerFile = async (baseBranch = 'main', fileFilter) => {
    try {
        // Calculate merge base to compare working tree against common ancestor
        const { stdout: mergeBase } = await (0, execa_1.execa)('git', ['merge-base', baseBranch, 'HEAD']);
        // --unified=0 gives us exact line numbers without context lines
        const { stdout } = await (0, execa_1.execa)('git', [
            'diff',
            '--unified=0',
            mergeBase.trim()
        ]);
        const files = [];
        let currentFile = null;
        let totalAddedLines = 0;
        const lines = stdout.split('\n');
        for (const line of lines) {
            // New file header: diff --git a/path/to/file b/path/to/file
            if (line.startsWith('diff --git ')) {
                // Save previous file if it has hunks
                if (currentFile && currentFile.addedLines.length > 0) {
                    // Apply filter if provided
                    if (!fileFilter || fileFilter(currentFile.path)) {
                        files.push(currentFile);
                    }
                }
                // Extract file path from "diff --git a/path b/path"
                const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
                if (match) {
                    currentFile = {
                        path: match[1],
                        addedLines: [],
                    };
                }
                else {
                    currentFile = null;
                }
                continue;
            }
            // Hunk header: @@ -X,Y +A,B @@
            if (line.startsWith('@@') && currentFile) {
                const hunk = parseHunkHeader(line);
                if (hunk) {
                    currentFile.addedLines.push(hunk);
                    totalAddedLines += hunk.lineCount;
                }
            }
        }
        // Don't forget the last file
        if (currentFile && currentFile.addedLines.length > 0) {
            if (!fileFilter || fileFilter(currentFile.path)) {
                files.push(currentFile);
            }
        }
        return {
            files,
            totalAddedLines,
        };
    }
    catch (error) {
        ui_1.logger.error(`Failed to get line-level diff against ${baseBranch}. Ensure you have fetched remote branches.`);
        throw error;
    }
};
exports.getChangedLinesPerFile = getChangedLinesPerFile;
/**
 * Get changed lines for Swift/ObjC files only.
 * Convenience wrapper around getChangedLinesPerFile.
 */
const getChangedSwiftLines = async (baseBranch = 'main') => {
    return (0, exports.getChangedLinesPerFile)(baseBranch, (path) => {
        return path.endsWith('.swift') || path.endsWith('.m') || path.endsWith('.mm');
    });
};
exports.getChangedSwiftLines = getChangedSwiftLines;
/**
 * Expand diff hunks to individual line numbers.
 * Useful for intersection with coverage data.
 */
const expandHunksToLines = (hunks) => {
    const lines = [];
    for (const hunk of hunks) {
        for (let i = 0; i < hunk.lineCount; i++) {
            lines.push(hunk.startLine + i);
        }
    }
    return lines;
};
exports.expandHunksToLines = expandHunksToLines;
