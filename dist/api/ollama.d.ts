import { ToolCall, ToolDefinition } from '../core/types.js';
export interface OllamaConfig {
    baseUrl: string;
    defaultModel: string;
    timeout: number;
    maxRetries: number;
    temperature?: number;
    maxTokens?: number;
}
export declare const DEFAULT_OLLAMA_CONFIG: OllamaConfig;
export interface OllamaModel {
    name: string;
    size: number;
    modified_at: string;
    details: {
        format: string;
        family: string;
        parameter_size: string;
        quantization_level: string;
    };
}
export interface OllamaChatResponse {
    content: string;
    model: string;
    totalDuration: number;
    evalCount: number;
    evalDuration: number;
}
export interface OllamaStreamCallbacks {
    onToken?: (token: string) => void;
    onToolCall?: (toolCall: ToolCall) => void;
    onComplete?: (response: OllamaChatResponse) => void;
    onError?: (error: Error) => void;
}
type ProviderMode = 'ollama' | 'openai-compatible';
export declare class OllamaProviderError extends Error {
    readonly statusCode?: number | undefined;
    readonly body?: string | undefined;
    constructor(message: string, statusCode?: number | undefined, body?: string | undefined);
}
export declare class OllamaTimeoutError extends OllamaProviderError {
    constructor(timeout: number);
}
export declare class OllamaConnectionError extends OllamaProviderError {
    constructor(baseUrl: string, cause?: unknown);
}
export declare class OllamaProvider {
    private config;
    private mode;
    constructor(config?: Partial<OllamaConfig>);
    /**
     * Chat completion with optional streaming.
     *
     * When callbacks are provided and stream is not explicitly false,
     * the response is streamed token-by-token via the callbacks.
     */
    chat(messages: Array<{
        role: string;
        content: string;
        toolCalls?: any[];
        toolCallId?: string;
    }>, options?: {
        model?: string;
        tools?: ToolDefinition[];
        stream?: boolean;
        temperature?: number;
        maxTokens?: number;
    }, callbacks?: OllamaStreamCallbacks): Promise<OllamaChatResponse>;
    /**
     * List locally available models.
     */
    listModels(): Promise<OllamaModel[]>;
    /**
     * Health check -- returns true if the endpoint is reachable.
     */
    isAvailable(): Promise<boolean>;
    /**
     * Generate embeddings for a prompt using the Ollama native API.
     * Not supported on OpenAI-compatible endpoints through this method.
     */
    generateEmbeddings(prompt: string, model?: string): Promise<number[]>;
    /**
     * Pull a model from the Ollama registry.
     * Returns true on success.
     */
    pullModel(name: string): Promise<boolean>;
    /**
     * Estimate token count for a text string.
     *
     * Uses a heuristic based on the model family. Ollama does not expose
     * a tokenization endpoint, so this is an approximation:
     *   - For most models: ~4 characters per token (GPT-style)
     *   - For CJK-heavy text: ~2 characters per token
     *   - A slight overhead is added for special tokens / formatting.
     */
    estimateTokens(text: string): number;
    /**
     * Get the current configuration (read-only copy).
     */
    getConfig(): OllamaConfig;
    /**
     * Update configuration. Merges with existing config.
     * Re-detects provider mode if baseUrl changes.
     */
    updateConfig(updates: Partial<OllamaConfig>): void;
    private chatOllama;
    /**
     * Stream an Ollama native /api/chat response (NDJSON).
     */
    private streamOllamaChat;
    /**
     * Normalize a non-streaming Ollama /api/chat response.
     */
    private normalizeOllamaResponse;
    private chatOpenAICompatible;
    /**
     * Stream an OpenAI-compatible /v1/chat/completions response (SSE).
     */
    private streamOpenAIChat;
    /**
     * Non-streaming OpenAI-compatible /v1/chat/completions response.
     */
    private nonStreamOpenAIChat;
    private listModelsOllama;
    private listModelsOpenAICompatible;
    /**
     * Detect whether the configured endpoint is native Ollama or an
     * OpenAI-compatible server (LM Studio, etc.).
     *
     * Strategy: try the Ollama-specific GET /api/version endpoint. If it
     * responds with a JSON object containing a "version" field, we treat
     * it as native Ollama. Otherwise, fall back to OpenAI-compatible mode.
     */
    private detectMode;
    /**
     * Get the current provider mode.
     */
    getMode(): ProviderMode;
    /**
     * Fetch wrapper with timeout and error handling.
     */
    private fetch;
    /**
     * Typed request helper for non-streaming JSON endpoints.
     */
    private request;
    private convertMessages;
    private convertTools;
    private isRetryable;
    private sleep;
}
export {};
//# sourceMappingURL=ollama.d.ts.map