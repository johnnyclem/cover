"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameworkRegistry = void 0;
exports.createFramework = createFramework;
exports.getAvailableFrameworks = getAvailableFrameworks;
exports.getUnitFrameworks = getUnitFrameworks;
exports.getE2EFrameworks = getE2EFrameworks;
exports.detectFramework = detectFramework;
const mocha_js_1 = require("./mocha.js");
const jest_js_1 = require("./jest.js");
const vitest_js_1 = require("./vitest.js");
const cypress_js_1 = require("./cypress.js");
const playwright_js_1 = require("./playwright.js");
class FrameworkRegistry {
    static frameworks = new Map();
    static {
        // Register all available frameworks
        this.frameworks.set('mocha', () => new mocha_js_1.MochaFramework());
        this.frameworks.set('jest', () => new jest_js_1.JestFramework());
        this.frameworks.set('vitest', () => new vitest_js_1.VitestFramework());
        this.frameworks.set('cypress', () => new cypress_js_1.CypressFramework());
        this.frameworks.set('playwright', () => new playwright_js_1.PlaywrightFramework());
    }
    static getFramework(name) {
        const factory = this.frameworks.get(name.toLowerCase());
        return factory ? factory() : null;
    }
    static getAvailableFrameworks() {
        return Array.from(this.frameworks.keys());
    }
    static getFrameworksByType(type) {
        const frameworks = [];
        for (const [name, factory] of this.frameworks) {
            const framework = factory();
            if (framework.getConfig().type === type) {
                frameworks.push(name);
            }
        }
        return frameworks;
    }
    static registerFramework(name, factory) {
        this.frameworks.set(name.toLowerCase(), factory);
    }
}
exports.FrameworkRegistry = FrameworkRegistry;
function createFramework(name) {
    const framework = FrameworkRegistry.getFramework(name);
    if (!framework) {
        throw new Error(`Unknown testing framework: ${name}. Available frameworks: ${FrameworkRegistry.getAvailableFrameworks().join(', ')}`);
    }
    return framework;
}
function getAvailableFrameworks() {
    return FrameworkRegistry.getAvailableFrameworks();
}
function getUnitFrameworks() {
    return FrameworkRegistry.getFrameworksByType('unit');
}
function getE2EFrameworks() {
    return FrameworkRegistry.getFrameworksByType('e2e');
}
async function detectFramework() {
    const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
    try {
        // Check package.json dependencies
        const packageJson = await fs.readFile('package.json', 'utf-8');
        const pkg = JSON.parse(packageJson);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        // Check for framework dependencies
        for (const frameworkName of FrameworkRegistry.getAvailableFrameworks()) {
            if (deps[frameworkName] || deps[`@${frameworkName}/core`]) {
                return frameworkName;
            }
        }
        // Check for configuration files
        const configFiles = {
            jest: ['jest.config.js', 'jest.config.json', 'jest.config.ts', 'jest.config.mjs'],
            vitest: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs', 'vite.config.js'],
            mocha: ['test/mocha.opts', '.mocharc.json', '.mocharc.js', 'mocha.config.js'],
            cypress: ['cypress.config.js', 'cypress.config.ts', 'cypress.config.mjs', 'cypress.json'],
            playwright: ['playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs']
        };
        for (const [framework, files] of Object.entries(configFiles)) {
            for (const file of files) {
                try {
                    await fs.access(file);
                    return framework;
                }
                catch {
                    // File doesn't exist
                }
            }
        }
        // Check for test file patterns
        const testPatterns = {
            jest: [/\.test\.(js|ts|jsx|tsx)$/, /\.spec\.(js|ts|jsx|tsx)$/],
            vitest: [/\.test\.(js|ts|jsx|tsx)$/, /\.spec\.(js|ts|jsx|tsx)$/],
            mocha: [/\.test\.(js|ts)$/, /\.spec\.(js|ts)$/],
            cypress: [/\.cy\.(js|ts|jsx|tsx)$/],
            playwright: [/\.spec\.(js|ts)$/, /\.test\.(js|ts)$/]
        };
        // Look for test files in common directories
        const testDirs = ['test', 'tests', '__tests__', 'e2e', 'cypress/e2e', 'cypress/integration'];
        for (const testDir of testDirs) {
            try {
                const { glob } = await Promise.resolve().then(() => __importStar(require('glob')));
                const pattern = `${testDir}/**/*.{js,ts,jsx,tsx}`;
                const testFiles = await glob(pattern);
                for (const [framework, patterns] of Object.entries(testPatterns)) {
                    for (const pattern of patterns) {
                        if (testFiles.some(file => pattern.test(file))) {
                            return framework;
                        }
                    }
                }
            }
            catch {
                // Directory doesn't exist
            }
        }
    }
    catch (error) {
        // package.json doesn't exist or is invalid
    }
    return null;
}
