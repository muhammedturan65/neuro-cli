export type Complexity = 'simple' | 'moderate' | 'complex';
export type EffortLevel = 'low' | 'medium' | 'high' | 'ultrathink';
export type TaskCategory = 'code' | 'reasoning' | 'creative' | 'analysis' | 'conversation' | 'debugging' | 'review' | 'refactoring';
export interface RoutingDecision {
    model: string;
    complexity: Complexity;
    category: TaskCategory;
    effort: EffortLevel;
    estimatedTokens: number;
    reasoning: string;
    alternatives: string[];
}
export interface RouterConfig {
    defaultModel: string;
    simpleModel: string;
    moderateModel: string;
    complexModel: string;
    effortModels: Record<EffortLevel, string>;
    categoryOverrides: Partial<Record<TaskCategory, string>>;
    maxTokenBudget: number;
}
export interface ModelInfo {
    name: string;
    contextWindow: number;
    maxOutput: number;
}
export declare class ModelRouter {
    private config;
    private availableModels;
    private currentEffort;
    private forcedModel;
    constructor(config: RouterConfig, availableModels: Record<string, ModelInfo>);
    /**
     * Route a prompt to the best available model.
     */
    route(prompt: string, effort?: EffortLevel): RoutingDecision;
    /**
     * Set the default effort level for subsequent routing calls.
     */
    setEffort(level: EffortLevel): void;
    /**
     * Get the current effort level.
     */
    getEffort(): EffortLevel;
    /**
     * Force all routing decisions to use a specific model.
     */
    overrideModel(modelId: string): void;
    /**
     * Remove any forced model override.
     */
    clearOverride(): void;
    /**
     * Classify the task category of a prompt.
     */
    getCategory(prompt: string): TaskCategory;
    /**
     * Classify the complexity of a prompt.
     */
    getComplexity(prompt: string): Complexity;
    /**
     * Estimate the number of tokens a prompt will consume.
     * Uses a character-based heuristic (~4 chars per token for English,
     * with adjustments for code-heavy content).
     */
    estimateTokens(prompt: string): number;
    /**
     * Print a human-readable routing decision to stdout.
     */
    printDecision(decision: RoutingDecision): void;
    private analyzePrompt;
    /**
     * Score each category based on how many pattern groups match.
     * Each group in CATEGORY_PATTERNS is worth 1 point when at least one
     * pattern in the group matches.
     */
    private scoreCategories;
    /**
     * Determine the winning category and record indicators.
     */
    private pickTopCategory;
    /**
     * Score complexity using a weighted combination of:
     *   1. Pattern match signals
     *   2. Prompt length
     *   3. Multi-step indicators
     */
    private scoreComplexity;
    /**
     * Count the approximate number of distinct steps or sub-tasks in a prompt.
     */
    private countSteps;
    /**
     * Extract a short snippet from the prompt that matched a pattern,
     * for use as a human-readable indicator.
     */
    private truncateMatch;
    private selectModel;
    /**
     * Return alternative models that could handle the same task but were not
     * selected as the primary choice.
     */
    private getAlternatives;
    private buildReasoning;
    private validateConfig;
}
export declare const DEFAULT_ROUTER_CONFIG: RouterConfig;
export declare const DEFAULT_AVAILABLE_MODELS: Record<string, ModelInfo>;
//# sourceMappingURL=model-router.d.ts.map