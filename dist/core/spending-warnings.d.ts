export interface SpendingConfig {
    dailyLimit: number;
    sessionLimit: number;
    warnAtPercent: number[];
    autoStopAtLimit: boolean;
    trackByModel: boolean;
}
export interface SpendingEntry {
    timestamp: number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    sessionId: string;
}
export interface SpendingReport {
    todayTotal: number;
    todayByModel: Record<string, number>;
    sessionTotal: number;
    sessionByModel: Record<string, number>;
    dailyLimit: number;
    sessionLimit: number;
    dailyPercentUsed: number;
    sessionPercentUsed: number;
    estimatedDailySpend: number;
    entries: number;
}
export declare class SpendingMonitor {
    private config;
    private sessionEntries;
    private todayEntries;
    private warnedThresholds;
    private dataPath;
    private sessionStartTime;
    constructor(config?: Partial<SpendingConfig>);
    /**
     * Record a spending entry. Returns whether the spend is allowed
     * and optional warning / limit-reached information.
     */
    record(entry: Omit<SpendingEntry, 'timestamp'>): {
        allowed: boolean;
        warning?: string;
        limitReached?: 'daily' | 'session';
    };
    /**
     * Check whether spending is within limits without recording anything.
     */
    checkLimit(): {
        allowed: boolean;
        remaining: {
            daily: number;
            session: number;
        };
        limitReached?: 'daily' | 'session';
    };
    /**
     * Build a full spending report.
     */
    getReport(): SpendingReport;
    /**
     * Print a formatted spending report to the terminal.
     */
    printReport(): void;
    /**
     * Reset session-level tracking (e.g. on new conversation).
     */
    resetSession(): void;
    /**
     * Reset daily tracking. Called automatically at midnight.
     */
    resetDaily(): void;
    /**
     * Whether the daily spending limit has been reached.
     */
    isDailyLimitReached(): boolean;
    /**
     * Whether the session spending limit has been reached.
     */
    isSessionLimitReached(): boolean;
    /**
     * Current spending rate in USD per hour, estimated from the current session.
     */
    getSpendingRate(): number;
    /**
     * Export the full history of today's spending entries.
     */
    exportHistory(): SpendingEntry[];
    /**
     * Sum the cost of an array of entries.
     */
    private sumCost;
    /**
     * Sum costs grouped by model name.
     */
    private sumByModel;
    /**
     * Estimate total daily spend by extrapolating the current session rate
     * over the remaining portion of the day.
     */
    private estimateDailySpend;
    /**
     * Check whether a warning should be emitted for the current usage percent.
     * Returns the warning message or undefined.
     */
    private checkWarnings;
    /**
     * Load today's spending data from disk.
     */
    private loadTodayData;
    /**
     * Persist today's spending data to disk.
     */
    private saveTodayData;
    /**
     * Schedule an automatic reset at the next midnight.
     */
    private scheduleDailyReset;
    /**
     * Remove spending data files older than 30 days to avoid unbounded disk use.
     */
    private cleanupOldFiles;
}
//# sourceMappingURL=spending-warnings.d.ts.map