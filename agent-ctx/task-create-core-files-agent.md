# Task: Create Core Files for NeuroCLI

## Task ID: create-core-files

## Summary

Created three production-quality TypeScript files for NeuroCLI at `/home/z/my-project/neuro-cli/src/core/`:

### Files Created

1. **`linting.ts`** (25KB) — `LintingIntegration` class
   - `runLint(filePath?, fix?)` — Run linter with auto-detection
   - `detectLinter(projectRoot)` — Detect configured linters
   - `fixIssues(filePath?)` — Auto-fix linting issues
   - `getIssues(filePath?)` — Get current lint issues
   - `formatFile(filePath)` — Format file using project formatter
   - `detectFormatter(projectRoot)` — Detect configured formatter
   - `onLintResult(callback)` — Event handler
   - Supports: ESLint, Prettier, Ruff, Pylint, Flake8, golangci-lint, Clippy
   - Exports: `LintIssue`, `LintResult`, `LinterConfig`

2. **`testing.ts`** (44KB) — `TestingIntegration` class
   - `runTests(testPath?, options?)` — Run tests with auto-detection
   - `detectTestFramework(projectRoot)` — Detect test framework
   - `runRelatedTests(filePath)` — Run tests for a changed file
   - `getCoverage(options?)` — Get test coverage report
   - `watchTests(testPath?)` — Watch mode for continuous testing
   - `generateTest(filePath)` — Generate test file for source file
   - `onTestResult(callback)` — Event handler
   - Supports: Jest, Vitest, pytest, Go test, cargo test, JUnit, Playwright, Cypress
   - Exports: `TestResult`, `TestFailure`, `TestingConfig`, `CoverageReport`, `TestRunOptions`

3. **`code-review.ts`** (43KB) — `CodeReviewSystem` class
   - `reviewFile(filePath)` — Review a single file
   - `reviewChanges(baseBranch?)` — Review uncommitted changes
   - `reviewDiff(diff)` — Review a diff string
   - `reviewPR(prUrl)` — Review a GitHub PR
   - `getReviewComments(filePath?)` — Get review comments
   - `severityFilter(severity)` — Filter by severity
   - `generateReport()` — Generate full review report
   - `setFocus(areas)` — Set focus areas
   - Review categories: security, performance, style, correctness, best-practices, dead-code, complexity
   - 40+ built-in review patterns across all categories
   - Exports: `ReviewComment`, `ReviewReport`, `ReviewSummary`, `CodeReviewConfig`

### Design Decisions
- All files use only Node.js built-in modules (no external dependencies)
- Consistent code style with existing NeuroCLI core files
- TypeScript strict mode compatible (verified with `tsc --noEmit --strict`)
- Comprehensive pattern-based analysis with severity levels
- Event/callback system for integration with other NeuroCLI components
- Quality score calculation (0-100) in code review
- Test file generation based on language conventions
- Diff parsing for targeted code review of changed lines only
