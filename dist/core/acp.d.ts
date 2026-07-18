export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number | string | null;
    method: string;
    params?: Record<string, unknown> | unknown[];
}
export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number | string | null;
    result?: unknown;
    error?: JsonRpcError;
}
export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}
export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}
export interface ACPConfig {
    /** Whether ACP server is enabled */
    enabled: boolean;
    /** Transport mode: 'stdio' | 'websocket' | 'http' | 'all' */
    transport: 'stdio' | 'websocket' | 'http' | 'all';
    /** Host for HTTP/WS transport */
    host: string;
    /** Port for HTTP/WS transport */
    port: number;
    /** Require authentication */
    requireAuth: boolean;
    /** API key (auto-generated if not set) */
    apiKey: string;
    /** Maximum request body size in bytes for HTTP transport */
    maxBodySize: number;
    /** Request timeout in ms */
    requestTimeout: number;
    /** Whether to log protocol messages */
    trace: boolean;
    /** Allowed origins for WebSocket (CORS) */
    corsOrigin: string;
}
export interface ACPServerCapabilities {
    /** Supported text document operations */
    textDocumentOperations: string[];
    /** Supported workspace operations */
    workspaceOperations: string[];
    /** Supported agent operations */
    agentOperations: string[];
    /** Whether streaming is supported */
    streaming: boolean;
    /** Whether tool call notifications are supported */
    toolNotifications: boolean;
    /** Whether file change notifications are supported */
    fileChangeNotifications: boolean;
    /** Maximum concurrent agent sessions */
    maxConcurrentSessions: number;
}
export interface ACPServerInfo {
    name: string;
    version: string;
    protocolVersion: string;
}
export interface ACPCClientCapabilities {
    /** Client supports streaming tokens */
    streaming?: boolean;
    /** Client supports tool call notifications */
    toolNotifications?: boolean;
    /** Client supports file change notifications */
    fileChangeNotifications?: boolean;
    /** Client name */
    clientName?: string;
    /** Client version */
    clientVersion?: string;
}
export interface ACPSession {
    /** Unique session ID */
    id: string;
    /** Client capabilities negotiated during initialize */
    clientCapabilities: ACPCClientCapabilities;
    /** Whether the session has been initialized */
    initialized: boolean;
    /** When the session was created */
    createdAt: number;
    /** Last activity timestamp */
    lastActivity: number;
    /** Transport type for this session */
    transport: 'stdio' | 'websocket' | 'http';
    /** Active agent operation ID (for cancel support) */
    activeOperationId: string | null;
    /** Abort controller for cancelling ongoing operations */
    abortController: AbortController | null;
}
export interface TextDocumentEditParams {
    /** File URI (file:///path/to/file) */
    uri: string;
    /** Edit operations to apply */
    edits: TextEdit[];
}
export interface TextEdit {
    /** Range to replace (line/column based) */
    range: {
        start: {
            line: number;
            character: number;
        };
        end: {
            line: number;
            character: number;
        };
    };
    /** New text to insert (replaces the range) */
    newText: string;
}
export interface TextDocumentReadParams {
    /** File URI */
    uri: string;
}
export interface WorkspaceSearchParams {
    /** Search query */
    query: string;
    /** File glob pattern to include */
    include?: string;
    /** File glob pattern to exclude */
    exclude?: string;
    /** Maximum results */
    maxResults?: number;
}
export interface AgentPromptParams {
    /** The prompt text */
    prompt: string;
    /** Execution mode */
    mode?: 'auto' | 'agent' | 'direct';
    /** Target agent name (for direct mode) */
    agent?: string;
    /** Whether to stream tokens */
    stream?: boolean;
    /** Model override */
    model?: string;
    /** Session ID to continue */
    sessionId?: string;
}
export interface AgentCancelParams {
    /** Operation ID to cancel */
    operationId: string;
}
export interface AgentStatusParams {
    /** Optional session ID to check */
    sessionId?: string;
}
export interface WorkspaceDiagnosticsParams {
    /** Optional file URI to get diagnostics for */
    uri?: string;
}
export interface GitStatusParams {
    /** Working directory (defaults to engine cwd) */
    workingDirectory?: string;
}
export interface AgentToolsParams {
    /** Optional filter by category */
    category?: string;
}
export interface StreamTokenParams {
    /** The token text */
    token: string;
    /** Operation ID this token belongs to */
    operationId: string;
    /** Whether this is the final token */
    done?: boolean;
}
export interface ToolCallParams {
    /** Tool name */
    toolName: string;
    /** Tool arguments */
    arguments: Record<string, unknown>;
    /** Operation ID */
    operationId: string;
    /** Tool call ID */
    toolCallId: string;
}
export interface ToolResultParams {
    /** Tool call ID */
    toolCallId: string;
    /** Result content */
    content: string;
    /** Whether the result is an error */
    isError?: boolean;
    /** Operation ID */
    operationId: string;
}
export interface FileChangedParams {
    /** File URI that was changed */
    uri: string;
    /** Type of change */
    changeType: 'created' | 'modified' | 'deleted';
    /** Optional diff content */
    diff?: string;
}
export interface AgentCompletedParams {
    /** Operation ID */
    operationId: string;
    /** Final response content */
    content: string;
    /** Token usage */
    usage?: {
        inputTokens: number;
        outputTokens: number;
        cost: number;
    };
    /** Whether the operation was cancelled */
    cancelled?: boolean;
}
export interface AgentErrorParams {
    /** Operation ID */
    operationId: string;
    /** Error message */
    message: string;
    /** Error code */
    code?: number;
}
export declare class ACPServer {
    private config;
    private engine;
    private sessions;
    private connections;
    private httpServer;
    private wsTransport;
    private stdioTransport;
    private isRunning;
    private startTime;
    private requestCount;
    private operationCounter;
    private readonly serverCapabilities;
    private readonly serverInfo;
    constructor(engine: any, config?: Partial<ACPConfig>);
    /**
     * Start the ACP server on configured transports
     */
    start(): Promise<void>;
    /**
     * Stop the ACP server gracefully
     */
    stop(): Promise<void>;
    /**
     * Check if server is running
     */
    getIsRunning(): boolean;
    /**
     * Get server configuration
     */
    getConfig(): ACPConfig;
    /**
     * Get server statistics
     */
    getStats(): {
        isRunning: boolean;
        uptime: number;
        requestCount: number;
        activeSessions: number;
        activeConnections: number;
        transport: string;
    };
    /**
     * Print server status to console
     */
    printStatus(): void;
    /**
     * Handle an incoming JSON-RPC request
     */
    handleRequest(request: JsonRpcRequest, sessionId?: string): Promise<JsonRpcResponse>;
    /**
     * Handle an incoming JSON-RPC notification
     */
    handleNotification(notification: JsonRpcNotification, sessionId?: string): void;
    /**
     * Parse a raw JSON-RPC message string and route appropriately
     */
    handleMessage(raw: string, sessionId?: string): Promise<JsonRpcResponse | null>;
    /**
     * Send a notification to all connected clients
     */
    notifyClients(method: string, params: Record<string, unknown>): void;
    /**
     * Send a notification to a specific client by session ID
     */
    notifyClient(sessionId: string, method: string, params: Record<string, unknown>): void;
    private routeMethod;
    private handleInitialize;
    private handleShutdown;
    private handleTextDocumentEdit;
    private handleTextDocumentRead;
    private handleWorkspaceSearch;
    private handleWorkspaceDiagnostics;
    private handleAgentPrompt;
    private handleAgentCancel;
    private handleAgentStatus;
    private handleAgentTools;
    private handleGitStatus;
    private startStdio;
    private startHttpServer;
    private handleHttpRequest;
    private parseHttpBody;
    private resolveHttpSession;
    private handleWsConnect;
    private handleWsDisconnect;
    private handleWsMessage;
    private createSessionId;
    private removeSession;
    private removeConnection;
    private findSessionByOperation;
    private cancelOperation;
    private detectTransportFromSession;
    private successResponse;
    private errorResponse;
    private uriToPath;
    private pathToUri;
    private languageIdFromPath;
    private saveConfig;
    private loadConfig;
    private log;
}
export declare function startACPServer(engine: any, config?: Partial<ACPConfig>): Promise<ACPServer>;
//# sourceMappingURL=acp.d.ts.map