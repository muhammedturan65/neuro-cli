/**
 * Extended Thinking System for NeuroCLI
 *
 * Handles thinking/reasoning blocks in AI responses, providing configurable
 * thinking modes, budget management, streaming support, and statistics tracking.
 */
export type ThinkingMode = 'none' | 'brief' | 'full' | 'ultrathink';
export interface ThinkingConfig {
    mode: ThinkingMode;
    maxThinkingTokens: number;
    showThinking: boolean;
    effortBudget: Record<ThinkingMode, number>;
}
export interface ThinkingBlock {
    content: string;
    tokenCount: number;
    duration?: number;
}
export interface ThinkingResult {
    thinkingBlocks: ThinkingBlock[];
    totalThinkingTokens: number;
    cleanedResponse: string;
    hadThinking: boolean;
}
export declare class ExtendedThinking {
    private config;
    private totalThinkingTokens;
    private thinkingHistory;
    static readonly DEFAULT_CONFIG: ThinkingConfig;
    constructor(config?: Partial<ThinkingConfig>);
    /**
     * Parse an AI response, extracting any <thinking> blocks and returning
     * the cleaned response text together with extracted thinking data.
     */
    parseResponse(response: string): ThinkingResult;
    /** Switch to a different thinking mode and update the token budget. */
    setMode(mode: ThinkingMode): void;
    /** Return the current thinking mode. */
    getMode(): ThinkingMode;
    /** Toggle the display of thinking blocks. Returns the new state. */
    toggleDisplay(): boolean;
    /** Whether thinking blocks should be shown to the user. */
    isDisplayEnabled(): boolean;
    /** Return the token budget for the current mode. */
    getEffortBudget(): number;
    /**
     * Return a system-prompt fragment that instructs the model to use
     * <thinking> tags for its internal reasoning process, scoped to the
     * current mode and token budget.
     */
    getSystemPromptAddition(): string;
    /** Return aggregate statistics across all parsed responses. */
    getStats(): {
        totalThinkingTokens: number;
        totalBlocks: number;
        avgBlockLength: number;
    };
    /** Reset accumulated statistics and history. */
    resetStats(): void;
    /**
     * Check whether a partial streaming buffer currently contains an open
     * thinking tag that has not yet been closed. Useful for deciding whether
     * incoming tokens belong to a thinking region.
     */
    static isInThinkingBlock(buffer: string): boolean;
    /**
     * Attempt to extract any complete thinking blocks from a streaming buffer
     * without mutating it. Returns completed blocks and leaves partial blocks
     * untouched (they remain in the buffer for subsequent chunks).
     */
    static extractStreamingBlocks(buffer: string): {
        completedBlocks: ThinkingBlock[];
        remaining: string;
    };
    /**
     * Extract all <thinking>...</thinking> blocks from a complete response
     * string, returning the parsed blocks and the cleaned response with the
     * thinking tags removed.
     */
    private extractThinkingBlocks;
    /** Estimate the number of tokens in a piece of text. */
    private estimateTokens;
    /** Static version for use without an instance. */
    private static estimateTokensStatic;
    /**
     * Serialize the display preference and mode so it can be persisted
     * (e.g. to a config file or localStorage).
     */
    serializePreferences(): {
        mode: ThinkingMode;
        showThinking: boolean;
    };
    /**
     * Restore a previously serialized preference. Only mode and display
     * toggle are restored; statistics remain untouched.
     */
    restorePreferences(prefs: {
        mode?: ThinkingMode;
        showThinking?: boolean;
    }): void;
}
export default ExtendedThinking;
//# sourceMappingURL=extended-thinking.d.ts.map