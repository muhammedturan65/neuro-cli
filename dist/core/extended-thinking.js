/**
 * Extended Thinking System for NeuroCLI
 *
 * Handles thinking/reasoning blocks in AI responses, providing configurable
 * thinking modes, budget management, streaming support, and statistics tracking.
 */
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const THINKING_OPEN_TAG = '<thinking>';
const THINKING_CLOSE_TAG = '</thinking>';
const OPEN_TAG_LEN = THINKING_OPEN_TAG.length;
const CLOSE_TAG_LEN = THINKING_CLOSE_TAG.length;
// Rough heuristic: 1 token ~ 4 characters for English text
const CHARS_PER_TOKEN = 4;
// ---------------------------------------------------------------------------
// ExtendedThinking
// ---------------------------------------------------------------------------
export class ExtendedThinking {
    config;
    totalThinkingTokens;
    thinkingHistory;
    static DEFAULT_CONFIG = {
        mode: 'none',
        maxThinkingTokens: 0,
        showThinking: false,
        effortBudget: {
            none: 0,
            brief: 1000,
            full: 4000,
            ultrathink: 16000,
        },
    };
    constructor(config) {
        this.config = {
            ...ExtendedThinking.DEFAULT_CONFIG,
            ...config,
            effortBudget: {
                ...ExtendedThinking.DEFAULT_CONFIG.effortBudget,
                ...(config?.effortBudget ?? {}),
            },
        };
        // Sync maxThinkingTokens with the budget for the chosen mode
        this.config.maxThinkingTokens = this.config.effortBudget[this.config.mode];
        this.totalThinkingTokens = 0;
        this.thinkingHistory = [];
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Parse an AI response, extracting any <thinking> blocks and returning
     * the cleaned response text together with extracted thinking data.
     */
    parseResponse(response) {
        const { blocks, cleaned } = this.extractThinkingBlocks(response);
        const blockTokenTotal = blocks.reduce((sum, block) => sum + block.tokenCount, 0);
        // Accumulate history and stats
        for (const block of blocks) {
            this.thinkingHistory.push(block);
            this.totalThinkingTokens += block.tokenCount;
        }
        return {
            thinkingBlocks: blocks,
            totalThinkingTokens: blockTokenTotal,
            cleanedResponse: cleaned,
            hadThinking: blocks.length > 0,
        };
    }
    /** Switch to a different thinking mode and update the token budget. */
    setMode(mode) {
        this.config.mode = mode;
        this.config.maxThinkingTokens = this.config.effortBudget[mode];
    }
    /** Return the current thinking mode. */
    getMode() {
        return this.config.mode;
    }
    /** Toggle the display of thinking blocks. Returns the new state. */
    toggleDisplay() {
        this.config.showThinking = !this.config.showThinking;
        return this.config.showThinking;
    }
    /** Whether thinking blocks should be shown to the user. */
    isDisplayEnabled() {
        return this.config.showThinking;
    }
    /** Return the token budget for the current mode. */
    getEffortBudget() {
        return this.config.effortBudget[this.config.mode];
    }
    /**
     * Return a system-prompt fragment that instructs the model to use
     * <thinking> tags for its internal reasoning process, scoped to the
     * current mode and token budget.
     */
    getSystemPromptAddition() {
        if (this.config.mode === 'none') {
            return '';
        }
        const budget = this.config.effortBudget[this.config.mode];
        const modeDescriptions = {
            none: '',
            brief: 'Provide condensed, focused reasoning highlighting only the key decision points.',
            full: 'Provide thorough, step-by-step reasoning that walks through your entire thought process.',
            ultrathink: 'Provide exhaustive, maximum-depth reasoning. Explore every angle, consider alternatives, verify logic at each step, and leave no stone unturned. This is the highest reasoning effort mode.',
        };
        const description = modeDescriptions[this.config.mode];
        return [
            'You have an extended thinking capability. When you need to reason through a problem, enclose your reasoning inside <thinking>...</thinking> tags.',
            `Current thinking mode: ${this.config.mode}.`,
            `Maximum thinking token budget: ${budget} tokens.`,
            description,
            'Place your thinking blocks BEFORE the visible response content. You may include multiple thinking blocks if needed, but stay within the token budget.',
            'Do NOT include <thinking> tags in the final visible output -- they are only for internal reasoning.',
        ].join('\n');
    }
    /** Return aggregate statistics across all parsed responses. */
    getStats() {
        const totalBlocks = this.thinkingHistory.length;
        return {
            totalThinkingTokens: this.totalThinkingTokens,
            totalBlocks,
            avgBlockLength: totalBlocks > 0
                ? Math.round(this.totalThinkingTokens / totalBlocks)
                : 0,
        };
    }
    /** Reset accumulated statistics and history. */
    resetStats() {
        this.totalThinkingTokens = 0;
        this.thinkingHistory = [];
    }
    // -------------------------------------------------------------------------
    // Streaming helpers (static utilities for use during streaming)
    // -------------------------------------------------------------------------
    /**
     * Check whether a partial streaming buffer currently contains an open
     * thinking tag that has not yet been closed. Useful for deciding whether
     * incoming tokens belong to a thinking region.
     */
    static isInThinkingBlock(buffer) {
        const lastOpen = buffer.lastIndexOf(THINKING_OPEN_TAG);
        if (lastOpen === -1)
            return false;
        const lastClose = buffer.lastIndexOf(THINKING_CLOSE_TAG);
        return lastClose < lastOpen;
    }
    /**
     * Attempt to extract any complete thinking blocks from a streaming buffer
     * without mutating it. Returns completed blocks and leaves partial blocks
     * untouched (they remain in the buffer for subsequent chunks).
     */
    static extractStreamingBlocks(buffer) {
        const completedBlocks = [];
        let remaining = buffer;
        let searchStart = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const openIdx = remaining.indexOf(THINKING_OPEN_TAG, searchStart);
            if (openIdx === -1)
                break;
            const closeIdx = remaining.indexOf(THINKING_CLOSE_TAG, openIdx + OPEN_TAG_LEN);
            if (closeIdx === -1) {
                // Partial block -- still streaming; leave it in remaining
                break;
            }
            const content = remaining.slice(openIdx + OPEN_TAG_LEN, closeIdx).trim();
            completedBlocks.push({
                content,
                tokenCount: ExtendedThinking.estimateTokensStatic(content),
            });
            // Remove the parsed block from remaining
            const before = remaining.slice(0, openIdx);
            const after = remaining.slice(closeIdx + CLOSE_TAG_LEN);
            remaining = before + after;
            searchStart = before.length;
        }
        return { completedBlocks, remaining };
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Extract all <thinking>...</thinking> blocks from a complete response
     * string, returning the parsed blocks and the cleaned response with the
     * thinking tags removed.
     */
    extractThinkingBlocks(response) {
        const blocks = [];
        let cleaned = response;
        let searchStart = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const openIdx = cleaned.indexOf(THINKING_OPEN_TAG, searchStart);
            if (openIdx === -1)
                break;
            const closeIdx = cleaned.indexOf(THINKING_CLOSE_TAG, openIdx + OPEN_TAG_LEN);
            if (closeIdx === -1) {
                // Malformed -- unclosed tag; treat the rest as thinking content
                const content = cleaned
                    .slice(openIdx + OPEN_TAG_LEN)
                    .trim();
                if (content.length > 0) {
                    blocks.push({
                        content,
                        tokenCount: this.estimateTokens(content),
                    });
                }
                cleaned = cleaned.slice(0, openIdx);
                break;
            }
            const content = cleaned
                .slice(openIdx + OPEN_TAG_LEN, closeIdx)
                .trim();
            if (content.length > 0) {
                blocks.push({
                    content,
                    tokenCount: this.estimateTokens(content),
                });
            }
            // Splice out the thinking block
            const before = cleaned.slice(0, openIdx);
            const after = cleaned.slice(closeIdx + CLOSE_TAG_LEN);
            cleaned = before + after;
            searchStart = before.length;
        }
        // Collapse excessive whitespace left behind after removal
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
        return { blocks, cleaned };
    }
    /** Estimate the number of tokens in a piece of text. */
    estimateTokens(text) {
        return ExtendedThinking.estimateTokensStatic(text);
    }
    /** Static version for use without an instance. */
    static estimateTokensStatic(text) {
        if (text.length === 0)
            return 0;
        return Math.ceil(text.length / CHARS_PER_TOKEN);
    }
    // -------------------------------------------------------------------------
    // Persistence helpers
    // -------------------------------------------------------------------------
    /**
     * Serialize the display preference and mode so it can be persisted
     * (e.g. to a config file or localStorage).
     */
    serializePreferences() {
        return {
            mode: this.config.mode,
            showThinking: this.config.showThinking,
        };
    }
    /**
     * Restore a previously serialized preference. Only mode and display
     * toggle are restored; statistics remain untouched.
     */
    restorePreferences(prefs) {
        if (prefs.mode !== undefined) {
            this.setMode(prefs.mode);
        }
        if (prefs.showThinking !== undefined) {
            this.config.showThinking = prefs.showThinking;
        }
    }
}
export default ExtendedThinking;
//# sourceMappingURL=extended-thinking.js.map