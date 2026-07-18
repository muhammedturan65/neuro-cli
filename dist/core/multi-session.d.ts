import { EventEmitter } from 'events';
export interface SessionConfig {
    model?: string;
    systemPrompt?: string;
    workingDirectory?: string;
    maxTokens?: number;
    maxIterations?: number;
    temperature?: number;
    autoApprove?: boolean;
    tags?: string[];
    /** Optional cost rate overrides (USD per 1M tokens) */
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
}
export interface SessionInfo {
    id: string;
    name: string;
    status: 'active' | 'idle' | 'closed';
    createdAt: number;
    lastActivityAt: number;
    messageCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    tags: string[];
    model: string;
}
export interface CostBreakdown {
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    currency: string;
}
export interface SessionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    tokenCount?: number;
}
export interface InterSessionMessage {
    id: string;
    fromSession: string;
    toSession: string;
    payload: unknown;
    timestamp: number;
    read: boolean;
}
export declare class MultiSessionManager extends EventEmitter {
    private sessions;
    private currentSessionId;
    private maxConcurrent;
    private globalTokenBudget;
    private totalTokensConsumed;
    constructor(options?: {
        maxConcurrent?: number;
        globalTokenBudget?: number;
    });
    /**
     * Create a new independent agent session. Returns the session ID.
     */
    createSession(name: string, config?: SessionConfig): Promise<string>;
    /**
     * Close a session by ID. Releases resources and rejects any pending replies.
     */
    closeSession(id: string): Promise<void>;
    /**
     * List all sessions (including closed ones) with summary info.
     */
    listSessions(): SessionInfo[];
    /**
     * Switch the active / focused session.
     */
    switchSession(id: string): void;
    /**
     * Get the current session ID (or null if none).
     */
    getCurrentSession(): string | null;
    /**
     * Send a prompt to a specific session and return the response.
     * Simulates an LLM interaction: appends the prompt, generates a
     * simulated response, and returns it.
     */
    sendToSession(id: string, prompt: string): Promise<string>;
    /**
     * Broadcast a prompt to all active sessions. Returns a map of
     * session ID → response string.
     */
    broadcast(prompt: string): Promise<Map<string, string>>;
    /**
     * Get the conversation history for a session.
     */
    getSessionHistory(id: string): SessionMessage[];
    /**
     * Get the cost breakdown for a specific session.
     */
    getSessionCost(id: string): CostBreakdown;
    /**
     * Post a message from one session to another's message queue.
     * The receiving session can read it via getMessageQueue().
     */
    postMessage(fromSession: string, toSession: string, message: unknown): void;
    /**
     * Get the pending message queue for a session.
     */
    getMessageQueue(sessionId: string): InterSessionMessage[];
    /**
     * Drain (retrieve and clear) the message queue for a session.
     */
    drainMessageQueue(sessionId: string): InterSessionMessage[];
    /**
     * Set the maximum number of concurrent sessions.
     */
    setMaxConcurrent(max: number): void;
    /**
     * Get total token usage across all sessions.
     */
    getTotalTokenUsage(): number;
    /**
     * Get aggregate cost across all sessions.
     */
    getTotalCost(): CostBreakdown;
    /**
     * Get the number of active sessions.
     */
    getActiveSessionCount(): number;
    /**
     * Clean up closed sessions, freeing memory.
     */
    cleanup(): number;
    private countActive;
    private findFirstActiveSession;
    private recordToInfo;
    /**
     * Rough token estimation: ~4 characters per token.
     */
    private estimateTokens;
    /**
     * Generate a simulated LLM response for a session.
     * In production, this would call the actual model API.
     */
    private generateSimulatedResponse;
}
//# sourceMappingURL=multi-session.d.ts.map