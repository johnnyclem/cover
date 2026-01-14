"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentBranch = exports.getChangedFiles = void 0;
const execa_1 = require("execa");
const ui_1 = require("./ui");
const getChangedFiles = async (baseBranch = 'main') => {
    try {
        const { stdout } = await (0, execa_1.execa)('git', ['diff', '--name-only', `${baseBranch}...HEAD`]);
        const files = stdout.split('\n').filter(Boolean);
        return files.filter(f => f.endsWith('.swift') || f.endsWith('.m') || f.endsWith('.mm'));
    }
    catch (error) {
        ui_1.logger.error(`Failed to get git diff against ${baseBranch}. Ensure you have fetched remote branches.`);
        throw error;
    }
};
exports.getChangedFiles = getChangedFiles;
const getCurrentBranch = async () => {
    const { stdout } = await (0, execa_1.execa)('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim();
};
exports.getCurrentBranch = getCurrentBranch;
