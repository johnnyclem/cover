# Cover

An automated TDD/Coverage CLI utility for iOS/macOS applications.

## Features
- **Git Integration**: Automatically detects changed files between your branch and `main`.
- **Xcode Integration**: Runs `xcodebuild test` with coverage enabled.
- **Coverage Analysis**: filters coverage reports to focus *only* on the files you modified.
- **AI Agent Integration**: Generates prompts for AI coding agents (like `opencode`, `claude-code`) to write missing tests.
- **Interactive Loop**: Repeats the process until your coverage threshold (default 80%) is met.

## Installation

```bash
npm install -g .
# or run via npx
npx .
```

## Usage

Run `cover` in the root of your Xcode project.

```bash
cover
```

### Options

- `-s, --scheme <scheme>`: Specify the Xcode Scheme to test.
- `-b, --branch <branch>`: Base branch to compare against (default: `main`).
- `-t, --threshold <number>`: Coverage percentage threshold (default: 80).

## Workflow

1. **Analyze**: `cover` finds files changed in your PR.
2. **Test**: It runs your test suite.
3. **Report**: It shows a table of coverage for *only* your changes.
4. **Fix**: If coverage is low, it asks to launch an AI agent.
5. **Repeat**: It re-runs the tests after you add the generated test code.

## Requirements
- Node.js 18+
- Xcode & Command Line Tools (`xcodebuild`, `xcrun`)
- Git
