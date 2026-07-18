// ============================================================
// NeuroCLI - GAP-36: OpenTelemetry / Observability Integration
// Zero-dependency OTLP JSON over HTTP export, custom spans,
// metrics, session tracing, and console pretty-printer.
// Compatible with Datadog, Jaeger, Dynatrace, Grafana.
// ============================================================
import chalk from 'chalk';
// -----------------------------------------------------------
// OTLP constants
// -----------------------------------------------------------
const SPAN_KIND_MAP = {
    internal: 1,
    server: 2,
    client: 3,
};
const STATUS_CODE_MAP = {
    ok: 1,
    error: 2,
};
const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
// -----------------------------------------------------------
// ID generation (crypto-quality random hex)
// -----------------------------------------------------------
function generateTraceId() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function generateSpanId() {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
// -----------------------------------------------------------
// OTLP JSON encoders
// -----------------------------------------------------------
function encodeAttributeValue(value) {
    if (typeof value === 'string') {
        return { stringValue: value };
    }
    if (typeof value === 'number') {
        return Number.isInteger(value)
            ? { intValue: value }
            : { doubleValue: value };
    }
    if (typeof value === 'boolean') {
        return { boolValue: value };
    }
    return { stringValue: String(value) };
}
function encodeAttributes(attrs) {
    return Object.entries(attrs).map(([key, value]) => ({
        key,
        value: encodeAttributeValue(value),
    }));
}
function encodeSpanToOTLP(span, serviceName) {
    return {
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId ?? '',
        name: span.name,
        kind: SPAN_KIND_MAP[span.kind] ?? 1,
        startTimeUnixNano: String(span.startTime * 1_000_000),
        endTimeUnixNano: String(span.endTime * 1_000_000),
        attributes: encodeAttributes({ 'service.name': serviceName, ...span.attributes }),
        events: span.events.map(evt => ({
            name: evt.name,
            timeUnixNano: String(evt.timestamp * 1_000_000),
            attributes: encodeAttributes(evt.attributes),
        })),
        status: {
            code: STATUS_CODE_MAP[span.status.code] ?? 0,
            message: span.status.message ?? '',
        },
    };
}
function buildTracesPayload(spans, serviceName) {
    return {
        resourceSpans: [{
                resource: {
                    attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
                },
                scopeSpans: [{
                        scope: { name: serviceName, version: '1.0.0' },
                        spans: spans.map(s => encodeSpanToOTLP(s, serviceName)),
                    }],
            }],
    };
}
function buildMetricsPayload(metrics, serviceName) {
    const grouped = new Map();
    for (const m of metrics) {
        const key = `${m.name}:${m.type}`;
        const list = grouped.get(key) ?? [];
        list.push(m);
        grouped.set(key, list);
    }
    const otlpMetrics = [];
    for (const [, group] of grouped) {
        const first = group[0];
        const dataPoints = group.map(m => ({
            asDouble: m.value,
            timeUnixNano: String(m.timestamp * 1_000_000),
            attributes: encodeAttributes(m.attributes),
        }));
        let metricData;
        if (first.type === 'counter') {
            metricData = { sum: { dataPoints, isMonotonic: true } };
        }
        else if (first.type === 'gauge') {
            metricData = { gauge: { dataPoints } };
        }
        else {
            const values = group.map(m => m.value);
            const sorted = [...values].sort((a, b) => a - b);
            const count = sorted.length;
            const sum = sorted.reduce((a, b) => a + b, 0);
            const min = sorted[0] ?? 0;
            const max = sorted[count - 1] ?? 0;
            const bucketCounts = new Array(DEFAULT_HISTOGRAM_BUCKETS.length + 1).fill(0);
            for (const v of sorted) {
                let placed = false;
                for (let i = 0; i < DEFAULT_HISTOGRAM_BUCKETS.length; i++) {
                    if (v <= DEFAULT_HISTOGRAM_BUCKETS[i]) {
                        bucketCounts[i]++;
                        placed = true;
                        break;
                    }
                }
                if (!placed)
                    bucketCounts[DEFAULT_HISTOGRAM_BUCKETS.length]++;
            }
            metricData = {
                histogram: {
                    dataPoints: [{
                            asDouble: sum,
                            timeUnixNano: String(first.timestamp * 1_000_000),
                            attributes: encodeAttributes(first.attributes),
                            count,
                            sum,
                            min,
                            max,
                            explicitBounds: DEFAULT_HISTOGRAM_BUCKETS,
                            bucketCounts,
                        }],
                },
            };
        }
        otlpMetrics.push({ name: first.name, ...metricData });
    }
    return {
        resourceMetrics: [{
                resource: {
                    attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
                },
                scopeMetrics: [{
                        scope: { name: serviceName, version: '1.0.0' },
                        metrics: otlpMetrics,
                    }],
            }],
    };
}
// -----------------------------------------------------------
// Ring buffer (fixed-capacity, overwrites oldest)
// -----------------------------------------------------------
class RingBuffer {
    buffer;
    head = 0;
    tail = 0;
    size = 0;
    capacity;
    constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
    }
    push(item) {
        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.capacity;
        if (this.size === this.capacity) {
            this.head = (this.head + 1) % this.capacity;
        }
        else {
            this.size++;
        }
    }
    items() {
        const result = [];
        for (let i = 0; i < this.size; i++) {
            const idx = (this.head + i) % this.capacity;
            const item = this.buffer[idx];
            if (item !== undefined)
                result.push(item);
        }
        return result;
    }
    clear() {
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }
    get length() {
        return this.size;
    }
}
// -----------------------------------------------------------
// Console pretty-printer
// -----------------------------------------------------------
function formatDuration(ms) {
    if (ms < 1)
        return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000)
        return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
function formatTimestamp(unixMs) {
    return new Date(unixMs).toISOString();
}
function consolePrintSpan(span, depth) {
    const indent = '  '.repeat(depth);
    const duration = span.endTime - span.startTime;
    const statusIcon = span.status.code === 'ok'
        ? chalk.green('✓')
        : chalk.red('✗');
    const kindBadge = {
        internal: chalk.gray('INT'),
        client: chalk.blue('CLI'),
        server: chalk.magenta('SRV'),
    }[span.kind] ?? chalk.gray('???');
    const lines = [];
    lines.push(`${indent}${statusIcon} ${chalk.bold(span.name)} ${kindBadge} ${chalk.gray(formatDuration(duration))}`);
    if (span.status.code === 'error' && span.status.message) {
        lines.push(`${indent}  ${chalk.red('error:')} ${span.status.message}`);
    }
    const attrEntries = Object.entries(span.attributes);
    if (attrEntries.length > 0) {
        const attrStr = attrEntries
            .slice(0, 5)
            .map(([k, v]) => `${chalk.cyan(k)}=${chalk.yellow(String(v))}`)
            .join(' ');
        const overflow = attrEntries.length > 5 ? ` ${chalk.gray(`+${attrEntries.length - 5} more`)}` : '';
        lines.push(`${indent}  ${attrStr}${overflow}`);
    }
    for (const evt of span.events) {
        lines.push(`${indent}  ${chalk.gray('@')} ${chalk.white(evt.name)} ${chalk.gray(formatTimestamp(evt.timestamp))}`);
    }
    return lines.join('\n');
}
function consolePrintSpanTree(spans) {
    if (spans.length === 0)
        return chalk.gray('No spans recorded.');
    const spanMap = new Map(spans.map(s => [s.spanId, s]));
    const children = new Map();
    const roots = [];
    for (const span of spans) {
        if (!span.parentSpanId || !spanMap.has(span.parentSpanId)) {
            roots.push(span);
        }
        else {
            const list = children.get(span.parentSpanId) ?? [];
            list.push(span);
            children.set(span.parentSpanId, list);
        }
    }
    const lines = [];
    lines.push('');
    lines.push(chalk.bold('━━━ NeuroCLI Trace ━━━'));
    function render(span, depth) {
        lines.push(consolePrintSpan(span, depth));
        const kids = children.get(span.spanId) ?? [];
        kids.sort((a, b) => a.startTime - b.startTime);
        for (const child of kids) {
            render(child, depth + 1);
        }
    }
    roots.sort((a, b) => a.startTime - b.startTime);
    for (const root of roots) {
        render(root, 0);
    }
    lines.push(chalk.bold('━━━━━━━━━━━━━━━━━━━━'));
    lines.push('');
    return lines.join('\n');
}
// -----------------------------------------------------------
// HTTP export helper
// -----------------------------------------------------------
async function exportOTLPJson(url, payload, headers) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(payload),
        });
        return response.status >= 200 && response.status < 300;
    }
    catch {
        return false;
    }
}
// -----------------------------------------------------------
// ObservabilityManager
// -----------------------------------------------------------
export class ObservabilityManager {
    config;
    pendingSpans = [];
    pendingMetrics = [];
    spanBuffer;
    sessionTraceId;
    sessionRootSpanId;
    exportTimer;
    activeSpans = new Map();
    histogramBuckets = new Map();
    counters = new Map();
    gauges = new Map();
    constructor(config) {
        this.config = config;
        this.spanBuffer = new RingBuffer(1000);
        this.sessionTraceId = generateTraceId();
    }
    // ----------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------
    start() {
        if (!this.config.enabled)
            return;
        if (this.config.exportInterval > 0) {
            this.exportTimer = setInterval(() => {
                this.flush().catch(() => { });
            }, this.config.exportInterval);
            if (this.exportTimer.unref) {
                this.exportTimer.unref();
            }
        }
    }
    async stop() {
        if (this.exportTimer !== undefined) {
            clearInterval(this.exportTimer);
            this.exportTimer = undefined;
        }
        await this.flush();
    }
    // ----------------------------------------------------------
    // Sampling
    // ----------------------------------------------------------
    shouldSample() {
        if (this.config.sampleRate >= 1)
            return true;
        if (this.config.sampleRate <= 0)
            return false;
        return Math.random() < this.config.sampleRate;
    }
    // ----------------------------------------------------------
    // Tracing
    // ----------------------------------------------------------
    startSpan(name, parent, attributes) {
        if (!this.config.enabled) {
            return this.createNoopSpan();
        }
        const traceId = parent?.traceId ?? this.sessionTraceId;
        const spanId = generateSpanId();
        const span = {
            traceId,
            spanId,
            parentSpanId: parent?.spanId ?? this.sessionRootSpanId,
            name,
            kind: 'internal',
            startTime: Date.now(),
            endTime: 0,
            attributes: attributes ?? {},
            events: [],
            status: { code: 'ok' },
        };
        this.activeSpans.set(spanId, span);
        return span;
    }
    endSpan(span, status) {
        if (!this.config.enabled)
            return;
        span.endTime = Date.now();
        if (status) {
            span.status = status;
        }
        this.activeSpans.delete(span.spanId);
        if (!this.shouldSample())
            return;
        this.pendingSpans.push(span);
        this.spanBuffer.push(span);
        if (this.config.consoleExporter) {
            this.printSpanToConsole(span);
        }
        if (this.pendingSpans.length >= this.config.maxBatchSize) {
            this.flush().catch(() => { });
        }
    }
    addEvent(span, name, attributes) {
        if (!this.config.enabled)
            return;
        span.events.push({
            name,
            timestamp: Date.now(),
            attributes: attributes ?? {},
        });
    }
    // ----------------------------------------------------------
    // Metrics
    // ----------------------------------------------------------
    incrementCounter(name, value = 1, attributes = {}) {
        if (!this.config.enabled)
            return;
        const key = `${name}:${JSON.stringify(attributes)}`;
        const current = this.counters.get(key) ?? 0;
        this.counters.set(key, current + value);
        const metric = {
            name,
            type: 'counter',
            value: current + value,
            attributes,
            timestamp: Date.now(),
        };
        this.pendingMetrics.push(metric);
        if (this.pendingMetrics.length >= this.config.maxBatchSize) {
            this.flush().catch(() => { });
        }
    }
    recordGauge(name, value, attributes = {}) {
        if (!this.config.enabled)
            return;
        const key = `${name}:${JSON.stringify(attributes)}`;
        this.gauges.set(key, value);
        const metric = {
            name,
            type: 'gauge',
            value,
            attributes,
            timestamp: Date.now(),
        };
        this.pendingMetrics.push(metric);
        if (this.pendingMetrics.length >= this.config.maxBatchSize) {
            this.flush().catch(() => { });
        }
    }
    recordHistogram(name, value, attributes = {}) {
        if (!this.config.enabled)
            return;
        const key = `${name}:${JSON.stringify(attributes)}`;
        let bucket = this.histogramBuckets.get(key);
        if (!bucket) {
            const bounds = [...DEFAULT_HISTOGRAM_BUCKETS];
            bucket = { bounds, counts: new Array(bounds.length + 1).fill(0), sum: 0, count: 0, min: Infinity, max: -Infinity };
            this.histogramBuckets.set(key, bucket);
        }
        bucket.sum += value;
        bucket.count++;
        if (value < bucket.min)
            bucket.min = value;
        if (value > bucket.max)
            bucket.max = value;
        let placed = false;
        for (let i = 0; i < bucket.bounds.length; i++) {
            if (value <= bucket.bounds[i]) {
                bucket.counts[i]++;
                placed = true;
                break;
            }
        }
        if (!placed) {
            bucket.counts[bucket.bounds.length]++;
        }
        const metric = {
            name,
            type: 'histogram',
            value,
            attributes,
            timestamp: Date.now(),
        };
        this.pendingMetrics.push(metric);
        if (this.pendingMetrics.length >= this.config.maxBatchSize) {
            this.flush().catch(() => { });
        }
    }
    // ----------------------------------------------------------
    // Convenience tracing methods
    // ----------------------------------------------------------
    traceLLMRequest(model, promptTokens, completionTokens, duration, cost) {
        const span = this.startSpan('llm.request', undefined, {
            'llm.model': model,
            'llm.prompt_tokens': promptTokens,
            'llm.completion_tokens': completionTokens,
            'llm.total_tokens': promptTokens + completionTokens,
            'llm.cost_usd': cost,
            'llm.duration_ms': duration,
        });
        span.kind = 'client';
        span.endTime = span.startTime + duration;
        span.status = { code: 'ok' };
        this.activeSpans.delete(span.spanId);
        if (this.shouldSample()) {
            this.pendingSpans.push(span);
            this.spanBuffer.push(span);
        }
        this.incrementCounter('llm.requests.total', 1, { model });
        this.incrementCounter('llm.tokens.prompt', promptTokens, { model });
        this.incrementCounter('llm.tokens.completion', completionTokens, { model });
        this.recordGauge('llm.cost', cost, { model });
        this.recordHistogram('llm.latency', duration, { model });
        if (this.config.consoleExporter) {
            this.printSpanToConsole(span);
        }
        return span;
    }
    traceToolCall(tool, args, duration, success) {
        const span = this.startSpan('tool.call', undefined, {
            'tool.name': tool,
            'tool.duration_ms': duration,
            'tool.success': success,
            'tool.args_preview': typeof args === 'string' ? args.slice(0, 200) : JSON.stringify(args).slice(0, 200),
        });
        span.kind = 'client';
        span.endTime = span.startTime + duration;
        span.status = success ? { code: 'ok' } : { code: 'error', message: `Tool '${tool}' failed` };
        this.activeSpans.delete(span.spanId);
        if (this.shouldSample()) {
            this.pendingSpans.push(span);
            this.spanBuffer.push(span);
        }
        this.incrementCounter('tool.calls.total', 1, { tool, success: String(success) });
        this.incrementCounter(success ? 'tool.calls.success' : 'tool.calls.error', 1, { tool });
        this.recordHistogram('tool.duration', duration, { tool });
        if (this.config.consoleExporter) {
            this.printSpanToConsole(span);
        }
        return span;
    }
    traceAgentAction(agent, action, duration) {
        const span = this.startSpan('agent.action', undefined, {
            'agent.name': agent,
            'agent.action': action,
            'agent.duration_ms': duration,
        });
        span.kind = 'internal';
        span.endTime = span.startTime + duration;
        span.status = { code: 'ok' };
        this.activeSpans.delete(span.spanId);
        if (this.shouldSample()) {
            this.pendingSpans.push(span);
            this.spanBuffer.push(span);
        }
        this.incrementCounter('agent.actions.total', 1, { agent, action });
        this.recordHistogram('agent.action.duration', duration, { agent, action });
        if (this.config.consoleExporter) {
            this.printSpanToConsole(span);
        }
        return span;
    }
    // ----------------------------------------------------------
    // Export
    // ----------------------------------------------------------
    async flush() {
        if (!this.config.enabled)
            return;
        const spansToExport = this.pendingSpans.splice(0);
        const metricsToExport = this.pendingMetrics.splice(0);
        if (spansToExport.length === 0 && metricsToExport.length === 0)
            return;
        const tracesUrl = this.config.endpoint.replace(/\/$/, '');
        const metricsUrl = tracesUrl.replace(/\/v1\/traces$/, '/v1/metrics');
        const exportPromises = [];
        if (spansToExport.length > 0) {
            const tracesPayload = buildTracesPayload(spansToExport, this.config.serviceName);
            exportPromises.push(exportOTLPJson(tracesUrl, tracesPayload, this.config.headers));
        }
        if (metricsToExport.length > 0) {
            const metricsPayload = buildMetricsPayload(metricsToExport, this.config.serviceName);
            exportPromises.push(exportOTLPJson(metricsUrl, metricsPayload, this.config.headers));
        }
        await Promise.allSettled(exportPromises);
    }
    getPendingCount() {
        return {
            spans: this.pendingSpans.length,
            metrics: this.pendingMetrics.length,
        };
    }
    // ----------------------------------------------------------
    // Session tracing
    // ----------------------------------------------------------
    startSession(sessionName) {
        this.sessionTraceId = generateTraceId();
        const rootSpan = this.startSpan(sessionName ?? 'session', undefined, {
            'session.id': this.sessionTraceId,
        });
        rootSpan.kind = 'server';
        this.sessionRootSpanId = rootSpan.spanId;
        return rootSpan;
    }
    endSession(rootSpan) {
        this.endSpan(rootSpan, { code: 'ok' });
        this.sessionRootSpanId = undefined;
    }
    getSessionTrace() {
        return this.spanBuffer.items().filter(s => s.traceId === this.sessionTraceId);
    }
    printTrace() {
        const spans = this.getSessionTrace();
        return consolePrintSpanTree(spans);
    }
    // ----------------------------------------------------------
    // Configuration
    // ----------------------------------------------------------
    getConfig() {
        return { ...this.config };
    }
    updateConfig(partial) {
        Object.assign(this.config, partial);
    }
    getSessionTraceId() {
        return this.sessionTraceId;
    }
    setSessionTraceId(traceId) {
        this.sessionTraceId = traceId;
    }
    getActiveSpanCount() {
        return this.activeSpans.size;
    }
    // ----------------------------------------------------------
    // Metric summaries
    // ----------------------------------------------------------
    getCounterValue(name, attributes = {}) {
        const key = `${name}:${JSON.stringify(attributes)}`;
        return this.counters.get(key) ?? 0;
    }
    getGaugeValue(name, attributes = {}) {
        const key = `${name}:${JSON.stringify(attributes)}`;
        return this.gauges.get(key);
    }
    getHistogramSummary(name, attributes = {}) {
        const key = `${name}:${JSON.stringify(attributes)}`;
        const bucket = this.histogramBuckets.get(key);
        if (!bucket)
            return undefined;
        return {
            count: bucket.count,
            sum: bucket.sum,
            min: bucket.min === Infinity ? 0 : bucket.min,
            max: bucket.max === -Infinity ? 0 : bucket.max,
            avg: bucket.count > 0 ? bucket.sum / bucket.count : 0,
        };
    }
    // ----------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------
    createNoopSpan() {
        return {
            traceId: '0'.repeat(32),
            spanId: '0'.repeat(16),
            name: 'noop',
            kind: 'internal',
            startTime: 0,
            endTime: 0,
            attributes: {},
            events: [],
            status: { code: 'ok' },
        };
    }
    printSpanToConsole(span) {
        const duration = span.endTime > 0 ? span.endTime - span.startTime : 0;
        const statusIcon = span.status.code === 'ok' ? chalk.green('✓') : chalk.red('✗');
        const kindLabel = {
            internal: chalk.gray('INT'),
            client: chalk.blue('CLI'),
            server: chalk.magenta('SRV'),
        }[span.kind] ?? chalk.gray('???');
        const parts = [
            statusIcon,
            chalk.bold(span.name),
            kindLabel,
            chalk.gray(formatDuration(duration)),
        ];
        if (span.status.code === 'error' && span.status.message) {
            parts.push(chalk.red(`(${span.status.message})`));
        }
        const attrEntries = Object.entries(span.attributes);
        if (attrEntries.length > 0) {
            const attrStr = attrEntries
                .slice(0, 3)
                .map(([k, v]) => `${chalk.cyan(k)}=${chalk.yellow(String(v))}`)
                .join(' ');
            const overflow = attrEntries.length > 3 ? chalk.gray(` +${attrEntries.length - 3}`) : '';
            parts.push(attrStr + overflow);
        }
        try {
            console.log(parts.join(' '));
        }
        catch {
            // Silently fail if console is not available (e.g., during tests)
        }
    }
}
// -----------------------------------------------------------
// Default config factory
// -----------------------------------------------------------
export function defaultObservabilityConfig() {
    return {
        enabled: false,
        serviceName: 'neuro-cli',
        endpoint: 'http://localhost:4318/v1/traces',
        headers: {},
        exportInterval: 5000,
        maxBatchSize: 512,
        consoleExporter: true,
        sampleRate: 1.0,
    };
}
// -----------------------------------------------------------
// Singleton accessor (optional convenience)
// -----------------------------------------------------------
let globalInstance = null;
export function initObservability(config) {
    const full = { ...defaultObservabilityConfig(), ...config };
    globalInstance = new ObservabilityManager(full);
    globalInstance.start();
    return globalInstance;
}
export function getObservability() {
    return globalInstance;
}
export function resetObservability() {
    if (globalInstance) {
        globalInstance.stop().catch(() => { });
        globalInstance = null;
    }
}
//# sourceMappingURL=observability.js.map