// ============================================================
// NeuroCLI - Auto Mode
// Full autonomous execution mode similar to Claude Code's Auto Mode
// Skips approval prompts while maintaining safety guardrails
// Supports /goal and /routine commands for autonomous workflows
// ============================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { join, resolve, relative } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { execSync, spawn } from 'child_process';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

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
  snapshot: string; // serialised state description
}

// ---------------------------------------------------------------------------
// Dangerous-command patterns – always blocked regardless of safety level
// ---------------------------------------------------------------------------

const ALWAYS_BLOCKED_COMMANDS: string[] = [
  'rm -rf /',
  'rm -rf /*',
  'sudo rm -rf',
  'mkfs',
  'dd if=',
  ':(){ :|:& };:',        // fork bomb
  'chmod 777 /',
  'chown -R root',
  'curl | sh',
  'wget | sh',
  'curl | bash',
  'wget | bash',
  '> /dev/sda',
  'mv / ',
  'shutdown',
  'reboot',
  'init 0',
  'init 6',
  'systemctl poweroff',
  'systemctl reboot',
];

const CONSERVATIVE_BLOCKED_COMMANDS: string[] = [
  'rm -rf',
  'rm -r',
  'sudo',
  'chmod',
  'chown',
  'kill -9',
  'pkill',
  'killall',
  'pip uninstall',
  'npm uninstall',
  'npm publish',
  'git push --force',
  'git reset --hard',
  'git clean -fd',
  'drop table',
  'drop database',
  'truncate table',
];

const MODERATE_BLOCKED_COMMANDS: string[] = [
  'rm -rf',
  'sudo rm',
  'npm publish',
  'git push --force',
  'drop table',
  'drop database',
];

const ALWAYS_BLOCKED_PATTERNS: string[] = [
  '**/.env',
  '**/.env.*',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/*.pem',
  '**/*.key',
  '**/credentials.json',
  '**/secrets.*',
  '**/.ssh/*',
  '**/.gnupg/*',
  '**/etc/shadow',
  '**/etc/passwd',
];

const CONSERVATIVE_BLOCKED_PATTERNS: string[] = [
  '**/package.json',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/.gitignore',
  '**/tsconfig.json',
  '**/next.config.*',
  '**/webpack.config.*',
  '**/docker-compose.*',
  '**/Dockerfile*',
];

// ---------------------------------------------------------------------------
// Engine type – minimal contract so auto-mode can drive the engine
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AutoMode class
// ---------------------------------------------------------------------------

const NEURO_DIR = join(homedir(), '.neuro');
const AUTO_STATE_FILE = join(NEURO_DIR, 'auto-mode-state.json');
const GOALS_FILE = join(NEURO_DIR, 'auto-mode-goals.json');
const ROUTINES_FILE = join(NEURO_DIR, 'auto-mode-routines.json');
const CHECKPOINTS_DIR = join(NEURO_DIR, 'auto-checkpoints');

export class AutoMode {
  private config: AutoModeConfig;
  private stats: AutoModeStats;
  private goals: Map<string, GoalDefinition> = new Map();
  private routines: Map<string, RoutineDefinition> = new Map();
  private checkpoints: AutoModeCheckpoint[] = [];
  private startTime: number = 0;
  private running: boolean = false;
  private abortController: AbortController | null = null;
  private onStatusChange?: (status: AutoModeStatus) => void;

  constructor(config?: Partial<AutoModeConfig>, onStatusChange?: (status: AutoModeStatus) => void) {
    this.config = {
      enabled: false,
      safetyLevel: 'moderate',
      maxIterations: 50,
      maxCost: 0,
      maxTimeMs: 0,
      blockedCommands: [...ALWAYS_BLOCKED_COMMANDS],
      blockedPatterns: [...ALWAYS_BLOCKED_PATTERNS],
      autoCommit: false,
      autoTest: false,
      pauseOnError: true,
      ...config,
    };
    this.onStatusChange = onStatusChange;
    this.stats = this.freshStats();
    this.loadState();
  }

  // -----------------------------------------------------------------------
  // Enable / Disable
  // -----------------------------------------------------------------------

  /** Enable auto mode – skip all approval prompts, run safety checks in background */
  enable(): void {
    this.config.enabled = true;
    this.emitStatus('enabled');
    this.persistState();
  }

  /** Disable auto mode, return to interactive */
  disable(): void {
    this.config.enabled = false;
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.emitStatus('disabled');
    this.persistState();
  }

  /** Check whether auto mode is currently enabled */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Check whether auto mode is currently running a task */
  isRunning(): boolean {
    return this.running;
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  getConfig(): Readonly<AutoModeConfig> {
    return Object.freeze({ ...this.config });
  }

  updateConfig(updates: Partial<AutoModeConfig>): void {
    // Merge blocked lists so ALWAYS_BLOCKED are never removed
    if (updates.blockedCommands) {
      const merged = new Set([...ALWAYS_BLOCKED_COMMANDS, ...updates.blockedCommands]);
      updates.blockedCommands = Array.from(merged);
    }
    if (updates.blockedPatterns) {
      const merged = new Set([...ALWAYS_BLOCKED_PATTERNS, ...updates.blockedPatterns]);
      updates.blockedPatterns = Array.from(merged);
    }
    Object.assign(this.config, updates);
    this.persistState();
  }

  setSafetyLevel(level: SafetyLevel): void {
    this.config.safetyLevel = level;
    // Re-apply the pattern / command block lists for the new level
    this.config.blockedCommands = this.buildBlockedCommands(level);
    this.config.blockedPatterns = this.buildBlockedPatterns(level);
    this.persistState();
  }

  // -----------------------------------------------------------------------
  // Core autonomous execution
  // -----------------------------------------------------------------------

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
  async executeAuto(
    prompt: string,
    engine: AutoModeEngine,
    maxIterations?: number,
  ): Promise<AutoModeResult> {
    if (this.running) {
      return { ok: false, iterations: 0, finalText: '', error: 'Auto mode is already running a task' };
    }

    const limit = maxIterations ?? this.config.maxIterations;
    this.running = true;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    this.stats = this.freshStats();

    this.emitStatus('running');

    const result: AutoModeResult = { ok: true, iterations: 0, finalText: '' };

    try {
      let currentPrompt = prompt;

      for (let i = 0; i < limit; i++) {
        // ---- Abort check ----
        if (this.abortController.signal.aborted) {
          result.ok = false;
          result.error = 'Aborted by user';
          break;
        }

        // ---- Time limit ----
        if (this.config.maxTimeMs > 0 && Date.now() - this.startTime > this.config.maxTimeMs) {
          result.error = `Time limit of ${this.config.maxTimeMs}ms exceeded`;
          break;
        }

        // ---- Cost limit ----
        if (this.config.maxCost > 0 && this.stats.totalCost >= this.config.maxCost) {
          result.error = `Cost limit of $${this.config.maxCost} exceeded`;
          break;
        }

        // ---- Safety pre-check ----
        const safetyResult = this.preFlightSafetyCheck(currentPrompt);
        if (!safetyResult.allowed) {
          this.stats.blockedOperations++;
          result.error = `Safety check blocked execution: ${safetyResult.reason}`;
          if (this.config.pauseOnError) break;
          // If not pausing on error, try to continue with a modified prompt
          currentPrompt = `The previous action was blocked for safety reasons (${safetyResult.reason}). ` +
            `Please try a different, safer approach to accomplish the goal. Original task: ${prompt}`;
          continue;
        }

        // ---- Execute ----
        try {
          const response = await engine.runPrompt(currentPrompt);
          this.stats.iterations = i + 1;
          this.stats.filesChanged += response.filesChanged;
          this.stats.commandsRun += response.commandsRun;
          this.stats.totalCost += response.cost;
          this.stats.timeElapsedMs = Date.now() - this.startTime;

          if (response.error) {
            this.stats.errors++;
            if (this.config.pauseOnError) {
              result.error = response.error;
              break;
            }
          }

          result.iterations = i + 1;
          result.finalText = response.text;

          // ---- Auto-commit ----
          if (this.config.autoCommit && response.filesChanged > 0) {
            this.autoGitCommit(i + 1);
          }

          // ---- Auto-test ----
          if (this.config.autoTest && response.filesChanged > 0) {
            const testResult = this.autoRunTests();
            if (!testResult.passed && this.config.pauseOnError) {
              result.error = `Tests failed after iteration ${i + 1}`;
              break;
            }
          }

          // ---- Checkpoint ----
          if (i > 0 && i % 5 === 0) {
            this.createCheckpoint(i, undefined, undefined);
          }

          // ---- Detect completion ----
          if (this.detectCompletion(response.text)) {
            result.completed = true;
            break;
          }

          // Feed the response back as context for the next iteration
          currentPrompt =
            `Continuing autonomous task. Previous iteration result:\n` +
            `${response.text.slice(0, 2000)}\n\n` +
            `If the task is complete, respond with "TASK_COMPLETE". ` +
            `Otherwise continue working towards: ${prompt}`;

        } catch (err) {
          this.stats.errors++;
          if (this.config.pauseOnError) {
            result.ok = false;
            result.error = `Execution error: ${err instanceof Error ? err.message : String(err)}`;
            break;
          }
          // Otherwise swallow and continue
        }
      }
    } finally {
      this.running = false;
      this.abortController = null;
      this.emitStatus(this.config.enabled ? 'enabled' : 'disabled');
      this.persistState();
    }

    return result;
  }

  /** Abort the currently running auto execution */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // -----------------------------------------------------------------------
  // /goal command support
  // -----------------------------------------------------------------------

  /** Set a high-level goal and let the agent work towards it autonomously */
  setGoal(name: string, description: string, successCriteria: string[] = []): GoalDefinition {
    const goal: GoalDefinition = {
      id: randomUUID(),
      name,
      description,
      successCriteria,
      subGoals: [],
      createdAt: new Date().toISOString(),
      status: 'pending',
      progress: 0,
    };
    this.goals.set(goal.id, goal);
    this.persistGoals();
    return goal;
  }

  /** Get a goal by ID */
  getGoal(goalId: string): GoalDefinition | undefined {
    return this.goals.get(goalId);
  }

  /** List all goals */
  listGoals(): GoalDefinition[] {
    return Array.from(this.goals.values());
  }

  /** Update goal progress */
  updateGoalProgress(goalId: string, progress: number, status?: GoalDefinition['status']): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    goal.progress = Math.min(1, Math.max(0, progress));
    if (status) goal.status = status;
    if (goal.progress >= 1 && goal.status !== 'failed' && goal.status !== 'cancelled') {
      goal.status = 'completed';
      goal.completedAt = new Date().toISOString();
    }
    this.persistGoals();
  }

  /** Add a sub-goal */
  addSubGoal(parentId: string, name: string, description: string): GoalDefinition | null {
    const parent = this.goals.get(parentId);
    if (!parent) return null;
    const sub: GoalDefinition = {
      id: randomUUID(),
      name,
      description,
      successCriteria: [],
      subGoals: [],
      createdAt: new Date().toISOString(),
      status: 'pending',
      progress: 0,
    };
    parent.subGoals.push(sub);
    this.goals.set(sub.id, sub); // flat index too
    this.persistGoals();
    return sub;
  }

  /** Delete a goal */
  deleteGoal(goalId: string): boolean {
    if (!this.goals.has(goalId)) return false;
    // Also remove from any parent's subGoals
    for (const g of Array.from(this.goals.values())) {
      g.subGoals = g.subGoals.filter((s: GoalDefinition) => s.id !== goalId);
    }
    this.goals.delete(goalId);
    this.persistGoals();
    return true;
  }

  /**
   * Execute a goal autonomously – will iterate until the goal is reached
   * or limits are hit
   */
  async executeGoal(goalId: string, engine: AutoModeEngine): Promise<AutoModeResult> {
    const goal = this.goals.get(goalId);
    if (!goal) return { ok: false, iterations: 0, finalText: '', error: `Goal "${goalId}" not found` };

    goal.status = 'in_progress';
    this.persistGoals();

    const prompt = this.buildGoalPrompt(goal);
    const result = await this.executeAuto(prompt, engine, this.config.maxIterations);

    if (result.completed) {
      goal.status = 'completed';
      goal.progress = 1;
      goal.completedAt = new Date().toISOString();
    } else if (result.error) {
      goal.status = 'failed';
    }
    this.persistGoals();

    return result;
  }

  // -----------------------------------------------------------------------
  // /routine command support
  // -----------------------------------------------------------------------

  /** Create a new routine */
  createRoutine(name: string, description: string, steps: RoutineStep[], tags: string[] = []): RoutineDefinition {
    const routine: RoutineDefinition = {
      id: randomUUID(),
      name,
      description,
      steps,
      createdAt: new Date().toISOString(),
      runCount: 0,
      tags,
    };
    this.routines.set(routine.id, routine);
    this.persistRoutines();
    return routine;
  }

  /** Get a routine by ID */
  getRoutine(routineId: string): RoutineDefinition | undefined {
    return this.routines.get(routineId);
  }

  /** List all routines, optionally filtered by tag */
  listRoutines(tag?: string): RoutineDefinition[] {
    const all = Array.from(this.routines.values());
    if (tag) return all.filter(r => r.tags.includes(tag));
    return all;
  }

  /** Delete a routine */
  deleteRoutine(routineId: string): boolean {
    if (!this.routines.has(routineId)) return false;
    this.routines.delete(routineId);
    this.persistRoutines();
    return true;
  }

  /** Update a routine's steps */
  updateRoutineSteps(routineId: string, steps: RoutineStep[]): boolean {
    const routine = this.routines.get(routineId);
    if (!routine) return false;
    routine.steps = steps;
    this.persistRoutines();
    return true;
  }

  /** Replay a saved routine */
  async executeRoutine(routineId: string, engine: AutoModeEngine): Promise<AutoModeResult> {
    const routine = this.routines.get(routineId);
    if (!routine) return { ok: false, iterations: 0, finalText: '', error: `Routine "${routineId}" not found` };
    if (routine.steps.length === 0) return { ok: false, iterations: 0, finalText: '', error: 'Routine has no steps' };

    routine.runCount++;
    routine.lastRunAt = new Date().toISOString();
    this.persistRoutines();

    const overallResult: AutoModeResult = { ok: true, iterations: 0, finalText: '' };
    const stepResults: string[] = [];

    for (let i = 0; i < routine.steps.length; i++) {
      const step = routine.steps[i];

      // Build context from previous steps
      const contextPrompt = stepResults.length > 0
        ? `Context from previous steps:\n${stepResults.map((r, idx) => `Step ${idx + 1}: ${r.slice(0, 500)}`).join('\n')}\n\n`
        : '';

      const fullPrompt = `${contextPrompt}Step ${i + 1}/${routine.steps.length}: ${step.prompt}`;

      const stepMaxIter = step.maxIterations ?? Math.max(5, Math.floor(this.config.maxIterations / routine.steps.length));
      const result = await this.executeAuto(fullPrompt, engine, stepMaxIter);

      overallResult.iterations += result.iterations;

      if (!result.ok) {
        overallResult.ok = false;
        overallResult.error = `Routine failed at step ${i + 1}: ${result.error}`;
        break;
      }

      stepResults.push(result.finalText);
      overallResult.finalText = result.finalText;

      if (step.pauseAfter && i < routine.steps.length - 1) {
        // In auto mode we just log; in interactive mode a real prompt would appear
        // eslint-disable-next-line no-console
        console.log(`[auto-mode] Routine "${routine.name}" paused after step ${i + 1}. Continuing automatically in auto mode.`);
      }
    }

    if (overallResult.ok) {
      overallResult.completed = true;
    }

    return overallResult;
  }

  // -----------------------------------------------------------------------
  // Safety
  // -----------------------------------------------------------------------

  /**
   * Pre-flight safety check – examines the prompt for dangerous commands
   * or patterns that should be blocked even in auto mode.
   */
  preFlightSafetyCheck(prompt: string): { allowed: boolean; reason?: string } {
    const lower = prompt.toLowerCase();

    // Check always-blocked commands
    for (const cmd of this.config.blockedCommands) {
      if (lower.includes(cmd.toLowerCase())) {
        return { allowed: false, reason: `Blocked command detected: "${cmd}"` };
      }
    }

    // Safety-level-specific checks for conservative / moderate
    if (this.config.safetyLevel === 'conservative') {
      for (const cmd of CONSERVATIVE_BLOCKED_COMMANDS) {
        if (lower.includes(cmd.toLowerCase())) {
          return { allowed: false, reason: `Conservative mode blocked command: "${cmd}"` };
        }
      }
    } else if (this.config.safetyLevel === 'moderate') {
      for (const cmd of MODERATE_BLOCKED_COMMANDS) {
        if (lower.includes(cmd.toLowerCase())) {
          return { allowed: false, reason: `Moderate mode blocked command: "${cmd}"` };
        }
      }
    }
    // 'aggressive' – only always-blocked commands are blocked

    // Check blocked file patterns
    for (const pattern of this.config.blockedPatterns) {
      // Simple substring check for path-like strings in prompt
      if (lower.includes(pattern.replace(/\*\*/g, '').replace(/\*/g, '').toLowerCase())) {
        return { allowed: false, reason: `Blocked file pattern detected: "${pattern}"` };
      }
    }

    return { allowed: true };
  }

  /**
   * Runtime safety check for a specific command about to be executed.
   * This is meant to be called by the engine before running any shell command.
   */
  isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    const trimmed = command.trim();

    // Always-blocked
    for (const blocked of ALWAYS_BLOCKED_COMMANDS) {
      if (trimmed.includes(blocked) || trimmed.startsWith(blocked.split(' ')[0])) {
        return { allowed: false, reason: `Command blocked (always): "${blocked}"` };
      }
    }

    // Config-level blocked
    for (const blocked of this.config.blockedCommands) {
      if (trimmed.includes(blocked)) {
        return { allowed: false, reason: `Command blocked (config): "${blocked}"` };
      }
    }

    // Safety-level checks
    const levelLists: Record<SafetyLevel, string[]> = {
      conservative: CONSERVATIVE_BLOCKED_COMMANDS,
      moderate: MODERATE_BLOCKED_COMMANDS,
      aggressive: [],
    };
    for (const blocked of levelLists[this.config.safetyLevel]) {
      if (trimmed.includes(blocked)) {
        return { allowed: false, reason: `Command blocked (${this.config.safetyLevel}): "${blocked}"` };
      }
    }

    return { allowed: true };
  }

  /**
   * Runtime safety check for a file path about to be modified.
   * This is meant to be called by the engine before any file write.
   */
  isFileModificationAllowed(filePath: string): { allowed: boolean; reason?: string } {
    const normalised = filePath.replace(/\\/g, '/');

    for (const pattern of this.config.blockedPatterns) {
      if (this.matchesGlobPattern(normalised, pattern)) {
        return { allowed: false, reason: `File pattern blocked: "${pattern}"` };
      }
    }

    // Safety-level-specific patterns
    const patternLists: Record<SafetyLevel, string[]> = {
      conservative: CONSERVATIVE_BLOCKED_PATTERNS,
      moderate: [],
      aggressive: [],
    };
    for (const pattern of patternLists[this.config.safetyLevel]) {
      if (this.matchesGlobPattern(normalised, pattern)) {
        return { allowed: false, reason: `File pattern blocked (${this.config.safetyLevel}): "${pattern}"` };
      }
    }

    return { allowed: true };
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  getStats(): Readonly<AutoModeStats> {
    if (this.running) {
      return { ...this.stats, timeElapsedMs: Date.now() - this.startTime };
    }
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = this.freshStats();
  }

  // -----------------------------------------------------------------------
  // Checkpoints
  // -----------------------------------------------------------------------

  listCheckpoints(): AutoModeCheckpoint[] {
    return [...this.checkpoints];
  }

  getLatestCheckpoint(): AutoModeCheckpoint | undefined {
    return this.checkpoints.length > 0
      ? this.checkpoints[this.checkpoints.length - 1]
      : undefined;
  }

  /** Create a checkpoint of the current state */
  createCheckpoint(iteration: number, goalId?: string, routineId?: string): AutoModeCheckpoint {
    const cp: AutoModeCheckpoint = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      iteration,
      goalId,
      routineId,
      snapshot: JSON.stringify({
        stats: this.stats,
        config: { ...this.config, enabled: false }, // don't persist enabled state in snapshot
      }),
    };
    this.checkpoints.push(cp);

    // Persist to disk
    try {
      if (!existsSync(CHECKPOINTS_DIR)) mkdirSync(CHECKPOINTS_DIR, { recursive: true });
      const cpFile = join(CHECKPOINTS_DIR, `checkpoint-${cp.id}.json`);
      writeFileSync(cpFile, JSON.stringify(cp, null, 2), 'utf-8');
    } catch {
      // Best-effort persistence
    }

    // Keep at most 50 checkpoints in memory
    if (this.checkpoints.length > 50) {
      const removed = this.checkpoints.shift();
      if (removed) {
        try {
          const cpFile = join(CHECKPOINTS_DIR, `checkpoint-${removed.id}.json`);
          if (existsSync(cpFile)) unlinkSync(cpFile);
        } catch { /* ignore */ }
      }
    }

    return cp;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private freshStats(): AutoModeStats {
    return {
      iterations: 0,
      filesChanged: 0,
      commandsRun: 0,
      timeElapsedMs: 0,
      totalCost: 0,
      blockedOperations: 0,
      errors: 0,
    };
  }

  private emitStatus(status: AutoModeStatus): void {
    if (this.onStatusChange) {
      this.onStatusChange(status);
    }
  }

  private buildBlockedCommands(level: SafetyLevel): string[] {
    const base = new Set(ALWAYS_BLOCKED_COMMANDS);
    if (level === 'conservative') {
      CONSERVATIVE_BLOCKED_COMMANDS.forEach(c => base.add(c));
    } else if (level === 'moderate') {
      MODERATE_BLOCKED_COMMANDS.forEach(c => base.add(c));
    }
    // Merge user-defined on top
    this.config.blockedCommands.forEach(c => base.add(c));
    return Array.from(base);
  }

  private buildBlockedPatterns(level: SafetyLevel): string[] {
    const base = new Set(ALWAYS_BLOCKED_PATTERNS);
    if (level === 'conservative') {
      CONSERVATIVE_BLOCKED_PATTERNS.forEach(p => base.add(p));
    }
    this.config.blockedPatterns.forEach(p => base.add(p));
    return Array.from(base);
  }

  private detectCompletion(text: string): boolean {
    const markers = [
      'TASK_COMPLETE',
      'task complete',
      'task is complete',
      'goal achieved',
      'goal reached',
      'all done',
      'finished successfully',
    ];
    const lower = text.toLowerCase();
    return markers.some(m => lower.includes(m));
  }

  private buildGoalPrompt(goal: GoalDefinition): string {
    const criteria = goal.successCriteria.length > 0
      ? `\n\nSuccess criteria:\n${goal.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
      : '';

    const subGoals = goal.subGoals.length > 0
      ? `\n\nSub-goals:\n${goal.subGoals.map((sg, i) => `${i + 1}. ${sg.name}: ${sg.description}`).join('\n')}`
      : '';

    return (
      `Goal: ${goal.name}\n\n` +
      `Description: ${goal.description}${criteria}${subGoals}\n\n` +
      `Work towards this goal autonomously. When the goal is achieved, respond with "TASK_COMPLETE".`
    );
  }

  private autoGitCommit(iteration: number): void {
    try {
      execSync('git add -A', { stdio: 'pipe', timeout: 10_000 });
      execSync(`git commit -m "auto-mode: iteration ${iteration}" --allow-empty`, {
        stdio: 'pipe',
        timeout: 10_000,
      });
    } catch {
      // Not a git repo, or nothing to commit – ignore
    }
  }

  private autoRunTests(): { passed: boolean; output: string } {
    // Try common test commands
    const testCommands = ['npm test', 'bun test', 'yarn test', 'pnpm test'];
    for (const cmd of testCommands) {
      try {
        const output = execSync(cmd, { stdio: 'pipe', timeout: 60_000 }).toString('utf-8');
        return { passed: true, output };
      } catch (err: unknown) {
        // execSync throws on non-zero exit
        if (err instanceof Error && 'stdout' in err) {
          const output = String((err as unknown as { stdout: Buffer }).stdout);
          return { passed: false, output };
        }
        // Command not found – try the next one
        continue;
      }
    }
    return { passed: true, output: 'No test runner found' };
  }

  private matchesGlobPattern(filePath: string, pattern: string): boolean {
    // Convert simple glob to regex
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape regex special chars (except * and ?)
      .replace(/\*\*/g, '{{GLOBSTAR}}')          // preserve **
      .replace(/\*/g, '[^/]*')                   // * matches anything except /
      .replace(/\?/g, '[^/]')                    // ? matches single non-/
      .replace(/\{\{GLOBSTAR\}\}/g, '.*');       // ** matches anything
    try {
      const regex = new RegExp(regexStr + '$', 'i');
      return regex.test(filePath);
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  private persistState(): void {
    try {
      if (!existsSync(NEURO_DIR)) mkdirSync(NEURO_DIR, { recursive: true });
      writeFileSync(AUTO_STATE_FILE, JSON.stringify({
        config: this.config,
        stats: this.stats,
      }, null, 2), 'utf-8');
    } catch { /* best effort */ }
  }

  private loadState(): void {
    try {
      if (existsSync(AUTO_STATE_FILE)) {
        const data = JSON.parse(readFileSync(AUTO_STATE_FILE, 'utf-8'));
        if (data.config) Object.assign(this.config, data.config);
        if (data.stats) Object.assign(this.stats, data.stats);
      }
    } catch { /* ignore corrupt state */ }

    // Load goals
    try {
      if (existsSync(GOALS_FILE)) {
        const data = JSON.parse(readFileSync(GOALS_FILE, 'utf-8')) as GoalDefinition[];
        for (const g of data) this.goals.set(g.id, g);
      }
    } catch { /* ignore */ }

    // Load routines
    try {
      if (existsSync(ROUTINES_FILE)) {
        const data = JSON.parse(readFileSync(ROUTINES_FILE, 'utf-8')) as RoutineDefinition[];
        for (const r of data) this.routines.set(r.id, r);
      }
    } catch { /* ignore */ }

    // Load checkpoints from disk
    try {
      if (existsSync(CHECKPOINTS_DIR)) {
        const files = readdirSync(CHECKPOINTS_DIR).filter(f => f.startsWith('checkpoint-'));
        for (const f of files.slice(-50)) {
          try {
            const cp = JSON.parse(readFileSync(join(CHECKPOINTS_DIR, f), 'utf-8')) as AutoModeCheckpoint;
            this.checkpoints.push(cp);
          } catch { /* skip corrupt */ }
        }
        // Sort by timestamp
        this.checkpoints.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }
    } catch { /* ignore */ }
  }

  private persistGoals(): void {
    try {
      if (!existsSync(NEURO_DIR)) mkdirSync(NEURO_DIR, { recursive: true });
      writeFileSync(GOALS_FILE, JSON.stringify(Array.from(this.goals.values()), null, 2), 'utf-8');
    } catch { /* best effort */ }
  }

  private persistRoutines(): void {
    try {
      if (!existsSync(NEURO_DIR)) mkdirSync(NEURO_DIR, { recursive: true });
      writeFileSync(ROUTINES_FILE, JSON.stringify(Array.from(this.routines.values()), null, 2), 'utf-8');
    } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export type AutoModeStatus = 'disabled' | 'enabled' | 'running';

export interface AutoModeResult {
  ok: boolean;
  iterations: number;
  finalText: string;
  completed?: boolean;
  error?: string;
}
