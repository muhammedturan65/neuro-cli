import { Message } from './types.js';
import { ContextCompactor } from '../context/compaction.js';
export interface AutoCompactConfig {
    enabled: boolean;
    warningThreshold: number;
    compactThreshold: number;
    emergencyThreshold: number;
    preserveRecentCount: number;
    preserveSystemPrompt: boolean;
    compactStrategy: 'summarize' | 'drop-oldest' | 'hybrid';
    tokenBudget: {
        systemPrompt: number;
        conversation: number;
        tools: number;
        output: number;
    };
}
export interface ContextUsage {
    totalTokens: number;
    maxTokens: number;
    usagePercent: number;
    breakdown: {
        systemPrompt: number;
        conversation: number;
        tools: number;
        available: number;
    };
    level: 'normal' | 'warning' | 'compact' | 'emergency';
}
export interface AutoCompactResult {
    messages: Message[];
    usage: ContextUsage;
    strategy: AutoCompactConfig['compactStrategy'];
    tokensSaved: number;
    level: ContextUsage['level'];
}
export declare const DEFAULT_AUTO_COMPACT_CONFIG: AutoCompactConfig;
export declare class AutoCompactManager {
    private config;
    private currentModelId;
    private contextManager;
    private compactor;
    private warningCallbacks;
    private compactCallbacks;
    private emergencyCallbacks;
    private lastLevel;
    constructor(config?: Partial<AutoCompactConfig>);
    /**
     * Update the current model and recalculate model-aware thresholds.
     * Rebuilds ContextManager and ContextCompactor for the new model.
     */
    setModel(modelId: string): void;
    /**
     * Set the ContextCompactor for LLM-backed summarization.
     * This is optional — without it, auto-compact uses local strategies only.
     */
    setCompactor(compactor: ContextCompactor): void;
    /**
     * Compute detailed context usage breakdown for the given messages and model.
     */
    getContextUsage(messages: Message[], modelId: string): ContextUsage;
    /**
     * Determine whether compaction is needed and at what level.
     * Fires callbacks when the level transitions.
     */
    shouldCompact(messages: Message[], modelId: string): {
        needed: boolean;
        level: ContextUsage['level'];
    };
    /**
     * Compact messages according to the configured or specified strategy.
     * Returns the compacted message list along with usage metrics.
     */
    compact(messages: Message[], strategy?: AutoCompactConfig['compactStrategy']): Promise<Message[]>;
    /**
     * Strategy: Summarize older messages into a single context message.
     * Keeps last N messages verbatim, summarizes everything else.
     */
    private compactBySummarize;
    /**
     * Strategy: Drop oldest messages (except system prompt and recent).
     */
    private compactByDropOldest;
    /**
     * Strategy: Hybrid — summarize first, then drop oldest if still over budget.
     */
    private compactByHybrid;
    /**
     * Emergency compaction: keep only system prompt + last 3 exchanges (6 messages).
     * This is the last resort when everything else fails.
     */
    private emergencyDrop;
    /**
     * Estimate the number of tokens in a text string for a given model.
     * Uses ~4 chars/token for English, ~2 chars/token for CJK.
     */
    estimateTokens(text: string, _modelId?: string): number;
    /**
     * Estimate total tokens across an array of messages,
     * including tool calls.
     */
    estimateMessagesTokens(messages: Message[]): number;
    /**
     * Estimate tokens for a single message including tool calls.
     */
    private estimateMessageTokens;
    onWarning(callback: (usage: ContextUsage) => void): void;
    onCompact(callback: (usage: ContextUsage, result: Message[]) => void): void;
    onEmergency(callback: (usage: ContextUsage) => void): void;
    /**
     * Partition messages into system and non-system buckets.
     */
    private partitionMessages;
    /**
     * Build a concise summary from a list of messages.
     * Prioritizes user intent, tool interactions, and assistant decisions.
     */
    private buildSummary;
}
/**
 * Middleware function that can be called before each LLM call.
 * Checks context usage, auto-compacts if needed, and returns
 * the (possibly compacted) message list.
 */
export declare function autoCompactMiddleware(manager: AutoCompactManager, messages: Message[], modelId: string): Promise<Message[]>;
export declare function createAutoCompactManager(overrides?: Partial<AutoCompactConfig>): AutoCompactManager;
//# sourceMappingURL=auto-compact.d.ts.map