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
type TestResultCallback = (result: TestResult) => void;
export declare class TestingIntegration {
    private config;
    private projectRoot;
    private detectedFramework;
    private frameworkDetected;
    private cachedResults;
    private callbacks;
    private watchProcess;
    constructor(projectRoot?: string, config?: Partial<TestingConfig>);
    /**
     * Run tests with auto-detection of the test framework.
     * Optionally target a specific test path or pass run options.
     */
    runTests(testPath?: string, options?: TestRunOptions): Promise<TestResult>;
    /**
     * Detect which test framework is configured in the project.
     * Returns the name of the detected framework, or null if none found.
     */
    detectTestFramework(projectRoot?: string): string | null;
    /**
     * Run tests related to a changed file.
     * Attempts to find and run only the test files that cover the changed source.
     */
    runRelatedTests(filePath: string): Promise<TestResult>;
    /**
     * Get test coverage report.
     */
    getCoverage(options?: TestRunOptions): Promise<TestResult>;
    /**
     * Start watch mode for continuous testing.
     * Returns a function that stops the watcher when called.
     */
    watchTests(testPath?: string): Promise<() => void>;
    /**
     * Generate a test file for a source file based on conventions.
     * Returns the path of the generated test file, or null if generation failed.
     */
    generateTest(filePath: string): Promise<string | null>;
    /**
     * Register a callback for test results.
     */
    onTestResult(callback: TestResultCallback): void;
    /**
     * Remove a previously registered callback.
     */
    offTestResult(callback: TestResultCallback): void;
    /**
     * Get the current testing configuration.
     */
    getConfig(): TestingConfig;
    /**
     * Update the testing configuration.
     */
    updateConfig(updates: Partial<TestingConfig>): void;
    /**
     * Get the last cached test result.
     */
    getLastResult(): TestResult | null;
    /**
     * Get the name of the detected test framework.
     */
    getDetectedFramework(): string | null;
    /**
     * Determine the language of a file based on its extension.
     */
    getLanguageForFile(filePath: string): string | null;
    /**
     * Check if a file is a test file based on naming conventions.
     */
    isTestFile(filePath: string): boolean;
    /**
     * Find all test files in the project.
     */
    findTestFiles(directory?: string): string[];
    /**
     * Print a summary of test results.
     */
    printSummary(result: TestResult): void;
    private ensureDetected;
    private emit;
    private emptyResult;
    private stopWatcher;
    private findRelatedTestFiles;
    private findRelatedTestFilePaths;
    private generateTestContent;
    private generateJSTestContent;
    private generatePythonTestContent;
    private generateGoTestContent;
    private generateJavaTestContent;
    private pascalCase;
    private walkDir;
    private execCommand;
}
export {};
//# sourceMappingURL=testing.d.ts.map