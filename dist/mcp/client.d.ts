import { ToolDefinition } from '../core/types.js';
export interface MCPServerConfig {
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    timeout?: number;
    disabled?: boolean;
    /** Auto-reconnect on disconnect (default: true) */
    autoReconnect?: boolean;
    /** Max reconnect attempts (default: 3) */
    maxReconnectAttempts?: number;
    /** Health check interval in ms (default: 60000 = 1 min) */
    healthCheckIntervalMs?: number;
}
export interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}
export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}
export interface MCPPrompt {
    name: string;
    description?: string;
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}
export interface MCPConnectionState {
    name: string;
    status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
    lastConnected?: number;
    lastError?: string;
    reconnectAttempts: number;
    toolCount: number;
    resourceCount: number;
    promptCount: number;
}
export declare class MCPClient {
    private processes;
    private nextId;
    private pendingRequests;
    private tools;
    private resources;
    private prompts;
    private servers;
    private inputBuffers;
    private configPath;
    private connectionStates;
    private healthCheckTimers;
    private reconnectTimers;
    private eventSource;
    private sseEventHandlers;
    constructor(configPath?: string);
    loadConfig(): MCPConfig;
    saveConfig(config: MCPConfig, global?: boolean): void;
    addServer(name: string, config: MCPServerConfig): void;
    removeServer(name: string): boolean;
    listServers(): Array<{
        name: string;
        config: MCPServerConfig;
        connected: boolean;
        toolCount: number;
        resourceCount: number;
    }>;
    getConnectionStates(): MCPConnectionState[];
    getConnectionState(name: string): MCPConnectionState | undefined;
    private setConnectionState;
    private startHealthCheck;
    private stopHealthCheck;
    private attemptReconnect;
    connectAll(): Promise<number>;
    connect(name: string, config: MCPServerConfig): Promise<void>;
    private connectStdio;
    private connectSSE;
    private handleSSEEvent;
    /**
     * Register a custom SSE event handler
     */
    onSSEEvent(serverName: string, handler: (event: string, data: string) => void): void;
    disconnect(name: string): Promise<void>;
    disconnectAll(): Promise<void>;
    private initialize;
    callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
    private callToolHTTP;
    readResource(serverName: string, uri: string): Promise<unknown>;
    getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<unknown>;
    private sendRequest;
    private sendRequestSSE;
    private sendNotification;
    private handleResponse;
    getAllTools(): Array<{
        serverName: string;
        tool: MCPTool;
    }>;
    getToolDefinitions(): ToolDefinition[];
    getAllResources(): Array<{
        serverName: string;
        resource: MCPResource;
    }>;
    getAllPrompts(): Array<{
        serverName: string;
        prompt: MCPPrompt;
    }>;
    parseMCPToolName(fullName: string): {
        serverName: string;
        toolName: string;
    } | null;
    isConnected(name: string): boolean;
    getServerNames(): string[];
    /**
     * Print a health report of all MCP connections
     */
    healthReport(): void;
}
//# sourceMappingURL=client.d.ts.map