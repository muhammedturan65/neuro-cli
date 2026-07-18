import { Message, ToolCall, ToolDefinition, ToolResult } from '../core/types.js';
export interface StreamCallbacks {
    onToken?: (token: string) => void;
    onToolCall?: (toolCall: ToolCall) => void;
    onToolResult?: (result: ToolResult) => void;
    onThinking?: (thinking: string) => void;
    onComplete?: (fullResponse: string, usage: TokenUsage) => void;
    onError?: (error: Error) => void;
}
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cost: number;
}
export interface ChatRequest {
    model: string;
    messages: Message[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
}
export declare class OpenRouterClient {
    private apiKey;
    private baseUrl;
    private totalUsage;
    constructor(apiKey: string, baseUrl?: string);
    get usage(): TokenUsage;
    resetUsage(): void;
    /**
     * Main chat completion with streaming
     */
    chat(request: ChatRequest, callbacks?: StreamCallbacks): Promise<{
        content: string;
        toolCalls: ToolCall[];
        usage: TokenUsage;
    }>;
    /**
     * Handle SSE streaming response
     */
    private handleStreamingResponse;
    /**
     * Handle non-streaming response
     */
    private handleNonStreamingResponse;
    /**
     * Quick completion without streaming (for sub-agents)
     */
    quickChat(model: string, messages: Message[], tools?: ToolDefinition[], temperature?: number): Promise<{
        content: string;
        toolCalls: ToolCall[];
        usage: TokenUsage;
    }>;
}
//# sourceMappingURL=openrouter.d.ts.map