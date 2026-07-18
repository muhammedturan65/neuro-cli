export interface SmartMonitorConfig {
    enabled: boolean;
    /** Cheap model used for monitoring evaluations (default: gemma-4-31b) */
    evaluatorModel: string;
    riskThresholds: {
        /** Risk score below this → auto-approve (default: 30) */
        autoApprove: number;
        /** Risk score above this → ask user (default: 70) */
        askUser: number;
    };
    learning: {
        enabled: boolean;
        /** Directory where learned patterns are stored */
        storagePath: string;
        /** Minimum number of similar approvals before learning kicks in */
        minSamples: number;
    };
    escalationRules: EscalationRule[];
    contextAwareness: {
        checkGitStatus: boolean;
        checkTestCoverage: boolean;
        checkProductionFiles: boolean;
        /** Paths that are always treated as protected / high-risk */
        protectedPaths: string[];
    };
}
export interface ActionRisk {
    /** Aggregate risk score 0-100 */
    score: number;
    /** Individual contributing factors */
    factors: RiskFactor[];
    /** The monitor's recommendation */
    recommendation: 'approve' | 'deny' | 'modify' | 'ask-user';
    /** Human-readable explanation */
    reasoning: string;
}
export interface RiskFactor {
    name: string;
    /** 0-100 contribution to the overall risk score */
    contribution: number;
    description: string;
}
export interface EscalationRule {
    /** JS-style condition expression, e.g. "file matches src/production/**" */
    condition: string;
    action: 'ask-user' | 'deny';
    reason: string;
}
export interface MonitorDecision {
    action: 'approve' | 'deny' | 'modify' | 'ask-user';
    confidence: number;
    riskScore: number;
    reasoning: string;
    /** Populated only when action is 'modify' */
    modifiedArgs?: Record<string, unknown>;
    /** Populated only when action is 'ask-user' */
    userQuestion?: string;
    /** Whether this decision was derived from learned patterns */
    learned: boolean;
}
export interface MonitorStats {
    totalEvaluations: number;
    approvals: number;
    denials: number;
    modifications: number;
    escalations: number;
    approvalRate: number;
    avgRiskScore: number;
    avgEvaluationTimeMs: number;
    learnedDecisions: number;
    cacheHitRate: number;
}
export interface ActionContext {
    /** Current working directory */
    workingDirectory: string;
    /** Files that have been modified in the current session */
    modifiedFiles: string[];
    /** Total cost accrued so far in USD */
    currentCost: number;
    /** Spending limit in USD (0 = unlimited) */
    spendingLimit: number;
    /** Current safety level from auto mode */
    safetyLevel: 'conservative' | 'moderate' | 'aggressive';
    /** Recent tool call history (tool name + brief) */
    recentHistory: Array<{
        toolName: string;
        brief: string;
    }>;
    /** Whether there are uncommitted git changes */
    hasUncommittedChanges: boolean;
    /** Optional project-level context from NEURO.md */
    neuroMdContent?: string;
}
export interface LearnedPattern {
    /** Normalised key used for matching, e.g. "write_file:*.ts" */
    pattern: string;
    /** Number of times the user approved this pattern */
    approvals: number;
    /** Number of times the user denied this pattern */
    denials: number;
    /** Last seen timestamp (ms epoch) */
    lastSeen: number;
    /** Whether the pattern currently qualifies for auto-approve */
    active: boolean;
}
export declare class SmartMonitor {
    private config;
    private apiClient;
    private patterns;
    private evaluationCache;
    private stats;
    constructor(config: Partial<SmartMonitorConfig>, apiClient: any);
    evaluate(toolName: string, args: Record<string, unknown>, context: ActionContext): Promise<MonitorDecision>;
    assessRisk(toolName: string, args: Record<string, unknown>, context: ActionContext): Promise<ActionRisk>;
    private evaluateWithLLM;
    private callEvaluatorModel;
    private parseLLMResponse;
    private estimateCost;
    recordDecision(toolName: string, args: Record<string, unknown>, decision: MonitorDecision, userOverride?: boolean): void;
    getLearnedPatterns(): LearnedPattern[];
    resetLearning(): void;
    private checkLearnedPatterns;
    private loadPatterns;
    private persistPatterns;
    updateThresholds(thresholds: Partial<SmartMonitorConfig['riskThresholds']>): void;
    addEscalationRule(rule: EscalationRule): void;
    removeEscalationRule(condition: string): void;
    getConfig(): Readonly<SmartMonitorConfig>;
    setEnabled(enabled: boolean): void;
    isEnabled(): boolean;
    setEvaluatorModel(model: string): void;
    addProtectedPath(pathPattern: string): void;
    removeProtectedPath(pathPattern: string): void;
    getStats(): MonitorStats;
    resetStats(): void;
    gatherContext(workingDirectory: string, currentCost: number, spendingLimit: number): ActionContext;
    private adjustForSafetyLevel;
    private scoreToConfidence;
    private computeCacheKey;
    private cacheDecision;
    private sanitizeArgsForPrompt;
    private freshStats;
}
export declare function createSmartMonitor(config?: Partial<SmartMonitorConfig>, apiClient?: any): SmartMonitor;
export declare function defaultSmartMonitorConfig(): SmartMonitorConfig;
//# sourceMappingURL=smart-monitor.d.ts.map