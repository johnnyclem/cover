# Cover

An automated TDD/Coverage CLI utility for iOS/macOS and JavaScript/TypeScript projects.

## Features

- **Multi-Platform Support**: Works with Xcode (Swift/Objective-C) and JavaScript/TypeScript projects.
- **Framework Auto-Detection**: Automatically detects Jest, Vitest, Mocha, Cypress, Playwright, or XCTest.
- **Git Integration**: Automatically detects changed files between your branch and `main`.
- **Focused Coverage Analysis**: Filters coverage reports to focus *only* on the files you modified.
- **PR Line-Level Coverage**: Calculates coverage specifically for new/modified lines in your PR, not just files.
- **Multi-Format Support**: Supports xccov, lcov, JaCoCo, and llvm-cov coverage formats.
- **AI Agent Integration**: Generates tests or fixes failures using AI agents (opencode, claude-code, codex-cli, gemini-cli) or a local/remote LLM.
- **Interactive Loop**: Repeats the process until your coverage threshold (default 80%) is met.

## Installation

```bash
npm install -g .
# or run via npx
npx .
```

## Usage

Run `cover` in the root of your project:

```bash
cover
```

Cover will auto-detect your testing framework and run appropriately.

## Commands

### `cover check` (default)

Check code coverage for changed files.

```bash
cover check [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --scheme <scheme>` | Xcode scheme to test | - |
| `-f, --framework <framework>` | Testing framework (auto-detected if not specified) | - |
| `-b, --branch <branch>` | Base branch to compare against | `main` |
| `-t, --threshold <number>` | Coverage threshold percentage | `80` |
| `-w, --workspace <path>` | Path to .xcworkspace | - |
| `-p, --project <path>` | Path to .xcodeproj | - |
| `-tp, --test-plan <plan>` | Xcode test plan name (optional, auto-discovered with prompt) | - |
| `--no-coverage` | Skip coverage generation | - |
| `--refresh-destinations` | Refresh cached Xcode run destinations | - |
| `-v, --verbose` | Show detailed path matching and debugging information | - |
| `--pr-lines-only` | Also show line-level coverage for PR changes | - |

### `cover fix`

Run tests and autonomously fix failures using AI.

```bash
cover fix [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --scheme <scheme>` | Xcode scheme to test | - |
| `-d, --destination <destination>` | Simulator destination | - |
| `-tp, --test-plan <plan>` | Xcode test plan name (optional, auto-discovered with prompt) | - |
| `-r, --retries <number>` | Max retries for auto-fix | `3` |
| `-f, --framework <framework>` | Testing framework | auto-detected |
| `-t, --test-files <files...>` | Specific test files to run | - |
| `--refresh-destinations` | Refresh cached Xcode run destinations | - |

### `cover init [path]`

Initialize Cover in a project directory. This command:

- Checks for git repository (offers to initialize one)
- Configures your LLM provider (local or OpenAI)
- Auto-detects your testing framework
- Optionally generates test stubs for your project

```bash
cover init
cover init ./my-project
```

### `cover test-plan <path>`

Run tests from an Xcode test plan JSON file.

```bash
cover test-plan path/to/test-plan.json [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-d, --destination <destination>` | Simulator destination |
| `-tp, --test-plan <plan>` | Xcode test plan name (optional, auto-discovered with prompt) |
| `-w, --workspace <path>` | Path to .xcworkspace |
| `-p, --project <path>` | Path to .xcodeproj |
| `--no-coverage` | Skip coverage generation |

### `cover run-targets <targets...>`

Run specific test targets without a full test plan.

```bash
cover run-targets MyTests MyOtherTests [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-s, --scheme <scheme>` | Xcode scheme |
| `-d, --destination <destination>` | Simulator destination |
| `-tp, --test-plan <plan>` | Xcode test plan name (optional, auto-discovered with prompt) |
| `-w, --workspace <path>` | Path to .xcworkspace |
| `-p, --project <path>` | Path to .xcodeproj |
| `--no-coverage` | Skip coverage generation |

### `cover pr-coverage`

Calculate line-level coverage specifically for PR changes. This command analyzes only the lines you've added or modified, providing precise coverage metrics for code review.

```bash
cover pr-coverage [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --base <branch>` | Base branch to compare against | `main` |
| `--coverage-format <format>` | Coverage format (xccov, lcov, jacoco, llvm-cov) | auto-detect |
| `--coverage-path <paths...>` | Path(s) to coverage artifacts (supports globs) | - |
| `--manifest <path>` | Path to coverage manifest JSON file | - |
| `-s, --scheme <scheme>` | Xcode scheme (if generating coverage via xcodebuild) | - |
| `-t, --threshold <number>` | Minimum coverage threshold percentage | `80` |
| `--strict` | Spec-compliant plain text output (no colors/emojis) | - |
| `--fast` | Skip line-level coverage parsing, use file-level heuristics | - |
| `-v, --verbose` | Show detailed debug output | - |

**Examples:**

```bash
# Auto-detect coverage and compare against main
cover pr-coverage

# Use a specific coverage file
cover pr-coverage --coverage-path build/TestResult.xcresult

# Compare against a different branch with higher threshold
cover pr-coverage -b develop -t 90

# CI mode with plain text output
cover pr-coverage --strict --threshold 80

# Fast mode (skips line-level parsing for better performance)
cover pr-coverage --fast

# Generate coverage if none exists
cover pr-coverage -s MyAppTests
```

**Coverage Format Support:**

| Format | Extensions | Description |
|--------|------------|-------------|
| `xccov` | `.xcresult` | Xcode test result bundles |
| `lcov` | `.lcov`, `.info` | LCOV format (common in JS/TS) |
| `jacoco` | `.xml` | JaCoCo XML reports (Java/Kotlin) |
| `llvm-cov` | `.json` | LLVM coverage JSON export |

**Coverage Manifest:**

For projects with multiple coverage sources, create a `.cover-manifest.json`:

```json
{
  "artifacts": [
    { "format": "xccov", "path": "build/*.xcresult" },
    { "format": "lcov", "path": "coverage/lcov.info" }
  ]
}
```

## Supported Testing Frameworks

| Framework | Type | Auto-Detected |
|-----------|------|---------------|
| **Jest** | Unit | Yes |
| **Vitest** | Unit | Yes |
| **Mocha** | Unit | Yes |
| **Cypress** | E2E | Yes |
| **Playwright** | E2E | Yes |
| **XCTest** | Unit/UI | Yes (default for Swift) |

## Configuration

Cover uses a `.coverrc` JSON file for configuration:

```json
{
  "framework": "jest",
  "llm": {
    "provider": "local",
    "baseUrl": "http://localhost:11434/v1",
    "model": "llama3"
  },
  "paths": {
    "source": "src",
    "tests": "tests"
  },
  "js": {
    "enableCoverage": true,
    "coverageThreshold": 80,
    "testPatterns": ["**/*.test.ts"],
    "sourcePatterns": ["**/*.ts"]
  }
}
```

## AI Agent Integration

Cover supports multiple AI agents for test generation and failure fixing:

- **Internal Auto-Generate**: Uses configured LLM (local or OpenAI)
- **opencode**: Launch opencode CLI
- **claude-code**: Launch claude-code CLI
- **codex-cli**: Launch codex CLI
- **gemini-cli**: Launch gemini CLI
- **Manual**: Copy prompt for use in your preferred tool

### LLM Configuration

On first run, Cover checks for a local LLM server (default: `http://localhost:1234/v1`). If not found, you can:

1. Configure a different local URL (e.g., Ollama at `http://localhost:11434/v1`)
2. Use OpenAI (requires API key and consent for data egress)
3. Skip AI features

## Workflow

1. **Analyze**: Cover finds files changed in your PR compared to `main`.
2. **Test**: It runs your test suite with coverage enabled.
3. **Report**: It shows a coverage table for *only* your changes.
4. **Fix**: If coverage is low or tests fail, it offers AI-assisted fixes.
5. **Repeat**: Re-runs tests after changes are applied.

### PR Coverage Workflow

For CI/CD integration or precise line-level analysis:

1. **Diff**: Parses git diff to find exact lines added/modified.
2. **Parse**: Loads coverage data from your preferred format (xccov, lcov, etc.).
3. **Intersect**: Calculates which changed lines are covered vs uncovered.
4. **Report**: Shows per-file and overall coverage for PR changes only.
5. **Gate**: Exits with error if coverage is below threshold (great for CI).

## Requirements

- Node.js 18+
- Git

**For iOS/macOS projects:**
- Xcode & Command Line Tools (`xcodebuild`, `xcrun`)

**For JavaScript/TypeScript projects:**
- Your testing framework installed (Jest, Vitest, Mocha, etc.)
