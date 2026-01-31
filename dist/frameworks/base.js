export class BaseFramework {
    config;
    constructor(config) {
        this.config = config;
    }
    async executeCommand(command, args) {
        const { execa } = await import('execa');
        try {
            const result = await execa(command, args, { cwd: process.cwd() });
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode || 0
            };
        }
        catch (error) {
            return {
                stdout: error.stdout || '',
                stderr: error.stderr || error.message,
                exitCode: error.exitCode || 1
            };
        }
    }
    getConfig() {
        return this.config;
    }
    isTestFile(filePath) {
        return this.config.filePatterns.test.some(pattern => filePath.includes(pattern) || new RegExp(pattern).test(filePath));
    }
    isSourceFile(filePath) {
        return this.config.filePatterns.source.some(pattern => filePath.includes(pattern) || new RegExp(pattern).test(filePath));
    }
}
