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
export declare class ScheduledTaskManager {
    private tasks;
    private timers;
    private engine;
    private shuttingDown;
    constructor(engine?: ScheduledTaskEngine);
    /** Set or replace the execution engine */
    setEngine(engine: ScheduledTaskEngine): void;
    /**
     * Schedule a new recurring task.
     * Returns the full task state including its generated ID.
     */
    scheduleTask(config: Omit<ScheduledTaskConfig, 'id'> & {
        id?: string;
    }): ScheduledTaskState;
    /** Cancel a scheduled task permanently */
    cancelTask(taskId: string): boolean;
    /** List all tasks, optionally filtered by status */
    listTasks(status?: TaskStatus): ScheduledTaskState[];
    /** Temporarily pause a task */
    pauseTask(taskId: string): boolean;
    /** Resume a paused task */
    resumeTask(taskId: string): boolean;
    /** Get execution status and history for a task */
    getTaskStatus(taskId: string): ScheduledTaskState | undefined;
    /** Update a task's configuration (resets timer) */
    updateTask(taskId: string, updates: Partial<Omit<ScheduledTaskConfig, 'id'>>): boolean;
    /** Delete a task entirely (removes from memory and persistence) */
    deleteTask(taskId: string): boolean;
    /** Manually trigger a task run (outside its schedule) */
    runTaskNow(taskId: string): Promise<TaskExecution | null>;
    /** Pause all scheduled tasks */
    pauseAll(): number;
    /** Resume all paused tasks */
    resumeAll(): number;
    /** Cancel all tasks */
    cancelAll(): number;
    /** Get aggregate stats across all tasks */
    getAggregateStats(): {
        totalTasks: number;
        activeTasks: number;
        pausedTasks: number;
        totalRuns: number;
        totalFailures: number;
        totalCost: number;
    };
    /** Get recent executions across all tasks, sorted by time (most recent first) */
    getRecentExecutions(limit?: number): TaskExecution[];
    /** Gracefully shut down – cancels all timers */
    shutdown(): void;
    private scheduleTimer;
    private clearTimer;
    private onTimerFire;
    private executeTask;
    private intervalToMs;
    private saveResultToFile;
    private notifyCompletion;
    private persistTasks;
    private loadTasks;
    private registerShutdownHooks;
}
//# sourceMappingURL=scheduled-tasks.d.ts.map