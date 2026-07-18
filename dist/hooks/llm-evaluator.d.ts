import { OpenRouterClient } from '../api/openrouter.js';
import { FileChange } from '../core/types.js';
import { HookEvent } from './hooks.js';
/** A hook backed by an LLM evaluator instead of a shell command. */
export interface LLMEvaluatorHook {
    /** Unique identifier for this evaluator. */
    id: string;
    /** Human-readable name. */
    name: string;
    /** Lifecycle event this evaluator subscribes to. */
    event: HookEvent;
    /** Model identifier used for evaluation (e.g. "google/gemma-4-31b-it:free"). */
    evaluatorModel: string;
    /** Evaluation criteria / instructions for the LLM. */
    rubric: string;
    /** Default action when the evaluator is undecided. */
    action: 'approve' | 'deny' | 'modify' | 'ask-user';
    /** Maximum tokens the evaluator may generate. */
    maxTokens: number;
    /** Sampling temperature for the evaluator. */
    temperature: number;
    /** Whether to cache evaluation decisions. */
    cacheDecisions: boolean;
    /** Time-to-live for cached decisions in seconds. */
    cacheTTL: number;
    /** Optional glob-style matcher to filter by tool name. */
    matcher?: string;
    /** Whether this evaluator is enabled. */
    enabled?: boolean;
    /** Optional provider override ("openrouter" | "ollama"). */
    provider?: 'openrouter' | 'ollama';
    /** Ollama base URL (only used when provider is "ollama"). */
    ollamaBaseUrl?: string;
}
/** Context passed to an evaluator describing the pending action. */
export interface EvaluationContext {
    /** Name of the tool about to be (or having been) called. */
    toolName: string;
    /** Arguments that will be passed to the tool. */
    toolArgs: Record<string, any>;
    /** File changes that the tool would cause (if known). */
    fileChanges?: FileChange[];
    /** Output from the tool (only available in post-tool hooks). */
    commandOutput?: string;
    /** Recent conversation messages for situational awareness. */
    conversationContext?: string;
    /** Contents of NEURO.md for project-level context. */
    projectContext?: string;
}
/** Result returned by an LLM evaluator. */
export interface EvaluationResult {
    /** The evaluator's decision. */
    decision: 'approve' | 'deny' | 'modify' | 'ask-user';
    /** Confidence level between 0 and 1. */
    confidence: number;
    /** Free-text reasoning from the evaluator. */
    reasoning: string;
    /** Suggested modified tool arguments (only when decision is "modify"). */
    suggestedModification?: Record<string, any>;
    /** Question to surface to the user (only when decision is "ask-user"). */
    userQuestion?: string;
    /** Whether this result was served from cache. */
    cached: boolean;
    /** The model that was actually used for the evaluation. */
    modelUsed: string;
    /** Number of tokens consumed by the evaluation call. */
    tokensUsed: number;
    /** Wall-clock duration of the evaluation in milliseconds. */
    duration: number;
}
/** Aggregate statistics about evaluator usage. */
export interface EvaluatorStats {
    totalEvaluations: number;
    totalTokensUsed: number;
    totalCost: number;
    cacheHits: number;
    cacheMisses: number;
    decisions: Record<'approve' | 'deny' | 'modify' | 'ask-user', number>;
    byEvaluator: Record<string, {
        evaluations: number;
        tokensUsed: number;
        cost: number;
    }>;
}
/** Configuration for the LLMEvaluatorManager. */
export interface EvaluatorConfig {
    /** Default model when none is specified on a hook. */
    defaultModel?: string;
    /** Default rubric when none is specified. */
    defaultRubric?: string;
    /** Confidence threshold below which decisions escalate to "ask-user". */
    confidenceThreshold?: number;
    /** Global toggle for caching. */
    cacheEnabled?: boolean;
    /** Default cache TTL in seconds. */
    defaultCacheTTL?: number;
    /** Maximum number of cache entries. */
    maxCacheEntries?: number;
    /** Ollama base URL for local evaluation models. */
    ollamaBaseUrl?: string;
}
export declare class LLMEvaluatorManager {
    private apiClient;
    private evaluators;
    private eventIndex;
    private cache;
    private stats;
    private readonly defaultModel;
    private readonly defaultRubric;
    private readonly confidenceThreshold;
    private readonly cacheEnabled;
    private readonly defaultCacheTTL;
    private readonly maxCacheEntries;
    private readonly ollamaBaseUrl;
    constructor(apiClient: OpenRouterClient, config?: EvaluatorConfig);
    /** Register a new LLM evaluator hook. */
    registerEvaluator(hook: LLMEvaluatorHook): void;
    /** Remove a registered evaluator by its id. */
    unregisterEvaluator(id: string): void;
    /** Return all registered evaluators. */
    listEvaluators(): LLMEvaluatorHook[];
    /**
     * Run all evaluators registered for `event` against the given `context`.
     * Evaluators are executed sequentially in registration order.
     * The first "deny" short-circuits; "modify" updates the context for
     * subsequent evaluators; "ask-user" is collected and returned.
     */
    evaluate(event: HookEvent, context: EvaluationContext): Promise<EvaluationResult>;
    private evaluateSingle;
    private parseEvaluationResponse;
    private getFromCache;
    private storeInCache;
    /** Remove all cached decisions. */
    clearCache(): void;
    /**
     * Scan `dir/.neuro/hooks/` for YAML files with frontmatter and register
     * them as evaluators.
     *
     * Expected file format:
     * ```
     * ---
     * id: my-evaluator
     * name: My Safety Evaluator
     * event: BeforeTool
     * evaluatorModel: google/gemma-4-31b-it:free
     * action: deny
     * maxTokens: 256
     * temperature: 0.1
     * cacheDecisions: true
     * cacheTTL: 300
     * matcher: "write|delete|exec"
     * provider: openrouter
     * ---
     * Never allow modifications to .env files or deletion of test files.
     * ```
     *
     * The body (after frontmatter) becomes the rubric.
     */
    loadFromConfig(dir: string): Promise<void>;
    /** Return a snapshot of aggregate evaluation statistics. */
    getStats(): EvaluatorStats;
    /** Rough token estimator when exact counts are unavailable. */
    private estimateTokens;
}
//# sourceMappingURL=llm-evaluator.d.ts.map