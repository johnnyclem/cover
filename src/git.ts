import { execa } from 'execa';
import { logger } from './ui';
import { DiffHunk, FileDiff, PRDiffResult } from './types';

/**
 * Get list of changed file names between base branch and HEAD.
 * Filters to only Swift/ObjC source files.
 */
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

/**
 * Get the current branch name.
 */
export const getCurrentBranch = async (): Promise<string> => {
  const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
};

/**
 * Get the current HEAD commit SHA (short form).
 */
export const getHeadCommit = async (): Promise<string> => {
  const { stdout } = await execa('git', ['rev-parse', '--short', 'HEAD']);
  return stdout.trim();
};

/**
 * Validate that a branch exists (locally or as a remote tracking branch).
 */
export const validateBranchExists = async (branch: string): Promise<boolean> => {
  try {
    // Check local branch
    await execa('git', ['rev-parse', '--verify', branch]);
    return true;
  } catch {
    try {
      // Check remote branch (origin/branch)
      await execa('git', ['rev-parse', '--verify', `origin/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }
};

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
const parseHunkHeader = (line: string): DiffHunk | null => {
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
export const getChangedLinesPerFile = async (
  baseBranch: string = 'main',
  fileFilter?: (path: string) => boolean
): Promise<PRDiffResult> => {
  try {
    // Use triple-dot syntax to get all changes from the merge-base
    // --unified=0 gives us exact line numbers without context lines
    const { stdout } = await execa('git', [
      'diff',
      '--unified=0',
      `${baseBranch}...HEAD`
    ]);

    const files: FileDiff[] = [];
    let currentFile: FileDiff | null = null;
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
        } else {
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
  } catch (error) {
    logger.error(`Failed to get line-level diff against ${baseBranch}. Ensure you have fetched remote branches.`);
    throw error;
  }
};

/**
 * Get changed lines for Swift/ObjC files only.
 * Convenience wrapper around getChangedLinesPerFile.
 */
export const getChangedSwiftLines = async (baseBranch: string = 'main'): Promise<PRDiffResult> => {
  return getChangedLinesPerFile(baseBranch, (path) => {
    return path.endsWith('.swift') || path.endsWith('.m') || path.endsWith('.mm');
  });
};

/**
 * Expand diff hunks to individual line numbers.
 * Useful for intersection with coverage data.
 */
export const expandHunksToLines = (hunks: DiffHunk[]): number[] => {
  const lines: number[] = [];
  for (const hunk of hunks) {
    for (let i = 0; i < hunk.lineCount; i++) {
      lines.push(hunk.startLine + i);
    }
  }
  return lines;
};
