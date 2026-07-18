export interface TelemetryConfig {
    /** Whether telemetry is enabled (opt-in, default: false) */
    enabled: boolean;
    /** Storage directory for telemetry data */
    dataDir: string;
    /** Whether to include model performance metrics */
    trackModelPerformance: boolean;
    /** Whether to include tool usage stats */
    trackToolUsage: boolean;
    /** Whether to include session metrics */
    trackSessionMetrics: boolean;
    /** Retention period in days (default: 90) */
    retentionDays: number;
    /** Anonymous session ID hash (no PII) */
    anonymousId: string;
}
export interface SessionMetric {
    sessionId: string;
    duration: number;
    messageCount: number;
    modelUsed: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    toolsCalled: number;
    timestamp: number;
}
export interface ToolUsageMetric {
    toolName: string;
    callCount: number;
    successCount: number;
    errorCount: number;
    avgDurationMs: number;
    lastUsed: number;
}
export interface ModelPerformanceMetric {
    model: string;
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    avgLatencyMs: number;
    errorCount: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
}
export interface TelemetryReport {
    generatedAt: number;
    period: {
        start: number;
        end: number;
    };
    totalSessions: number;
    totalMessages: number;
    totalTokens: {
        input: number;
        output: number;
    };
    totalCost: number;
    toolUsage: ToolUsageMetric[];
    modelPerformance: ModelPerformanceMetric[];
    sessionMetrics: SessionMetric[];
}
export declare class TelemetrySystem {
    private config;
    private sessionMetrics;
    private toolUsageMap;
    private modelPerformanceMap;
    private currentSessionStart;
    private currentSessionMessages;
    private currentSessionTools;
    private currentSessionModel;
    private currentSessionInputTokens;
    private currentSessionOutputTokens;
    private currentSessionCost;
    constructor(config?: Partial<TelemetryConfig>);
    /**
     * Check if telemetry is enabled
     */
    isEnabled(): boolean;
    /**
     * Enable telemetry (opt-in)
     */
    enable(): void;
    /**
     * Disable telemetry
     */
    disable(): void;
    /**
     * Toggle telemetry on/off
     */
    toggle(): boolean;
    /**
     * Record a session start
     */
    startSession(sessionId: string, model: string): void;
    /**
     * Record a message in the current session
     */
    recordMessage(): void;
    /**
     * Record a tool call
     */
    recordToolCall(toolName: string, durationMs: number, success: boolean): void;
    /**
     * Record model performance data
     */
    recordModelPerformance(model: string, inputTokens: number, outputTokens: number, cost: number, latencyMs: number, error: boolean): void;
    /**
     * End the current session and record its metrics
     */
    endSession(sessionId: string): void;
    /**
     * Get all tool usage metrics
     */
    getToolUsageMetrics(): ToolUsageMetric[];
    /**
     * Get model performance metrics
     */
    getModelPerformanceMetrics(): ModelPerformanceMetric[];
    /**
     * Get session metrics
     */
    getSessionMetrics(): SessionMetric[];
    /**
     * Generate a full telemetry report
     */
    generateReport(startTimestamp?: number, endTimestamp?: number): TelemetryReport;
    /**
     * Export telemetry data as JSON string
     */
    exportJSON(pretty?: boolean): string;
    /**
     * Export telemetry data to a file
     */
    exportToFile(filePath: string): void;
    /**
     * Print a summary of telemetry data
     */
    printSummary(): void;
    /**
     * Clear all telemetry data
     */
    clearData(): void;
    /**
     * Get current config
     */
    getConfig(): TelemetryConfig;
    private percentile;
    private ensureDataDir;
    private persistConfig;
    private persistData;
    private loadPersistedData;
    private cleanupOldData;
}
//# sourceMappingURL=telemetry.d.ts.map