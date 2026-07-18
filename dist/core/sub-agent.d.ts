import { EventEmitter } from 'events';
import { ToolDefinition } from '../core/types.js';
import { OpenRouterClient } from '../api/openrouter.js';
import { ToolRegistry, ToolExecutor, ToolContext } from '../tools/registry.js';
/**
 * Configuration for spawning a sub-agent.
 * The parent defines exactly what the child can do via tool allowlists,
 * file scopes, and resource limits.
 */
export interface SubAgentConfig {
    /** Human-readable name for the sub-agent (used in logging and results) */
    name: string;
    /** Custom system prompt that overrides the default for this sub-agent */
    systemPrompt: string;
    /** Tool name allowlist — only these tools will be available to the sub-agent */
    allowedTools: string[];
    /** Optional tool denylist — these tools are excluded even if in allowedTools */
    deniedTools?: string[];
    /** File system scope restriction */
    fileScope?: {
        /** Paths the sub-agent is allowed to read/write (absolute or relative to workingDir) */
        allowedPaths: string[];
        /** Paths explicitly denied regardless of allowedPaths */
        deniedPaths: string[];
    };
    /** Resource limits enforced during execution */
    resourceLimits: {
        /** Maximum total tokens (input + output) the sub-agent may consume */
        maxTokens: number;
        /** Maximum number of agent loop iterations (turns) */
        maxTurns: number;
        /** Wall-clock timeout in milliseconds; sub-agent is cancelled if exceeded */
        timeoutMs: number;
    };
    /** Override the model used by this sub-agent (defaults to parent's model) */
    model?: string;
    /** Maximum nesting depth for sub-agent spawning (0 = cannot spawn children, 3 = default max) */
    maxDepth: number;
    /** Execution mode: 'sequential' waits for result, 'async' returns a task ID immediately */
    mode: 'sequential' | 'async';
}
/**
 * Structured result returned when a sub-agent completes.
 * Provides a complete accounting of what the sub-agent did.
 */
export interface SubAgentResult {
    /** Whether the sub-agent completed its task successfully */
    success: boolean;
    /** The final text output from the sub-agent */
    output: string;
    /** List of file paths that were modified (created, edited, or deleted) */
    filesModified: string[];
    /** Total tokens consumed (input + output) */
    tokensUsed: number;
    /** Number of agent loop iterations completed */
    turnsCompleted: number;
    /** Error message if the sub-agent failed */
    error?: string;
    /** Wall-clock duration in milliseconds */
    duration: number;
}
/**
 * Current status of an async sub-agent task.
 */
export type SubAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
/**
 * Information about a sub-agent, returned by list().
 */
export interface SubAgentInfo {
    /** Unique task identifier */
    taskId: string;
    /** Human-readable name */
    name: string;
    /** Current status */
    status: SubAgentStatus;
    /** Nesting depth (0 = direct child of parent) */
    depth: number;
    /** Number of turns completed so far */
    turnsCompleted: number;
    /** Tokens consumed so far */
    tokensUsed: number;
    /** Elapsed time in ms since spawn */
    elapsedMs: number;
    /** Parent task ID (if this is a nested sub-agent) */
    parentTaskId?: string;
    /** Timestamp when the sub-agent was spawned */
    startedAt: number;
}
/**
 * Manages the lifecycle of sub-agents spawned by a parent agent.
 *
 * A parent agent creates a SubAgentManager with its own OpenRouterClient
 * and ToolRegistry. When it wants to delegate work, it calls spawn()
 * or spawnAsync() with a configuration that defines the child's
 * permissions, tools, and resource limits.
 *
 * The SubAgentManager:
 * - Creates a temporary BaseAgent with a scoped tool registry
 * - Enforces resource limits (tokens, turns, timeout)
 * - Tracks file modifications via before/after snapshots
 * - Supports hierarchical delegation (sub-agents can spawn their own children)
 * - Emits events for status changes
 *
 * Usage:
 * ```typescript
 * const manager = new SubAgentManager(client, registry, '/project', 'session-1');
 *
 * // Sequential: block until done
 * const result = await manager.spawn({
 *   name: 'code-searcher',
 *   systemPrompt: 'You are a code search specialist.',
 *   allowedTools: ['search_files', 'read_file'],
 *   resourceLimits: { maxTokens: 50_000, maxTurns: 10, timeoutMs: 60_000 },
 *   maxDepth: 2,
 *   mode: 'sequential',
 * }, 'Find all uses of the deprecated API');
 *
 * // Async: fire and forget, get a task ID
 * const taskId = await manager.spawnAsync({ ... }, 'Refactor the utils');
 * // Later...
 * const status = manager.getStatus(taskId);
 * const result = await manager.waitFor(taskId);
 * ```
 */
export declare class SubAgentManager extends EventEmitter {
    private client;
    private parentRegistry;
    private workingDirectory;
    private sessionId;
    private defaultModel;
    private currentDepth;
    private maxGlobalDepth;
    /** Active and completed sub-agent records */
    private records;
    /** Monotonic counter for generating unique task IDs */
    private taskCounter;
    /**
     * @param client        The OpenRouterClient shared with the parent agent
     * @param registry      The parent's ToolRegistry (tools will be filtered for children)
     * @param workingDir    The working directory for sub-agents
     * @param sessionId     The session ID to inherit
     * @param defaultModel  The default model to use (inherited from parent)
     * @param currentDepth  Current nesting depth (0 for top-level manager)
     * @param maxGlobalDepth Maximum allowed nesting depth across the hierarchy
     */
    constructor(client: OpenRouterClient, registry: ToolRegistry, workingDir: string, sessionId: string, defaultModel?: string, currentDepth?: number, maxGlobalDepth?: number);
    /**
     * Spawn a sub-agent in sequential mode and wait for its result.
     * The parent agent blocks until the child completes (or fails/times out).
     *
     * @param config  Configuration for the sub-agent
     * @param prompt  The task prompt to send to the sub-agent
     * @returns       Structured result from the sub-agent
     * @throws        Error if the sub-agent fails or is cancelled
     */
    spawn(config: SubAgentConfig, prompt: string): Promise<SubAgentResult>;
    /**
     * Spawn a sub-agent in async (fire-and-forget) mode.
     * Returns a task ID immediately; the sub-agent runs in the background.
     * Use getStatus() to check progress and waitFor() to collect results.
     *
     * @param config  Configuration for the sub-agent
     * @param prompt  The task prompt to send to the sub-agent
     * @returns       Unique task ID for tracking this sub-agent
     */
    spawnAsync(config: SubAgentConfig, prompt: string): Promise<string>;
    /**
     * Get the current status of an async sub-agent task.
     *
     * @param taskId  The task ID returned by spawnAsync()
     * @returns       Current status, or undefined if the task doesn't exist
     */
    getStatus(taskId: string): SubAgentStatus | undefined;
    /**
     * Get detailed info about a sub-agent.
     *
     * @param taskId  The task ID
     * @returns       Sub-agent info, or undefined if not found
     */
    getInfo(taskId: string): SubAgentInfo | undefined;
    /**
     * Cancel a running sub-agent.
     * The sub-agent's abort controller is triggered, causing it to
     * stop at the next iteration boundary.
     *
     * @param taskId  The task ID to cancel
     * @returns       True if the agent was successfully cancelled
     */
    cancel(taskId: string): boolean;
    /**
     * List all active sub-agents (pending, running, or timed_out).
     *
     * @returns Array of sub-agent info objects
     */
    list(): SubAgentInfo[];
    /**
     * Wait for a specific async sub-agent to complete and return its result.
     *
     * @param taskId  The task ID to wait for
     * @returns       The sub-agent's result
     * @throws        Error if the task doesn't exist or was cancelled
     */
    waitFor(taskId: string): Promise<SubAgentResult>;
    /**
     * Wait for all currently running async sub-agents to complete.
     * Returns results for all tasks that were active at the time of the call.
     *
     * @returns Array of results from all awaited sub-agents
     */
    waitForAll(): Promise<SubAgentResult[]>;
    /**
     * Get the result of a completed sub-agent.
     *
     * @param taskId  The task ID
     * @returns       The result, or undefined if not completed
     */
    getResult(taskId: string): SubAgentResult | undefined;
    /**
     * Get the current nesting depth of this manager.
     * Useful for checking whether further sub-agent spawning is allowed.
     */
    get depth(): number;
    /**
     * Check whether this manager can spawn additional sub-agents
     * (i.e., we haven't hit the max depth).
     */
    get canSpawn(): boolean;
    /**
     * Generate a unique task ID.
     */
    private generateTaskId;
    /**
     * Apply default values to a SubAgentConfig.
     */
    private applyDefaults;
    /**
     * Validate a SubAgentConfig, throwing if it's invalid.
     */
    private validateConfig;
    /**
     * Create a SubAgentRecord for tracking the sub-agent lifecycle.
     */
    private createRecord;
    /**
     * Execute a sub-agent: create a scoped BaseAgent, run it with
     * resource limit enforcement, and collect results.
     */
    private executeSubAgent;
    /**
     * Build the system prompt for a sub-agent, combining the user-provided
     * system prompt with context about the sub-agent's restrictions.
     */
    private buildSubAgentSystemPrompt;
    /**
     * Clean up completed/failed/cancelled sub-agent records.
     * Returns the number of records cleaned up.
     */
    cleanup(): number;
}
/**
 * A ToolExecutor that can be registered in the parent agent's tool
 * registry to give the agent the ability to spawn sub-agents via
 * the LLM tool-calling interface.
 *
 * This tool appears as "spawn_sub_agent" in the agent's tool list
 * and accepts the sub-agent configuration + prompt as arguments.
 *
 * Usage:
 * ```typescript
 * const manager = new SubAgentManager(client, registry, cwd, sessionId);
 * const subAgentTool = new SubAgentTool(manager);
 * registry.register(subAgentTool);
 * ```
 */
export declare class SubAgentTool implements ToolExecutor {
    name: string;
    description: string;
    risk: 'low' | 'medium' | 'high';
    definition: ToolDefinition;
    private manager;
    constructor(manager: SubAgentManager);
    execute(args: Record<string, unknown>, _context: ToolContext): Promise<string>;
    getApprovalRequest?(args: Record<string, unknown>): import('../core/types.js').ApprovalRequest;
}
/**
 * Convenience factory for creating a SubAgentManager from the
 * standard NeuroEngine components.
 *
 * @param client          The OpenRouter client from the engine
 * @param registry        The tool registry from the engine
 * @param workingDir      The current working directory
 * @param sessionId       The current session ID
 * @param defaultModel    The model to use for sub-agents
 * @param parentDepth     The current nesting depth (0 for top-level)
 * @returns               A configured SubAgentManager
 */
export declare function createSubAgentManager(client: OpenRouterClient, registry: ToolRegistry, workingDir: string, sessionId: string, defaultModel?: string, parentDepth?: number): SubAgentManager;
//# sourceMappingURL=sub-agent.d.ts.map