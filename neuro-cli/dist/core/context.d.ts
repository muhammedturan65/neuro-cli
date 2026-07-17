import { Message } from '../core/types.js';
export interface ContextSummary {
    totalMessages: number;
    totalTokens: number;
    systemTokens: number;
    conversationTokens: number;
    availableTokens: number;
    truncationNeeded: boolean;
}
export declare class ContextManager {
    private modelId;
    private maxContextTokens;
    private systemPromptRatio;
    private reservedOutputTokens;
    constructor(modelId: string, maxContextTokens?: number, systemPromptRatio?: number, reservedOutputRatio?: number);
    get maxInputTokens(): number;
    /**
     * Analyze the current context
     */
    analyze(messages: Message[]): ContextSummary;
    /**
     * Count total tokens in messages
     */
    countTokens(messages: Message[]): number;
    /**
     * Manage context window - truncate if needed
     */
    manage(messages: Message[]): Message[];
    /**
     * Create a summary of old messages
     */
    private createSummary;
    /**
     * Build the final message array for an API call
     */
    buildMessages(systemPrompt: string, conversation: Message[], injectedContext?: string): Message[];
}
//# sourceMappingURL=context.d.ts.map