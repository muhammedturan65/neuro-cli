import { Session, Message, AgentExecution } from '../core/types.js';
export declare class SessionManager {
    private currentSession;
    /**
     * Create a new session
     */
    create(workingDirectory: string, model: string): Session;
    /**
     * Load an existing session
     */
    load(sessionId: string): Session | null;
    /**
     * Get the current session
     */
    getCurrent(): Session | null;
    /**
     * Save the current session
     */
    save(): void;
    /**
     * Add a message to the current session
     */
    addMessage(message: Message): void;
    /**
     * Add an agent execution record
     */
    addAgentExecution(execution: AgentExecution): void;
    /**
     * Update token usage
     */
    updateUsage(inputTokens: number, outputTokens: number, cost: number): void;
    /**
     * List all sessions
     */
    list(): Array<{
        id: string;
        createdAt: number;
        messageCount: number;
        model: string;
        cost: number;
    }>;
    /**
     * Delete a session
     */
    delete(sessionId: string): boolean;
    /**
     * Get session statistics
     */
    getStats(): {
        totalSessions: number;
        totalMessages: number;
        totalCost: number;
        totalTokens: number;
    };
}
//# sourceMappingURL=session.d.ts.map