export interface LintIssue {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info';
    rule: string;
    message: string;
    fixable: boolean;
    source?: string;
}
export interface LintResult {
    success: boolean;
    issues: LintIssue[];
    fixed: number;
    totalFiles: number;
    duration: number;
    linter: string;
}
export interface LinterConfig {
    enabled: boolean;
    autoRunOnChange: boolean;
    autoFix: boolean;
    failOnError: boolean;
    timeout: number;
    excludePatterns: string[];
}
interface FormatterInfo {
    name: string;
    configFiles: string[];
    command: string[];
    extensions: string[];
}
type LintResultCallback = (result: LintResult) => void;
export declare class LintingIntegration {
    private config;
    private projectRoot;
    private detectedLinters;
    private detectedFormatter;
    private cachedIssues;
    private callbacks;
    private lintersDetected;
    constructor(projectRoot?: string, config?: Partial<LinterConfig>);
    /**
     * Run linter on a specific file or the entire project.
     * Returns a LintResult with all detected issues.
     */
    runLint(filePath?: string, fix?: boolean): Promise<LintResult>;
    /**
     * Detect which linters are configured in the project root.
     * Returns an array of detected linter names.
     */
    detectLinter(projectRoot?: string): string[];
    /**
     * Auto-fix linting issues for a specific file or the entire project.
     */
    fixIssues(filePath?: string): Promise<LintResult>;
    /**
     * Get all current lint issues, optionally filtered by file.
     * If no cached issues exist, runs the linter first.
     */
    getIssues(filePath?: string): Promise<LintIssue[]>;
    /**
     * Format a file using the project's configured formatter.
     * Returns true if formatting succeeded.
     */
    formatFile(filePath: string): Promise<boolean>;
    /**
     * Detect the configured formatter for the project.
     * Returns the FormatterInfo or null if none found.
     */
    detectFormatter(projectRoot?: string): FormatterInfo | null;
    /**
     * Register a callback for lint results.
     */
    onLintResult(callback: LintResultCallback): void;
    /**
     * Remove a previously registered callback.
     */
    offLintResult(callback: LintResultCallback): void;
    /**
     * Get the current linter configuration.
     */
    getConfig(): LinterConfig;
    /**
     * Update the linter configuration.
     */
    updateConfig(updates: Partial<LinterConfig>): void;
    /**
     * Clear the cached issues.
     */
    clearCache(): void;
    /**
     * Get the list of detected linter names.
     */
    getDetectedLinters(): string[];
    /**
     * Get the detected formatter name, or null.
     */
    getDetectedFormatter(): string | null;
    /**
     * Determine the primary language of a file based on its extension.
     */
    getLanguageForFile(filePath: string): string | null;
    /**
     * Check if a specific linter is available and configured.
     */
    isLinterAvailable(linterName: string): boolean;
    /**
     * Print a summary of lint results.
     */
    printSummary(result: LintResult): void;
    private ensureDetected;
    private emit;
    private emptyResult;
    private countLintedFiles;
    private filterExcludedIssues;
    private globToRegex;
    /**
     * Execute a command and return its output.
     * Rejects on spawn errors; resolves with stdout/stderr even on non-zero exit.
     */
    private execCommand;
    /**
     * Check if a command-line tool is available on the system PATH.
     */
    private isCommandAvailable;
}
export {};
//# sourceMappingURL=linting.d.ts.map