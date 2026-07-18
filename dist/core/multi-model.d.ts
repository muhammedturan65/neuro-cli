import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { ToolCall } from './types.js';
export interface ModelRole {
    name: string;
    model: string;
    fallbackModels: string[];
    maxTokensPerRequest: number;
    description: string;
}
export interface OrchestratorConfig {
    roles: {
        orchestrator: ModelRole;
        worker: ModelRole;
        evaluator: ModelRole;
        reviewer: ModelRole;
    };
    costBudget: {
        maxPerSession: number;
        maxPerTask: number;
        warnThreshold: number;
    };
    qualityGates: {
        enabled: boolean;
        evaluatorModel: string;
        minConfidence: number;
    };
    dynamicSwitching: boolean;
}
export interface TaskClassification {
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'critical';
    suggestedRole: string;
    suggestedModel: string;
    estimatedTokens: number;
    reasoning: string;
}
export interface ModelResponse {
    content: string;
    model: string;
    role: string;
    usage: TokenUsage;
    toolCalls: ToolCall[];
    confidence?: number;
    timestamp: number;
}
export interface OrchestrationResult {
    plan: ModelResponse;
    execution: ModelResponse;
    evaluation?: ModelResponse;
    review?: ModelResponse;
    totalCost: number;
    totalTokens: number;
    phases: OrchestrationPhase[];
    escalated: boolean;
    escalationReason?: string;
    success: boolean;
    timestamp: number;
}
export interface OrchestrationPhase {
    role: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    durationMs: number;
    success: boolean;
}
export interface CostBreakdown {
    total: number;
    byRole: Record<string, number>;
    byModel: Record<string, number>;
    perTask: CostTaskEntry[];
    sessionStart: number;
}
export interface CostTaskEntry {
    taskDescription: string;
    cost: number;
    role: string;
    model: string;
    timestamp: number;
}
export interface WorkerFailureRecord {
    model: string;
    timestamp: number;
    error: string;
}
export declare const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig;
export declare class MultiModelOrchestrator {
    private config;
    private client;
    private fallbackChain;
    private spendingMonitor;
    private roleCosts;
    private modelCosts;
    private taskCostEntries;
    private sessionTotalCost;
    private sessionTotalTokens;
    private sessionStartTime;
    private workerFailures;
    private workerUpgradeUntil;
    private effectiveModels;
    private budgetExceeded;
    constructor(config: OrchestratorConfig, apiClient: OpenRouterClient);
    /**
     * Classify a task by complexity and suggest the appropriate model role.
     * Uses a lightweight LLM call when possible; falls back to local heuristics.
     */
    classifyTask(prompt: string, context?: string): Promise<TaskClassification>;
    /**
     * Route a classification to the appropriate model ID.
     */
    routeToModel(classification: TaskClassification): string;
    /**
     * Full orchestration pipeline:
     *   orchestrator plans -> worker executes -> evaluator checks -> reviewer reviews
     *
     * Quality gates can re-route to orchestrator if evaluator confidence is low.
     */
    orchestrateAndExecute(prompt: string, context?: string): Promise<OrchestrationResult>;
    /**
     * Call the orchestrator model with a prompt.
     */
    callOrchestrator(prompt: string): Promise<ModelResponse>;
    /**
     * Call the worker model with a prompt.
     */
    callWorker(prompt: string): Promise<ModelResponse>;
    /**
     * Call the evaluator model with a prompt.
     */
    callEvaluator(prompt: string): Promise<ModelResponse>;
    /**
     * Call the reviewer model with a prompt.
     */
    callReviewer(prompt: string): Promise<ModelResponse>;
    /**
     * Get the full cost breakdown for this session.
     */
    getSessionCost(): CostBreakdown;
    /**
     * Get cost grouped by role.
     */
    getCostByRole(): Record<string, number>;
    /**
     * Check whether spending is within budget.
     */
    isWithinBudget(): boolean;
    /**
     * Update role configurations partially.
     */
    updateRoles(roles: Partial<OrchestratorConfig['roles']>): void;
    /**
     * Set a new cost budget.
     */
    setCostBudget(budget: OrchestratorConfig['costBudget']): void;
    /**
     * Get the currently effective model for a given role.
     * This may differ from the configured model during fallback scenarios.
     */
    getEffectiveModel(role: string): string;
    /**
     * Get the full orchestrator config.
     */
    getConfig(): OrchestratorConfig;
    /**
     * Reset session-level cost tracking and worker failure state.
     */
    resetSession(): void;
    /**
     * Call a model for a specific role, with fallback chain support.
     */
    private callRole;
    /**
     * Record a cost entry for a role/model combination.
     */
    private recordCost;
    /**
     * Parse the LLM classification response.
     */
    private parseClassificationResponse;
    /**
     * Local heuristic classification fallback.
     * Used when the LLM classification call fails or is unavailable.
     */
    private classifyTaskHeuristic;
    /**
     * Parse the evaluator's confidence response.
     */
    private parseEvaluationResponse;
    /**
     * Record a worker failure for dynamic switching.
     */
    private recordWorkerFailure;
    /**
     * Check if the worker is currently upgraded to the orchestrator model.
     */
    private isWorkerUpgraded;
    /**
     * Get the cheapest available model from the registry.
     * Used for classification calls to minimize cost.
     */
    private cheapestAvailableModel;
    /**
     * Get the ModelRole config for a given role name.
     */
    private getRoleByName;
    /**
     * Get a system prompt appropriate for a role.
     */
    private getSystemPromptForRole;
    /**
     * Get an appropriate temperature for a role.
     */
    private getTemperatureForRole;
    /**
     * Create an empty ModelResponse for error/budget-exceeded cases.
     */
    private emptyResponse;
    /**
     * Sum the cost of completed phases.
     */
    private sumPhaseCosts;
    /**
     * Sum the tokens of completed phases.
     */
    private sumPhaseTokens;
    /**
     * Rebuild the fallback chain when role configs change.
     */
    private rebuildFallbackChain;
}
/**
 * Create a MultiModelOrchestrator with sensible defaults for free models.
 */
export declare function createFreeOrchestrator(apiClient: OpenRouterClient): MultiModelOrchestrator;
/**
 * Create a MultiModelOrchestrator with premium models for maximum capability.
 */
export declare function createPremiumOrchestrator(apiClient: OpenRouterClient): MultiModelOrchestrator;
/**
 * Create a MultiModelOrchestrator with a balanced mix of free and premium models.
 */
export declare function createBalancedOrchestrator(apiClient: OpenRouterClient): MultiModelOrchestrator;
//# sourceMappingURL=multi-model.d.ts.map