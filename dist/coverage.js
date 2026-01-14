"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCoverage = void 0;
const processCoverage = (coverageJson, changedFiles) => {
    const results = [];
    // Flatten all files from all targets
    const allCoveredFiles = [];
    if (coverageJson.targets) {
        for (const target of coverageJson.targets) {
            if (target.files) {
                allCoveredFiles.push(...target.files);
            }
        }
    }
    // Normalize changed files to absolute paths or match by filename suffix
    // Git returns relative paths (e.g., "Source/MyFile.swift")
    // Xccov returns absolute paths usually.
    for (const changedFile of changedFiles) {
        // We try to find a match in the covered files
        // A strict endsWith check is usually safe enough for unique filenames, 
        // but we should be careful about identical filenames in different modules.
        const match = allCoveredFiles.find((cf) => cf.path.endsWith(changedFile));
        if (match) {
            results.push({
                path: changedFile,
                lineCoverage: (match.lineCoverage || 0) * 100,
                functionCoverage: 0, // xccov default JSON report usually focuses on line coverage, sometimes functions
                uncoveredLines: [], // To be implemented with deeper parsing if needed
                uncoveredFunctions: []
            });
        }
        else {
            // File changed but not found in coverage? 
            // Maybe it's not a source file (e.g. UI test file) or targets were not tested.
            // We'll mark it as 0% coverage or skipped.
            results.push({
                path: changedFile,
                lineCoverage: 0,
                functionCoverage: 0,
                uncoveredLines: [],
                uncoveredFunctions: []
            });
        }
    }
    return results;
};
exports.processCoverage = processCoverage;
