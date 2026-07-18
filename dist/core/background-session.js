// ============================================================
// NeuroCLI - Background Session Manager
// Manages long-running sessions that execute independently in
// the background — inspired by Claude Code background sessions
// and Agent View. Supports persistence, output capture, desktop
// notifications, pause/resume, and attach/detach workflows.
// Uses only Node.js built-in modules.
// ============================================================
import { EventEmitter } from 'events';
import { join, } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, appendFileSync, } from 'fs';
import { homedir } from 'os';
import { spawn } from 'child_process';
// ---- Constants ----
const SESSION_DIR = join(homedir(), '.neuro', 'background-sessions');
const OUTPUT_DIR = join(homedir(), '.neuro', 'background-output');
const HISTORY_DIR = join(homedir(), '.neuro', 'background-history');
const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_MAX_COST = 5.0; // USD
const OUTPUT_BUFFER_MAX = 1000;
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// ============================================================
// BackgroundSessionManager
// ============================================================
export class BackgroundSessionManager extends EventEmitter {
    sessions = new Map();
    currentlyAttached = null;
    constructor() {
        super();
        this.ensureDir(SESSION_DIR);
        this.ensureDir(OUTPUT_DIR);
        this.ensureDir(HISTORY_DIR);
        // Restore persisted sessions on startup
        this.restoreSessions();
    }
    // ---- Public API ----
    /**
     * Create a new background session. The session starts in "created" status.
     * Call `startSession(sessionId)` to begin execution.
     */
    createSession(config) {
        if (this.sessions.has(config.id)) {
            throw new Error(`Session with id "${config.id}" already exists`);
        }
        const outputFilePath = config.saveOutput
            ? join(OUTPUT_DIR, `${config.id}.log`)
            : undefined;
        const state = {
            id: config.id,
            name: config.name,
            status: 'created',
            createdAt: Date.now(),
            iterations: 0,
            tokensUsed: 0,
            cost: 0,
            outputFilePath,
            tags: config.tags ?? [],
        };
        let completionResolve = null;
        let completionReject = null;
        const completionPromise = new Promise((resolve, reject) => {
            completionResolve = resolve;
            completionReject = reject;
        });
        const record = {
            config,
            state,
            history: [],
            abortController: new AbortController(),
            outputBuffer: [],
            attached: false,
            completionPromise,
            completionResolve,
            completionReject,
            pausePromise: null,
            pauseResolve: null,
        };
        this.sessions.set(config.id, record);
        this.addHistoryEntry(config.id, 'info', `Session "${config.name}" created`);
        if (outputFilePath) {
            this.initializeOutputFile(outputFilePath, config);
        }
        this.persistSession(config.id);
        this.emit('session:created', config.id, state);
        return config.id;
    }
    /**
     * Start running a session in the background.
     */
    startSession(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return false;
        if (record.state.status !== 'created' && record.state.status !== 'paused') {
            return false; // Can only start from 'created' or 'paused'
        }
        if (record.state.status === 'paused' && record.pauseResolve) {
            // Unpause by resolving the pause promise
            record.pauseResolve();
            record.pausePromise = null;
            record.pauseResolve = null;
            record.state.status = 'running';
            this.addHistoryEntry(sessionId, 'resume', `Session "${record.config.name}" resumed`);
            this.persistSession(sessionId);
            this.emit('session:resumed', sessionId, record.state);
            return true;
        }
        // Fresh start
        record.abortController = new AbortController();
        record.state.status = 'running';
        record.state.startedAt = Date.now();
        this.addHistoryEntry(sessionId, 'info', `Session "${record.config.name}" started`);
        this.persistSession(sessionId);
        this.emit('session:started', sessionId, record.state);
        this.runSessionLoop(record)
            .then(() => {
            record.state.status = 'completed';
            record.state.completedAt = Date.now();
            record.completionResolve?.();
            this.addHistoryEntry(sessionId, 'complete', `Session completed after ${record.state.iterations} iterations`);
            this.persistSession(sessionId);
            if (record.config.notifyOnComplete) {
                this.sendDesktopNotification('NeuroCLI Session Complete', `"${record.config.name}" finished successfully (${record.state.iterations} iterations, $${record.state.cost.toFixed(4)}).`);
            }
            this.emit('session:completed', sessionId, record.state);
        })
            .catch((err) => {
            if (record.state.status === 'stopped' || record.state.status === 'paused') {
                return; // Handled by stop/pause
            }
            const errorMsg = err instanceof Error ? err.message : String(err);
            record.state.status = 'failed';
            record.state.completedAt = Date.now();
            record.state.lastOutput = errorMsg;
            record.completionReject?.(err instanceof Error ? err : new Error(errorMsg));
            this.addHistoryEntry(sessionId, 'error', `Session failed: ${errorMsg}`);
            this.persistSession(sessionId);
            if (record.config.notifyOnComplete) {
                this.sendDesktopNotification('NeuroCLI Session Failed', `"${record.config.name}" encountered an error: ${errorMsg}`);
            }
            this.emit('session:failed', sessionId, errorMsg, record.state);
        });
        return true;
    }
    /**
     * Stop a running session. Cannot be resumed.
     */
    stopSession(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return false;
        if (record.state.status !== 'running')
            return false;
        record.abortController.abort();
        record.state.status = 'stopped';
        record.state.completedAt = Date.now();
        // If paused, also resolve the pause so the loop can exit
        if (record.pauseResolve) {
            record.pauseResolve();
            record.pausePromise = null;
            record.pauseResolve = null;
        }
        this.addHistoryEntry(sessionId, 'stop', `Session "${record.config.name}" stopped by user`);
        this.persistSession(sessionId);
        this.emit('session:stopped', sessionId, record.state);
        return true;
    }
    /**
     * Pause a running session. It can be resumed later.
     */
    pauseSession(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return false;
        if (record.state.status !== 'running')
            return false;
        // Set up a pause barrier that the loop will wait on
        let pauseResolve = null;
        const pausePromise = new Promise((resolve) => {
            pauseResolve = resolve;
        });
        record.pausePromise = pausePromise;
        record.pauseResolve = pauseResolve;
        record.state.status = 'paused';
        this.addHistoryEntry(sessionId, 'pause', `Session "${record.config.name}" paused by user`);
        this.persistSession(sessionId);
        this.emit('session:paused', sessionId, record.state);
        return true;
    }
    /**
     * Resume a paused session.
     */
    resumeSession(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return false;
        if (record.state.status !== 'paused')
            return false;
        return this.startSession(sessionId); // startSession handles unpause
    }
    /**
     * Get detailed status of a session.
     */
    getSessionStatus(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return null;
        return { ...record.state };
    }
    /**
     * List all background sessions.
     */
    listSessions() {
        const result = [];
        const records = Array.from(this.sessions.values());
        for (const record of records) {
            result.push({ ...record.state });
        }
        return result.sort((a, b) => b.createdAt - a.createdAt);
    }
    /**
     * Get recent output from a session.
     * @param lines Number of recent lines to return (default 50).
     */
    getSessionOutput(sessionId, lines = 50) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return null;
        // If we have an output file, read from it
        if (record.state.outputFilePath && existsSync(record.state.outputFilePath)) {
            try {
                const content = readFileSync(record.state.outputFilePath, 'utf-8');
                const allLines = content.split('\n').filter(Boolean);
                const fetchedLines = allLines.slice(-lines);
                return {
                    sessionId,
                    lines: fetchedLines,
                    totalLines: allLines.length,
                    fetchedAt: Date.now(),
                };
            }
            catch {
                // Fall through to buffer
            }
        }
        // Fall back to in-memory buffer
        const fetchedLines = record.outputBuffer.slice(-lines);
        return {
            sessionId,
            lines: fetchedLines,
            totalLines: record.outputBuffer.length,
            fetchedAt: Date.now(),
        };
    }
    /**
     * Attach to a background session for interactive monitoring.
     * Only one session can be attached at a time.
     */
    attachSession(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return false;
        // Detach from any currently attached session
        if (this.currentlyAttached && this.currentlyAttached !== sessionId) {
            this.detachSession();
        }
        record.attached = true;
        this.currentlyAttached = sessionId;
        this.addHistoryEntry(sessionId, 'info', `User attached to session`);
        this.emit('session:attached', sessionId);
        return true;
    }
    /**
     * Detach from the currently attached session.
     */
    detachSession() {
        if (!this.currentlyAttached)
            return false;
        const record = this.sessions.get(this.currentlyAttached);
        if (record) {
            record.attached = false;
            this.addHistoryEntry(this.currentlyAttached, 'info', `User detached from session`);
        }
        this.emit('session:detached', this.currentlyAttached);
        this.currentlyAttached = null;
        return true;
    }
    /**
     * Wait for a session to complete.
     */
    async waitForSession(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Session "${sessionId}" not found`);
        }
        if (record.state.status === 'completed')
            return;
        if (record.state.status === 'failed') {
            throw new Error(record.state.lastOutput ?? `Session "${sessionId}" failed`);
        }
        if (record.state.status === 'stopped') {
            throw new Error(`Session "${sessionId}" was stopped`);
        }
        return record.completionPromise;
    }
    /**
     * Get the full execution history of a session.
     */
    getSessionHistory(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return null;
        return [...record.history];
    }
    /**
     * Clean up old completed/failed/stopped sessions older than
     * the specified age (default 7 days).
     */
    cleanup(maxAgeMs = CLEANUP_AGE_MS) {
        const cutoff = Date.now() - maxAgeMs;
        let removed = 0;
        const toRemove = [];
        const entries = Array.from(this.sessions.entries());
        for (const [id, record] of entries) {
            const isTerminal = record.state.status === 'completed' ||
                record.state.status === 'failed' ||
                record.state.status === 'stopped';
            if (!isTerminal)
                continue;
            const endTime = record.state.completedAt ?? record.state.createdAt;
            if (endTime < cutoff) {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            this.removeSession(id);
            removed++;
        }
        return removed;
    }
    /**
     * Get the currently attached session ID (if any).
     */
    getAttachedSessionId() {
        return this.currentlyAttached;
    }
    /**
     * Find sessions by tag.
     */
    findByTag(tag) {
        const results = [];
        const records = Array.from(this.sessions.values());
        for (const record of records) {
            if (record.state.tags.includes(tag)) {
                results.push({ ...record.state });
            }
        }
        return results;
    }
    // ---- Private: Session Execution Loop ----
    /**
     * The main execution loop for a background session.
     *
     * In production, this would call an LLM, execute tools, handle
     * approvals, etc. Here we simulate with iteration tracking,
     * cost accounting, pause/resume, abort, and output capture.
     */
    async runSessionLoop(record) {
        const maxIterations = record.config.maxIterations || DEFAULT_MAX_ITERATIONS;
        const maxCost = record.config.maxCost || DEFAULT_MAX_COST;
        const abortSignal = record.abortController.signal;
        for (let i = 0; i < maxIterations; i++) {
            // ---- Abort check ----
            if (abortSignal.aborted) {
                throw new Error('Session aborted');
            }
            // ---- Pause check ----
            if (record.pausePromise) {
                this.addHistoryEntry(record.config.id, 'pause', `Paused at iteration ${i}`);
                await record.pausePromise;
                // After resuming, check abort again
                if (abortSignal.aborted) {
                    throw new Error('Session aborted after resume');
                }
            }
            // ---- Simulate iteration ----
            const iterationTokens = 50 + Math.floor(Math.random() * 200);
            const iterationCost = (iterationTokens / 1_000_000) * 3.0; // simulated $3/1M tokens
            record.state.iterations = i + 1;
            record.state.tokensUsed += iterationTokens;
            record.state.cost += iterationCost;
            const outputLine = `[iter ${i + 1}] Processing... (tokens: ${record.state.tokensUsed}, cost: $${record.state.cost.toFixed(4)})`;
            record.state.lastOutput = outputLine;
            // Capture output
            this.captureOutput(record, outputLine);
            // Add history entry every 10 iterations to avoid bloat
            if ((i + 1) % 10 === 0 || i === 0) {
                this.addHistoryEntry(record.config.id, 'iteration', `Iteration ${i + 1}/${maxIterations}`, { tokensUsed: record.state.tokensUsed, cost: record.state.cost });
            }
            // ---- Cost limit check ----
            if (record.state.cost >= maxCost) {
                const msg = `Cost limit ($${maxCost}) reached at iteration ${i + 1}`;
                this.captureOutput(record, msg);
                this.addHistoryEntry(record.config.id, 'info', msg);
                break;
            }
            // Persist state periodically (every 5 iterations)
            if ((i + 1) % 5 === 0) {
                this.persistSession(record.config.id);
            }
            // Yield control for cooperative multitasking
            await this.yieldControl();
        }
        // Final persist
        this.persistSession(record.config.id);
    }
    /**
     * Yield control to the event loop.
     */
    yieldControl() {
        return new Promise((resolve) => setImmediate(resolve));
    }
    // ---- Private: Output Management ----
    /**
     * Capture an output line to both the in-memory buffer and
     * the output file (if configured).
     */
    captureOutput(record, line) {
        // In-memory buffer (bounded)
        record.outputBuffer.push(line);
        if (record.outputBuffer.length > OUTPUT_BUFFER_MAX) {
            record.outputBuffer.shift();
        }
        // File output
        if (record.state.outputFilePath) {
            try {
                appendFileSync(record.state.outputFilePath, line + '\n', 'utf-8');
            }
            catch {
                // Non-critical — best effort file I/O
            }
        }
    }
    /**
     * Initialize an output file with a header.
     */
    initializeOutputFile(filePath, config) {
        try {
            const header = [
                `=== NeuroCLI Background Session Output ===`,
                `Session: ${config.name} (${config.id})`,
                `Model: ${config.model ?? 'default'}`,
                `Working Directory: ${config.workingDirectory}`,
                `Max Iterations: ${config.maxIterations}`,
                `Max Cost: $${config.maxCost}`,
                `Started: ${new Date().toISOString()}`,
                `==========================================\n`,
            ].join('\n');
            writeFileSync(filePath, header, 'utf-8');
        }
        catch {
            // Non-critical
        }
    }
    // ---- Private: History ----
    /**
     * Add a history entry to a session.
     */
    addHistoryEntry(sessionId, type, message, data) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return;
        record.history.push({
            timestamp: Date.now(),
            type,
            message,
            data,
        });
        // Persist history to disk (append)
        this.persistHistory(sessionId, {
            timestamp: Date.now(),
            type,
            message,
            data,
        });
    }
    // ---- Private: Persistence ----
    /**
     * Persist session state to disk so it survives app restarts.
     */
    persistSession(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return;
        const filePath = join(SESSION_DIR, `${sessionId}.json`);
        try {
            const data = {
                config: record.config,
                state: record.state,
                // Don't persist runtime objects like AbortController or promises
                persistedAt: Date.now(),
            };
            writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch {
            // Non-critical — persistence is best-effort
        }
    }
    /**
     * Persist a single history entry to the session's history file.
     */
    persistHistory(sessionId, entry) {
        const filePath = join(HISTORY_DIR, `${sessionId}.jsonl`);
        try {
            appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
        }
        catch {
            // Non-critical
        }
    }
    /**
     * Restore sessions from disk on startup.
     * Only restores terminal-state sessions; running sessions
     * from a previous process are marked as 'stopped'.
     */
    restoreSessions() {
        if (!existsSync(SESSION_DIR))
            return;
        try {
            for (const file of readdirSync(SESSION_DIR)) {
                if (!file.endsWith('.json'))
                    continue;
                const filePath = join(SESSION_DIR, file);
                try {
                    const content = readFileSync(filePath, 'utf-8');
                    const data = JSON.parse(content);
                    // If the session was running when the app exited, mark it stopped
                    if (data.state.status === 'running' || data.state.status === 'paused') {
                        data.state.status = 'stopped';
                        data.state.completedAt = data.state.completedAt ?? Date.now();
                    }
                    // Re-create a minimal record (no running loop)
                    let completionResolve = null;
                    let completionReject = null;
                    const completionPromise = new Promise((resolve, reject) => {
                        completionResolve = resolve;
                        completionReject = reject;
                    });
                    // Resolve immediately for terminal-state sessions
                    if (data.state.status === 'completed' ||
                        data.state.status === 'failed' ||
                        data.state.status === 'stopped') {
                        // Pre-resolved
                        completionPromise.catch(() => { }); // swallow
                    }
                    // Restore history from disk if available
                    const history = this.loadHistoryFromDisk(data.config.id);
                    const record = {
                        config: data.config,
                        state: data.state,
                        history,
                        abortController: new AbortController(),
                        outputBuffer: [],
                        attached: false,
                        completionPromise,
                        completionResolve,
                        completionReject,
                        pausePromise: null,
                        pauseResolve: null,
                    };
                    this.sessions.set(data.config.id, record);
                }
                catch {
                    // Corrupted file — skip
                }
            }
        }
        catch {
            // Session directory read failure — skip
        }
    }
    /**
     * Load history entries from the JSONL file on disk.
     */
    loadHistoryFromDisk(sessionId) {
        const filePath = join(HISTORY_DIR, `${sessionId}.jsonl`);
        if (!existsSync(filePath))
            return [];
        const entries = [];
        try {
            const content = readFileSync(filePath, 'utf-8');
            for (const line of content.split('\n')) {
                if (!line.trim())
                    continue;
                try {
                    entries.push(JSON.parse(line));
                }
                catch {
                    // Skip malformed lines
                }
            }
        }
        catch {
            // Read failure — return what we have
        }
        return entries;
    }
    /**
     * Remove a session and its associated files.
     */
    removeSession(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record)
            return;
        // Remove session file
        const sessionFile = join(SESSION_DIR, `${sessionId}.json`);
        try {
            if (existsSync(sessionFile))
                unlinkSync(sessionFile);
        }
        catch { /* ignore */ }
        // Remove history file
        const historyFile = join(HISTORY_DIR, `${sessionId}.jsonl`);
        try {
            if (existsSync(historyFile))
                unlinkSync(historyFile);
        }
        catch { /* ignore */ }
        // Remove output file
        if (record.state.outputFilePath) {
            try {
                if (existsSync(record.state.outputFilePath))
                    unlinkSync(record.state.outputFilePath);
            }
            catch { /* ignore */ }
        }
        // Detach if currently attached
        if (this.currentlyAttached === sessionId) {
            this.currentlyAttached = null;
        }
        this.sessions.delete(sessionId);
        this.emit('session:removed', sessionId);
    }
    // ---- Private: Desktop Notifications ----
    /**
     * Send a desktop notification using the operating system's
     * native notification mechanism.
     */
    sendDesktopNotification(title, body) {
        try {
            const platform = process.platform;
            if (platform === 'darwin') {
                // macOS: use osascript to display a notification
                const escapedTitle = title.replace(/"/g, '\\"');
                const escapedBody = body.replace(/"/g, '\\"');
                spawn('osascript', [
                    '-e',
                    `display notification "${escapedBody}" with title "${escapedTitle}"`,
                ]).unref();
            }
            else if (platform === 'linux') {
                // Linux: try notify-send
                spawn('notify-send', [title, body]).unref();
            }
            else if (platform === 'win32') {
                // Windows: use PowerShell toast
                const escapedTitle = title.replace(/'/g, "''");
                const escapedBody = body.replace(/'/g, "''");
                const psCmd = `
          Add-Type -AssemblyName System.Windows.Forms
          $notify = New-Object System.Windows.Forms.NotifyIcon
          $notify.Icon = [System.Drawing.SystemIcons]::Information
          $notify.Visible = $true
          $notify.ShowBalloonTip(5000, '${escapedTitle}', '${escapedBody}', [System.Windows.Forms.ToolTipIcon]::Info)
        `.trim();
                spawn('powershell', ['-NoProfile', '-Command', psCmd], {
                    windowsHide: true,
                }).unref();
            }
            // If platform is unsupported, silently skip notification
        }
        catch {
            // Notification failure must never crash the manager
        }
    }
    // ---- Private: Utilities ----
    /**
     * Ensure a directory exists.
     */
    ensureDir(dir) {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }
}
//# sourceMappingURL=background-session.js.map