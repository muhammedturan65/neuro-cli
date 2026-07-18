// ============================================================
// NeuroCLI - Sub-Agent Spawning with Scoped Tool Access (GAP-27)
// Enables parent agents to spawn child sub-agents with
// restricted tool access, file scope, resource limits,
// hierarchical delegation, and structured result handoff.
// Inspired by Claude Code's Task tool and Cursor sub-agents.
// Uses only Node.js built-in modules + existing project deps.
// ============================================================

import { EventEmitter } from 'events';
import { resolve, relative, isAbsolute } from 'path';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { Message, ToolCall, ToolDefinition, ToolResult, AgentConfig, AgentExecution, FileChange } from '../core/types.js';
import { OpenRouterClient, StreamCallbacks, TokenUsage } from '../api/openrouter.js';
import { ToolRegistry, ToolExecutor, ToolContext, globalRegistry } from '../tools/registry.js';
import { BaseAgent, AgentRunResult, AgentCallbacks } from '../agents/base.js';

// ============================================================
// Exported Interfaces
// ============================================================

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
export type SubAgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

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

// ============================================================
// Internal Types
// ============================================================

/** Internal record for tracking a sub-agent through its lifecycle */
interface SubAgentRecord {
  taskId: string;
  config: SubAgentConfig;
  prompt: string;
  status: SubAgentStatus;
  depth: number;
  parentTaskId?: string;
  workingDirectory: string;
  sessionId: string;
  abortController: AbortController;
  startedAt: number;
  completedAt?: number;
  result?: SubAgentResult;
  /** Resolves when the sub-agent completes (for waitFor / sequential mode) */
  completionPromise: Promise<SubAgentResult>;
  completionResolve: ((result: SubAgentResult) => void) | null;
  completionReject: ((error: Error) => void) | null;
  /** Snapshot of files before execution (for diffing) */
  fileSnapshot: Map<string, string>;
}

/**
 * File change diff entry — simplified representation of a modification
 * detected by comparing file system state before and after execution.
 */
interface FileDiff {
  path: string;
  type: 'create' | 'modify' | 'delete';
  previousHash?: string;
  currentHash?: string;
}

// ============================================================
// Constants
// ============================================================

/** Default maximum nesting depth for sub-agents */
const DEFAULT_MAX_DEPTH = 3;

/** Default resource limits if not specified */
const DEFAULT_RESOURCE_LIMITS = {
  maxTokens: 100_000,
  maxTurns: 20,
  timeoutMs: 120_000, // 2 minutes
};

/** Names of tools that involve file I/O (used for file scope wrapping) */
const FILE_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'search_files',
  'create_directory',
  'move_file',
  'delete_file',
  'file_stats',
]);

// ============================================================
// ScopedToolRegistry
// ============================================================

/**
 * A filtered view of a ToolRegistry that only exposes tools
 * permitted by the sub-agent's allowlist/denylist, and wraps
 * file tools with path validation for file scope enforcement.
 */
class ScopedToolRegistry extends ToolRegistry {
  private allowedSet: Set<string>;
  private deniedSet: Set<string>;
  private fileScopeAllowed: Set<string>;
  private fileScopeDenied: Set<string>;
  private fileScopeEnabled: boolean;
  private workingDir: string;

  constructor(
    parentRegistry: ToolRegistry,
    allowedTools: string[],
    deniedTools: string[],
    fileScope: SubAgentConfig['fileScope'],
    workingDir: string,
  ) {
    super();

    this.allowedSet = new Set(allowedTools);
    this.deniedSet = new Set(deniedTools);
    this.workingDir = workingDir;

    // Resolve file scope paths to absolute
    this.fileScopeAllowed = new Set(
      (fileScope?.allowedPaths ?? []).map((p) =>
        isAbsolute(p) ? p : resolve(workingDir, p),
      ),
    );
    this.fileScopeDenied = new Set(
      (fileScope?.deniedPaths ?? []).map((p) =>
        isAbsolute(p) ? p : resolve(workingDir, p),
      ),
    );
    this.fileScopeEnabled = this.fileScopeAllowed.size > 0 || this.fileScopeDenied.size > 0;

    // Copy permitted tools from parent, wrapping file tools if needed
    for (const tool of parentRegistry.getAll()) {
      if (!this.allowedSet.has(tool.name)) continue;
      if (this.deniedSet.has(tool.name)) continue;

      if (this.fileScopeEnabled && FILE_TOOL_NAMES.has(tool.name)) {
        this.register(this.wrapFileTool(tool));
      } else {
        this.register(tool);
      }
    }
  }

  /**
   * Wrap a file tool executor with path validation.
   * If a file path argument is outside the allowed scope or
   * inside the denied scope, the tool returns an error instead
   * of executing.
   */
  private wrapFileTool(tool: ToolExecutor): ToolExecutor {
    const originalExecute = tool.execute.bind(tool);
    const scopeAllowed = this.fileScopeAllowed;
    const scopeDenied = this.fileScopeDenied;
    const workingDir = this.workingDir;

    const wrappedExecute = async (
      args: Record<string, unknown>,
      context: ToolContext,
    ): Promise<string> => {
      // Find the file path argument — tools use various arg names
      const filePath = this.extractFilePath(args);
      if (filePath !== null) {
        const absolutePath = isAbsolute(filePath) ? filePath : resolve(workingDir, filePath);

        // Check denied paths first (denied takes priority)
        for (const denied of scopeDenied) {
          if (absolutePath.startsWith(denied) || absolutePath === denied) {
            return `ERROR: Access denied — path "${filePath}" is outside the allowed file scope.`;
          }
        }

        // If allowed paths are specified, the path must be under one of them
        if (scopeAllowed.size > 0) {
          let isAllowed = false;
          for (const allowed of scopeAllowed) {
            if (absolutePath.startsWith(allowed) || absolutePath === allowed) {
              isAllowed = true;
              break;
            }
          }
          if (!isAllowed) {
            return `ERROR: Access denied — path "${filePath}" is outside the allowed file scope.`;
          }
        }
      }

      return originalExecute(args, context);
    };

    return {
      name: tool.name,
      definition: tool.definition,
      description: tool.description,
      parameters: tool.parameters,
      execute: wrappedExecute,
      getApprovalRequest: tool.getApprovalRequest?.bind(tool),
      risk: tool.risk,
    };
  }

  /**
   * Extract a file path from tool arguments.
   * Different tools use different argument names for paths.
   */
  private extractFilePath(args: Record<string, unknown>): string | null {
    const pathKeys = ['path', 'filePath', 'file_path', 'source', 'directory', 'dir'];
    for (const key of pathKeys) {
      if (typeof args[key] === 'string' && (args[key] as string).length > 0) {
        return args[key] as string;
      }
    }
    // Check for nested destinations (e.g., move_file has source + destination)
    if (typeof args['destination'] === 'string') {
      return args['destination'] as string;
    }
    return null;
  }
}

// ============================================================
// FileSnapshot
// ============================================================

/**
 * Simple file snapshot utility that records file content hashes
 * before sub-agent execution and compares afterwards to detect
 * what files were modified.
 */
class FileSnapshot {
  private workingDir: string;
  private snapshot: Map<string, string> = new Map();
  private scopedPaths: string[];

  constructor(workingDir: string, fileScope?: SubAgentConfig['fileScope']) {
    this.workingDir = workingDir;

    if (fileScope && fileScope.allowedPaths.length > 0) {
      this.scopedPaths = fileScope.allowedPaths.map((p) =>
        isAbsolute(p) ? p : resolve(workingDir, p),
      );
    } else {
      this.scopedPaths = [workingDir];
    }
  }

  /**
   * Take a snapshot of all files in the scoped paths.
   * Uses a fast hash (simple content length + first/last bytes) for
   * comparison purposes. Does not follow symlinks or descend into
   * node_modules / .git directories.
   */
  take(): Map<string, string> {
    this.snapshot = new Map();
    for (const scopedPath of this.scopedPaths) {
      this.walkDir(scopedPath);
    }
    return new Map(this.snapshot);
  }

  /**
   * Compare the current file state against the snapshot and
   * return a list of detected changes.
   */
  diff(): FileChange[] {
    const changes: FileChange[] = [];
    const currentSnapshot = new Map<string, string>();

    // Re-scan the same directories
    for (const scopedPath of this.scopedPaths) {
      this.walkDirInto(scopedPath, currentSnapshot);
    }

    // Find modified and deleted files (present in original snapshot)
    for (const [filePath, originalHash] of this.snapshot) {
      const currentHash = currentSnapshot.get(filePath);
      if (currentHash === undefined) {
        changes.push({ path: filePath, type: 'delete' });
      } else if (currentHash !== originalHash) {
        changes.push({ path: filePath, type: 'modify' });
      }
    }

    // Find newly created files (present in current but not original)
    for (const [filePath] of currentSnapshot) {
      if (!this.snapshot.has(filePath)) {
        changes.push({ path: filePath, type: 'create' });
      }
    }

    return changes;
  }

  /**
   * Recursively walk a directory and record file hashes.
   */
  private walkDir(dirPath: string): void {
    this.walkDirInto(dirPath, this.snapshot);
  }

  private walkDirInto(dirPath: string, target: Map<string, string>): void {
    if (!existsSync(dirPath)) return;

    let entries;
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return; // Permission denied or similar
    }

    for (const entry of entries) {
      // Skip common non-essential directories
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.next' ||
          entry.name === 'dist' ||
          entry.name === '.turbo'
        ) {
          continue;
        }
        this.walkDirInto(resolve(dirPath, entry.name), target);
      } else if (entry.isFile()) {
        const fullPath = resolve(dirPath, entry.name);
        try {
          const hash = this.quickHash(fullPath);
          target.set(fullPath, hash);
        } catch {
          // File may be unreadable; skip
        }
      }
    }
  }

  /**
   * Quick content hash: uses file size + first 64 bytes + last 64 bytes.
   * Fast and sufficient for detecting modifications without reading
   * entire large files.
   */
  private quickHash(filePath: string): string {
    const stat = statSync(filePath);
    const size = stat.size;

    if (size === 0) return `0:empty`;

    const fd = [] as number[];
    const buf = Buffer.alloc(Math.min(size, 128));
    const fileHandle = readFileSync(filePath);

    // Use first 64 bytes and last 64 bytes
    const firstChunk = fileHandle.subarray(0, Math.min(64, size));
    const lastChunk = size > 64 ? fileHandle.subarray(Math.max(0, size - 64)) : Buffer.alloc(0);

    return `${size}:${firstChunk.toString('hex')}:${lastChunk.toString('hex')}`;
  }
}

// ============================================================
// SubAgentManager
// ============================================================

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
export class SubAgentManager extends EventEmitter {
  private client: OpenRouterClient;
  private parentRegistry: ToolRegistry;
  private workingDirectory: string;
  private sessionId: string;
  private defaultModel: string;
  private currentDepth: number;
  private maxGlobalDepth: number;

  /** Active and completed sub-agent records */
  private records: Map<string, SubAgentRecord> = new Map();

  /** Monotonic counter for generating unique task IDs */
  private taskCounter: number = 0;

  /**
   * @param client        The OpenRouterClient shared with the parent agent
   * @param registry      The parent's ToolRegistry (tools will be filtered for children)
   * @param workingDir    The working directory for sub-agents
   * @param sessionId     The session ID to inherit
   * @param defaultModel  The default model to use (inherited from parent)
   * @param currentDepth  Current nesting depth (0 for top-level manager)
   * @param maxGlobalDepth Maximum allowed nesting depth across the hierarchy
   */
  constructor(
    client: OpenRouterClient,
    registry: ToolRegistry,
    workingDir: string,
    sessionId: string,
    defaultModel: string = 'qwen/qwen3-coder:free',
    currentDepth: number = 0,
    maxGlobalDepth: number = DEFAULT_MAX_DEPTH,
  ) {
    super();
    this.client = client;
    this.parentRegistry = registry;
    this.workingDirectory = workingDir;
    this.sessionId = sessionId;
    this.defaultModel = defaultModel;
    this.currentDepth = currentDepth;
    this.maxGlobalDepth = maxGlobalDepth;
  }

  // ----------------------------------------------------------
  // Public API — Spawn
  // ----------------------------------------------------------

  /**
   * Spawn a sub-agent in sequential mode and wait for its result.
   * The parent agent blocks until the child completes (or fails/times out).
   *
   * @param config  Configuration for the sub-agent
   * @param prompt  The task prompt to send to the sub-agent
   * @returns       Structured result from the sub-agent
   * @throws        Error if the sub-agent fails or is cancelled
   */
  async spawn(config: SubAgentConfig, prompt: string): Promise<SubAgentResult> {
    const effectiveConfig = this.applyDefaults(config);
    this.validateConfig(effectiveConfig);

    const taskId = this.generateTaskId(effectiveConfig.name);
    const record = this.createRecord(taskId, effectiveConfig, prompt);

    this.emit('subagent:spawning', taskId, effectiveConfig.name);

    try {
      const result = await this.executeSubAgent(record, effectiveConfig, prompt);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const failResult: SubAgentResult = {
        success: false,
        output: '',
        filesModified: [],
        tokensUsed: 0,
        turnsCompleted: 0,
        error: error.message,
        duration: Date.now() - record.startedAt,
      };
      record.status = 'failed';
      record.result = failResult;
      record.completedAt = Date.now();
      record.completionReject?.(error);
      this.emit('subagent:failed', taskId, error.message);
      return failResult;
    } finally {
      this.records.delete(taskId);
    }
  }

  /**
   * Spawn a sub-agent in async (fire-and-forget) mode.
   * Returns a task ID immediately; the sub-agent runs in the background.
   * Use getStatus() to check progress and waitFor() to collect results.
   *
   * @param config  Configuration for the sub-agent
   * @param prompt  The task prompt to send to the sub-agent
   * @returns       Unique task ID for tracking this sub-agent
   */
  async spawnAsync(config: SubAgentConfig, prompt: string): Promise<string> {
    const effectiveConfig = this.applyDefaults(config);
    this.validateConfig(effectiveConfig);

    const taskId = this.generateTaskId(effectiveConfig.name);
    const record = this.createRecord(taskId, effectiveConfig, prompt);

    this.emit('subagent:spawning', taskId, effectiveConfig.name);

    // Execute in the background (non-blocking)
    this.executeSubAgent(record, effectiveConfig, prompt)
      .then((result) => {
        record.status = 'completed';
        record.result = result;
        record.completedAt = Date.now();
        record.completionResolve?.(result);
        this.emit('subagent:completed', taskId, result);
      })
      .catch((err: unknown) => {
        if (record.status === 'cancelled') return; // Already handled
        const error = err instanceof Error ? err : new Error(String(err));
        record.status = 'failed';
        record.result = {
          success: false,
          output: '',
          filesModified: [],
          tokensUsed: 0,
          turnsCompleted: 0,
          error: error.message,
          duration: Date.now() - record.startedAt,
        };
        record.completedAt = Date.now();
        record.completionReject?.(error);
        this.emit('subagent:failed', taskId, error.message);
      });

    return taskId;
  }

  // ----------------------------------------------------------
  // Public API — Status & Control
  // ----------------------------------------------------------

  /**
   * Get the current status of an async sub-agent task.
   *
   * @param taskId  The task ID returned by spawnAsync()
   * @returns       Current status, or undefined if the task doesn't exist
   */
  getStatus(taskId: string): SubAgentStatus | undefined {
    const record = this.records.get(taskId);
    if (!record) return undefined;
    return record.status;
  }

  /**
   * Get detailed info about a sub-agent.
   *
   * @param taskId  The task ID
   * @returns       Sub-agent info, or undefined if not found
   */
  getInfo(taskId: string): SubAgentInfo | undefined {
    const record = this.records.get(taskId);
    if (!record) return undefined;

    return {
      taskId: record.taskId,
      name: record.config.name,
      status: record.status,
      depth: record.depth,
      turnsCompleted: record.result?.turnsCompleted ?? 0,
      tokensUsed: record.result?.tokensUsed ?? 0,
      elapsedMs: Date.now() - record.startedAt,
      parentTaskId: record.parentTaskId,
      startedAt: record.startedAt,
    };
  }

  /**
   * Cancel a running sub-agent.
   * The sub-agent's abort controller is triggered, causing it to
   * stop at the next iteration boundary.
   *
   * @param taskId  The task ID to cancel
   * @returns       True if the agent was successfully cancelled
   */
  cancel(taskId: string): boolean {
    const record = this.records.get(taskId);
    if (!record) return false;

    if (
      record.status === 'completed' ||
      record.status === 'failed' ||
      record.status === 'cancelled'
    ) {
      return false; // Already terminal
    }

    record.abortController.abort();
    record.status = 'cancelled';
    record.completedAt = Date.now();

    if (!record.result) {
      record.result = {
        success: false,
        output: '',
        filesModified: [],
        tokensUsed: 0,
        turnsCompleted: 0,
        error: 'Cancelled by parent',
        duration: Date.now() - record.startedAt,
      };
    }

    record.completionReject?.(new Error(`Sub-agent "${taskId}" was cancelled`));
    this.emit('subagent:cancelled', taskId);
    return true;
  }

  /**
   * List all active sub-agents (pending, running, or timed_out).
   *
   * @returns Array of sub-agent info objects
   */
  list(): SubAgentInfo[] {
    const infos: SubAgentInfo[] = [];
    for (const record of this.records.values()) {
      if (
        record.status === 'pending' ||
        record.status === 'running' ||
        record.status === 'timed_out'
      ) {
        infos.push({
          taskId: record.taskId,
          name: record.config.name,
          status: record.status,
          depth: record.depth,
          turnsCompleted: record.result?.turnsCompleted ?? 0,
          tokensUsed: record.result?.tokensUsed ?? 0,
          elapsedMs: Date.now() - record.startedAt,
          parentTaskId: record.parentTaskId,
          startedAt: record.startedAt,
        });
      }
    }
    return infos.sort((a, b) => a.startedAt - b.startedAt);
  }

  /**
   * Wait for a specific async sub-agent to complete and return its result.
   *
   * @param taskId  The task ID to wait for
   * @returns       The sub-agent's result
   * @throws        Error if the task doesn't exist or was cancelled
   */
  async waitFor(taskId: string): Promise<SubAgentResult> {
    const record = this.records.get(taskId);
    if (!record) {
      throw new Error(`Sub-agent task "${taskId}" not found`);
    }

    // If already completed, return immediately
    if (record.status === 'completed' && record.result) {
      return record.result;
    }
    // If already failed/cancelled, throw
    if (
      (record.status === 'failed' || record.status === 'cancelled') &&
      record.result
    ) {
      if (record.result.error) {
        throw new Error(record.result.error);
      }
      return record.result;
    }

    return record.completionPromise;
  }

  /**
   * Wait for all currently running async sub-agents to complete.
   * Returns results for all tasks that were active at the time of the call.
   *
   * @returns Array of results from all awaited sub-agents
   */
  async waitForAll(): Promise<SubAgentResult[]> {
    const activeIds: string[] = [];
    for (const [id, record] of this.records) {
      if (
        record.status === 'pending' ||
        record.status === 'running'
      ) {
        activeIds.push(id);
      }
    }

    const results = await Promise.allSettled(
      activeIds.map((id) => this.waitFor(id)),
    );

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      // Rejected — return a failure result
      return {
        success: false,
        output: '',
        filesModified: [],
        tokensUsed: 0,
        turnsCompleted: 0,
        error: r.reason?.message ?? String(r.reason),
        duration: 0,
      } as SubAgentResult;
    });
  }

  /**
   * Get the result of a completed sub-agent.
   *
   * @param taskId  The task ID
   * @returns       The result, or undefined if not completed
   */
  getResult(taskId: string): SubAgentResult | undefined {
    const record = this.records.get(taskId);
    if (!record || record.status !== 'completed') return undefined;
    return record.result;
  }

  /**
   * Get the current nesting depth of this manager.
   * Useful for checking whether further sub-agent spawning is allowed.
   */
  get depth(): number {
    return this.currentDepth;
  }

  /**
   * Check whether this manager can spawn additional sub-agents
   * (i.e., we haven't hit the max depth).
   */
  get canSpawn(): boolean {
    return this.currentDepth < this.maxGlobalDepth;
  }

  // ----------------------------------------------------------
  // Private — Record Management
  // ----------------------------------------------------------

  /**
   * Generate a unique task ID.
   */
  private generateTaskId(name: string): string {
    this.taskCounter++;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
    return `sub-${slug}-${this.taskCounter}-${Date.now().toString(36)}`;
  }

  /**
   * Apply default values to a SubAgentConfig.
   */
  private applyDefaults(config: SubAgentConfig): SubAgentConfig {
    return {
      name: config.name,
      systemPrompt: config.systemPrompt,
      allowedTools: config.allowedTools,
      deniedTools: config.deniedTools ?? [],
      fileScope: config.fileScope ?? {
        allowedPaths: [this.workingDirectory],
        deniedPaths: [],
      },
      resourceLimits: {
        maxTokens: config.resourceLimits?.maxTokens ?? DEFAULT_RESOURCE_LIMITS.maxTokens,
        maxTurns: config.resourceLimits?.maxTurns ?? DEFAULT_RESOURCE_LIMITS.maxTurns,
        timeoutMs: config.resourceLimits?.timeoutMs ?? DEFAULT_RESOURCE_LIMITS.timeoutMs,
      },
      model: config.model ?? this.defaultModel,
      maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
      mode: config.mode ?? 'sequential',
    };
  }

  /**
   * Validate a SubAgentConfig, throwing if it's invalid.
   */
  private validateConfig(config: SubAgentConfig): void {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error('Sub-agent config must have a non-empty name');
    }
    if (!config.systemPrompt || config.systemPrompt.trim().length === 0) {
      throw new Error('Sub-agent config must have a non-empty systemPrompt');
    }
    if (!config.allowedTools || config.allowedTools.length === 0) {
      throw new Error('Sub-agent config must specify at least one allowed tool');
    }
    if (config.resourceLimits.maxTokens <= 0) {
      throw new Error('Sub-agent resourceLimits.maxTokens must be > 0');
    }
    if (config.resourceLimits.maxTurns <= 0) {
      throw new Error('Sub-agent resourceLimits.maxTurns must be > 0');
    }
    if (config.resourceLimits.timeoutMs <= 0) {
      throw new Error('Sub-agent resourceLimits.timeoutMs must be > 0');
    }

    // Check nesting depth
    const nextDepth = this.currentDepth + 1;
    if (nextDepth > this.maxGlobalDepth) {
      throw new Error(
        `Cannot spawn sub-agent: nesting depth ${nextDepth} exceeds maximum ${this.maxGlobalDepth}`,
      );
    }
    if (config.maxDepth > this.maxGlobalDepth) {
      throw new Error(
        `Sub-agent maxDepth ${config.maxDepth} exceeds global maximum ${this.maxGlobalDepth}`,
      );
    }

    // Validate that allowed tools exist in the parent registry
    for (const toolName of config.allowedTools) {
      if (!this.parentRegistry.has(toolName)) {
        throw new Error(
          `Allowed tool "${toolName}" does not exist in the parent tool registry`,
        );
      }
    }
  }

  /**
   * Create a SubAgentRecord for tracking the sub-agent lifecycle.
   */
  private createRecord(
    taskId: string,
    config: SubAgentConfig,
    prompt: string,
  ): SubAgentRecord {
    let completionResolve: ((result: SubAgentResult) => void) | null = null;
    let completionReject: ((error: Error) => void) | null = null;
    const completionPromise = new Promise<SubAgentResult>((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;
    });

    const record: SubAgentRecord = {
      taskId,
      config,
      prompt,
      status: 'pending',
      depth: this.currentDepth + 1,
      workingDirectory: this.workingDirectory,
      sessionId: this.sessionId,
      abortController: new AbortController(),
      startedAt: Date.now(),
      fileSnapshot: new Map(),
      completionPromise,
      completionResolve,
      completionReject,
    };

    this.records.set(taskId, record);
    return record;
  }

  // ----------------------------------------------------------
  // Private — Execution Engine
  // ----------------------------------------------------------

  /**
   * Execute a sub-agent: create a scoped BaseAgent, run it with
   * resource limit enforcement, and collect results.
   */
  private async executeSubAgent(
    record: SubAgentRecord,
    config: SubAgentConfig,
    prompt: string,
  ): Promise<SubAgentResult> {
    record.status = 'running';
    this.emit('subagent:started', record.taskId, config.name);

    const startTime = Date.now();
    const abortSignal = record.abortController.signal;

    // Take a file snapshot before execution
    const snapshot = new FileSnapshot(this.workingDirectory, config.fileScope);
    record.fileSnapshot = snapshot.take();

    // Build the scoped tool registry
    const scopedRegistry = new ScopedToolRegistry(
      this.parentRegistry,
      config.allowedTools,
      config.deniedTools ?? [],
      config.fileScope,
      this.workingDirectory,
    );

    // Build the AgentConfig for the sub-agent's BaseAgent
    const agentConfig: AgentConfig = {
      name: config.name,
      description: `Sub-agent: ${config.name}`,
      systemPrompt: this.buildSubAgentSystemPrompt(config),
      model: config.model,
      maxTokens: config.resourceLimits.maxTokens,
      maxIterations: config.resourceLimits.maxTurns,
      tools: config.allowedTools.filter((t) => !(config.deniedTools ?? []).includes(t)),
      autoApprove: true, // Sub-agents auto-approve; the parent already gated access
      temperature: 0.5,
    };

    // Create the temporary BaseAgent
    const agent = new BaseAgent(
      agentConfig,
      this.client,
      scopedRegistry,
      this.workingDirectory,
      `${this.sessionId}-sub-${record.taskId}`,
    );

    // Set up timeout
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    if (config.resourceLimits.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        record.abortController.abort();
      }, config.resourceLimits.timeoutMs);
    }

    // Resource-tracking state
    let totalTokensUsed = 0;
    let turnsCompleted = 0;

    // Callbacks that enforce resource limits
    const resourceCallbacks: AgentCallbacks = {
      onIteration: (iteration: number, _maxIterations: number) => {
        turnsCompleted = iteration;

        // Check for abort (timeout or explicit cancel)
        if (abortSignal.aborted) {
          throw new Error(
            timedOut
              ? `Sub-agent "${config.name}" timed out after ${config.resourceLimits.timeoutMs}ms`
              : `Sub-agent "${config.name}" was cancelled`,
          );
        }

        // Check token budget
        if (totalTokensUsed >= config.resourceLimits.maxTokens) {
          throw new Error(
            `Sub-agent "${config.name}" exceeded token budget of ${config.resourceLimits.maxTokens}`,
          );
        }
      },

      onToolCall: (_toolName: string, _args: Record<string, unknown>) => {
        // Check for abort before each tool call
        if (abortSignal.aborted) {
          throw new Error(
            timedOut
              ? `Sub-agent "${config.name}" timed out`
              : `Sub-agent "${config.name}" was cancelled`,
          );
        }
      },
    };

    try {
      // Run the sub-agent
      const runResult: AgentRunResult = await agent.run(prompt, resourceCallbacks);

      // Clear timeout
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);

      // Account for token usage
      totalTokensUsed = runResult.usage.inputTokens + runResult.usage.outputTokens;

      // Detect file changes
      const fileChanges = snapshot.diff();
      const filesModified = fileChanges.map((fc) =>
        relative(this.workingDirectory, fc.path) || fc.path,
      );

      const result: SubAgentResult = {
        success: true,
        output: runResult.content || '',
        filesModified,
        tokensUsed: totalTokensUsed,
        turnsCompleted: runResult.iterations,
        duration: Date.now() - startTime,
      };

      record.status = 'completed';
      record.result = result;
      record.completedAt = Date.now();
      record.completionResolve?.(result);
      this.emit('subagent:completed', record.taskId, result);

      return result;
    } catch (err) {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);

      // If timed out, set the appropriate status
      if (timedOut) {
        record.status = 'timed_out';
      }

      const error = err instanceof Error ? err : new Error(String(err));

      // Detect file changes even on failure (partial modifications are important)
      const fileChanges = snapshot.diff();
      const filesModified = fileChanges.map((fc) =>
        relative(this.workingDirectory, fc.path) || fc.path,
      );

      const result: SubAgentResult = {
        success: false,
        output: '',
        filesModified,
        tokensUsed: totalTokensUsed,
        turnsCompleted,
        error: error.message,
        duration: Date.now() - startTime,
      };

      record.result = result;
      record.completedAt = Date.now();

      if (record.status === 'running') {
        record.status = 'failed';
      }

      this.emit('subagent:failed', record.taskId, error.message);

      // For sequential mode, re-throw so the caller knows it failed
      if (config.mode === 'sequential') {
        throw error;
      }

      // For async mode, the result is stored and accessible via getStatus/getResult
      return result;
    }
  }

  /**
   * Build the system prompt for a sub-agent, combining the user-provided
   * system prompt with context about the sub-agent's restrictions.
   */
  private buildSubAgentSystemPrompt(config: SubAgentConfig): string {
    let prompt = config.systemPrompt;

    prompt += `\n\n## Sub-Agent Context`;
    prompt += `\n- You are a sub-agent named "${config.name}"`;
    prompt += `\n- Available tools: ${config.allowedTools.filter((t) => !(config.deniedTools ?? []).includes(t)).join(', ')}`;

    if (config.fileScope) {
      const allowedPaths = config.fileScope.allowedPaths.join(', ') || '(none)';
      const deniedPaths = config.fileScope.deniedPaths.join(', ') || '(none)';
      prompt += `\n- Allowed file paths: ${allowedPaths}`;
      prompt += `\n- Denied file paths: ${deniedPaths}`;
      prompt += `\n- IMPORTANT: You can only access files within the allowed paths. Attempts to access other paths will be denied.`;
    }

    prompt += `\n- Token budget: ${config.resourceLimits.maxTokens.toLocaleString()} tokens`;
    prompt += `\n- Turn limit: ${config.resourceLimits.maxTurns} turns`;
    prompt += `\n- Timeout: ${Math.round(config.resourceLimits.timeoutMs / 1000)} seconds`;

    if (config.maxDepth > 0 && this.currentDepth + 1 < this.maxGlobalDepth) {
      prompt += `\n- You may spawn sub-agents up to depth ${config.maxDepth}`;
    } else {
      prompt += `\n- You cannot spawn further sub-agents (depth limit reached)`;
    }

    prompt += `\n\n## Sub-Agent Guidelines
- Work efficiently within your resource limits
- Focus on the specific task you were given
- Do not attempt to access files or tools outside your scope
- When you complete your task, provide a clear summary of what you did
- If you encounter scope violations, report them rather than retrying`;

    return prompt;
  }

  // ----------------------------------------------------------
  // Private — Utilities
  // ----------------------------------------------------------

  /**
   * Clean up completed/failed/cancelled sub-agent records.
   * Returns the number of records cleaned up.
   */
  cleanup(): number {
    let cleaned = 0;
    for (const [id, record] of this.records) {
      if (
        record.status === 'completed' ||
        record.status === 'failed' ||
        record.status === 'cancelled' ||
        record.status === 'timed_out'
      ) {
        this.records.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// ============================================================
// SubAgentTool — A tool that allows agents to spawn sub-agents
// ============================================================

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
export class SubAgentTool implements ToolExecutor {
  name = 'spawn_sub_agent';
  description =
    'Spawn a sub-agent to perform a specific task. The sub-agent runs with restricted tools and resources. Use this to delegate focused work to a specialist agent.';
  risk: 'low' | 'medium' | 'high' = 'medium';

  definition: ToolDefinition = {
    name: 'spawn_sub_agent',
    description:
      'Spawn a sub-agent to perform a specific task. The sub-agent runs with restricted tools and resources. Use this to delegate focused work to a specialist agent.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'A descriptive name for the sub-agent (e.g., "code-searcher", "test-runner")',
        },
        prompt: {
          type: 'string',
          description: 'The task to assign to the sub-agent',
        },
        allowedTools: {
          type: 'string',
          description:
            'Comma-separated list of tool names the sub-agent can use (e.g., "read_file,search_files,list_directory")',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens the sub-agent may consume (default: 50000)',
        },
        maxTurns: {
          type: 'number',
          description: 'Maximum number of turns the sub-agent may take (default: 10)',
        },
        timeoutSeconds: {
          type: 'number',
          description: 'Timeout in seconds for the sub-agent (default: 60)',
        },
      },
      required: ['name', 'prompt', 'allowedTools'],
    },
  };

  private manager: SubAgentManager;

  constructor(manager: SubAgentManager) {
    this.manager = manager;
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<string> {
    const name = args.name as string;
    const prompt = args.prompt as string;
    const allowedToolsStr = args.allowedTools as string;
    const maxTokens = (args.maxTokens as number) ?? 50_000;
    const maxTurns = (args.maxTurns as number) ?? 10;
    const timeoutSeconds = (args.timeoutSeconds as number) ?? 60;

    if (!name || !prompt || !allowedToolsStr) {
      return 'ERROR: Missing required parameters: name, prompt, allowedTools';
    }

    const allowedTools = allowedToolsStr
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (allowedTools.length === 0) {
      return 'ERROR: At least one tool must be specified in allowedTools';
    }

    // Check if the manager can still spawn
    if (!this.manager.canSpawn) {
      return 'ERROR: Maximum sub-agent nesting depth reached. Cannot spawn further sub-agents.';
    }

    const config: SubAgentConfig = {
      name,
      systemPrompt: `You are a specialized sub-agent named "${name}". Focus on completing the specific task you are assigned efficiently.`,
      allowedTools,
      resourceLimits: {
        maxTokens,
        maxTurns,
        timeoutMs: timeoutSeconds * 1000,
      },
      maxDepth: DEFAULT_MAX_DEPTH,
      mode: 'sequential',
    };

    try {
      const result = await this.manager.spawn(config, prompt);

      if (result.success) {
        let output = `Sub-agent "${name}" completed successfully.\n`;
        output += `Duration: ${Math.round(result.duration / 1000)}s | Tokens: ${result.tokensUsed.toLocaleString()} | Turns: ${result.turnsCompleted}\n`;
        if (result.filesModified.length > 0) {
          output += `Files modified: ${result.filesModified.join(', ')}\n`;
        }
        output += `\nResult:\n${result.output}`;
        return output;
      } else {
        return `Sub-agent "${name}" failed: ${result.error}\nTokens used: ${result.tokensUsed.toLocaleString()} | Turns: ${result.turnsCompleted}`;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return `ERROR: Sub-agent "${name}" encountered an error: ${error}`;
    }
  }

  getApprovalRequest?(args: Record<string, unknown>): import('../core/types.js').ApprovalRequest {
    // Sub-agent spawning is medium risk — it could modify files
    // but is already scoped by the config
    return {
      toolName: this.name,
      args,
      risk: 'medium',
      description: `Spawn sub-agent "${args.name}" with tools: ${args.allowedTools}`,
    };
  }
}

// ============================================================
// Helper — Create a SubAgentManager from a NeuroEngine context
// ============================================================

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
export function createSubAgentManager(
  client: OpenRouterClient,
  registry: ToolRegistry,
  workingDir: string,
  sessionId: string,
  defaultModel: string = 'qwen/qwen3-coder:free',
  parentDepth: number = 0,
): SubAgentManager {
  return new SubAgentManager(
    client,
    registry,
    workingDir,
    sessionId,
    defaultModel,
    parentDepth,
    DEFAULT_MAX_DEPTH,
  );
}
