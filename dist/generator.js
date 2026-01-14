"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateStubs = exports.scanProject = void 0;
const glob_1 = require("glob");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const llm_1 = require("./llm");
const scanProject = async () => {
    // Basic heuristic: look for .swift files for now, since we are heavily iOS focused in previous context.
    // TODO: Make this generic based on framework.
    const sourceFiles = await (0, glob_1.glob)('**/*.swift', { ignore: ['**/node_modules/**', '**/*.test.swift', '**/*Tests.swift'] });
    const plan = [];
    for (const source of sourceFiles) {
        // Simple convention: MyFile.swift -> MyFileTests.swift
        const dir = path_1.default.dirname(source);
        const name = path_1.default.basename(source, '.swift');
        const testName = `${name}Tests.swift`;
        // Try to find if test exists anywhere or assume parallel structure?
        // For simplicity, assume same dir or a 'Tests' dir. 
        // Let's assume standard 'Tests' target location is hard to guess without project analysis.
        // We'll put them in a 'Tests' folder at the root for now if we can't find them, 
        // or alongside if that's the pattern.
        // Let's search for the test file
        const existingTests = await (0, glob_1.glob)(`**/${testName}`);
        let testPath = '';
        let exists = false;
        if (existingTests.length > 0) {
            testPath = existingTests[0];
            exists = true;
        }
        else {
            // Propose a new location. 
            // If there's a Tests directory, put it there mirroring structure?
            // Or just side-by-side?
            // Let's default to side-by-side for simplicity in this prototype, 
            // or create a Tests/ directory.
            testPath = path_1.default.join(dir, testName); // Side by side
            exists = false;
        }
        plan.push({
            sourcePath: source,
            testPath,
            exists,
            stubs: []
        });
    }
    return plan;
};
exports.scanProject = scanProject;
const generateStubs = async (plan) => {
    const analyzer = (0, llm_1.getAnalyzerClient)();
    for (const item of plan) {
        const content = fs_1.default.readFileSync(item.sourcePath, 'utf-8');
        const prompt = `
        Analyze the following Swift code. 
        List the names of unit test functions that should be created to cover the public functionality.
        Format the output as a JSON string array. Example: ["testInitialization", "testCalculateTotal"]
        Do not output anything else.

        Code:
        ${content.slice(0, 2000)} 
        `; // truncate for token safety in prototype
        try {
            const response = await analyzer.client.chat.completions.create({
                model: analyzer.model,
                messages: [{ role: 'user', content: prompt }]
            });
            const text = response.choices[0].message.content || '[]';
            // clean up code blocks
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const stubs = JSON.parse(jsonStr);
            if (Array.isArray(stubs)) {
                item.stubs = stubs;
            }
        }
        catch (e) {
            // logger.warn(`Failed to generate stubs for ${item.sourcePath}`);
        }
    }
    return plan;
};
exports.generateStubs = generateStubs;
