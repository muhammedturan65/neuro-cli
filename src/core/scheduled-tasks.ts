// ============================================================
// NeuroCLI - Scheduled Tasks
// Recurring / scheduled task execution similar to Claude Code's
// /loop command.  Supports cron-like intervals, persistence,
// execution history, and pausing / resuming.
// Uses ONLY Node.js built-in modules.
// ============================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Interfaces & Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type IntervalUnit = 'minutes' | 'hours' | 'days';

export interface ScheduledTaskConfig {
  /** Unique identifier (auto-generated if not provided) */
  id: string;
  /** Human-readable name */
  name: string;
  /** The prompt / task description to execute each run */
  prompt: string;
  /** Interval value (used together with intervalUnit) */
  interval: number;
  /** Unit for the interval */
  intervalUnit: IntervalUnit;
  /** Maximum number of runs – 0 = unlimited */
  maxRuns: number;
  /** Optional model override */
  model?: string;
  /** Whether to auto-approve tool calls during execution */
  autoApprove: boolean;
  /** Whether to notify on completion (platform-dependent) */
  notifyOnComplete: boolean;
  /** Whether to save results to a file */
  saveResults: boolean;
  /** Working directory for the task */
  workingDirectory: string;
}

export interface TaskExecution {
  /** Unique execution ID */
  id: string;
  /** The task this execution belongs to */
  taskId: string;
  /** ISO timestamp when execution started */
  startedAt: string;
  /** ISO timestamp when execution ended */
  endedAt?: string;
  /** Duration in ms */
  durationMs?: number;
  /** Execution status */
  status: 'success' | 'error' | 'timeout' | 'aborted';
  /** The prompt that was executed (may differ from task if templated) */
  prompt: string;
  /** Result text */
  result?: string;
  /** Error message if status is error */
  error?: string;
  /** Number of iterations used */
  iterations: number;
  /** Cost in USD */
  cost: number;
  /** Files modified during this execution */
  filesChanged: number;
  /** Commands run during this execution */
  commandsRun: number;
}

export interface ScheduledTaskState {
  config: ScheduledTaskConfig;
  status: TaskStatus;
  /** Number of completed runs so far */
  runCount: number;
  /** Number of failed runs */
  failCount: number;
  /** ISO timestamp of last successful run */
  lastRunAt?: string;
  /** ISO timestamp of next scheduled run */
  nextRunAt?: string;
  /** ISO timestamp when the task was created */
  createdAt: string;
  /** ISO timestamp when the task was last updated */
  updatedAt: string;
  /** Execution history (most recent first, capped at 100) */
  history: TaskExecution[];
  /** Accumulated cost across all runs */
  totalCost: number;
  /** Accumulated iterations across all runs */
  totalIterations: number;
}

// ---------------------------------------------------------------------------
// Engine contract – mirrors the one in auto-mode.ts but kept self-contained
// ---------------------------------------------------------------------------

export interface ScheduledTaskEngine {
  /** Run a prompt and return structured results */
  runPrompt(prompt: string, model?: string, workingDir?: string): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    filesChanged: number;
    commandsRun: number;
    iterations: number;
    error?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEURO_DIR = join(homedir(), '.neuro');
const TASKS_FILE = join(NEURO_DIR, 'scheduled-tasks.json');
const RESULTS_DIR = join(NEURO_DIR, 'scheduled-results');

const MAX_HISTORY_PER_TASK = 100;
const MAX_RESULT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// ScheduledTaskManager
// ---------------------------------------------------------------------------

export class ScheduledTaskManager {
  private tasks: Map<string, ScheduledTaskState> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private engine: ScheduledTaskEngine | null = null;
  private shuttingDown: boolean = false;

  constructor(engine?: ScheduledTaskEngine) {
    if (engine) this.engine = engine;
    this.loadTasks();
    this.registerShutdownHooks();
  }

  // -----------------------------------------------------------------------
  // Engine registration
  // -----------------------------------------------------------------------

  /** Set or replace the execution engine */
  setEngine(engine: ScheduledTaskEngine): void {
    this.engine = engine;
  }

  // -----------------------------------------------------------------------
  // Task CRUD
  // -----------------------------------------------------------------------

  /**
   * Schedule a new recurring task.
   * Returns the full task state including its generated ID.
   */
  scheduleTask(config: Omit<ScheduledTaskConfig, 'id'> & { id?: string }): ScheduledTaskState {
    const id = config.id ?? randomUUID();
    const fullConfig: ScheduledTaskConfig = { ...config, id };

    const now = new Date().toISOString();
    const intervalMs = this.intervalToMs(fullConfig.interval, fullConfig.intervalUnit);
    const nextRunAt = new Date(Date.now() + intervalMs).toISOString();

    const state: ScheduledTaskState = {
      config: fullConfig,
      status: 'scheduled',
      runCount: 0,
      failCount: 0,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
      history: [],
      totalCost: 0,
      totalIterations: 0,
    };

    this.tasks.set(id, state);
    this.scheduleTimer(id);
    this.persistTasks();

    return state;
  }

  /** Cancel a scheduled task permanently */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    this.clearTimer(taskId);
    task.status = 'cancelled';
    task.updatedAt = new Date().toISOString();
    task.nextRunAt = undefined;
    this.persistTasks();

    return true;
  }

  /** List all tasks, optionally filtered by status */
  listTasks(status?: TaskStatus): ScheduledTaskState[] {
    const all = Array.from(this.tasks.values());
    if (status) return all.filter(t => t.status === status);
    return all;
  }

  /** Temporarily pause a task */
  pauseTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'paused') return true; // already paused

    if (task.status !== 'scheduled' && task.status !== 'running') return false;

    this.clearTimer(taskId);
    task.status = 'paused';
    task.nextRunAt = undefined;
    task.updatedAt = new Date().toISOString();
    this.persistTasks();

    return true;
  }

  /** Resume a paused task */
  resumeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'paused') return false;

    const intervalMs = this.intervalToMs(task.config.interval, task.config.intervalUnit);
    task.status = 'scheduled';
    task.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    task.updatedAt = new Date().toISOString();
    this.scheduleTimer(taskId);
    this.persistTasks();

    return true;
  }

  /** Get execution status and history for a task */
  getTaskStatus(taskId: string): ScheduledTaskState | undefined {
    return this.tasks.get(taskId);
  }

  /** Update a task's configuration (resets timer) */
  updateTask(taskId: string, updates: Partial<Omit<ScheduledTaskConfig, 'id'>>): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Apply updates
    Object.assign(task.config, updates);

    // If interval changed, reschedule
    if (updates.interval !== undefined || updates.intervalUnit !== undefined) {
      this.clearTimer(taskId);
      if (task.status === 'scheduled') {
        const intervalMs = this.intervalToMs(task.config.interval, task.config.intervalUnit);
        task.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
        this.scheduleTimer(taskId);
      }
    }

    task.updatedAt = new Date().toISOString();
    this.persistTasks();
    return true;
  }

  /** Delete a task entirely (removes from memory and persistence) */
  deleteTask(taskId: string): boolean {
    if (!this.tasks.has(taskId)) return false;
    this.clearTimer(taskId);
    this.tasks.delete(taskId);
    this.persistTasks();
    return true;
  }

  // -----------------------------------------------------------------------
  // Manual execution
  // -----------------------------------------------------------------------

  /** Manually trigger a task run (outside its schedule) */
  async runTaskNow(taskId: string): Promise<TaskExecution | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (task.status === 'running') return null; // already running

    return this.executeTask(taskId);
  }

  // -----------------------------------------------------------------------
  // Bulk operations
  // -----------------------------------------------------------------------

  /** Pause all scheduled tasks */
  pauseAll(): number {
    let count = 0;
    for (const [id, task] of Array.from(this.tasks.entries())) {
      if (task.status === 'scheduled') {
        this.pauseTask(id);
        count++;
      }
    }
    return count;
  }

  /** Resume all paused tasks */
  resumeAll(): number {
    let count = 0;
    for (const [id, task] of Array.from(this.tasks.entries())) {
      if (task.status === 'paused') {
        this.resumeTask(id);
        count++;
      }
    }
    return count;
  }

  /** Cancel all tasks */
  cancelAll(): number {
    let count = 0;
    for (const id of Array.from(this.tasks.keys())) {
      if (this.cancelTask(id)) count++;
    }
    return count;
  }

  // -----------------------------------------------------------------------
  // Statistics & Reporting
  // -----------------------------------------------------------------------

  /** Get aggregate stats across all tasks */
  getAggregateStats(): {
    totalTasks: number;
    activeTasks: number;
    pausedTasks: number;
    totalRuns: number;
    totalFailures: number;
    totalCost: number;
  } {
    let totalRuns = 0;
    let totalFailures = 0;
    let totalCost = 0;
    let activeTasks = 0;
    let pausedTasks = 0;

    for (const task of Array.from(this.tasks.values())) {
      totalRuns += task.runCount;
      totalFailures += task.failCount;
      totalCost += task.totalCost;
      if (task.status === 'scheduled' || task.status === 'running') activeTasks++;
      if (task.status === 'paused') pausedTasks++;
    }

    return {
      totalTasks: this.tasks.size,
      activeTasks,
      pausedTasks,
      totalRuns,
      totalFailures,
      totalCost,
    };
  }

  /** Get recent executions across all tasks, sorted by time (most recent first) */
  getRecentExecutions(limit: number = 20): TaskExecution[] {
    const all: TaskExecution[] = [];
    for (const task of Array.from(this.tasks.values())) {
      all.push(...task.history);
    }
    all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return all.slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  /** Gracefully shut down – cancels all timers */
  shutdown(): void {
    this.shuttingDown = true;
    for (const id of Array.from(this.timers.keys())) {
      this.clearTimer(id);
    }
    this.persistTasks();
  }

  // -----------------------------------------------------------------------
  // Private – Timer scheduling
  // -----------------------------------------------------------------------

  private scheduleTimer(taskId: string): void {
    this.clearTimer(taskId);

    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'scheduled') return;

    const intervalMs = this.intervalToMs(task.config.interval, task.config.intervalUnit);

    // Calculate delay until next run
    let delay: number;
    if (task.nextRunAt) {
      const nextRun = new Date(task.nextRunAt).getTime();
      delay = Math.max(0, nextRun - Date.now());
    } else {
      delay = intervalMs;
    }

    const timer = setTimeout(async () => {
      await this.onTimerFire(taskId);
    }, delay);

    // Allow the Node.js process to exit cleanly if this is the only timer
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.timers.set(taskId, timer);
  }

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }

  private async onTimerFire(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'scheduled') return;

    await this.executeTask(taskId);

    // Re-schedule if still active
    const updated = this.tasks.get(taskId);
    if (updated && updated.status === 'scheduled') {
      // Check maxRuns
      if (updated.config.maxRuns > 0 && updated.runCount >= updated.config.maxRuns) {
        updated.status = 'completed';
        updated.nextRunAt = undefined;
        updated.updatedAt = new Date().toISOString();
        this.persistTasks();
        return;
      }

      const intervalMs = this.intervalToMs(updated.config.interval, updated.config.intervalUnit);
      updated.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      updated.updatedAt = new Date().toISOString();
      this.persistTasks();
      this.scheduleTimer(taskId);
    }
  }

  // -----------------------------------------------------------------------
  // Private – Task execution
  // -----------------------------------------------------------------------

  private async executeTask(taskId: string): Promise<TaskExecution | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (!this.engine) return null;

    const executionId = randomUUID();
    const execution: TaskExecution = {
      id: executionId,
      taskId,
      startedAt: new Date().toISOString(),
      status: 'success',
      prompt: task.config.prompt,
      iterations: 0,
      cost: 0,
      filesChanged: 0,
      commandsRun: 0,
    };

    // Mark as running
    task.status = 'running';
    this.persistTasks();

    try {
      const result = await this.engine.runPrompt(
        task.config.prompt,
        task.config.model,
        task.config.workingDirectory,
      );

      execution.endedAt = new Date().toISOString();
      execution.durationMs = new Date(execution.endedAt).getTime() - new Date(execution.startedAt).getTime();
      execution.result = result.text;
      execution.iterations = result.iterations;
      execution.cost = result.cost;
      execution.filesChanged = result.filesChanged;
      execution.commandsRun = result.commandsRun;

      if (result.error) {
        execution.status = 'error';
        execution.error = result.error;
        task.failCount++;
      } else {
        execution.status = 'success';
      }

      task.runCount++;
      task.totalCost += result.cost;
      task.totalIterations += result.iterations;
      task.lastRunAt = execution.endedAt;

    } catch (err) {
      execution.endedAt = new Date().toISOString();
      execution.durationMs = new Date(execution.endedAt).getTime() - new Date(execution.startedAt).getTime();
      execution.status = 'error';
      execution.error = err instanceof Error ? err.message : String(err);
      task.failCount++;
      task.runCount++;
    }

    // Add to history
    task.history.unshift(execution);
    if (task.history.length > MAX_HISTORY_PER_TASK) {
      task.history = task.history.slice(0, MAX_HISTORY_PER_TASK);
    }

    // Restore status
    task.status = 'scheduled';
    task.updatedAt = new Date().toISOString();

    // Save results to file if configured
    if (task.config.saveResults && execution.result) {
      this.saveResultToFile(taskId, execution);
    }

    // Notify if configured
    if (task.config.notifyOnComplete) {
      this.notifyCompletion(task.config.name, execution);
    }

    this.persistTasks();
    return execution;
  }

  // -----------------------------------------------------------------------
  // Private – Helpers
  // -----------------------------------------------------------------------

  private intervalToMs(interval: number, unit: IntervalUnit): number {
    switch (unit) {
      case 'minutes': return interval * 60 * 1000;
      case 'hours':   return interval * 60 * 60 * 1000;
      case 'days':    return interval * 24 * 60 * 60 * 1000;
      default:        return interval * 60 * 1000; // default to minutes
    }
  }

  private saveResultToFile(taskId: string, execution: TaskExecution): void {
    try {
      const taskDir = join(RESULTS_DIR, taskId);
      if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });

      // Sanitise the execution for file storage
      const resultData = {
        executionId: execution.id,
        taskId,
        taskName: this.tasks.get(taskId)?.config.name ?? 'unknown',
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        durationMs: execution.durationMs,
        status: execution.status,
        iterations: execution.iterations,
        cost: execution.cost,
        filesChanged: execution.filesChanged,
        commandsRun: execution.commandsRun,
        result: execution.result
          ? execution.result.slice(0, MAX_RESULT_FILE_SIZE)
          : undefined,
        error: execution.error,
      };

      const filename = `run-${new Date(execution.startedAt).toISOString().replace(/[:.]/g, '-')}.json`;
      writeFileSync(join(taskDir, filename), JSON.stringify(resultData, null, 2), 'utf-8');

      // Clean up old result files – keep at most 50 per task
      try {
        const files = readdirSync(taskDir)
          .filter(f => f.startsWith('run-') && f.endsWith('.json'))
          .sort()
          .reverse();
        for (const file of files.slice(50)) {
          unlinkSync(join(taskDir, file));
        }
      } catch { /* ignore cleanup errors */ }

    } catch { /* best effort */ }
  }

  private notifyCompletion(taskName: string, execution: TaskExecution): void {
    // Best-effort desktop notification using built-in tools
    const status = execution.status === 'success' ? '✅' : '❌';
    const message = `${status} "${taskName}" ${execution.status} (${execution.durationMs ?? 0}ms)`;

    // Log to console (always)
    // eslint-disable-next-line no-console
    console.log(`[scheduled-tasks] ${message}`);

    // Try platform notification (macOS / Linux)
    try {
      if (process.platform === 'darwin') {
        // osascript is a built-in macOS tool
        const { execSync } = require('child_process');
        execSync(
          `osascript -e 'display notification "${message}" with title "NeuroCLI"'`,
          { stdio: 'pipe', timeout: 5000 },
        );
      } else if (process.platform === 'linux') {
        const { execSync } = require('child_process');
        // notify-send is common on Linux desktops
        execSync(`notify-send "NeuroCLI" "${message}"`, { stdio: 'pipe', timeout: 5000 });
      }
    } catch {
      // Notification failed – not critical
    }
  }

  // -----------------------------------------------------------------------
  // Private – Persistence
  // -----------------------------------------------------------------------

  private persistTasks(): void {
    try {
      if (!existsSync(NEURO_DIR)) mkdirSync(NEURO_DIR, { recursive: true });

      const data = Array.from(this.tasks.values()).map(task => ({
        ...task,
        // Don't persist 'running' status – on restart tasks should be 'scheduled'
        status: task.status === 'running' ? 'scheduled' : task.status,
      }));

      writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* best effort */ }
  }

  private loadTasks(): void {
    try {
      if (!existsSync(TASKS_FILE)) return;

      const data = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as ScheduledTaskState[];

      for (const taskState of data) {
        this.tasks.set(taskState.config.id, taskState);

        // Re-schedule timers for tasks that were active
        if (taskState.status === 'scheduled') {
          // If the nextRunAt is in the past, execute immediately then reschedule
          if (taskState.nextRunAt && new Date(taskState.nextRunAt).getTime() <= Date.now()) {
            const intervalMs = this.intervalToMs(taskState.config.interval, taskState.config.intervalUnit);
            taskState.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
          }
          this.scheduleTimer(taskState.config.id);
        }
      }
    } catch { /* ignore corrupt state */ }
  }

  // -----------------------------------------------------------------------
  // Private – Shutdown hooks
  // -----------------------------------------------------------------------

  private registerShutdownHooks(): void {
    const handler = () => {
      if (!this.shuttingDown) {
        this.shutdown();
      }
    };

    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
    process.on('beforeExit', handler);
  }
}
