import { MochaFramework } from './mocha.js';
import { JestFramework } from './jest.js';
import { VitestFramework } from './vitest.js';
import { CypressFramework } from './cypress.js';
import { PlaywrightFramework } from './playwright.js';
export class FrameworkRegistry {
    static frameworks = new Map();
    static {
        // Register all available frameworks
        this.frameworks.set('mocha', () => new MochaFramework());
        this.frameworks.set('jest', () => new JestFramework());
        this.frameworks.set('vitest', () => new VitestFramework());
        this.frameworks.set('cypress', () => new CypressFramework());
        this.frameworks.set('playwright', () => new PlaywrightFramework());
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
export function createFramework(name) {
    const framework = FrameworkRegistry.getFramework(name);
    if (!framework) {
        throw new Error(`Unknown testing framework: ${name}. Available frameworks: ${FrameworkRegistry.getAvailableFrameworks().join(', ')}`);
    }
    return framework;
}
export function getAvailableFrameworks() {
    return FrameworkRegistry.getAvailableFrameworks();
}
export function getUnitFrameworks() {
    return FrameworkRegistry.getFrameworksByType('unit');
}
export function getE2EFrameworks() {
    return FrameworkRegistry.getFrameworksByType('e2e');
}
export async function detectFramework() {
    const fs = await import('fs/promises');
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
                const { glob } = await import('glob');
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
