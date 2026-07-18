// ============================================================
// NeuroCLI - Telemetry System
// Anonymous usage tracking (opt-in), session metrics,
// tool usage, model performance. Privacy-first: no PII.
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
// -----------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------
const DEFAULT_DATA_DIR = join(homedir(), '.neuro', 'telemetry');
function generateAnonymousId() {
    const chars = 'abcdef0123456789';
    let id = '';
    for (let i = 0; i < 16; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}
function defaultConfig() {
    return {
        enabled: false,
        dataDir: DEFAULT_DATA_DIR,
        trackModelPerformance: true,
        trackToolUsage: true,
        trackSessionMetrics: true,
        retentionDays: 90,
        anonymousId: generateAnonymousId(),
    };
}
// -----------------------------------------------------------
// TelemetrySystem
// -----------------------------------------------------------
export class TelemetrySystem {
    config;
    sessionMetrics = [];
    toolUsageMap = new Map();
    modelPerformanceMap = new Map();
    currentSessionStart = Date.now();
    currentSessionMessages = 0;
    currentSessionTools = 0;
    currentSessionModel = '';
    currentSessionInputTokens = 0;
    currentSessionOutputTokens = 0;
    currentSessionCost = 0;
    constructor(config) {
        this.config = { ...defaultConfig(), ...config };
        this.ensureDataDir();
        this.loadPersistedData();
    }
    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    /**
     * Check if telemetry is enabled
     */
    isEnabled() {
        return this.config.enabled;
    }
    /**
     * Enable telemetry (opt-in)
     */
    enable() {
        this.config.enabled = true;
        this.persistConfig();
        console.log(chalk.green('Telemetry enabled. No PII is collected.'));
    }
    /**
     * Disable telemetry
     */
    disable() {
        this.config.enabled = false;
        this.persistConfig();
        console.log(chalk.gray('Telemetry disabled.'));
    }
    /**
     * Toggle telemetry on/off
     */
    toggle() {
        this.config.enabled = !this.config.enabled;
        this.persistConfig();
        return this.config.enabled;
    }
    /**
     * Record a session start
     */
    startSession(sessionId, model) {
        if (!this.config.enabled || !this.config.trackSessionMetrics)
            return;
        this.currentSessionStart = Date.now();
        this.currentSessionMessages = 0;
        this.currentSessionTools = 0;
        this.currentSessionModel = model;
        this.currentSessionInputTokens = 0;
        this.currentSessionOutputTokens = 0;
        this.currentSessionCost = 0;
    }
    /**
     * Record a message in the current session
     */
    recordMessage() {
        if (!this.config.enabled || !this.config.trackSessionMetrics)
            return;
        this.currentSessionMessages++;
    }
    /**
     * Record a tool call
     */
    recordToolCall(toolName, durationMs, success) {
        if (!this.config.enabled || !this.config.trackToolUsage)
            return;
        this.currentSessionTools++;
        let metric = this.toolUsageMap.get(toolName);
        if (!metric) {
            metric = {
                toolName,
                callCount: 0,
                successCount: 0,
                errorCount: 0,
                avgDurationMs: 0,
                lastUsed: Date.now(),
            };
        }
        const totalDuration = metric.avgDurationMs * metric.callCount + durationMs;
        metric.callCount++;
        if (success)
            metric.successCount++;
        else
            metric.errorCount++;
        metric.avgDurationMs = totalDuration / metric.callCount;
        metric.lastUsed = Date.now();
        this.toolUsageMap.set(toolName, metric);
    }
    /**
     * Record model performance data
     */
    recordModelPerformance(model, inputTokens, outputTokens, cost, latencyMs, error) {
        if (!this.config.enabled || !this.config.trackModelPerformance)
            return;
        this.currentSessionInputTokens += inputTokens;
        this.currentSessionOutputTokens += outputTokens;
        this.currentSessionCost += cost;
        let perf = this.modelPerformanceMap.get(model);
        if (!perf) {
            perf = { latencies: [], errors: 0, requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
        }
        perf.requests++;
        perf.inputTokens += inputTokens;
        perf.outputTokens += outputTokens;
        perf.cost += cost;
        perf.latencies.push(latencyMs);
        if (error)
            perf.errors++;
        // Keep only last 1000 latency samples
        if (perf.latencies.length > 1000) {
            perf.latencies = perf.latencies.slice(-1000);
        }
        this.modelPerformanceMap.set(model, perf);
    }
    /**
     * End the current session and record its metrics
     */
    endSession(sessionId) {
        if (!this.config.enabled || !this.config.trackSessionMetrics)
            return;
        const metric = {
            sessionId,
            duration: Date.now() - this.currentSessionStart,
            messageCount: this.currentSessionMessages,
            modelUsed: this.currentSessionModel,
            inputTokens: this.currentSessionInputTokens,
            outputTokens: this.currentSessionOutputTokens,
            cost: this.currentSessionCost,
            toolsCalled: this.currentSessionTools,
            timestamp: Date.now(),
        };
        this.sessionMetrics.push(metric);
        this.persistData();
    }
    /**
     * Get all tool usage metrics
     */
    getToolUsageMetrics() {
        return Array.from(this.toolUsageMap.values());
    }
    /**
     * Get model performance metrics
     */
    getModelPerformanceMetrics() {
        const metrics = [];
        for (const [model, perf] of this.modelPerformanceMap) {
            const sorted = [...perf.latencies].sort((a, b) => a - b);
            const p50 = this.percentile(sorted, 50);
            const p95 = this.percentile(sorted, 95);
            const p99 = this.percentile(sorted, 99);
            const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
            metrics.push({
                model,
                requestCount: perf.requests,
                totalInputTokens: perf.inputTokens,
                totalOutputTokens: perf.outputTokens,
                totalCost: perf.cost,
                avgLatencyMs: Math.round(avg),
                errorCount: perf.errors,
                p50LatencyMs: Math.round(p50),
                p95LatencyMs: Math.round(p95),
                p99LatencyMs: Math.round(p99),
            });
        }
        return metrics;
    }
    /**
     * Get session metrics
     */
    getSessionMetrics() {
        return [...this.sessionMetrics];
    }
    /**
     * Generate a full telemetry report
     */
    generateReport(startTimestamp, endTimestamp) {
        const end = endTimestamp || Date.now();
        const start = startTimestamp || end - 30 * 24 * 60 * 60 * 1000; // default: last 30 days
        const filteredSessions = this.sessionMetrics.filter(s => s.timestamp >= start && s.timestamp <= end);
        return {
            generatedAt: Date.now(),
            period: { start, end },
            totalSessions: filteredSessions.length,
            totalMessages: filteredSessions.reduce((sum, s) => sum + s.messageCount, 0),
            totalTokens: {
                input: filteredSessions.reduce((sum, s) => sum + s.inputTokens, 0),
                output: filteredSessions.reduce((sum, s) => sum + s.outputTokens, 0),
            },
            totalCost: filteredSessions.reduce((sum, s) => sum + s.cost, 0),
            toolUsage: this.getToolUsageMetrics(),
            modelPerformance: this.getModelPerformanceMetrics(),
            sessionMetrics: filteredSessions,
        };
    }
    /**
     * Export telemetry data as JSON string
     */
    exportJSON(pretty) {
        const report = this.generateReport();
        return pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
    }
    /**
     * Export telemetry data to a file
     */
    exportToFile(filePath) {
        try {
            const data = this.exportJSON(true);
            writeFileSync(filePath, data, 'utf-8');
            console.log(chalk.green(`Telemetry data exported to ${filePath}`));
        }
        catch (error) {
            console.log(chalk.red(`Failed to export telemetry: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    /**
     * Print a summary of telemetry data
     */
    printSummary() {
        if (!this.config.enabled) {
            console.log(chalk.gray('Telemetry is disabled. Use /telemetry on to enable.'));
            return;
        }
        const report = this.generateReport();
        console.log('');
        console.log(chalk.bold('--- NeuroCLI Telemetry Report ---'));
        console.log('');
        console.log(`  Anonymous ID: ${chalk.cyan(this.config.anonymousId)}`);
        console.log(`  Period: ${new Date(report.period.start).toLocaleDateString()} - ${new Date(report.period.end).toLocaleDateString()}`);
        console.log('');
        console.log(`  Total Sessions:  ${chalk.yellow(String(report.totalSessions))}`);
        console.log(`  Total Messages:  ${chalk.yellow(String(report.totalMessages))}`);
        console.log(`  Total Tokens In: ${chalk.yellow(report.totalTokens.input.toLocaleString())}`);
        console.log(`  Total Tokens Out:${chalk.yellow(report.totalTokens.output.toLocaleString())}`);
        console.log(`  Total Cost:      ${chalk.green('$' + report.totalCost.toFixed(4))}`);
        console.log('');
        // Tool usage
        if (report.toolUsage.length > 0) {
            console.log(chalk.bold('  Tool Usage:'));
            for (const tool of report.toolUsage.sort((a, b) => b.callCount - a.callCount).slice(0, 10)) {
                const successRate = tool.callCount > 0 ? ((tool.successCount / tool.callCount) * 100).toFixed(1) : '0';
                console.log(`    ${chalk.cyan(tool.toolName)}: ${tool.callCount} calls (${successRate}% success, avg ${Math.round(tool.avgDurationMs)}ms)`);
            }
            console.log('');
        }
        // Model performance
        if (report.modelPerformance.length > 0) {
            console.log(chalk.bold('  Model Performance:'));
            for (const model of report.modelPerformance) {
                console.log(`    ${chalk.cyan(model.model)}:`);
                console.log(`      Requests: ${model.requestCount} | Errors: ${model.errorCount}`);
                console.log(`      Latency: p50=${model.p50LatencyMs}ms p95=${model.p95LatencyMs}ms p99=${model.p99LatencyMs}ms`);
                console.log(`      Cost: $${model.totalCost.toFixed(4)}`);
            }
            console.log('');
        }
        console.log(chalk.bold('---------------------------------'));
        console.log('');
    }
    /**
     * Clear all telemetry data
     */
    clearData() {
        this.sessionMetrics = [];
        this.toolUsageMap.clear();
        this.modelPerformanceMap.clear();
        this.persistData();
        console.log(chalk.green('Telemetry data cleared.'));
    }
    /**
     * Get current config
     */
    getConfig() {
        return { ...this.config };
    }
    // ----------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------
    percentile(sorted, p) {
        if (sorted.length === 0)
            return 0;
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }
    ensureDataDir() {
        if (!existsSync(this.config.dataDir)) {
            mkdirSync(this.config.dataDir, { recursive: true });
        }
    }
    persistConfig() {
        try {
            const configPath = join(this.config.dataDir, 'config.json');
            writeFileSync(configPath, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch { /* Silently fail */ }
    }
    persistData() {
        if (!this.config.enabled)
            return;
        try {
            this.ensureDataDir();
            // Persist session metrics
            const sessionPath = join(this.config.dataDir, 'sessions.json');
            writeFileSync(sessionPath, JSON.stringify(this.sessionMetrics, null, 2), 'utf-8');
            // Persist tool usage
            const toolPath = join(this.config.dataDir, 'tools.json');
            writeFileSync(toolPath, JSON.stringify(Array.from(this.toolUsageMap.entries()), null, 2), 'utf-8');
            // Persist model performance
            const modelPath = join(this.config.dataDir, 'models.json');
            const serializableModels = Array.from(this.modelPerformanceMap.entries()).map(([key, val]) => ({
                key,
                ...val,
            }));
            writeFileSync(modelPath, JSON.stringify(serializableModels, null, 2), 'utf-8');
            // Cleanup old data
            this.cleanupOldData();
        }
        catch { /* Silently fail */ }
    }
    loadPersistedData() {
        try {
            // Load config
            const configPath = join(this.config.dataDir, 'config.json');
            if (existsSync(configPath)) {
                const raw = readFileSync(configPath, 'utf-8');
                const saved = JSON.parse(raw);
                this.config = { ...this.config, ...saved };
            }
            if (!this.config.enabled)
                return;
            // Load session metrics
            const sessionPath = join(this.config.dataDir, 'sessions.json');
            if (existsSync(sessionPath)) {
                const raw = readFileSync(sessionPath, 'utf-8');
                this.sessionMetrics = JSON.parse(raw);
            }
            // Load tool usage
            const toolPath = join(this.config.dataDir, 'tools.json');
            if (existsSync(toolPath)) {
                const raw = readFileSync(toolPath, 'utf-8');
                const entries = JSON.parse(raw);
                this.toolUsageMap = new Map(entries);
            }
            // Load model performance
            const modelPath = join(this.config.dataDir, 'models.json');
            if (existsSync(modelPath)) {
                const raw = readFileSync(modelPath, 'utf-8');
                const items = JSON.parse(raw);
                this.modelPerformanceMap = new Map(items.map(item => [item.key, {
                        latencies: item.latencies,
                        errors: item.errors,
                        requests: item.requests,
                        inputTokens: item.inputTokens,
                        outputTokens: item.outputTokens,
                        cost: item.cost,
                    }]));
            }
        }
        catch { /* Silently fail - telemetry should never block the CLI */ }
    }
    cleanupOldData() {
        const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
        this.sessionMetrics = this.sessionMetrics.filter(s => s.timestamp >= cutoff);
    }
}
//# sourceMappingURL=telemetry.js.map