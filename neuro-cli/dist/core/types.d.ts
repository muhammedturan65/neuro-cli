export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
    name?: string;
    timestamp?: number;
}
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export interface ToolResult {
    toolCallId: string;
    content: string;
    isError?: boolean;
}
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required: string[];
    };
}
export interface AgentConfig {
    name: string;
    description: string;
    systemPrompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: string[];
    autoApprove?: boolean;
    maxIterations?: number;
    /** Custom agent defined by user */
    isCustom?: boolean;
    /** Tags for categorizing agents */
    tags?: string[];
}
export interface ModelConfig {
    id: string;
    name: string;
    provider: string;
    contextWindow: number;
    maxOutput: number;
    inputPrice: number;
    outputPrice: number;
    supportsTools: boolean;
    supportsVision: boolean;
    supportsStreaming: boolean;
}
export interface NeuroConfig {
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
    agents: Record<string, AgentConfig>;
    tools: {
        autoApprove: string[];
        requireApproval: string[];
        denied: string[];
    };
    context: {
        maxTokens: number;
        systemPromptRatio: number;
    };
    session: {
        autoSave: boolean;
        maxHistory: number;
    };
    ui: {
        theme: 'dark' | 'light' | 'dracula' | 'nord';
        showTokenCount: boolean;
        showCost: boolean;
        streaming: boolean;
        syntaxHighlight: boolean;
    };
    permissionMode: PermissionMode;
    fallbackChain: FallbackModelChain;
    doomLoop: DoomLoopConfig;
    mcp: {
        servers: Record<string, MCPServerConfig>;
        autoConnect: boolean;
    };
    diffPreview: boolean;
    /** Sandbox configuration */
    sandbox: SandboxConfigType;
    /** Spending limit in USD (0 = unlimited) */
    spendingLimit: number;
    /** Prompt cache configuration */
    promptCache: PromptCacheConfig;
    /** Custom agents defined by the user */
    customAgents: Record<string, AgentConfig>;
    /** Telemetry configuration */
    telemetry: TelemetryConfigType;
    /** Vim mode configuration */
    vimMode: VimModeConfigType;
    /** i18n / language configuration */
    i18n: I18nConfigType;
    /** Multimodal / image support configuration */
    multimodal: MultimodalConfigType;
    /** Voice I/O configuration */
    voice: VoiceConfigType;
    /** API server configuration */
    apiServer: APIServerConfigType;
    /** Cloud sync configuration */
    cloudSync: CloudSyncConfigType;
    /** Web dashboard configuration */
    dashboard: DashboardConfigType;
}
export interface Session {
    id: string;
    createdAt: number;
    updatedAt: number;
    messages: Message[];
    workingDirectory: string;
    model: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    agentHistory: AgentExecution[];
    /** Session tags for categorization */
    tags: string[];
    /** Session description (auto-generated or user-set) */
    description?: string;
    /** Whether this is a fork of another session */
    forkedFrom?: string;
    /** Parent session ID */
    parentSessionId?: string;
}
export interface AgentExecution {
    agentName: string;
    task: string;
    startTime: number;
    endTime?: number;
    iterations: number;
    tokensUsed: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    result?: string;
}
export interface ApprovalRequest {
    toolName: string;
    args: Record<string, unknown>;
    risk: 'low' | 'medium' | 'high';
    description: string;
}
export interface FileChange {
    path: string;
    type: 'create' | 'modify' | 'delete';
    content?: string;
    diff?: string;
}
export interface SearchResult {
    file: string;
    line: number;
    column: number;
    text: string;
    match: string;
}
export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
}
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cost: number;
}
export type PermissionMode = 'manual' | 'auto' | 'plan' | 'yolo';
export interface FallbackModelChain {
    models: string[];
    maxRetries: number;
    retryDelayMs: number;
}
export interface DoomLoopConfig {
    maxConsecutiveErrors: number;
    maxRepetitiveActions: number;
    similarityThreshold: number;
    autoBreak: boolean;
}
export interface HeadlessOptions {
    prompt: string;
    model?: string;
    agent?: string;
    maxTurns?: number;
    allowedTools?: string[];
    outputFormat?: 'text' | 'json' | 'stream-json';
    autoApprove?: boolean;
    continueSession?: string;
}
export interface MCPServerConfig {
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    timeout?: number;
    disabled?: boolean;
    autoReconnect?: boolean;
    maxReconnectAttempts?: number;
    healthCheckIntervalMs?: number;
}
export interface SandboxConfigType {
    enabled: boolean;
    rootDir: string;
    allowedDirs: string[];
    deniedDirs: string[];
    deniedPatterns: string[];
    allowCommands: boolean;
    allowedCommands: string[];
    deniedCommands: string[];
    backupOnModify: boolean;
    backupDir: string;
    maxFileSize: number;
    allowNetwork: boolean;
    allowEnvAccess: boolean;
    readOnly: boolean;
}
export interface PromptCacheConfig {
    enabled: boolean;
    /** Cache directory */
    cacheDir: string;
    /** Maximum cache entries */
    maxEntries: number;
    /** TTL in milliseconds (default: 1 hour) */
    ttlMs: number;
    /** Similarity threshold for cache hits (0-1) */
    similarityThreshold: number;
}
export interface SessionExport {
    version: string;
    exportedAt: number;
    session: Session;
    neuroVersion: string;
}
export interface TelemetryConfigType {
    /** Whether telemetry is enabled (opt-in) */
    enabled: boolean;
    /** Whether to track model performance */
    trackModelPerformance: boolean;
    /** Whether to track tool usage */
    trackToolUsage: boolean;
    /** Whether to track session metrics */
    trackSessionMetrics: boolean;
    /** Retention period in days */
    retentionDays: number;
}
export interface VimModeConfigType {
    /** Whether vim keybindings are enabled */
    enabled: boolean;
    /** Show mode indicator in prompt */
    showModeIndicator: boolean;
    /** Bell on error in normal mode */
    bellOnError: boolean;
}
export interface I18nConfigType {
    /** Current locale code */
    locale: string;
    /** Fallback locale when key is missing */
    fallbackLocale: string;
    /** Auto-detect system language */
    autoDetect: boolean;
}
export interface MultimodalConfigType {
    /** Whether multimodal support is enabled */
    enabled: boolean;
    /** Max image file size in bytes */
    maxImageSize: number;
    /** Auto-detect image references in prompts */
    autoDetectImages: boolean;
}
export interface VoiceConfigType {
    /** Whether voice I/O is enabled */
    enabled: boolean;
    /** TTS engine */
    ttsEngine: 'system' | 'espeak' | 'say' | 'auto';
    /** STT engine */
    sttEngine: 'system' | 'whisper' | 'auto';
    /** Auto-speak assistant responses */
    autoSpeak: boolean;
    /** Language for TTS/STT */
    language: string;
}
export interface APIServerConfigType {
    /** Whether the API server is enabled */
    enabled: boolean;
    /** Host to bind to */
    host: string;
    /** Port to listen on */
    port: number;
    /** Whether authentication is required */
    requireAuth: boolean;
    /** Enable WebSocket support */
    enableWebSocket: boolean;
}
export interface CloudSyncConfigType {
    /** Whether cloud sync is enabled */
    enabled: boolean;
    /** Storage backend */
    backend: 'gist' | 'local';
    /** Auto-sync on session end */
    autoSync: boolean;
    /** Include session content in sync */
    includeContent: boolean;
}
export interface DashboardConfigType {
    /** Whether the web dashboard is enabled */
    enabled: boolean;
    /** Host to bind to */
    host: string;
    /** Port for dashboard server */
    port: number;
    /** Auto-open browser on start */
    autoOpen: boolean;
    /** Refresh interval for real-time updates (ms) */
    refreshInterval: number;
}
//# sourceMappingURL=types.d.ts.map