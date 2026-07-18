// ============================================================
// NeuroCLI - Multi-Session Parallel Agents (GAP-39)
// Multiple agent sessions running in parallel with independent
// state, inter-session communication, and resource management.
// Uses only Node.js built-in modules.
// ============================================================
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
// ---- Constants ----
const DEFAULT_MAX_CONCURRENT = 10;
const DEFAULT_MAX_TOKENS = 200_000;
const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_INPUT_PRICE = 3.0; // USD per 1M tokens
const DEFAULT_OUTPUT_PRICE = 15.0; // USD per 1M tokens
const REPLY_TIMEOUT_MS = 120_000; // 2 minutes
const TOKEN_CHARS_RATIO = 4; // ~4 characters per token (heuristic)
// ============================================================
// MultiSessionManager Class
// ============================================================
export class MultiSessionManager extends EventEmitter {
    sessions = new Map();
    currentSessionId = null;
    maxConcurrent;
    globalTokenBudget;
    totalTokensConsumed = 0;
    constructor(options) {
        super();
        this.maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
        this.globalTokenBudget = options?.globalTokenBudget ?? 0; // 0 = unlimited
    }
    // ============================================================
    // Session Lifecycle
    // ============================================================
    /**
     * Create a new independent agent session. Returns the session ID.
     */
    async createSession(name, config) {
        const activeCount = this.countActive();
        if (activeCount >= this.maxConcurrent) {
            throw new Error(`Maximum concurrent sessions reached (${this.maxConcurrent}). ` +
                `Close an existing session before creating a new one.`);
        }
        const id = randomUUID();
        const now = Date.now();
        const record = {
            id,
            name,
            config: config ?? {},
            history: [],
            status: 'active',
            createdAt: now,
            lastActivityAt: now,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            messageQueue: [],
            abortController: new AbortController(),
            pendingReplies: new Map(),
        };
        // Add system message if a system prompt was provided
        if (record.config.systemPrompt) {
            record.history.push({
                role: 'system',
                content: record.config.systemPrompt,
                timestamp: now,
            });
        }
        this.sessions.set(id, record);
        // If this is the first session, auto-switch to it
        if (this.sessions.size === 1) {
            this.currentSessionId = id;
        }
        this.emit('session:created', id, name);
        return id;
    }
    /**
     * Close a session by ID. Releases resources and rejects any pending replies.
     */
    async closeSession(id) {
        const record = this.sessions.get(id);
        if (!record) {
            throw new Error(`Session "${id}" not found`);
        }
        // Cancel any pending operations
        record.abortController.abort();
        // Reject all pending replies
        for (const [correlationId, pending] of record.pendingReplies) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`Session "${id}" was closed`));
            record.pendingReplies.delete(correlationId);
        }
        record.status = 'closed';
        record.lastActivityAt = Date.now();
        // If the closed session was current, switch to another active one
        if (this.currentSessionId === id) {
            this.currentSessionId = this.findFirstActiveSession();
        }
        this.emit('session:closed', id);
    }
    /**
     * List all sessions (including closed ones) with summary info.
     */
    listSessions() {
        const result = [];
        const records = Array.from(this.sessions.values());
        for (const r of records) {
            result.push(this.recordToInfo(r));
        }
        return result.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    }
    /**
     * Switch the active / focused session.
     */
    switchSession(id) {
        const record = this.sessions.get(id);
        if (!record) {
            throw new Error(`Session "${id}" not found`);
        }
        if (record.status === 'closed') {
            throw new Error(`Session "${id}" is closed and cannot be switched to`);
        }
        this.currentSessionId = id;
        this.emit('session:switched', id);
    }
    /**
     * Get the current session ID (or null if none).
     */
    getCurrentSession() {
        return this.currentSessionId;
    }
    // ============================================================
    // Session Communication
    // ============================================================
    /**
     * Send a prompt to a specific session and return the response.
     * Simulates an LLM interaction: appends the prompt, generates a
     * simulated response, and returns it.
     */
    async sendToSession(id, prompt) {
        const record = this.sessions.get(id);
        if (!record) {
            throw new Error(`Session "${id}" not found`);
        }
        if (record.status === 'closed') {
            throw new Error(`Session "${id}" is closed`);
        }
        // Check global token budget
        if (this.globalTokenBudget > 0 && this.totalTokensConsumed >= this.globalTokenBudget) {
            throw new Error('Global token budget exhausted. Cannot send more messages.');
        }
        const now = Date.now();
        // Append user message
        const inputTokenEstimate = this.estimateTokens(prompt);
        record.history.push({
            role: 'user',
            content: prompt,
            timestamp: now,
            tokenCount: inputTokenEstimate,
        });
        record.totalInputTokens += inputTokenEstimate;
        this.totalTokensConsumed += inputTokenEstimate;
        // Simulate assistant response (in production this would call an LLM)
        const response = this.generateSimulatedResponse(record, prompt);
        const outputTokenEstimate = this.estimateTokens(response);
        record.history.push({
            role: 'assistant',
            content: response,
            timestamp: Date.now(),
            tokenCount: outputTokenEstimate,
        });
        record.totalOutputTokens += outputTokenEstimate;
        this.totalTokensConsumed += outputTokenEstimate;
        record.lastActivityAt = Date.now();
        record.status = 'active';
        this.emit('session:message', id, { role: 'user', content: prompt });
        this.emit('session:message', id, { role: 'assistant', content: response });
        return response;
    }
    /**
     * Broadcast a prompt to all active sessions. Returns a map of
     * session ID → response string.
     */
    async broadcast(prompt) {
        const results = new Map();
        const activeIds = [];
        const records = Array.from(this.sessions.values());
        for (const record of records) {
            if (record.status !== 'closed') {
                activeIds.push(record.id);
            }
        }
        // Send to all active sessions concurrently
        const promises = activeIds.map(async (id) => {
            try {
                const response = await this.sendToSession(id, prompt);
                results.set(id, response);
            }
            catch (err) {
                results.set(id, `ERROR: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
        await Promise.allSettled(promises);
        this.emit('broadcast', prompt, activeIds);
        return results;
    }
    // ============================================================
    // Session History & Cost
    // ============================================================
    /**
     * Get the conversation history for a session.
     */
    getSessionHistory(id) {
        const record = this.sessions.get(id);
        if (!record) {
            throw new Error(`Session "${id}" not found`);
        }
        return [...record.history];
    }
    /**
     * Get the cost breakdown for a specific session.
     */
    getSessionCost(id) {
        const record = this.sessions.get(id);
        if (!record) {
            throw new Error(`Session "${id}" not found`);
        }
        const inputPrice = record.config.inputPricePerMillion ?? DEFAULT_INPUT_PRICE;
        const outputPrice = record.config.outputPricePerMillion ?? DEFAULT_OUTPUT_PRICE;
        const inputCost = (record.totalInputTokens / 1_000_000) * inputPrice;
        const outputCost = (record.totalOutputTokens / 1_000_000) * outputPrice;
        return {
            inputTokens: record.totalInputTokens,
            outputTokens: record.totalOutputTokens,
            inputCost: Math.round(inputCost * 10000) / 10000,
            outputCost: Math.round(outputCost * 10000) / 10000,
            totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
            currency: 'USD',
        };
    }
    // ============================================================
    // Inter-Session Messaging
    // ============================================================
    /**
     * Post a message from one session to another's message queue.
     * The receiving session can read it via getMessageQueue().
     */
    postMessage(fromSession, toSession, message) {
        const fromRecord = this.sessions.get(fromSession);
        if (!fromRecord) {
            throw new Error(`Source session "${fromSession}" not found`);
        }
        const toRecord = this.sessions.get(toSession);
        if (!toRecord) {
            throw new Error(`Target session "${toSession}" not found`);
        }
        if (toRecord.status === 'closed') {
            throw new Error(`Target session "${toSession}" is closed`);
        }
        const msg = {
            id: randomUUID(),
            fromSession,
            toSession,
            payload: message,
            timestamp: Date.now(),
            read: false,
        };
        toRecord.messageQueue.push(msg);
        toRecord.lastActivityAt = Date.now();
        this.emit('session:intermessage', fromSession, toSession, msg);
    }
    /**
     * Get the pending message queue for a session.
     */
    getMessageQueue(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Session "${sessionId}" not found`);
        }
        // Mark all as read
        const messages = [...record.messageQueue];
        for (const msg of messages) {
            msg.read = true;
        }
        return messages;
    }
    /**
     * Drain (retrieve and clear) the message queue for a session.
     */
    drainMessageQueue(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Session "${sessionId}" not found`);
        }
        const messages = [...record.messageQueue];
        for (const msg of messages) {
            msg.read = true;
        }
        record.messageQueue = [];
        return messages;
    }
    // ============================================================
    // Resource Management
    // ============================================================
    /**
     * Set the maximum number of concurrent sessions.
     */
    setMaxConcurrent(max) {
        if (max < 1) {
            throw new Error('Max concurrent sessions must be at least 1');
        }
        this.maxConcurrent = max;
        this.emit('config:maxConcurrent', max);
    }
    /**
     * Get total token usage across all sessions.
     */
    getTotalTokenUsage() {
        return this.totalTokensConsumed;
    }
    /**
     * Get aggregate cost across all sessions.
     */
    getTotalCost() {
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalInputCost = 0;
        let totalOutputCost = 0;
        const records = Array.from(this.sessions.values());
        for (const record of records) {
            const inputPrice = record.config.inputPricePerMillion ?? DEFAULT_INPUT_PRICE;
            const outputPrice = record.config.outputPricePerMillion ?? DEFAULT_OUTPUT_PRICE;
            totalInputTokens += record.totalInputTokens;
            totalOutputTokens += record.totalOutputTokens;
            totalInputCost += (record.totalInputTokens / 1_000_000) * inputPrice;
            totalOutputCost += (record.totalOutputTokens / 1_000_000) * outputPrice;
        }
        return {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            inputCost: Math.round(totalInputCost * 10000) / 10000,
            outputCost: Math.round(totalOutputCost * 10000) / 10000,
            totalCost: Math.round((totalInputCost + totalOutputCost) * 10000) / 10000,
            currency: 'USD',
        };
    }
    /**
     * Get the number of active sessions.
     */
    getActiveSessionCount() {
        return this.countActive();
    }
    /**
     * Clean up closed sessions, freeing memory.
     */
    cleanup() {
        let cleaned = 0;
        const entries = Array.from(this.sessions.entries());
        for (const [id, record] of entries) {
            if (record.status === 'closed') {
                // Reject any remaining pending replies
                for (const [, pending] of record.pendingReplies) {
                    clearTimeout(pending.timeout);
                    pending.reject(new Error('Session cleaned up'));
                }
                this.sessions.delete(id);
                cleaned++;
            }
        }
        this.emit('cleanup', cleaned);
        return cleaned;
    }
    // ============================================================
    // Private Helpers
    // ============================================================
    countActive() {
        let count = 0;
        const records = Array.from(this.sessions.values());
        for (const record of records) {
            if (record.status !== 'closed') {
                count++;
            }
        }
        return count;
    }
    findFirstActiveSession() {
        const records = Array.from(this.sessions.values());
        for (const record of records) {
            if (record.status !== 'closed') {
                return record.id;
            }
        }
        return null;
    }
    recordToInfo(record) {
        return {
            id: record.id,
            name: record.name,
            status: record.status,
            createdAt: record.createdAt,
            lastActivityAt: record.lastActivityAt,
            messageCount: record.history.filter((m) => m.role !== 'system').length,
            totalInputTokens: record.totalInputTokens,
            totalOutputTokens: record.totalOutputTokens,
            tags: record.config.tags ?? [],
            model: record.config.model ?? 'default',
        };
    }
    /**
     * Rough token estimation: ~4 characters per token.
     */
    estimateTokens(text) {
        return Math.ceil(text.length / TOKEN_CHARS_RATIO);
    }
    /**
     * Generate a simulated LLM response for a session.
     * In production, this would call the actual model API.
     */
    generateSimulatedResponse(record, prompt) {
        const sessionName = record.name;
        const historyLength = record.history.length;
        const maxIterations = record.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        // Build context from recent history (last 5 non-system messages)
        const recentMessages = record.history
            .filter((m) => m.role !== 'system')
            .slice(-5);
        const contextSummary = recentMessages
            .map((m) => `[${m.role}]: ${m.content.substring(0, 80)}...`)
            .join('\n');
        const lines = [
            `[Session "${sessionName}" — response #${Math.floor(historyLength / 2)}]`,
            '',
            `Received prompt (${prompt.length} chars). Context window contains ${historyLength} messages.`,
            '',
            `Recent context:`,
            contextSummary,
            '',
            `Remaining iterations: ${Math.max(0, maxIterations - Math.floor(historyLength / 2))}`,
            `Session tokens: ${record.totalInputTokens + record.totalOutputTokens} (est.)`,
        ];
        return lines.join('\n');
    }
}
//# sourceMappingURL=multi-session.js.map