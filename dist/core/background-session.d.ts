import { EventEmitter } from 'events';
export interface BackgroundSessionConfig {
    id: string;
    name: string;
    prompt: string;
    model?: string;
    workingDirectory: string;
    autoApprove: boolean;
    maxIterations: number;
    maxCost: number;
    notifyOnComplete: boolean;
    saveOutput: boolean;
    tags?: string[];
}
export interface BackgroundSessionState {
    id: string;
    name: string;
    status: 'created' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    iterations: number;
    tokensUsed: number;
    cost: number;
    lastOutput?: string;
    outputFilePath?: string;
    tags: string[];
}
export interface BackgroundSessionOutput {
    sessionId: string;
    lines: string[];
    totalLines: number;
    fetchedAt: number;
}
export interface BackgroundSessionHistoryEntry {
    timestamp: number;
    type: 'info' | 'iteration' | 'output' | 'error' | 'pause' | 'resume' | 'stop' | 'complete';
    message: string;
    data?: Record<string, unknown>;
}
export declare class BackgroundSessionManager extends EventEmitter {
    private sessions;
    private currentlyAttached;
    constructor();
    /**
     * Create a new background session. The session starts in "created" status.
     * Call `startSession(sessionId)` to begin execution.
     */
    createSession(config: BackgroundSessionConfig): string;
    /**
     * Start running a session in the background.
     */
    startSession(sessionId: string): boolean;
    /**
     * Stop a running session. Cannot be resumed.
     */
    stopSession(sessionId: string): boolean;
    /**
     * Pause a running session. It can be resumed later.
     */
    pauseSession(sessionId: string): boolean;
    /**
     * Resume a paused session.
     */
    resumeSession(sessionId: string): boolean;
    /**
     * Get detailed status of a session.
     */
    getSessionStatus(sessionId: string): BackgroundSessionState | null;
    /**
     * List all background sessions.
     */
    listSessions(): BackgroundSessionState[];
    /**
     * Get recent output from a session.
     * @param lines Number of recent lines to return (default 50).
     */
    getSessionOutput(sessionId: string, lines?: number): BackgroundSessionOutput | null;
    /**
     * Attach to a background session for interactive monitoring.
     * Only one session can be attached at a time.
     */
    attachSession(sessionId: string): boolean;
    /**
     * Detach from the currently attached session.
     */
    detachSession(): boolean;
    /**
     * Wait for a session to complete.
     */
    waitForSession(sessionId: string): Promise<void>;
    /**
     * Get the full execution history of a session.
     */
    getSessionHistory(sessionId: string): BackgroundSessionHistoryEntry[] | null;
    /**
     * Clean up old completed/failed/stopped sessions older than
     * the specified age (default 7 days).
     */
    cleanup(maxAgeMs?: number): number;
    /**
     * Get the currently attached session ID (if any).
     */
    getAttachedSessionId(): string | null;
    /**
     * Find sessions by tag.
     */
    findByTag(tag: string): BackgroundSessionState[];
    /**
     * The main execution loop for a background session.
     *
     * In production, this would call an LLM, execute tools, handle
     * approvals, etc. Here we simulate with iteration tracking,
     * cost accounting, pause/resume, abort, and output capture.
     */
    private runSessionLoop;
    /**
     * Yield control to the event loop.
     */
    private yieldControl;
    /**
     * Capture an output line to both the in-memory buffer and
     * the output file (if configured).
     */
    private captureOutput;
    /**
     * Initialize an output file with a header.
     */
    private initializeOutputFile;
    /**
     * Add a history entry to a session.
     */
    private addHistoryEntry;
    /**
     * Persist session state to disk so it survives app restarts.
     */
    private persistSession;
    /**
     * Persist a single history entry to the session's history file.
     */
    private persistHistory;
    /**
     * Restore sessions from disk on startup.
     * Only restores terminal-state sessions; running sessions
     * from a previous process are marked as 'stopped'.
     */
    private restoreSessions;
    /**
     * Load history entries from the JSONL file on disk.
     */
    private loadHistoryFromDisk;
    /**
     * Remove a session and its associated files.
     */
    private removeSession;
    /**
     * Send a desktop notification using the operating system's
     * native notification mechanism.
     */
    private sendDesktopNotification;
    /**
     * Ensure a directory exists.
     */
    private ensureDir;
}
//# sourceMappingURL=background-session.d.ts.map