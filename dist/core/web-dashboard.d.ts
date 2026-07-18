export interface DashboardConfig {
    /** Host to bind to */
    host: string;
    /** Port for the dashboard server */
    port: number;
    /** Whether to auto-open browser */
    autoOpen: boolean;
    /** Refresh interval for real-time updates in ms */
    refreshInterval: number;
    /** Whether to enable the dashboard */
    enabled: boolean;
}
export interface DashboardData {
    sessions: SessionSummary[];
    tokenUsage: TokenUsageChart;
    modelPerformance: ModelPerfData[];
    spending: SpendingData;
    systemInfo: SystemInfoData;
}
export interface SessionSummary {
    id: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    model: string;
    totalCost: number;
    description?: string;
    tags: string[];
}
export interface TokenUsageChart {
    labels: string[];
    inputTokens: number[];
    outputTokens: number[];
    costs: number[];
}
export interface ModelPerfData {
    model: string;
    requestCount: number;
    totalTokens: number;
    totalCost: number;
    avgLatencyMs: number;
}
export interface SpendingData {
    todayTotal: number;
    todayByModel: Record<string, number>;
    sessionTotal: number;
    sessionByModel: Record<string, number>;
    dailyLimit: number;
    estimatedDailySpend: number;
}
export interface SystemInfoData {
    version: string;
    uptime: number;
    platform: string;
    nodeVersion: string;
    modelsAvailable: number;
    toolsAvailable: number;
    agentsAvailable: number;
    currentModel: string;
}
export declare class WebDashboard {
    private config;
    private server;
    private isRunning;
    private startTime;
    private engineRef;
    constructor(config?: Partial<DashboardConfig>);
    /**
     * Set the engine reference for fetching data
     */
    setEngine(engine: unknown): void;
    /**
     * Start the dashboard server
     */
    start(): Promise<void>;
    /**
     * Stop the dashboard server
     */
    stop(): Promise<void>;
    /**
     * Check if dashboard is running
     */
    getIsRunning(): boolean;
    /**
     * Get dashboard URL
     */
    getUrl(): string;
    /**
     * Gather dashboard data
     */
    gatherData(): DashboardData;
    /**
     * Get config
     */
    getConfig(): DashboardConfig;
    /**
     * Print dashboard status
     */
    printStatus(): void;
    private handleRequest;
    private getSessionSummaries;
    private getTokenUsageData;
    private getModelPerformanceData;
    private getSpendingData;
    private getSystemInfo;
    private saveConfig;
    private loadConfig;
}
//# sourceMappingURL=web-dashboard.d.ts.map