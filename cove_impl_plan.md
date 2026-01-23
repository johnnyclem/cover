# Cover Implementation Plan

## Confirmed Decisions

| Question | Decision |
|----------|----------|
| xccov line-level performance | Accept performance hit only in `--strict` mode; add caching; add `--fast` flag for file-level only |
| Non-executable lines | Count as "covered" (don't penalize for comments/blank lines) |
| Manifest auto-detection | Yes, check `.cover-manifest.json` and `coverage/manifest.json` |
| `--pr-lines-only` output | Show both full file coverage AND PR line coverage with clear separation |

---

## Complete Implementation Checklist

### Phase 1: Core Types & Git Enhancement

| # | Task | File | Status |
|---|------|------|--------|
| 1.1 | Add `DiffHunk`, `FileDiff`, `PRDiffResult` types | `src/types.ts` | Pending |
| 1.2 | Add `LineCoverageData`, `CoverageFormat` types | `src/types.ts` | Pending |
| 1.3 | Add `PRFileCoverage`, `PRCoverageSummary`, `PRCoverageResult` types | `src/types.ts` | Pending |
| 1.4 | Add `validateBranchExists()` function | `src/git.ts` | Pending |
| 1.5 | Add `getChangedLinesPerFile()` function with hunk parsing | `src/git.ts` | Pending |
| 1.6 | Add `getHeadCommit()` function | `src/git.ts` | Pending |

### Phase 2: Coverage Format Parsers

| # | Task | File | Status |
|---|------|------|--------|
| 2.1 | Create abstract `BaseCoverageParser` class | `src/coverage-formats/base-parser.ts` | Pending |
| 2.2 | Create `XccovParser` with line-level support + caching | `src/coverage-formats/xccov-parser.ts` | Pending |
| 2.3 | Create `LcovParser` | `src/coverage-formats/lcov-parser.ts` | Pending |
| 2.4 | Create `JacocoParser` | `src/coverage-formats/jacoco-parser.ts` | Pending |
| 2.5 | Create `LlvmCovParser` | `src/coverage-formats/llvm-cov-parser.ts` | Pending |
| 2.6 | Create parser factory and registry | `src/coverage-formats/index.ts` | Pending |

### Phase 3: PR Coverage Logic

| # | Task | File | Status |
|---|------|------|--------|
| 3.1 | Create `calculatePRCoverage()` intersection algorithm | `src/pr-coverage.ts` | Pending |
| 3.2 | Create `expandHunksToLines()` helper | `src/pr-coverage.ts` | Pending |
| 3.3 | Create `findCoverageForFile()` with path normalization | `src/pr-coverage.ts` | Pending |
| 3.4 | Create `formatStrictReport()` (spec-compliant output) | `src/pr-coverage-report.ts` | Pending |
| 3.5 | Create `formatStyledReport()` (default with colors/table) | `src/pr-coverage-report.ts` | Pending |

### Phase 4: CLI Integration

| # | Task | File | Status |
|---|------|------|--------|
| 4.1 | Add `pr-coverage` command with all options | `src/index.ts` | Pending |
| 4.2 | Add `--pr-lines-only` flag to `check` command | `src/index.ts` | Pending |
| 4.3 | Add `--fast` flag to `pr-coverage` command | `src/index.ts` | Pending |
| 4.4 | Add `--strict` flag to `pr-coverage` command | `src/index.ts` | Pending |
| 4.5 | Add manifest auto-detection logic | `src/index.ts` | Pending |
| 4.6 | Implement dual output for `check --pr-lines-only` | `src/index.ts` | Pending |

### Phase 5: Supporting Infrastructure

| # | Task | File | Status |
|---|------|------|--------|
| 5.1 | Add xccov cache directory and logic | `src/coverage-formats/xccov-parser.ts` | Pending |
| 5.2 | Add glob pattern resolver utility | `src/utils.ts` (new) | Pending |
| 5.3 | Add manifest loading logic | `src/utils.ts` | Pending |
| 5.4 | Update `printCoverageTable` to accept threshold param | `src/ui.ts` | Pending |
| 5.5 | Add `printPRCoverageTable()` for styled PR output | `src/ui.ts` | Pending |

### Phase 6: Fix Existing Issues

| # | Task | File | Status |
|---|------|------|--------|
| 6.1 | Complete index.ts fixes from earlier session | `src/index.ts` | Pending |
| 6.2 | Update all `processCoverage` calls to use new API | `src/index.ts` | Pending |
| 6.3 | Install `fast-xml-parser` dependency | `package.json` | Pending |

### Phase 7: Testing & Validation

| # | Task | Status |
|---|------|--------|
| 7.1 | Verify TypeScript compilation passes | Pending |
| 7.2 | Test `pr-coverage` with real Xcode project | Pending |
| 7.3 | Test `--strict` output matches spec format exactly | Pending |
| 7.4 | Test `check --pr-lines-only` dual output | Pending |
| 7.5 | Test `--fast` flag uses file-level only | Pending |

---

## Key Implementation Details

### xccov Caching Strategy

```
~/.cover/
└── xccov-cache/
    └── <xcresult-hash>/
        ├── file-list.json
        └── lines/
            ├── <file-path-hash>.json
            └── ...
```

- Cache key: SHA256 hash of xcresult path + modification time
- Cache expiry: Invalidate when xcresult is modified
- Cache location: `~/.cover/xccov-cache/`

### `--fast` vs `--strict` Behavior

| Mode | Line-Level Parsing | Output Format | Performance |
|------|-------------------|---------------|-------------|
| Default | File-level only | Styled with colors | Fast |
| `--fast` | File-level only | Styled with colors | Fast |
| `--strict` | Full line-level | Plain text, no emojis | Slower (accurate) |
| `--strict --fast` | File-level only | Plain text, no emojis | Fast |

### Dual Output for `check --pr-lines-only`

```
=== File Coverage (All Changed Files) ===
┌─────────────────────┬──────────────┬───────────────┬────────┐
│ File                │ Line Coverage│ Func Coverage │ Status │
├─────────────────────┼──────────────┼───────────────┼────────┤
│ Source/Auth.swift   │ 85.50%       │ 90.00%        │ PASS   │
│ Source/Login.swift  │ 72.30%       │ 80.00%        │ FAIL   │
└─────────────────────┴──────────────┴───────────────┴────────┘

=== PR Line Coverage (New/Modified Lines Only) ===
┌─────────────────────┬──────────────┬──────────────┬───────────────┬────────┐
│ File                │ New Lines    │ Covered      │ Uncovered     │ Status │
├─────────────────────┼──────────────┼──────────────┼───────────────┼────────┤
│ Source/Auth.swift   │ 25           │ 23           │ 42, 56        │ PASS   │
│ Source/Login.swift  │ 18           │ 12           │ 15, 22, 31... │ FAIL   │
└─────────────────────┴──────────────┴──────────────┴───────────────┴────────┘

PR Coverage Summary: 81.4% (35/43 new lines covered)
```

### Manifest Auto-Detection Order

1. `.cover-manifest.json` (project root)
2. `coverage/manifest.json`
3. `coverage/.manifest.json`
4. `.coverage-manifest.json`

---

## Estimated Implementation Time

| Phase | Estimated Effort |
|-------|------------------|
| Phase 1: Types & Git | 30 min |
| Phase 2: Parsers | 90 min |
| Phase 3: PR Coverage Logic | 45 min |
| Phase 4: CLI Integration | 60 min |
| Phase 5: Supporting Infrastructure | 30 min |
| Phase 6: Fix Existing Issues | 20 min |
| Phase 7: Testing | 30 min |
| **Total** | **~5 hours** |

---

## Ready for Implementation

The plan is complete. When you're ready to proceed, say **"continue"** or **"implement"** and I'll begin executing the implementation in the order specified above, starting with Phase 1.

---

