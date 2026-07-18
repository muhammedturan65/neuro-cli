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
     * Fork a session (create a copy with new ID)
     */
    fork(sessionId: string): Session | null;
    /**
     * Get the most recent session
     */
    getMostRecent(): Session | null;
    /**
     * Search sessions by content
     */
    search(query: string): Array<{
        id: string;
        createdAt: number;
        messageCount: number;
        model: string;
        cost: number;
        matchPreview: string;
    }>;
    /**
     * Export a session to a portable JSON format
     */
    exportSession(sessionId: string, outputPath: string): boolean;
    /**
     * Import a session from a JSON file
     */
    importSession(filePath: string): Session | null;
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