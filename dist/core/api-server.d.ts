export interface APIServerConfig {
    /** Whether the API server is enabled */
    enabled: boolean;
    /** Host to bind to */
    host: string;
    /** Port to listen on */
    port: number;
    /** API key for authentication (auto-generated if not set) */
    apiKey: string;
    /** Whether authentication is required */
    requireAuth: boolean;
    /** CORS origin */
    corsOrigin: string;
    /** Maximum request body size in bytes */
    maxBodySize: number;
    /** Request timeout in ms */
    requestTimeout: number;
    /** Whether to enable WebSocket support */
    enableWebSocket: boolean;
    /** Rate limit: max requests per minute per IP */
    rateLimitPerMinute: number;
}
export interface APIRequest {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
    query: Record<string, string>;
    clientIp: string;
}
export interface APIResponse {
    status: number;
    headers: Record<string, string>;
    body: unknown;
}
export interface ChatRequest {
    message: string;
    model?: string;
    mode?: 'auto' | 'agent' | 'direct';
    agent?: string;
    sessionId?: string;
    stream?: boolean;
}
export interface ChatResponse {
    content: string;
    model: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        cost: number;
    };
    sessionId: string;
    timestamp: number;
}
export interface SessionInfo {
    id: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    model: string;
    totalCost: number;
}
export interface OpenAPISpec {
    openapi: string;
    info: {
        title: string;
        version: string;
        description: string;
    };
    servers: Array<{
        url: string;
    }>;
    paths: Record<string, unknown>;
    components: Record<string, unknown>;
}
export declare class APIServer {
    private config;
    private server;
    private routes;
    private rateLimiter;
    private isRunning;
    private requestCount;
    private startTime;
    private engineRef;
    constructor(config?: Partial<APIServerConfig>);
    /**
     * Set the engine reference for handling requests
     */
    setEngine(engine: unknown): void;
    /**
     * Start the API server
     */
    start(): Promise<void>;
    /**
     * Stop the API server
     */
    stop(): Promise<void>;
    /**
     * Check if server is running
     */
    getIsRunning(): boolean;
    /**
     * Get server URL
     */
    getUrl(): string;
    /**
     * Get API key
     */
    getApiKey(): string;
    /**
     * Regenerate API key
     */
    regenerateApiKey(): string;
    /**
     * Get server stats
     */
    getStats(): {
        uptime: number;
        requestCount: number;
        isRunning: boolean;
        url: string;
    };
    /**
     * Generate OpenAPI specification
     */
    getOpenAPISpec(): OpenAPISpec;
    /**
     * Get config
     */
    getConfig(): APIServerConfig;
    /**
     * Print server status
     */
    printStatus(): void;
    private handleRequest;
    private sendResponse;
    private parseBody;
    private registerRoutes;
    private addRoute;
    private saveConfig;
    private loadConfig;
}
//# sourceMappingURL=api-server.d.ts.map