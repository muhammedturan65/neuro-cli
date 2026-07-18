export interface ReviewComment {
    id: string;
    file: string;
    line: number;
    severity: 'critical' | 'major' | 'minor' | 'suggestion' | 'info';
    category: string;
    message: string;
    suggestion?: string;
    rule?: string;
}
export interface ReviewReport {
    id: string;
    timestamp: number;
    files: string[];
    comments: ReviewComment[];
    summary: ReviewSummary;
    score: number;
}
export interface ReviewSummary {
    totalComments: number;
    critical: number;
    major: number;
    minor: number;
    suggestions: number;
    categories: Record<string, number>;
}
export interface CodeReviewConfig {
    enabled: boolean;
    autoReviewOnChange: boolean;
    focusAreas: string[];
    severityThreshold: 'critical' | 'major' | 'minor';
    excludePatterns: string[];
}
type ReviewFocusArea = 'security' | 'performance' | 'style' | 'correctness' | 'best-practices' | 'dead-code' | 'complexity';
type ReviewCallback = (report: ReviewReport) => void;
export declare class CodeReviewSystem {
    private config;
    private projectRoot;
    private comments;
    private reports;
    private callbacks;
    private focusAreas;
    private commentCounter;
    constructor(projectRoot?: string, config?: Partial<CodeReviewConfig>);
    /**
     * Review a single file for issues.
     * Returns a ReviewReport with all detected comments and a quality score.
     */
    reviewFile(filePath: string): Promise<ReviewReport>;
    /**
     * Review all uncommitted changes (or changes vs. a base branch).
     */
    reviewChanges(baseBranch?: string): Promise<ReviewReport>;
    /**
     * Review a diff string for issues.
     * Only analyzes the new/changed lines in the diff.
     */
    reviewDiff(diff: string): Promise<ReviewReport>;
    /**
     * Review a GitHub PR by URL.
     * Fetches the diff and reviews it.
     */
    reviewPR(prUrl: string): Promise<ReviewReport>;
    /**
     * Get review comments for a specific file.
     */
    getReviewComments(filePath?: string): ReviewComment[];
    /**
     * Filter comments by severity level.
     * Returns comments at or above the given severity threshold.
     */
    severityFilter(severity: ReviewComment['severity']): ReviewComment[];
    /**
     * Generate a full review report covering all tracked comments.
     */
    generateReport(): ReviewReport;
    /**
     * Set review focus areas. Only patterns in these categories will be evaluated.
     */
    setFocus(areas: ReviewFocusArea[]): void;
    /**
     * Register a callback for review reports.
     */
    onReviewResult(callback: ReviewCallback): void;
    /**
     * Remove a previously registered callback.
     */
    offReviewResult(callback: ReviewCallback): void;
    /**
     * Get the current review configuration.
     */
    getConfig(): CodeReviewConfig;
    /**
     * Update the review configuration.
     */
    updateConfig(updates: Partial<CodeReviewConfig>): void;
    /**
     * Clear all stored comments.
     */
    clearComments(): void;
    /**
     * Get all historical reports.
     */
    getReports(): ReviewReport[];
    /**
     * Print a review report summary.
     */
    printSummary(report: ReviewReport): void;
    private analyzeFile;
    private runPatterns;
    private analyzeComplexity;
    private buildReport;
    /**
     * Calculate a code quality score from 0 to 100.
     * Start at 100 and deduct points based on issue severity.
     */
    private calculateScore;
    private emptyReport;
    private emit;
    private isExcluded;
    private globToRegex;
    /**
     * Get changed files from git (uncommitted or vs. a base branch).
     */
    private getChangedFiles;
    /**
     * Parse a unified diff into a map of file paths to changed line numbers.
     */
    private parseDiff;
}
export {};
//# sourceMappingURL=code-review.d.ts.map