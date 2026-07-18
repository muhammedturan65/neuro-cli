export interface ObservabilityConfig {
    enabled: boolean;
    serviceName: string;
    endpoint: string;
    headers: Record<string, string>;
    exportInterval: number;
    maxBatchSize: number;
    consoleExporter: boolean;
    sampleRate: number;
}
export interface SpanEvent {
    name: string;
    timestamp: number;
    attributes: Record<string, unknown>;
}
export interface Span {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: 'internal' | 'client' | 'server';
    startTime: number;
    endTime: number;
    attributes: Record<string, unknown>;
    events: SpanEvent[];
    status: {
        code: 'ok' | 'error';
        message?: string;
    };
}
export interface Metric {
    name: string;
    type: 'counter' | 'gauge' | 'histogram';
    value: number;
    attributes: Record<string, unknown>;
    timestamp: number;
}
export declare class ObservabilityManager {
    private config;
    private pendingSpans;
    private pendingMetrics;
    private spanBuffer;
    private sessionTraceId;
    private sessionRootSpanId;
    private exportTimer;
    private activeSpans;
    private histogramBuckets;
    private counters;
    private gauges;
    constructor(config: ObservabilityConfig);
    start(): void;
    stop(): Promise<void>;
    private shouldSample;
    startSpan(name: string, parent?: Span, attributes?: Record<string, unknown>): Span;
    endSpan(span: Span, status?: Span['status']): void;
    addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void;
    incrementCounter(name: string, value?: number, attributes?: Record<string, unknown>): void;
    recordGauge(name: string, value: number, attributes?: Record<string, unknown>): void;
    recordHistogram(name: string, value: number, attributes?: Record<string, unknown>): void;
    traceLLMRequest(model: string, promptTokens: number, completionTokens: number, duration: number, cost: number): Span;
    traceToolCall(tool: string, args: unknown, duration: number, success: boolean): Span;
    traceAgentAction(agent: string, action: string, duration: number): Span;
    flush(): Promise<void>;
    getPendingCount(): {
        spans: number;
        metrics: number;
    };
    startSession(sessionName?: string): Span;
    endSession(rootSpan: Span): void;
    getSessionTrace(): Span[];
    printTrace(): string;
    getConfig(): ObservabilityConfig;
    updateConfig(partial: Partial<ObservabilityConfig>): void;
    getSessionTraceId(): string;
    setSessionTraceId(traceId: string): void;
    getActiveSpanCount(): number;
    getCounterValue(name: string, attributes?: Record<string, unknown>): number;
    getGaugeValue(name: string, attributes?: Record<string, unknown>): number | undefined;
    getHistogramSummary(name: string, attributes?: Record<string, unknown>): {
        count: number;
        sum: number;
        min: number;
        max: number;
        avg: number;
    } | undefined;
    private createNoopSpan;
    private printSpanToConsole;
}
export declare function defaultObservabilityConfig(): ObservabilityConfig;
export declare function initObservability(config?: Partial<ObservabilityConfig>): ObservabilityManager;
export declare function getObservability(): ObservabilityManager | null;
export declare function resetObservability(): void;
//# sourceMappingURL=observability.d.ts.map