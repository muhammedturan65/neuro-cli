// ============================================================
// NeuroCLI - Testing Integration
// Automatic test framework detection, execution, and coverage
// Supports Jest, Vitest, pytest, Go test, cargo test,
// JUnit, Playwright, Cypress, and standard test runners
// ============================================================

import { join, resolve, dirname, extname, basename, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { execSync, spawn } from 'child_process';

// -----------------------------------------------------------
// Public interfaces
// -----------------------------------------------------------

export interface TestResult {
  success: boolean;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  framework: string;
  failures: TestFailure[];
  coverage?: CoverageReport;
}

export interface TestFailure {
  testName: string;
  file: string;
  line?: number;
  error: string;
  expected?: string;
  actual?: string;
}

export interface TestingConfig {
  enabled: boolean;
  autoRunOnChange: boolean;
  runOnSave: boolean;
  coverageThreshold: number;
  timeout: number;
  relatedTestsOnly: boolean;
}

// -----------------------------------------------------------
// Additional public types
// -----------------------------------------------------------

export interface CoverageReport {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  files: CoverageFile[];
}

export interface CoverageFile {
  path: string;
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  uncoveredLines: number[];
}

export interface TestRunOptions {
  coverage?: boolean;
  watch?: boolean;
  verbose?: boolean;
  filter?: string;
  timeout?: number;
  environment?: string;
}

// -----------------------------------------------------------
// Internal types
// -----------------------------------------------------------

interface TestFrameworkInfo {
  name: string;
  language: string;
  configFiles: string[];
  commands: {
    run: string[];
    watch?: string[];
    coverage: string[];
  };
  parseOutput: (stdout: string, stderr: string, rootDir: string) => ParsedTestOutput;
}

interface ParsedTestOutput {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: TestFailure[];
  coverage?: CoverageReport;
}

type TestResultCallback = (result: TestResult) => void;

// -----------------------------------------------------------
// Test framework definitions
// -----------------------------------------------------------

const TEST_FRAMEWORKS: TestFrameworkInfo[] = [
  // Jest
  {
    name: 'jest',
    language: 'javascript',
    configFiles: [
      'jest.config.js',
      'jest.config.cjs',
      'jest.config.mjs',
      'jest.config.ts',
      'jest.config.mts',
      'jest.config.cts',
    ],
    commands: {
      run: ['npx', 'jest', '--json', '--outputFile=/dev/stdout'],
      watch: ['npx', 'jest', '--watch'],
      coverage: ['npx', 'jest', '--coverage', '--json', '--outputFile=/dev/stdout'],
    },
    parseOutput: (stdout, _stderr, rootDir) => {
      const result: ParsedTestOutput = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        failures: [],
      };

      try {
        // Try to find JSON in the output (Jest mixes JSON with other output)
        const jsonMatch = stdout.match(/\{[\s\S]*"numPassedTests"[\s\S]*\}/);
        if (!jsonMatch) return result;

        const data = JSON.parse(jsonMatch[0]) as {
          numPassedTests: number;
          numFailedTests: number;
          numPendingTests: number;
          numTotalTests: number;
          startTime: number;
          testResults: Array<{
            name: string;
            assertionResults: Array<{
              fullName: string;
              status: string;
              failureMessages: string[];
              location?: { line: number };
            }>;
          }>;
          coverageMap?: Record<string, {
            statements: { covered: number; total: number };
            branches: { covered: number; total: number };
            functions: { covered: number; total: number };
            lines: { covered: number; total: number };
          }>;
        };

        result.total = data.numTotalTests;
        result.passed = data.numPassedTests;
        result.failed = data.numFailedTests;
        result.skipped = data.numPendingTests;
        result.duration = Date.now();

        for (const testFile of data.testResults) {
          for (const assertion of testFile.assertionResults) {
            if (assertion.status === 'failed') {
              const errorBody = assertion.failureMessages[0] ?? 'Unknown error';
              const { message, expected, actual, line } = parseJestError(errorBody);
              result.failures.push({
                testName: assertion.fullName,
                file: relative(rootDir, testFile.name),
                line: assertion.location?.line ?? line,
                error: message,
                expected,
                actual,
              });
            }
          }
        }

        // Coverage
        if (data.coverageMap) {
          result.coverage = parseJestCoverage(data.coverageMap, rootDir);
        }
      } catch {
        // Fallback: try to parse text output
        result.total = (stdout.match(/\d+ test(s)? passed/g) ?? []).length > 0
          ? parseInt(stdout.match(/Tests:\s+(\d+)/)?.[1] ?? '0', 10)
          : 0;
      }

      return result;
    },
  },
  // Vitest
  {
    name: 'vitest',
    language: 'javascript',
    configFiles: [
      'vitest.config.js',
      'vitest.config.cjs',
      'vitest.config.mjs',
      'vitest.config.ts',
      'vitest.config.mts',
    ],
    commands: {
      run: ['npx', 'vitest', 'run', '--reporter=json'],
      watch: ['npx', 'vitest', '--watch'],
      coverage: ['npx', 'vitest', 'run', '--coverage', '--reporter=json'],
    },
    parseOutput: (stdout, _stderr, rootDir) => {
      const result: ParsedTestOutput = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        failures: [],
      };

      try {
        const data = JSON.parse(stdout) as {
          numTotalTests: number;
          numPassedTests: number;
          numFailedTests: number;
          numPendingTests: number;
          startTime: number;
          testResults: Array<{
            name: string;
            assertionResults: Array<{
              fullName: string;
              status: string;
              failureMessages: string[];
              location?: { line: number; column: number };
            }>;
          }>;
        };

        result.total = data.numTotalTests;
        result.passed = data.numPassedTests;
        result.failed = data.numFailedTests;
        result.skipped = data.numPendingTests;
        result.duration = Date.now();

        for (const testFile of data.testResults) {
          for (const assertion of testFile.assertionResults) {
            if (assertion.status === 'failed') {
              result.failures.push({
                testName: assertion.fullName,
                file: relative(rootDir, testFile.name),
                line: assertion.location?.line,
                error: assertion.failureMessages[0] ?? 'Unknown error',
              });
            }
          }
        }
      } catch {
        // Parse error
      }

      return result;
    },
  },
  // pytest
  {
    name: 'pytest',
    language: 'python',
    configFiles: [
      'pytest.ini',
      'pyproject.toml',
      'tox.ini',
      'setup.cfg',
      'conftest.py',
    ],
    commands: {
      run: ['pytest', '--json-report', '--json-report-file=/dev/stdout'],
      coverage: ['pytest', '--cov', '--cov-report=term-missing'],
    },
    parseOutput: (stdout, _stderr, rootDir) => {
      const result: ParsedTestOutput = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        failures: [],
      };

      try {
        // Try JSON report first
        const data = JSON.parse(stdout) as {
          summary: {
            total: number;
            passed: number;
            failed: number;
            skipped: number;
            duration: number;
          };
          tests?: Array<{
            name: string;
            filepath: string;
            lineno: number;
            outcome: string;
            call?: { longrepr?: string };
          }>;
        };

        result.total = data.summary.total;
        result.passed = data.summary.passed;
        result.failed = data.summary.failed;
        result.skipped = data.summary.skipped;
        result.duration = Math.round(data.summary.duration * 1000);

        if (data.tests) {
          for (const test of data.tests) {
            if (test.outcome === 'failed') {
              result.failures.push({
                testName: test.name,
                file: relative(rootDir, test.filepath),
                line: test.lineno,
                error: test.call?.longrepr ?? 'Unknown error',
              });
            }
          }
        }
      } catch {
        // Fallback: parse text output
        const passedMatch = stdout.match(/(\d+) passed/);
        const failedMatch = stdout.match(/(\d+) failed/);
        const skippedMatch = stdout.match(/(\d+) skipped/);

        result.passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
        result.failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
        result.skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
        result.total = result.passed + result.failed + result.skipped;

        // Parse FAILED lines
        const failedLinePattern = /FAILED\s+(\S+)/g;
        let match: RegExpExecArray | null;
        while ((match = failedLinePattern.exec(stdout)) !== null) {
          result.failures.push({
            testName: match[1],
            file: match[1],
            error: 'Test failed',
          });
        }
      }

      return result;
    },
  },
  // Go test
  {
    name: 'go-test',
    language: 'go',
    configFiles: ['go.mod'],
    commands: {
      run: ['go', 'test', '-json', './...'],
      coverage: ['go', 'test', '-coverprofile=coverage.out', './...'],
    },
    parseOutput: (stdout, _stderr, rootDir) => {
      const result: ParsedTestOutput = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        failures: [],
      };

      const lines = stdout.split('\n');
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            Time: string;
            Action: string;
            Package: string;
            Test?: string;
            Output?: string;
            Elapsed?: number;
          };

          if (entry.Action === 'pass' && entry.Test) {
            result.total++;
            result.passed++;
          } else if (entry.Action === 'fail' && entry.Test) {
            result.total++;
            result.failed++;
            result.failures.push({
              testName: entry.Test,
              file: entry.Package,
              error: 'Test failed',
            });
          } else if (entry.Action === 'skip' && entry.Test) {
            result.total++;
            result.skipped++;
          }

          if (entry.Elapsed) {
            result.duration += Math.round(entry.Elapsed * 1000);
          }
        } catch {
          // Not a JSON line — skip
        }
      }

      return result;
    },
  },
  // cargo test (Rust)
  {
    name: 'cargo-test',
    language: 'rust',
    configFiles: ['Cargo.toml'],
    commands: {
      run: ['cargo', 'test', '--message-format=json'],
      coverage: ['cargo', 'tarpaulin', '--out=Stdout'],
    },
    parseOutput: (stdout, _stderr, rootDir) => {
      const result: ParsedTestOutput = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        failures: [],
      };

      const lines = stdout.split('\n');
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            type: string;
            name?: string;
            event?: string;
          };

          if (entry.type === 'test') {
            result.total++;
            if (entry.event === 'ok') {
              result.passed++;
            } else if (entry.event === 'failed') {
              result.failed++;
              result.failures.push({
                testName: entry.name ?? 'unknown',
                file: 'unknown',
                error: 'Test failed',
              });
            } else if (entry.event === 'ignored') {
              result.skipped++;
            }
          }
        } catch {
          // Not a JSON line — try text parsing
          if (line.includes('test result:')) {
            const passedMatch = line.match(/(\d+) passed/);
            const failedMatch = line.match(/(\d+) failed/);
            const ignoredMatch = line.match(/(\d+) ignored/);

            result.passed += passedMatch ? parseInt(passedMatch[1], 10) : 0;
            result.failed += failedMatch ? parseInt(failedMatch[1], 10) : 0;
            result.skipped += ignoredMatch ? parseInt(ignoredMatch[1], 10) : 0;
            result.total = result.passed + result.failed + result.skipped;
          }
        }
      }

      return result;
    },
  },
  // JUnit (Java)
  {
    name: 'junit',
    language: 'java',
    configFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    commands: {
      run: ['mvn', 'test'],
      coverage: ['mvn', 'test', 'jacoco:report'],
    },
    parseOutput: (stdout, _stderr, rootDir) => {
      const result: ParsedTestOutput = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        failures: [],
      };

      // Parse Maven test output
      const testsRunMatch = stdout.match(/Tests run:\s*(\d+)/);
      const failuresMatch = stdout.match(/Failures:\s*(\d+)/);
      const errorsMatch = stdout.match(/Errors:\s*(\d+)/);
      const skippedMatch = stdout.match(/Skipped:\s*(\d+)/);

      if (testsRunMatch) {
        result.total = parseInt(testsRunMatch[1], 10);
        const failCount = failuresMatch ? parseInt(failuresMatch[1], 10) : 0;
        const errCount = errorsMatch ? parseInt(errorsMatch[1], 10) : 0;
        result.failed = failCount + errCount;
        result.skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
        result.passed = result.total - result.failed - result.skipped;
      }

      // Parse failure details
      const failurePattern = /Failed tests:\s*([\s\S]*?)(?=\n\n|Tests run:|BUILD)/;
      const failureBlock = stdout.match(failurePattern);
      if (failureBlock) {
        const testFailurePattern = /\s*(\S+)\((\S+)\):\s*(.+)/g;
        let match: RegExpExecArray | null;
        while ((match = testFailurePattern.exec(failureBlock[1])) !== null) {
          result.failures.push({
            testName: match[1],
            file: match[2],
            error: match[3],
          });
        }
      }

      return result;
    },
  },
  // Playwright (E2E)
  {
    name: 'playwright',
    language: 'javascript',
    configFiles: [
      'playwright.config.js',
      'playwright.config.cjs',
      'playwright.config.mjs',
      'playwright.config.ts',
      'playwright.config.mts',
    ],
    commands: {
      run: ['npx', 'playwright', 'test', '--reporter=json'],
      watch: ['npx', 'playwright', 'test', '--ui'],
      coverage: ['npx', 'playwright', 'test', '--coverage'],
    },
    parseOutput: (stdout, _stderr, rootDir) => {
      const result: ParsedTestOutput = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        failures: [],
      };

      try {
        const data = JSON.parse(stdout) as {
          config?: unknown;
          suites?: unknown[];
          stats?: {
            total: number;
            expected: number;
            unexpected: number;
            skipped: number;
            duration: number;
          };
        };

        if (data.stats) {
          result.total = data.stats.total;
          result.passed = data.stats.expected;
          result.failed = data.stats.unexpected;
          result.skipped = data.stats.skipped;
          result.duration = data.stats.duration;
        }
      } catch {
        // Fallback text parse
        const passedMatch = stdout.match(/(\d+) passed/);
        const failedMatch = stdout.match(/(\d+) failed/);
        const skippedMatch = stdout.match(/(\d+) skipped/);

        result.passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
        result.failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
        result.skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
        result.total = result.passed + result.failed + result.skipped;
      }

      return result;
    },
  },
  // Cypress (E2E)
  {
    name: 'cypress',
    language: 'javascript',
    configFiles: [
      'cypress.config.js',
      'cypress.config.cjs',
      'cypress.config.mjs',
      'cypress.config.ts',
      'cypress.json',
    ],
    commands: {
      run: ['npx', 'cypress', 'run', '--reporter=json'],
      watch: ['npx', 'cypress', 'open'],
      coverage: ['npx', 'cypress', 'run', '--coverage'],
    },
    parseOutput: (stdout, _stderr, rootDir) => {
      const result: ParsedTestOutput = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        failures: [],
      };

      try {
        const data = JSON.parse(stdout) as {
          totalTests?: number;
          totalPassed?: number;
          totalFailed?: number;
          totalPending?: number;
          totalDuration?: number;
          runs?: Array<{
            spec: { name: string };
            tests: Array<{
              title: string[];
              state: string;
              displayError?: string;
            }>;
          }>;
        };

        result.total = data.totalTests ?? 0;
        result.passed = data.totalPassed ?? 0;
        result.failed = data.totalFailed ?? 0;
        result.skipped = data.totalPending ?? 0;
        result.duration = data.totalDuration ?? 0;

        if (data.runs) {
          for (const run of data.runs) {
            for (const test of run.tests) {
              if (test.state === 'failed') {
                result.failures.push({
                  testName: test.title.join(' > '),
                  file: run.spec.name,
                  error: test.displayError ?? 'Test failed',
                });
              }
            }
          }
        }
      } catch {
        // Parse error
      }

      return result;
    },
  },
];

// Default configuration
const DEFAULT_TESTING_CONFIG: TestingConfig = {
  enabled: true,
  autoRunOnChange: false,
  runOnSave: false,
  coverageThreshold: 80,
  timeout: 120_000,
  relatedTestsOnly: false,
};

// Test file naming conventions
const TEST_FILE_PATTERNS: Record<string, RegExp[]> = {
  javascript: [
    /\.test\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/,
    /\.spec\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/,
    /__tests__\/.*\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/,
  ],
  python: [
    /test_.*\.py$/,
    /.*_test\.py$/,
  ],
  go: [
    /_test\.go$/,
  ],
  rust: [],  // Rust tests are inline
  java: [
    /Test\.java$/,
    /Tests\.java$/,
    /IT\.java$/,  // Integration test
  ],
};

// Source file → test file mapping conventions
const SOURCE_TO_TEST_MAP: Record<string, Array<(srcPath: string) => string[]>> = {
  javascript: [
    (src) => {
      const base = src.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
      return [
        `${base}.test.${src.match(/\.(js|jsx|ts|tsx|mjs|cjs)$/)?.[1] ?? 'ts'}`,
        `${base}.spec.${src.match(/\.(js|jsx|ts|tsx|mjs|cjs)$/)?.[1] ?? 'ts'}`,
      ];
    },
    (src) => {
      const base = basename(src).replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
      const dir = dirname(src);
      return [
        join(dir, '__tests__', `${base}.test.ts`),
        join(dir, '__tests__', `${base}.spec.ts`),
      ];
    },
  ],
  python: [
    (src) => {
      const base = src.replace(/\.py$/, '');
      return [`test_${base}.py`, `${base}_test.py`];
    },
  ],
  go: [
    (src) => {
      const base = src.replace(/\.go$/, '');
      return [`${base}_test.go`];
    },
  ],
  rust: [],  // Inline tests
  java: [
    (src) => {
      const base = src.replace(/\.java$/, '');
      return [`${base}Test.java`, `${base}Tests.java`];
    },
  ],
};

// -----------------------------------------------------------
// TestingIntegration class
// -----------------------------------------------------------

export class TestingIntegration {
  private config: TestingConfig;
  private projectRoot: string;
  private detectedFramework: TestFrameworkInfo | null = null;
  private frameworkDetected = false;
  private cachedResults: TestResult | null = null;
  private callbacks: TestResultCallback[] = [];
  private watchProcess: ReturnType<typeof spawn> | null = null;

  constructor(projectRoot?: string, config?: Partial<TestingConfig>) {
    this.projectRoot = projectRoot ?? process.cwd();
    this.config = { ...DEFAULT_TESTING_CONFIG, ...config };
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Run tests with auto-detection of the test framework.
   * Optionally target a specific test path or pass run options.
   */
  async runTests(testPath?: string, options?: TestRunOptions): Promise<TestResult> {
    if (!this.config.enabled) {
      return this.emptyResult('disabled');
    }

    this.ensureDetected();

    if (!this.detectedFramework) {
      return this.emptyResult('none');
    }

    const framework = this.detectedFramework;
    const timeout = options?.timeout ?? this.config.timeout;
    const startTime = Date.now();

    // Build command
    let commandParts: string[];
    if (options?.coverage) {
      commandParts = [...framework.commands.coverage];
    } else {
      commandParts = [...framework.commands.run];
    }

    if (testPath) {
      commandParts.push(resolve(this.projectRoot, testPath));
    }

    if (options?.filter) {
      commandParts.push(options.filter);
    }

    if (options?.verbose && framework.name === 'jest') {
      commandParts.push('--verbose');
    }

    try {
      const { stdout, stderr } = await this.execCommand(
        commandParts,
        this.projectRoot,
        timeout,
      );

      const parsed = framework.parseOutput(stdout, stderr, this.projectRoot);
      const duration = Date.now() - startTime;

      const result: TestResult = {
        success: parsed.failed === 0,
        totalTests: parsed.total,
        passed: parsed.passed,
        failed: parsed.failed,
        skipped: parsed.skipped,
        duration: duration || parsed.duration,
        framework: framework.name,
        failures: parsed.failures,
        coverage: parsed.coverage,
      };

      // Check coverage threshold
      if (result.coverage && result.coverage.lines < this.config.coverageThreshold) {
        result.success = false;
      }

      this.cachedResults = result;
      this.emit(result);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);

      const result: TestResult = {
        success: false,
        totalTests: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration,
        framework: framework.name,
        failures: [{
          testName: 'Framework execution',
          file: '',
          error: `Failed to run tests: ${errMsg}`,
        }],
      };

      this.cachedResults = result;
      this.emit(result);
      return result;
    }
  }

  /**
   * Detect which test framework is configured in the project.
   * Returns the name of the detected framework, or null if none found.
   */
  detectTestFramework(projectRoot?: string): string | null {
    const root = projectRoot ?? this.projectRoot;

    // Check package.json for test scripts
    const pkgJsonPath = join(root, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
          scripts?: Record<string, string>;
          devDependencies?: Record<string, string>;
          dependencies?: Record<string, string>;
        };

        const allDeps = {
          ...pkgJson.dependencies,
          ...pkgJson.devDependencies,
        };

        // Check for vitest first (takes priority over jest if both present)
        if (allDeps['vitest']) {
          const vitestFramework = TEST_FRAMEWORKS.find(f => f.name === 'vitest')!;
          this.detectedFramework = vitestFramework;
          this.frameworkDetected = true;
          return 'vitest';
        }

        if (allDeps['jest']) {
          const jestFramework = TEST_FRAMEWORKS.find(f => f.name === 'jest')!;
          this.detectedFramework = jestFramework;
          this.frameworkDetected = true;
          return 'jest';
        }

        // Check for Playwright / Cypress
        if (allDeps['@playwright/test']) {
          const pwFramework = TEST_FRAMEWORKS.find(f => f.name === 'playwright')!;
          this.detectedFramework = pwFramework;
          this.frameworkDetected = true;
          return 'playwright';
        }

        if (allDeps['cypress']) {
          const cypressFramework = TEST_FRAMEWORKS.find(f => f.name === 'cypress')!;
          this.detectedFramework = cypressFramework;
          this.frameworkDetected = true;
          return 'cypress';
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check config files for all frameworks
    for (const framework of TEST_FRAMEWORKS) {
      const hasConfig = framework.configFiles.some(cfg =>
        existsSync(join(root, cfg)),
      );

      if (hasConfig) {
        this.detectedFramework = framework;
        this.frameworkDetected = true;
        return framework.name;
      }
    }

    this.frameworkDetected = true;
    return null;
  }

  /**
   * Run tests related to a changed file.
   * Attempts to find and run only the test files that cover the changed source.
   */
  async runRelatedTests(filePath: string): Promise<TestResult> {
    this.ensureDetected();

    if (!this.detectedFramework) {
      return this.emptyResult('none');
    }

    const lang = this.getLanguageForFile(filePath);
    if (!lang) {
      // If we can't determine language, run all tests
      return this.runTests();
    }

    // Find related test files
    const relatedTestFiles = this.findRelatedTestFiles(filePath, lang);

    if (relatedTestFiles.length === 0) {
      // No related tests found — run the full suite if not in related-only mode
      if (!this.config.relatedTestsOnly) {
        return this.runTests();
      }
      return this.emptyResult('no-related-tests');
    }

    // Run each related test file
    const allFailures: TestFailure[] = [];
    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalDuration = 0;

    for (const testFile of relatedTestFiles) {
      const absTestPath = resolve(this.projectRoot, testFile);
      if (!existsSync(absTestPath)) continue;

      const result = await this.runTests(testFile);
      totalTests += result.totalTests;
      totalPassed += result.passed;
      totalFailed += result.failed;
      totalSkipped += result.skipped;
      totalDuration += result.duration;
      allFailures.push(...result.failures);
    }

    const combinedResult: TestResult = {
      success: totalFailed === 0,
      totalTests,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalSkipped,
      duration: totalDuration,
      framework: this.detectedFramework.name,
      failures: allFailures,
    };

    return combinedResult;
  }

  /**
   * Get test coverage report.
   */
  async getCoverage(options?: TestRunOptions): Promise<TestResult> {
    return this.runTests(undefined, { ...options, coverage: true });
  }

  /**
   * Start watch mode for continuous testing.
   * Returns a function that stops the watcher when called.
   */
  async watchTests(testPath?: string): Promise<() => void> {
    this.ensureDetected();

    if (!this.detectedFramework) {
      throw new Error('No test framework detected');
    }

    const framework = this.detectedFramework;
    if (!framework.commands.watch) {
      throw new Error(`${framework.name} does not support watch mode`);
    }

    const commandParts = [...framework.commands.watch];
    if (testPath) {
      commandParts.push(resolve(this.projectRoot, testPath));
    }

    // Stop any existing watcher
    this.stopWatcher();

    const [cmd, ...args] = commandParts;

    this.watchProcess = spawn(cmd, args, {
      cwd: this.projectRoot,
      stdio: 'pipe',
      shell: true,
    });

    this.watchProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString('utf-8');
      console.log(output);
    });

    this.watchProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString('utf-8');
      console.error(output);
    });

    // Return stop function
    return () => this.stopWatcher();
  }

  /**
   * Generate a test file for a source file based on conventions.
   * Returns the path of the generated test file, or null if generation failed.
   */
  async generateTest(filePath: string): Promise<string | null> {
    const lang = this.getLanguageForFile(filePath);
    if (!lang) return null;

    const absPath = resolve(this.projectRoot, filePath);
    if (!existsSync(absPath)) return null;

    // Determine test file path
    const testFilePaths = this.findRelatedTestFilePaths(filePath, lang);
    if (testFilePaths.length === 0) return null;

    const testFilePath = testFilePaths[0];
    const fullTestPath = resolve(this.projectRoot, testFilePath);

    // Check if test file already exists
    if (existsSync(fullTestPath)) {
      return fullTestPath;
    }

    // Generate test file content
    const content = this.generateTestContent(filePath, lang, testFilePath);
    if (!content) return null;

    try {
      const testDir = dirname(fullTestPath);
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }
      writeFileSync(fullTestPath, content, 'utf-8');
      return fullTestPath;
    } catch {
      return null;
    }
  }

  /**
   * Register a callback for test results.
   */
  onTestResult(callback: TestResultCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove a previously registered callback.
   */
  offTestResult(callback: TestResultCallback): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callback);
  }

  /**
   * Get the current testing configuration.
   */
  getConfig(): TestingConfig {
    return { ...this.config };
  }

  /**
   * Update the testing configuration.
   */
  updateConfig(updates: Partial<TestingConfig>): void {
    Object.assign(this.config, updates);
  }

  /**
   * Get the last cached test result.
   */
  getLastResult(): TestResult | null {
    return this.cachedResults;
  }

  /**
   * Get the name of the detected test framework.
   */
  getDetectedFramework(): string | null {
    this.ensureDetected();
    return this.detectedFramework?.name ?? null;
  }

  /**
   * Determine the language of a file based on its extension.
   */
  getLanguageForFile(filePath: string): string | null {
    const ext = extname(filePath).toLowerCase();
    const extMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'javascript',
      '.tsx': 'javascript',
      '.mts': 'javascript',
      '.cts': 'javascript',
      '.py': 'python',
      '.pyi': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
    };
    return extMap[ext] ?? null;
  }

  /**
   * Check if a file is a test file based on naming conventions.
   */
  isTestFile(filePath: string): boolean {
    const lang = this.getLanguageForFile(filePath);
    if (!lang) return false;

    const patterns = TEST_FILE_PATTERNS[lang] ?? [];
    return patterns.some(pattern => pattern.test(basename(filePath)));
  }

  /**
   * Find all test files in the project.
   */
  findTestFiles(directory?: string): string[] {
    const root = directory ?? this.projectRoot;
    const testFiles: string[] = [];

    this.walkDir(root, (filePath) => {
      if (this.isTestFile(filePath)) {
        testFiles.push(relative(this.projectRoot, filePath));
      }
    });

    return testFiles;
  }

  /**
   * Print a summary of test results.
   */
  printSummary(result: TestResult): void {
    console.log('');
    console.log('--- Test Summary ---');
    console.log(`  Framework: ${result.framework}`);
    console.log(`  Duration:  ${result.duration}ms`);
    console.log(`  Total:     ${result.totalTests}`);
    console.log(`  Passed:    ${result.passed}`);
    console.log(`  Failed:    ${result.failed}`);
    console.log(`  Skipped:   ${result.skipped}`);
    console.log(`  Status:    ${result.success ? 'PASS' : 'FAIL'}`);

    if (result.coverage) {
      console.log('');
      console.log('  Coverage:');
      console.log(`    Lines:      ${result.coverage.lines.toFixed(1)}%`);
      console.log(`    Branches:   ${result.coverage.branches.toFixed(1)}%`);
      console.log(`    Functions:  ${result.coverage.functions.toFixed(1)}%`);
      console.log(`    Statements: ${result.coverage.statements.toFixed(1)}%`);

      if (result.coverage.lines < this.config.coverageThreshold) {
        console.log(`    ⚠ Below threshold (${this.config.coverageThreshold}%)`);
      }
    }

    if (result.failures.length > 0) {
      console.log('');
      console.log('  Failures:');
      for (const failure of result.failures.slice(0, 20)) {
        console.log(`    ✗ ${failure.testName}`);
        if (failure.file) console.log(`      File: ${failure.file}${failure.line ? `:${failure.line}` : ''}`);
        console.log(`      ${failure.error.split('\n')[0]}`);
        if (failure.expected) console.log(`      Expected: ${failure.expected}`);
        if (failure.actual) console.log(`      Actual:   ${failure.actual}`);
      }
      if (result.failures.length > 20) {
        console.log(`    ... and ${result.failures.length - 20} more`);
      }
    }

    console.log('');
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  private ensureDetected(): void {
    if (!this.frameworkDetected) {
      this.detectTestFramework(this.projectRoot);
    }
  }

  private emit(result: TestResult): void {
    for (const cb of this.callbacks) {
      try {
        cb(result);
      } catch {
        // Callback errors should not interrupt the flow
      }
    }
  }

  private emptyResult(reason: string): TestResult {
    return {
      success: reason !== 'fail',
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      framework: reason,
      failures: [],
    };
  }

  private stopWatcher(): void {
    if (this.watchProcess) {
      this.watchProcess.kill('SIGTERM');
      this.watchProcess = null;
    }
  }

  private findRelatedTestFiles(filePath: string, lang: string): string[] {
    const testPaths: string[] = [];

    // First check if the file itself is a test file
    if (this.isTestFile(filePath)) {
      testPaths.push(filePath);
      return testPaths;
    }

    // Use source-to-test mapping
    const mappers = SOURCE_TO_TEST_MAP[lang] ?? [];
    for (const mapper of mappers) {
      const candidates = mapper(filePath);
      for (const candidate of candidates) {
        const absCandidate = resolve(this.projectRoot, candidate);
        if (existsSync(absCandidate)) {
          testPaths.push(candidate);
        }
      }
    }

    return testPaths;
  }

  private findRelatedTestFilePaths(filePath: string, lang: string): string[] {
    const mappers = SOURCE_TO_TEST_MAP[lang] ?? [];
    const paths: string[] = [];
    for (const mapper of mappers) {
      paths.push(...mapper(filePath));
    }
    return paths;
  }

  private generateTestContent(
    sourceFilePath: string,
    lang: string,
    _testFilePath: string,
  ): string | null {
    const sourceBase = basename(sourceFilePath, extname(sourceFilePath));

    switch (lang) {
      case 'javascript':
        return this.generateJSTestContent(sourceBase, sourceFilePath);
      case 'python':
        return this.generatePythonTestContent(sourceBase, sourceFilePath);
      case 'go':
        return this.generateGoTestContent(sourceBase, sourceFilePath);
      case 'rust':
        return null; // Rust tests are inline
      case 'java':
        return this.generateJavaTestContent(sourceBase, sourceFilePath);
      default:
        return null;
    }
  }

  private generateJSTestContent(sourceBase: string, sourceFilePath: string): string {
    const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(sourceFilePath);
    const ext = isTypeScript ? 'ts' : 'js';
    const importExt = isTypeScript ? '' : '.js';

    // Detect if using vitest or jest
    const framework = this.detectedFramework?.name ?? 'jest';

    return `// Test file for ${sourceFilePath}
// Generated by NeuroCLI Testing Integration

import { describe, it, expect${framework === 'vitest' ? ', vi' : ''} } from '${framework === 'vitest' ? 'vitest' : '@jest/globals'}';

describe('${sourceBase}', () => {
  it('should work correctly', () => {
    // TODO: Implement test
    expect(true).toBe(true);
  });
});
`;
  }

  private generatePythonTestContent(sourceBase: string, _sourceFilePath: string): string {
    return `# Test file for ${sourceBase}
# Generated by NeuroCLI Testing Integration

import pytest


class Test${this.pascalCase(sourceBase)}:
    """Tests for ${sourceBase} module."""

    def test_placeholder(self):
        """TODO: Implement test."""
        assert True
`;
  }

  private generateGoTestContent(sourceBase: string, sourceFilePath: string): string {
    const packageName = dirname(sourceFilePath).split('/').pop() ?? 'main';

    return `package ${packageName}

// Test file for ${sourceFilePath}
// Generated by NeuroCLI Testing Integration

import "testing"

func Test${this.pascalCase(sourceBase)}(t *testing.T) {
    // TODO: Implement test
    if true != true {
        t.Fatal("placeholder test failed")
    }
}
`;
  }

  private generateJavaTestContent(sourceBase: string, _sourceFilePath: string): string {
    const className = this.pascalCase(sourceBase);

    return `// Test file for ${className}
// Generated by NeuroCLI Testing Integration

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ${className}Test {

    @Test
    void testPlaceholder() {
        // TODO: Implement test
        assertTrue(true);
    }
}
`;
  }

  private pascalCase(str: string): string {
    return str
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  private walkDir(dir: string, callback: (filePath: string) => void): void {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip common non-source directories
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '__pycache__', 'target', '.next', 'vendor', '.venv', 'venv'].includes(entry.name)) {
          continue;
        }
        this.walkDir(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  }

  private execCommand(
    commandParts: string[],
    cwd: string,
    timeout: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = commandParts;

      try {
        const result = execSync(`${cmd} ${args.map(a => `"${a}"`).join(' ')}`, {
          cwd,
          timeout,
          encoding: 'utf-8',
          maxBuffer: 50 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        resolve({ stdout: result, stderr: '', exitCode: 0 });
      } catch (error: unknown) {
        const execError = error as Error & {
          stdout?: string | Buffer;
          stderr?: string | Buffer;
          status?: number;
        };

        if (execError.stdout || execError.stderr) {
          resolve({
            stdout: typeof execError.stdout === 'string' ? execError.stdout : (execError.stdout?.toString('utf-8') ?? ''),
            stderr: typeof execError.stderr === 'string' ? execError.stderr : (execError.stderr?.toString('utf-8') ?? ''),
            exitCode: execError.status ?? 1,
          });
        } else {
          reject(error);
        }
      }
    });
  }
}

// -----------------------------------------------------------
// Standalone helper functions
// -----------------------------------------------------------

/**
 * Parse a Jest error message to extract expected/actual values.
 */
function parseJestError(errorMsg: string): {
  message: string;
  expected?: string;
  actual?: string;
  line?: number;
} {
  const result: { message: string; expected?: string; actual?: string; line?: number } = {
    message: errorMsg.split('\n')[0],
  };

  // Try to extract expected/actual from Jest assertion errors
  const expectedMatch = errorMsg.match(/Expected:\s*(.+)/);
  const receivedMatch = errorMsg.match(/Received:\s*(.+)/);

  if (expectedMatch) result.expected = expectedMatch[1].trim();
  if (receivedMatch) result.actual = receivedMatch[1].trim();

  // Try to extract line number
  const lineMatch = errorMsg.match(/:(\d+):\d+/);
  if (lineMatch) result.line = parseInt(lineMatch[1], 10);

  return result;
}

/**
 * Parse Jest coverage map into a CoverageReport.
 */
function parseJestCoverage(
  coverageMap: Record<string, {
    statements: { covered: number; total: number };
    branches: { covered: number; total: number };
    functions: { covered: number; total: number };
    lines: { covered: number; total: number };
  }>,
  rootDir: string,
): CoverageReport {
  let totalStatements = 0;
  let coveredStatements = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  let totalLines = 0;
  let coveredLines = 0;

  const files: CoverageFile[] = [];

  for (const [filePath, coverage] of Object.entries(coverageMap)) {
    totalStatements += coverage.statements.total;
    coveredStatements += coverage.statements.covered;
    totalBranches += coverage.branches.total;
    coveredBranches += coverage.branches.covered;
    totalFunctions += coverage.functions.total;
    coveredFunctions += coverage.functions.covered;
    totalLines += coverage.lines.total;
    coveredLines += coverage.lines.covered;

    files.push({
      path: relative(rootDir, filePath),
      lines: coverage.lines.total > 0 ? (coverage.lines.covered / coverage.lines.total) * 100 : 100,
      branches: coverage.branches.total > 0 ? (coverage.branches.covered / coverage.branches.total) * 100 : 100,
      functions: coverage.functions.total > 0 ? (coverage.functions.covered / coverage.functions.total) * 100 : 100,
      statements: coverage.statements.total > 0 ? (coverage.statements.covered / coverage.statements.total) * 100 : 100,
      uncoveredLines: [],
    });
  }

  return {
    lines: totalLines > 0 ? (coveredLines / totalLines) * 100 : 100,
    branches: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 100,
    functions: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 100,
    statements: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 100,
    files,
  };
}
