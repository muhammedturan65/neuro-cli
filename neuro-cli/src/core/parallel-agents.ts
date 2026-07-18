// ============================================================
// NeuroCLI - Parallel Agent Manager
// Parallel execution of multiple agents with shared state,
// resource limits, and coordination — inspired by Claude Code
// sub-agents and Cursor CLI parallel agents.
// Uses only Node.js built-in modules.
// ============================================================

import { EventEmitter } from 'events';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

// ---- Exported Interfaces ----

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
  progress: number; // 0-100
}

// ---- Internal Types ----

interface AgentRecord {
  config: ParallelAgentConfig;
  state: ParallelAgentState;
  abortController: AbortController;
  sharedState: Record<string, unknown>;
  sandboxDir: string;
  /** Resolves when the agent completes. */
  completionPromise: Promise<string>;
  /** Resolves (or rejects) the completion promise. */
  completionResolve: ((result: string) => void) | null;
  completionReject: ((error: Error) => void) | null;
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

// ---- Constants ----

const DEFAULT_MAX_CONCURRENT = 5;
const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_MAX_TOKENS = 200_000;
const PRIORITY_ORDER: Record<string, number> = { high: 3, normal: 2, low: 1 };
const SANDBOX_BASE_DIR = join(tmpdir(), 'neuro-cli-agents');

// ============================================================
// ParallelAgentManager
// ============================================================

export class ParallelAgentManager extends EventEmitter {
  private agents: Map<string, AgentRecord> = new Map();
  private maxConcurrent: number;
  private globalSharedState: Record<string, unknown>;
  private onAgentCompleteCallbacks: AgentCompleteCallback[] = [];
  private onAgentErrorCallbacks: AgentErrorCallback[] = [];
  /** Queue of agent IDs waiting to run when a slot opens. */
  private pendingQueue: string[] = [];

  constructor(options?: { maxConcurrent?: number; sharedState?: Record<string, unknown> }) {
    super();
    this.maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.globalSharedState = options?.sharedState ?? {};
  }

  // ---- Public API ----

  /**
   * Spawn a new parallel agent. If `config.autoStart` is true the agent
   * begins running immediately (subject to the concurrency limit).
   * Returns the agent ID.
   */
  spawn(config: ParallelAgentConfig): string {
    if (this.agents.has(config.id)) {
      throw new Error(`Agent with id "${config.id}" already exists`);
    }

    const sandboxDir = join(SANDBOX_BASE_DIR, config.id);
    this.ensureDir(sandboxDir);

    // Merge global + per-agent shared state (per-agent takes precedence)
    const mergedSharedState: Record<string, unknown> = {
      ...this.globalSharedState,
      ...config.sharedState,
    };

    const state: ParallelAgentState = {
      id: config.id,
      name: config.name,
      status: 'spawning',
      startedAt: Date.now(),
      iterations: 0,
      tokensUsed: 0,
      progress: 0,
    };

    // Create the completion promise wiring up-front
    let completionResolve: ((result: string) => void) | null = null;
    let completionReject: ((error: Error) => void) | null = null;
    const completionPromise = new Promise<string>((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;
    });

    const record: AgentRecord = {
      config,
      state,
      abortController: new AbortController(),
      sharedState: mergedSharedState,
      sandboxDir,
      completionPromise,
      completionResolve,
      completionReject,
    };

    this.agents.set(config.id, record);

    if (config.autoStart) {
      this.scheduleStart(config.id);
    }

    return config.id;
  }

  /**
   * Cancel a running (or pending) agent.
   */
  cancel(agentId: string): boolean {
    const record = this.agents.get(agentId);
    if (!record) return false;

    if (record.state.status === 'completed' || record.state.status === 'failed' || record.state.status === 'cancelled') {
      return false;
    }

    record.abortController.abort();
    record.state.status = 'cancelled';
    record.state.completedAt = Date.now();
    record.state.progress = record.state.progress; // freeze progress

    // Remove from pending queue if applicable
    this.pendingQueue = this.pendingQueue.filter((id) => id !== agentId);

    // Reject the completion promise so waiters unblock
    record.completionReject?.(new Error(`Agent "${agentId}" was cancelled`));

    this.emit('agent:cancelled', agentId, record.state);
    this.tryStartPending();

    return true;
  }

  /**
   * Cancel all running and pending agents.
   */
  cancelAll(): number {
    let count = 0;
    const ids = Array.from(this.agents.keys());
    for (const id of ids) {
      if (this.cancel(id)) count++;
    }
    return count;
  }

  /**
   * Get the state of a specific agent.
   */
  getStatus(agentId: string): ParallelAgentState | null {
    const record = this.agents.get(agentId);
    if (!record) return null;
    return { ...record.state };
  }

  /**
   * List all currently running agents (status === 'running' | 'spawning').
   */
  listActive(): ParallelAgentState[] {
    const active: ParallelAgentState[] = [];
    const records = Array.from(this.agents.values());
    for (const record of records) {
      if (record.state.status === 'running' || record.state.status === 'spawning') {
        active.push({ ...record.state });
      }
    }
    return active.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * List all agents including completed ones.
   */
  listAll(): ParallelAgentState[] {
    const all: ParallelAgentState[] = [];
    const records = Array.from(this.agents.values());
    for (const record of records) {
      all.push({ ...record.state });
    }
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Wait for a specific agent to complete and return its result.
   * Rejects if the agent was cancelled or failed.
   */
  async waitFor(agentId: string): Promise<string> {
    const record = this.agents.get(agentId);
    if (!record) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    // If already completed, return immediately
    if (record.state.status === 'completed') {
      return record.state.result ?? '';
    }
    // If already failed/cancelled, throw
    if (record.state.status === 'failed' || record.state.status === 'cancelled') {
      throw new Error(record.state.error ?? `Agent "${agentId}" ${record.state.status}`);
    }

    return record.completionPromise;
  }

  /**
   * Wait for all currently running agents to finish.
   * Returns a map of agentId → result (or error message on failure).
   */
  async waitForAll(): Promise<Map<string, { result?: string; error?: string }>> {
    const runningIds: string[] = [];
    const records = Array.from(this.agents.values());
    for (const record of records) {
      if (
        record.state.status === 'running' ||
        record.state.status === 'spawning'
      ) {
        runningIds.push(record.state.id);
      }
    }

    const results = new Map<string, { result?: string; error?: string }>();

    const promises = runningIds.map(async (id) => {
      try {
        const result = await this.waitFor(id);
        results.set(id, { result });
      } catch (err) {
        results.set(id, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Get the result of a completed agent.
   */
  getResult(agentId: string): string | null {
    const record = this.agents.get(agentId);
    if (!record || record.state.status !== 'completed') return null;
    return record.state.result ?? null;
  }

  /**
   * Broadcast a message to all running agents' shared state.
   * The message is stored under `sharedState.__broadcasts`.
   */
  broadcastMessage(message: string): number {
    let delivered = 0;
    const records = Array.from(this.agents.values());
    for (const record of records) {
      if (record.state.status !== 'running') continue;

      const broadcasts = (record.sharedState.__broadcasts as string[] | undefined) ?? [];
      broadcasts.push(message);
      record.sharedState.__broadcasts = broadcasts;
      delivered++;
    }
    this.emit('broadcast', message, delivered);
    return delivered;
  }

  /**
   * Register a callback for when any agent completes successfully.
   */
  onAgentComplete(callback: AgentCompleteCallback): void {
    this.onAgentCompleteCallbacks.push(callback);
  }

  /**
   * Register a callback for when any agent encounters an error.
   */
  onAgentError(callback: AgentErrorCallback): void {
    this.onAgentErrorCallbacks.push(callback);
  }

  /**
   * Get aggregate metrics across all agents.
   */
  getMetrics(): ParallelAgentMetrics {
    let activeAgents = 0;
    let completedAgents = 0;
    let failedAgents = 0;
    let cancelledAgents = 0;
    let totalDurationMs = 0;
    let totalTokensUsed = 0;

    const allRecords = Array.from(this.agents.values());
    for (const record of allRecords) {
      switch (record.state.status) {
        case 'spawning':
        case 'running':
          activeAgents++;
          break;
        case 'completed':
          completedAgents++;
          break;
        case 'failed':
          failedAgents++;
          break;
        case 'cancelled':
          cancelledAgents++;
          break;
      }

      totalTokensUsed += record.state.tokensUsed;

      if (record.state.completedAt) {
        totalDurationMs += record.state.completedAt - record.state.startedAt;
      }
    }

    const agentsWithDuration = completedAgents + failedAgents + cancelledAgents;

    return {
      totalAgents: this.agents.size,
      activeAgents,
      completedAgents,
      failedAgents,
      cancelledAgents,
      averageDurationMs: agentsWithDuration > 0 ? Math.round(totalDurationMs / agentsWithDuration) : 0,
      totalTokensUsed,
    };
  }

  /**
   * Read a value from the shared state of a specific agent.
   */
  getSharedValue(agentId: string, key: string): unknown {
    const record = this.agents.get(agentId);
    if (!record) return undefined;
    return record.sharedState[key];
  }

  /**
   * Write a value to the shared state of a specific agent.
   * Also writes to the global shared state so future agents inherit it.
   */
  setSharedValue(agentId: string, key: string, value: unknown): boolean {
    const record = this.agents.get(agentId);
    if (!record) return false;
    record.sharedState[key] = value;
    this.globalSharedState[key] = value;
    return true;
  }

  /**
   * Update the progress of a running agent (0-100).
   */
  updateProgress(agentId: string, progress: number): boolean {
    const record = this.agents.get(agentId);
    if (!record || record.state.status !== 'running') return false;
    record.state.progress = Math.max(0, Math.min(100, progress));
    this.emit('agent:progress', agentId, record.state.progress);
    return true;
  }

  /**
   * Clean up sandbox directories for completed/failed/cancelled agents.
   */
  cleanup(): number {
    let cleaned = 0;
    const entries = Array.from(this.agents.entries());
    for (const [id, record] of entries) {
      if (
        record.state.status === 'completed' ||
        record.state.status === 'failed' ||
        record.state.status === 'cancelled'
      ) {
        try {
          if (existsSync(record.sandboxDir)) {
            rmSync(record.sandboxDir, { recursive: true, force: true });
          }
        } catch {
          // Best-effort cleanup
        }
        cleaned++;
      }
    }
    return cleaned;
  }

  // ---- Private Helpers ----

  /**
   * Schedule an agent to start. If we're at the concurrency limit,
   * the agent is placed in the pending queue.
   */
  private scheduleStart(agentId: string): void {
    const record = this.agents.get(agentId);
    if (!record) return;

    if (this.activeCount() >= this.maxConcurrent) {
      // Enqueue by priority
      this.pendingQueue.push(agentId);
      this.pendingQueue.sort((a, b) => {
        const ra = this.agents.get(a);
        const rb = this.agents.get(b);
        const pa = ra ? PRIORITY_ORDER[ra.config.priority] ?? 2 : 2;
        const pb = rb ? PRIORITY_ORDER[rb.config.priority] ?? 2 : 2;
        return pb - pa; // higher priority first
      });
      this.emit('agent:queued', agentId);
      return;
    }

    this.runAgent(agentId);
  }

  /**
   * Actually start running an agent.
   */
  private runAgent(agentId: string): void {
    const record = this.agents.get(agentId);
    if (!record) return;

    record.state.status = 'running';
    record.state.startedAt = Date.now();
    this.emit('agent:started', agentId, record.state);

    // Run the agent loop asynchronously
    this.executeAgentLoop(record)
      .then((result) => {
        record.state.status = 'completed';
        record.state.result = result;
        record.state.completedAt = Date.now();
        record.state.progress = 100;
        record.completionResolve?.(result);
        this.fireCompleteCallbacks(agentId, record.state);
        this.emit('agent:completed', agentId, record.state);
        this.tryStartPending();
      })
      .catch((err: unknown) => {
        if (record.state.status === 'cancelled') {
          // Already handled by cancel()
          return;
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        record.state.status = 'failed';
        record.state.error = errorMsg;
        record.state.completedAt = Date.now();
        record.completionReject?.(err instanceof Error ? err : new Error(errorMsg));
        this.fireErrorCallbacks(agentId, errorMsg, record.state);
        this.emit('agent:error', agentId, errorMsg, record.state);
        this.tryStartPending();
      });
  }

  /**
   * The core agent execution loop.
   *
   * In a real implementation this would call an LLM, execute tools, etc.
   * Here we simulate the loop with AbortController support, token tracking,
   * iteration limits, and sandboxed file I/O — all using only Node built-ins.
   */
  private async executeAgentLoop(record: AgentRecord): Promise<string> {
    const maxIterations = record.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxTokens = record.config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const workingDir = record.config.workingDirectory ?? record.sandboxDir;
    const abortSignal = record.abortController.signal;

    const outputLines: string[] = [`Agent "${record.config.name}" (${record.config.id}) started.`];

    // Persist initial context to sandbox
    this.persistContext(record);

    for (let i = 0; i < maxIterations; i++) {
      // Check for cancellation
      if (abortSignal.aborted) {
        throw new Error(`Agent "${record.config.id}" was cancelled`);
      }

      // Simulate token usage per iteration
      const estimatedTokens = this.estimateTokens(record.config.prompt, i);
      record.state.tokensUsed += estimatedTokens;

      // Enforce token limit
      if (record.state.tokensUsed >= maxTokens) {
        outputLines.push(`Token limit reached (${maxTokens}). Stopping.`);
        break;
      }

      record.state.iterations = i + 1;

      // Update progress
      record.state.progress = Math.min(
        Math.round(((i + 1) / maxIterations) * 100),
        100
      );

      // Simulate one iteration of work (non-blocking)
      await this.yieldControl();

      // Simulate: write intermediate output to sandbox
      this.writeIterationLog(record, i, outputLines);

      // Check broadcasts in shared state
      const broadcasts = record.sharedState.__broadcasts as string[] | undefined;
      if (broadcasts && broadcasts.length > 0) {
        outputLines.push(`[broadcast received]: ${broadcasts.join('; ')}`);
        // Agent consumes broadcasts
        record.sharedState.__broadcasts = [];
      }

      // For demonstration, we complete after a few iterations.
      // In production, the agent would decide based on LLM output.
      if (i >= 2) {
        outputLines.push(`Task completed after ${i + 1} iterations.`);
        break;
      }
    }

    // Persist final context
    this.persistContext(record);

    const finalResult = outputLines.join('\n');
    return finalResult;
  }

  /**
   * Yield control to the event loop so other agents can progress.
   * Uses setImmediate for true interleaving.
   */
  private yieldControl(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Rough token estimation (heuristic: ~4 chars per token).
   */
  private estimateTokens(prompt: string, iteration: number): number {
    // Base cost from prompt + incremental cost per iteration
    const baseCost = Math.ceil(prompt.length / 4);
    const iterationCost = 50 + Math.floor(Math.random() * 150); // simulated
    return baseCost * (iteration === 0 ? 1 : 0) + iterationCost;
  }

  /**
   * Persist the agent's context to its sandbox directory.
   */
  private persistContext(record: AgentRecord): void {
    try {
      const contextPath = join(record.sandboxDir, 'context.json');
      const context = {
        id: record.config.id,
        name: record.config.name,
        prompt: record.config.prompt,
        model: record.config.model,
        sharedState: record.sharedState,
        state: record.state,
        updatedAt: Date.now(),
      };
      writeFileSync(contextPath, JSON.stringify(context, null, 2), 'utf-8');
    } catch {
      // Non-critical — context persistence is best-effort
    }
  }

  /**
   * Write an iteration log to the sandbox directory.
   */
  private writeIterationLog(
    record: AgentRecord,
    iteration: number,
    outputLines: string[]
  ): void {
    try {
      const logPath = join(record.sandboxDir, `iter_${iteration}.log`);
      writeFileSync(
        logPath,
        JSON.stringify(
          {
            agentId: record.config.id,
            iteration,
            tokensUsed: record.state.tokensUsed,
            progress: record.state.progress,
            lastOutput: outputLines[outputLines.length - 1],
            timestamp: Date.now(),
          },
          null,
          2
        ),
        'utf-8'
      );
    } catch {
      // Non-critical
    }
  }

  /**
   * When a slot opens, try to start the highest-priority pending agent.
   */
  private tryStartPending(): void {
    while (this.pendingQueue.length > 0 && this.activeCount() < this.maxConcurrent) {
      const nextId = this.pendingQueue.shift()!;
      const record = this.agents.get(nextId);
      if (!record || record.state.status === 'cancelled') continue;
      this.runAgent(nextId);
    }
  }

  /**
   * Count currently active (spawning + running) agents.
   */
  private activeCount(): number {
    let count = 0;
    const records = Array.from(this.agents.values());
    for (const record of records) {
      if (record.state.status === 'spawning' || record.state.status === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   * Fire all registered onAgentComplete callbacks.
   */
  private fireCompleteCallbacks(agentId: string, state: ParallelAgentState): void {
    for (const cb of this.onAgentCompleteCallbacks) {
      try {
        cb(agentId, state);
      } catch {
        // Subscriber errors must not break the manager
      }
    }
  }

  /**
   * Fire all registered onAgentError callbacks.
   */
  private fireErrorCallbacks(agentId: string, error: string, state: ParallelAgentState): void {
    for (const cb of this.onAgentErrorCallbacks) {
      try {
        cb(agentId, error, state);
      } catch {
        // Subscriber errors must not break the manager
      }
    }
  }

  /**
   * Ensure a directory exists.
   */
  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
