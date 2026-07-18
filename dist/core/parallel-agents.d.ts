import { EventEmitter } from 'events';
export interface ParallelAgentConfig {
    id: string;
    name: string;
    prompt: string;
    model?: string;
    workingDirectory?: string;
    maxIterations?: number;
    maxTokens?: number;
    tools?: string[];
    sharedState?: Record<string, unknown>;
    priority: 'low' | 'normal' | 'high';
    autoStart: boolean;
}
export interface ParallelAgentState {
    id: string;
    name: string;
    status: 'spawning' | 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt: number;
    completedAt?: number;
    iterations: number;
    tokensUsed: number;
    result?: string;
    error?: string;
    progress: number;
}
export interface ParallelAgentMetrics {
    totalAgents: number;
    activeAgents: number;
    completedAgents: number;
    failedAgents: number;
    cancelledAgents: number;
    averageDurationMs: number;
    totalTokensUsed: number;
}
type AgentCompleteCallback = (agentId: string, state: ParallelAgentState) => void;
type AgentErrorCallback = (agentId: string, error: string, state: ParallelAgentState) => void;
export declare class ParallelAgentManager extends EventEmitter {
    private agents;
    private maxConcurrent;
    private globalSharedState;
    private onAgentCompleteCallbacks;
    private onAgentErrorCallbacks;
    /** Queue of agent IDs waiting to run when a slot opens. */
    private pendingQueue;
    constructor(options?: {
        maxConcurrent?: number;
        sharedState?: Record<string, unknown>;
    });
    /**
     * Spawn a new parallel agent. If `config.autoStart` is true the agent
     * begins running immediately (subject to the concurrency limit).
     * Returns the agent ID.
     */
    spawn(config: ParallelAgentConfig): string;
    /**
     * Cancel a running (or pending) agent.
     */
    cancel(agentId: string): boolean;
    /**
     * Cancel all running and pending agents.
     */
    cancelAll(): number;
    /**
     * Get the state of a specific agent.
     */
    getStatus(agentId: string): ParallelAgentState | null;
    /**
     * List all currently running agents (status === 'running' | 'spawning').
     */
    listActive(): ParallelAgentState[];
    /**
     * List all agents including completed ones.
     */
    listAll(): ParallelAgentState[];
    /**
     * Wait for a specific agent to complete and return its result.
     * Rejects if the agent was cancelled or failed.
     */
    waitFor(agentId: string): Promise<string>;
    /**
     * Wait for all currently running agents to finish.
     * Returns a map of agentId → result (or error message on failure).
     */
    waitForAll(): Promise<Map<string, {
        result?: string;
        error?: string;
    }>>;
    /**
     * Get the result of a completed agent.
     */
    getResult(agentId: string): string | null;
    /**
     * Broadcast a message to all running agents' shared state.
     * The message is stored under `sharedState.__broadcasts`.
     */
    broadcastMessage(message: string): number;
    /**
     * Register a callback for when any agent completes successfully.
     */
    onAgentComplete(callback: AgentCompleteCallback): void;
    /**
     * Register a callback for when any agent encounters an error.
     */
    onAgentError(callback: AgentErrorCallback): void;
    /**
     * Get aggregate metrics across all agents.
     */
    getMetrics(): ParallelAgentMetrics;
    /**
     * Read a value from the shared state of a specific agent.
     */
    getSharedValue(agentId: string, key: string): unknown;
    /**
     * Write a value to the shared state of a specific agent.
     * Also writes to the global shared state so future agents inherit it.
     */
    setSharedValue(agentId: string, key: string, value: unknown): boolean;
    /**
     * Update the progress of a running agent (0-100).
     */
    updateProgress(agentId: string, progress: number): boolean;
    /**
     * Clean up sandbox directories for completed/failed/cancelled agents.
     */
    cleanup(): number;
    /**
     * Schedule an agent to start. If we're at the concurrency limit,
     * the agent is placed in the pending queue.
     */
    private scheduleStart;
    /**
     * Actually start running an agent.
     */
    private runAgent;
    /**
     * The core agent execution loop.
     *
     * In a real implementation this would call an LLM, execute tools, etc.
     * Here we simulate the loop with AbortController support, token tracking,
     * iteration limits, and sandboxed file I/O — all using only Node built-ins.
     */
    private executeAgentLoop;
    /**
     * Yield control to the event loop so other agents can progress.
     * Uses setImmediate for true interleaving.
     */
    private yieldControl;
    /**
     * Rough token estimation (heuristic: ~4 chars per token).
     */
    private estimateTokens;
    /**
     * Persist the agent's context to its sandbox directory.
     */
    private persistContext;
    /**
     * Write an iteration log to the sandbox directory.
     */
    private writeIterationLog;
    /**
     * When a slot opens, try to start the highest-priority pending agent.
     */
    private tryStartPending;
    /**
     * Count currently active (spawning + running) agents.
     */
    private activeCount;
    /**
     * Fire all registered onAgentComplete callbacks.
     */
    private fireCompleteCallbacks;
    /**
     * Fire all registered onAgentError callbacks.
     */
    private fireErrorCallbacks;
    /**
     * Ensure a directory exists.
     */
    private ensureDir;
}
export {};
//# sourceMappingURL=parallel-agents.d.ts.map