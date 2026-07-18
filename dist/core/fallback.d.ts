import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { Message } from './types.js';
export interface FallbackConfig {
    models: string[];
    maxRetries: number;
    retryDelayMs: number;
    fallbackOnErrors: string[];
}
export interface FallbackResult {
    content: string;
    modelUsed: string;
    attempts: Array<{
        model: string;
        success: boolean;
        error?: string;
    }>;
    usage: TokenUsage;
    toolCalls: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}
export declare class FallbackChain {
    private config;
    private client;
    constructor(client: OpenRouterClient, config?: Partial<FallbackConfig>);
    /**
     * Execute a chat request with fallback chain
     */
    chatWithFallback(primaryModel: string, messages: Message[], options: {
        tools?: unknown[];
        temperature?: number;
        maxTokens?: number;
        stream?: boolean;
    }, onModelSwitch?: (from: string, to: string) => void): Promise<FallbackResult>;
    /**
     * Set fallback models
     */
    setFallbackModels(models: string[]): void;
    /**
     * Add a fallback model
     */
    addFallbackModel(model: string): void;
    /**
     * Get current fallback chain
     */
    getFallbackChain(): string[];
    private sleep;
}
//# sourceMappingURL=fallback.d.ts.map