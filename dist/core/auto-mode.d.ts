export type SafetyLevel = 'conservative' | 'moderate' | 'aggressive';
export interface AutoModeConfig {
    /** Whether auto mode is currently enabled */
    enabled: boolean;
    /** Safety level controlling what operations are permitted */
    safetyLevel: SafetyLevel;
    /** Maximum iterations before auto mode stops (default 50) */
    maxIterations: number;
    /** Maximum spend in USD – 0 = unlimited */
    maxCost: number;
    /** Maximum execution time in ms – 0 = unlimited */
    maxTimeMs: number;
    /** Commands that are ALWAYS blocked, even in auto mode */
    blockedCommands: string[];
    /** File glob patterns that can never be modified in auto mode */
    blockedPatterns: string[];
    /** Auto git commit after each change */
    autoCommit: boolean;
    /** Auto run tests after each change */
    autoTest: boolean;
    /** Pause auto mode when an error is encountered */
    pauseOnError: boolean;
}
export interface AutoModeStats {
    /** Number of iterations completed */
    iterations: number;
    /** Number of files changed (created, modified, or deleted) */
    filesChanged: number;
    /** Number of commands executed */
    commandsRun: number;
    /** Total elapsed time in ms */
    timeElapsedMs: number;
    /** Total cost accrued in USD */
    totalCost: number;
    /** Number of operations blocked by safety */
    blockedOperations: number;
    /** Number of errors encountered */
    errors: number;
}
export interface GoalDefinition {
    /** Unique identifier */
    id: string;
    /** Short human-readable name */
    name: string;
    /** High-level goal description */
    description: string;
    /** Optional success criteria – when all pass, the goal is considered complete */
    successCriteria: string[];
    /** Optional list of sub-goals */
    subGoals: GoalDefinition[];
    /** ISO timestamp when the goal was created */
    createdAt: string;
    /** ISO timestamp when the goal was completed (if applicable) */
    completedAt?: string;
    /** Current status */
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
    /** Progress from 0 to 1 */
    progress: number;
}
export interface RoutineStep {
    /** Optional label for the step */
    label?: string;
    /** The prompt or command to execute */
    prompt: string;
    /** Optional model override for this step */
    model?: string;
    /** Whether to pause between this step and the next */
    pauseAfter?: boolean;
    /** Maximum iterations allowed for this step */
    maxIterations?: number;
}
export interface RoutineDefinition {
    /** Unique identifier */
    id: string;
    /** Short human-readable name */
    name: string;
    /** Description of what the routine accomplishes */
    description: string;
    /** Ordered list of steps */
    steps: RoutineStep[];
    /** ISO timestamp when the routine was created */
    createdAt: string;
    /** ISO timestamp of last run */
    lastRunAt?: string;
    /** Number of times this routine has been run */
    runCount: number;
    /** Tags for categorisation */
    tags: string[];
}
export interface AutoModeCheckpoint {
    id: string;
    timestamp: string;
    iteration: number;
    goalId?: string;
    routineId?: string;
    snapshot: string;
}
/**
 * Minimal interface that any execution engine must satisfy for AutoMode
 * to orchestrate it.  This avoids a hard import of NeuroEngine while
 * keeping the two modules loosely coupled.
 */
export interface AutoModeEngine {
    /** Run a single prompt through the engine and return the assistant text */
    runPrompt(prompt: string, model?: string): Promise<{
        text: string;
        inputTokens: number;
        outputTokens: number;
        cost: number;
        filesChanged: number;
        commandsRun: number;
        error?: string;
    }>;
}
export declare class AutoMode {
    private config;
    private stats;
    private goals;
    private routines;
    private checkpoints;
    private startTime;
    private running;
    private abortController;
    private onStatusChange?;
    constructor(config?: Partial<AutoModeConfig>, onStatusChange?: (status: AutoModeStatus) => void);
    /** Enable auto mode – skip all approval prompts, run safety checks in background */
    enable(): void;
    /** Disable auto mode, return to interactive */
    disable(): void;
    /** Check whether auto mode is currently enabled */
    isEnabled(): boolean;
    /** Check whether auto mode is currently running a task */
    isRunning(): boolean;
    getConfig(): Readonly<AutoModeConfig>;
    updateConfig(updates: Partial<AutoModeConfig>): void;
    setSafetyLevel(level: SafetyLevel): void;
    /**
     * Run a task fully autonomously.
     *
     * The engine will be called repeatedly until:
     * - maxIterations is reached
     * - maxCost is exceeded
     * - maxTimeMs is exceeded
     * - The task appears complete (engine signals no further action needed)
     * - An error occurs and pauseOnError is true
     * - The user aborts
     */
    executeAuto(prompt: string, engine: AutoModeEngine, maxIterations?: number): Promise<AutoModeResult>;
    /** Abort the currently running auto execution */
    abort(): void;
    /** Set a high-level goal and let the agent work towards it autonomously */
    setGoal(name: string, description: string, successCriteria?: string[]): GoalDefinition;
    /** Get a goal by ID */
    getGoal(goalId: string): GoalDefinition | undefined;
    /** List all goals */
    listGoals(): GoalDefinition[];
    /** Update goal progress */
    updateGoalProgress(goalId: string, progress: number, status?: GoalDefinition['status']): void;
    /** Add a sub-goal */
    addSubGoal(parentId: string, name: string, description: string): GoalDefinition | null;
    /** Delete a goal */
    deleteGoal(goalId: string): boolean;
    /**
     * Execute a goal autonomously – will iterate until the goal is reached
     * or limits are hit
     */
    executeGoal(goalId: string, engine: AutoModeEngine): Promise<AutoModeResult>;
    /** Create a new routine */
    createRoutine(name: string, description: string, steps: RoutineStep[], tags?: string[]): RoutineDefinition;
    /** Get a routine by ID */
    getRoutine(routineId: string): RoutineDefinition | undefined;
    /** List all routines, optionally filtered by tag */
    listRoutines(tag?: string): RoutineDefinition[];
    /** Delete a routine */
    deleteRoutine(routineId: string): boolean;
    /** Update a routine's steps */
    updateRoutineSteps(routineId: string, steps: RoutineStep[]): boolean;
    /** Replay a saved routine */
    executeRoutine(routineId: string, engine: AutoModeEngine): Promise<AutoModeResult>;
    /**
     * Pre-flight safety check – examines the prompt for dangerous commands
     * or patterns that should be blocked even in auto mode.
     */
    preFlightSafetyCheck(prompt: string): {
        allowed: boolean;
        reason?: string;
    };
    /**
     * Runtime safety check for a specific command about to be executed.
     * This is meant to be called by the engine before running any shell command.
     */
    isCommandAllowed(command: string): {
        allowed: boolean;
        reason?: string;
    };
    /**
     * Runtime safety check for a file path about to be modified.
     * This is meant to be called by the engine before any file write.
     */
    isFileModificationAllowed(filePath: string): {
        allowed: boolean;
        reason?: string;
    };
    getStats(): Readonly<AutoModeStats>;
    resetStats(): void;
    listCheckpoints(): AutoModeCheckpoint[];
    getLatestCheckpoint(): AutoModeCheckpoint | undefined;
    /** Create a checkpoint of the current state */
    createCheckpoint(iteration: number, goalId?: string, routineId?: string): AutoModeCheckpoint;
    private freshStats;
    private emitStatus;
    private buildBlockedCommands;
    private buildBlockedPatterns;
    private detectCompletion;
    private buildGoalPrompt;
    private autoGitCommit;
    private autoRunTests;
    private matchesGlobPattern;
    private persistState;
    private loadState;
    private persistGoals;
    private persistRoutines;
}
export type AutoModeStatus = 'disabled' | 'enabled' | 'running';
export interface AutoModeResult {
    ok: boolean;
    iterations: number;
    finalText: string;
    completed?: boolean;
    error?: string;
}
//# sourceMappingURL=auto-mode.d.ts.map