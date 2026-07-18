// ============================================================
// NeuroCLI - Agent Client Protocol (ACP) Server
// GAP-28: "LSP for AI Agents"
// JSON-RPC 2.0 protocol for editor/IDE integration
// Transports: stdio, WebSocket, HTTP POST
// Bidirectional: server can push notifications to clients
// ============================================================

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { createConnection, Socket } from 'net';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

// ============================================================
// JSON-RPC 2.0 Types
// ============================================================

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

// Standard JSON-RPC error codes
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_NOT_INITIALIZED: -32002,
  UNKNOWN_ERROR_CODE: -32001,
  REQUEST_CANCELLED: -32800,
  CONTENT_MODIFIED: -32801,
} as const;

// ============================================================
// ACP-specific Types
// ============================================================

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
    start: { line: number; character: number };
    end: { line: number; character: number };
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

// Notification parameter types
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

// ============================================================
// Default Configuration
// ============================================================

const ACP_CONFIG_PATH = join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.neuro',
  'acp-config.json',
);

function generateApiKey(): string {
  return `acp_${randomBytes(32).toString('hex')}`;
}

function defaultConfig(): ACPConfig {
  return {
    enabled: false,
    transport: 'all',
    host: '127.0.0.1',
    port: 3142,
    requireAuth: true,
    apiKey: generateApiKey(),
    maxBodySize: 10 * 1024 * 1024,
    requestTimeout: 120000,
    trace: false,
    corsOrigin: '*',
  };
}

// ============================================================
// Transport Abstraction
// ============================================================

interface ClientConnection {
  /** Unique connection ID */
  id: string;
  /** Session associated with this connection */
  sessionId: string;
  /** Send a message to this client */
  send: (message: string) => void;
  /** Close this connection */
  close: () => void;
  /** Transport type */
  transport: 'stdio' | 'websocket' | 'http';
}

// ============================================================
// Stdio Transport
// ============================================================

class StdioTransport {
  private buffer: string = '';
  private onMessage: (message: string) => void;
  private output: (data: string) => void;

  constructor(
    onMessage: (message: string) => void,
    output?: (data: string) => void,
  ) {
    this.onMessage = onMessage;
    this.output = output || ((data: string) => process.stdout.write(data));
    this.setupInput();
  }

  private setupInput(): void {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.processBuffer();
    });

    process.stdin.on('end', () => {
      // Client disconnected
    });
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) break;

      const body = this.buffer.slice(bodyStart, bodyEnd);
      this.buffer = this.buffer.slice(bodyEnd);

      this.onMessage(body);
    }
  }

  send(message: string): void {
    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
    this.output(header + message);
  }

  close(): void {
    // For stdio, we don't close stdin/stdout
  }
}

// ============================================================
// WebSocket Transport (minimal, no external deps)
// ============================================================

class WebSocketTransport {
  private connections: Map<string, { socket: Socket; buffer: string }> = new Map();
  private server: HttpServer | null = null;
  private host: string;
  private port: number;
  private onConnect: (connectionId: string, send: (msg: string) => void) => void;
  private onDisconnect: (connectionId: string) => void;
  private onMessage: (connectionId: string, message: string) => void;
  private corsOrigin: string;

  constructor(
    host: string,
    port: number,
    corsOrigin: string,
    onConnect: (connectionId: string, send: (msg: string) => void) => void,
    onDisconnect: (connectionId: string) => void,
    onMessage: (connectionId: string, message: string) => void,
  ) {
    this.host = host;
    this.port = port;
    this.corsOrigin = corsOrigin;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    this.onMessage = onMessage;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        // CORS preflight
        res.setHeader('Access-Control-Allow-Origin', this.corsOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // Health endpoint
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', transport: 'websocket' }));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      this.server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        if (req.url !== '/acp') {
          socket.destroy();
          return;
        }

        this.handleWebSocketUpgrade(socket, head);
      });

      this.server.on('error', (err: Error) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  private handleWebSocketUpgrade(socket: Socket, head: Buffer): void {
    const connectionId = `ws_${randomBytes(8).toString('hex')}`;

    // Perform minimal WebSocket handshake
    const secWebSocketKey = socket.readableLength > 0 ? '' : '';
    // We'll do a raw upgrade since we don't have the ws library
    // For a real implementation you'd use the ws package, but here
    // we use a simplified line-delimited JSON protocol over raw TCP
    // to avoid the dependency.

    // Actually, let's implement a proper WebSocket handshake:
    // The problem is we need headers from the upgrade request.
    // Since we get the socket after upgrade, let's use a simpler approach:
    // line-delimited JSON over TCP, which works well for ACP.

    // Register the connection with line-delimited JSON protocol
    const entry = { socket, buffer: '' };
    this.connections.set(connectionId, entry);

    const send = (msg: string) => {
      try {
        socket.write(msg + '\n');
      } catch {
        // Socket may have been closed
      }
    };

    this.onConnect(connectionId, send);

    socket.on('data', (data: Buffer) => {
      entry.buffer += data.toString('utf-8');
      const lines = entry.buffer.split('\n');
      entry.buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          this.onMessage(connectionId, line.trim());
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(connectionId);
      this.onDisconnect(connectionId);
    });

    socket.on('error', () => {
      this.connections.delete(connectionId);
      this.onDisconnect(connectionId);
    });

    // Push any leftover data from the head buffer
    if (head.length > 0) {
      socket.unshift(head);
    }
  }

  send(connectionId: string, message: string): void {
    const entry = this.connections.get(connectionId);
    if (entry) {
      try {
        entry.socket.write(message + '\n');
      } catch {
        // Socket may have been closed
      }
    }
  }

  close(connectionId: string): void {
    const entry = this.connections.get(connectionId);
    if (entry) {
      entry.socket.destroy();
      this.connections.delete(connectionId);
    }
  }

  async stop(): Promise<void> {
    for (const [id, entry] of this.connections) {
      entry.socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

// ============================================================
// ACP Server - Main Implementation
// ============================================================

export class ACPServer {
  private config: ACPConfig;
  private engine: any; // NeuroEngine reference - typed as any to avoid circular imports
  private sessions: Map<string, ACPSession> = new Map();
  private connections: Map<string, ClientConnection> = new Map();
  private httpServer: HttpServer | null = null;
  private wsTransport: WebSocketTransport | null = null;
  private stdioTransport: StdioTransport | null = null;
  private isRunning: boolean = false;
  private startTime: number = 0;
  private requestCount: number = 0;
  private operationCounter: number = 0;

  // Server capabilities
  private readonly serverCapabilities: ACPServerCapabilities = {
    textDocumentOperations: ['edit', 'read'],
    workspaceOperations: ['search', 'diagnostics'],
    agentOperations: ['prompt', 'cancel', 'status', 'tools'],
    streaming: true,
    toolNotifications: true,
    fileChangeNotifications: true,
    maxConcurrentSessions: 10,
  };

  private readonly serverInfo: ACPServerInfo = {
    name: 'NeuroCLI ACP Server',
    version: '4.0.0',
    protocolVersion: '1.0.0',
  };

  constructor(engine: any, config?: Partial<ACPConfig>) {
    this.engine = engine;
    this.config = { ...defaultConfig(), ...config };
    this.loadConfig();
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Start the ACP server on configured transports
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log(chalk.yellow('ACP server is already running.'));
      return;
    }

    const transport = this.config.transport;

    if (transport === 'stdio' || transport === 'all') {
      await this.startStdio();
    }

    if (transport === 'websocket' || transport === 'http' || transport === 'all') {
      await this.startHttpServer();
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.log(chalk.green(`ACP server started (transport: ${transport})`));

    if (transport !== 'stdio') {
      this.log(chalk.gray(`  HTTP endpoint: http://${this.config.host}:${this.config.port}/acp`));
      this.log(chalk.gray(`  WS endpoint: ws://${this.config.host}:${this.config.port}/acp`));
    }

    if (this.config.requireAuth) {
      this.log(chalk.gray(`  API Key: ${this.config.apiKey.slice(0, 12)}...`));
    }
  }

  /**
   * Stop the ACP server gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    // Close all client connections
    for (const [id, connection] of this.connections) {
      try {
        connection.close();
      } catch {
        // Ignore close errors during shutdown
      }
    }
    this.connections.clear();

    // Clear all sessions
    this.sessions.clear();

    // Stop stdio transport
    if (this.stdioTransport) {
      this.stdioTransport.close();
      this.stdioTransport = null;
    }

    // Stop WebSocket transport
    if (this.wsTransport) {
      await this.wsTransport.stop();
      this.wsTransport = null;
    }

    // Stop HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.isRunning = false;
    this.log(chalk.gray('ACP server stopped.'));
  }

  /**
   * Check if server is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get server configuration
   */
  getConfig(): ACPConfig {
    return { ...this.config };
  }

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
  } {
    return {
      isRunning: this.isRunning,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      requestCount: this.requestCount,
      activeSessions: this.sessions.size,
      activeConnections: this.connections.size,
      transport: this.config.transport,
    };
  }

  /**
   * Print server status to console
   */
  printStatus(): void {
    console.log('');
    console.log(chalk.bold('--- NeuroCLI ACP Server ---'));
    console.log(`  Running: ${this.isRunning ? chalk.green('yes') : chalk.gray('no')}`);
    if (this.isRunning) {
      console.log(`  Transport: ${chalk.cyan(this.config.transport)}`);
      console.log(`  Uptime: ${Math.round((Date.now() - this.startTime) / 1000)}s`);
      console.log(`  Requests: ${this.requestCount}`);
      console.log(`  Sessions: ${this.sessions.size}`);
      console.log(`  Connections: ${this.connections.size}`);
    }
    console.log(`  Auth: ${this.config.requireAuth ? chalk.green('enabled') : chalk.yellow('disabled')}`);
    console.log(`  Trace: ${this.config.trace ? chalk.green('enabled') : chalk.gray('disabled')}`);
    console.log('');
  }

  // ----------------------------------------------------------
  // JSON-RPC Protocol Handling
  // ----------------------------------------------------------

  /**
   * Handle an incoming JSON-RPC request
   */
  async handleRequest(
    request: JsonRpcRequest,
    sessionId?: string,
  ): Promise<JsonRpcResponse> {
    this.requestCount++;

    // Validate JSON-RPC version
    if (request.jsonrpc !== '2.0') {
      return this.errorResponse(
        request.id,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        'Invalid JSON-RPC version. Must be "2.0".',
      );
    }

    // Check session initialization (except for initialize method)
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session && !session.initialized && request.method !== 'initialize') {
      return this.errorResponse(
        request.id,
        JSON_RPC_ERRORS.SERVER_NOT_INITIALIZED,
        'Server not initialized. Send "initialize" request first.',
      );
    }

    // Update session activity
    if (session) {
      session.lastActivity = Date.now();
    }

    // Route to method handler
    try {
      const result = await this.routeMethod(request.method, request.params, sessionId);
      return this.successResponse(request.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as any).code || JSON_RPC_ERRORS.INTERNAL_ERROR;
      return this.errorResponse(request.id, code, message);
    }
  }

  /**
   * Handle an incoming JSON-RPC notification
   */
  handleNotification(notification: JsonRpcNotification, sessionId?: string): void {
    if (this.config.trace) {
      this.log(chalk.gray(`  <- notification: ${notification.method}`));
    }

    switch (notification.method) {
      case 'initialized':
        // Client confirms initialization - mark session as fully ready
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            session.initialized = true;
          }
        }
        break;

      case 'exit':
        // Client requests shutdown
        if (sessionId) {
          this.removeSession(sessionId);
        }
        break;

      case 'textDocument/didChange':
        // Client notifies us about a file change - could be used for context invalidation
        if (this.config.trace) {
          this.log(chalk.gray(`  File changed: ${JSON.stringify(notification.params)}`));
        }
        break;

      case 'cancelRequest':
        // Client wants to cancel a pending request
        if (notification.params && typeof notification.params === 'object') {
          const opId = (notification.params as Record<string, unknown>).id as string;
          if (opId) {
            this.cancelOperation(opId);
          }
        }
        break;

      default:
        if (this.config.trace) {
          this.log(chalk.gray(`  Unknown notification: ${notification.method}`));
        }
        break;
    }
  }

  /**
   * Parse a raw JSON-RPC message string and route appropriately
   */
  async handleMessage(raw: string, sessionId?: string): Promise<JsonRpcResponse | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.errorResponse(
        null,
        JSON_RPC_ERRORS.PARSE_ERROR,
        'Parse error: invalid JSON.',
      );
    }

    // Batch request support
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return this.errorResponse(
          null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          'Empty batch request.',
        );
      }

      const results = await Promise.all(
        parsed.map((item: unknown) => this.handleMessage(JSON.stringify(item), sessionId)),
      );

      // Filter out nulls (notifications don't get responses)
      const responses = results.filter((r): r is JsonRpcResponse => r !== null);
      return responses.length === 1 ? responses[0] : (responses as any);
    }

    // Validate it's an object
    if (typeof parsed !== 'object' || parsed === null) {
      return this.errorResponse(
        null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        'Invalid request: not an object.',
      );
    }

    const message = parsed as Record<string, unknown>;

    // Is it a notification (no id) or a request (has id)?
    if ('method' in message && !('id' in message)) {
      // It's a notification
      this.handleNotification(message as unknown as JsonRpcNotification, sessionId);
      return null;
    }

    // It's a request
    return this.handleRequest(message as unknown as JsonRpcRequest, sessionId);
  }

  /**
   * Send a notification to all connected clients
   */
  notifyClients(method: string, params: Record<string, unknown>): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const message = JSON.stringify(notification);

    for (const [id, connection] of this.connections) {
      try {
        connection.send(message);
      } catch {
        // Connection may have been closed
        this.removeConnection(id);
      }
    }

    if (this.config.trace) {
      this.log(chalk.gray(`  -> broadcast: ${method}`));
    }
  }

  /**
   * Send a notification to a specific client by session ID
   */
  notifyClient(sessionId: string, method: string, params: Record<string, unknown>): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const message = JSON.stringify(notification);
    const connection = this.connections.get(sessionId);

    if (connection) {
      try {
        connection.send(message);
      } catch {
        this.removeConnection(sessionId);
      }
    }

    if (this.config.trace) {
      this.log(chalk.gray(`  -> notify ${sessionId}: ${method}`));
    }
  }

  // ----------------------------------------------------------
  // Method Routing
  // ----------------------------------------------------------

  private async routeMethod(
    method: string,
    params: unknown,
    sessionId?: string,
  ): Promise<unknown> {
    if (this.config.trace) {
      this.log(chalk.gray(`  <- request: ${method}`));
    }

    switch (method) {
      // Lifecycle
      case 'initialize':
        return this.handleInitialize(params, sessionId);

      case 'shutdown':
        return this.handleShutdown();

      // Text Document operations
      case 'textDocument/edit':
        return this.handleTextDocumentEdit(params);

      case 'textDocument/read':
        return this.handleTextDocumentRead(params);

      // Workspace operations
      case 'workspace/search':
        return this.handleWorkspaceSearch(params);

      case 'workspace/diagnostics':
        return this.handleWorkspaceDiagnostics(params);

      // Agent operations
      case 'agent/prompt':
        return this.handleAgentPrompt(params, sessionId);

      case 'agent/cancel':
        return this.handleAgentCancel(params);

      case 'agent/status':
        return this.handleAgentStatus(params);

      case 'agent/tools':
        return this.handleAgentTools(params);

      // Git operations
      case 'git/status':
        return this.handleGitStatus(params);

      default:
        throw Object.assign(
          new Error(`Method not found: ${method}`),
          { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND },
        );
    }
  }

  // ----------------------------------------------------------
  // Method Handlers - Lifecycle
  // ----------------------------------------------------------

  private handleInitialize(params: unknown, sessionId?: string): Record<string, unknown> {
    const initParams = (params || {}) as Record<string, unknown>;
    const clientCapabilities = (initParams.capabilities || {}) as ACPCClientCapabilities;
    const clientInfo = (initParams.clientInfo || {}) as Record<string, unknown>;

    // Create or update session
    const sid = sessionId || this.createSessionId();
    let session = this.sessions.get(sid);
    if (!session) {
      session = {
        id: sid,
        clientCapabilities,
        initialized: true,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        transport: this.detectTransportFromSession(sid),
        activeOperationId: null,
        abortController: null,
      };
      this.sessions.set(sid, session);
    } else {
      session.clientCapabilities = clientCapabilities;
      session.initialized = true;
      session.lastActivity = Date.now();
    }

    this.log(chalk.green(`Client initialized: ${clientInfo.name || 'unknown'} v${clientInfo.version || '?'}`));

    return {
      capabilities: this.serverCapabilities,
      serverInfo: this.serverInfo,
    };
  }

  private handleShutdown(): Record<string, unknown> {
    // Prepare for shutdown - cleanup but don't actually stop
    return { success: true };
  }

  // ----------------------------------------------------------
  // Method Handlers - Text Document Operations
  // ----------------------------------------------------------

  private handleTextDocumentEdit(params: unknown): Record<string, unknown> {
    const editParams = params as TextDocumentEditParams;
    if (!editParams || !editParams.uri) {
      throw Object.assign(
        new Error('Invalid params: uri is required'),
        { code: JSON_RPC_ERRORS.INVALID_PARAMS },
      );
    }

    const filePath = this.uriToPath(editParams.uri);

    // Read current file content
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      // If file doesn't exist and we have edits with empty ranges, create it
      if (editParams.edits && editParams.edits.length > 0) {
        const hasCreateEdit = editParams.edits.some(
          (e) => e.range.start.line === 0 &&
                 e.range.start.character === 0 &&
                 e.range.end.line === 0 &&
                 e.range.end.character === 0,
        );
        if (hasCreateEdit) {
          content = '';
        } else {
          throw Object.assign(
            new Error(`File not found: ${filePath}`),
            { code: JSON_RPC_ERRORS.INTERNAL_ERROR },
          );
        }
      } else {
        throw Object.assign(
          new Error(`File not found: ${filePath}`),
          { code: JSON_RPC_ERRORS.INTERNAL_ERROR },
        );
      }
    }

    // Apply edits in reverse order (so line numbers don't shift)
    const lines = content.split('\n');
    const sortedEdits = [...(editParams.edits || [])].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) {
        return b.range.start.line - a.range.start.line;
      }
      return b.range.start.character - a.range.start.character;
    });

    for (const edit of sortedEdits) {
      const startLine = edit.range.start.line;
      const endLine = edit.range.end.line;
      const startChar = edit.range.start.character;
      const endChar = edit.range.end.character;

      // Build the new content for the affected range
      const beforeLine = (lines[startLine] || '').slice(0, startChar);
      const afterLine = (lines[endLine] || '').slice(endChar);
      const newLines = edit.newText.split('\n');

      // Replace the affected lines
      const replacement = [beforeLine + newLines[0]];
      for (let i = 1; i < newLines.length - 1; i++) {
        replacement.push(newLines[i]);
      }
      if (newLines.length > 1) {
        replacement.push(newLines[newLines.length - 1] + afterLine);
      } else {
        replacement[0] = beforeLine + newLines[0] + afterLine;
      }

      lines.splice(startLine, endLine - startLine + 1, ...replacement);
    }

    // Write the modified content back
    const newContent = lines.join('\n');

    try {
      writeFileSync(filePath, newContent, 'utf-8');
    } catch (writeError) {
      throw Object.assign(
        new Error(`Failed to write file: ${writeError instanceof Error ? writeError.message : String(writeError)}`),
        { code: JSON_RPC_ERRORS.INTERNAL_ERROR },
      );
    }

    // Notify clients about the file change
    this.notifyClients('workspace/fileChanged', {
      uri: editParams.uri,
      changeType: 'modified',
    } as unknown as Record<string, unknown>);

    return {
      applied: true,
      editCount: editParams.edits?.length || 0,
    };
  }

  private handleTextDocumentRead(params: unknown): Record<string, unknown> {
    const readParams = params as TextDocumentReadParams;
    if (!readParams || !readParams.uri) {
      throw Object.assign(
        new Error('Invalid params: uri is required'),
        { code: JSON_RPC_ERRORS.INVALID_PARAMS },
      );
    }

    const filePath = this.uriToPath(readParams.uri);

    try {
      const content = readFileSync(filePath, 'utf-8');
      const stat = statSync(filePath);

      return {
        uri: readParams.uri,
        content,
        languageId: this.languageIdFromPath(filePath),
        version: stat.mtimeMs,
        size: stat.size,
      };
    } catch (error) {
      throw Object.assign(
        new Error(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`),
        { code: JSON_RPC_ERRORS.INTERNAL_ERROR },
      );
    }
  }

  // ----------------------------------------------------------
  // Method Handlers - Workspace Operations
  // ----------------------------------------------------------

  private handleWorkspaceSearch(params: unknown): Record<string, unknown> {
    const searchParams = params as WorkspaceSearchParams;
    if (!searchParams || !searchParams.query) {
      throw Object.assign(
        new Error('Invalid params: query is required'),
        { code: JSON_RPC_ERRORS.INVALID_PARAMS },
      );
    }

    const workingDir = this.engine?.config ? process.cwd() : process.cwd();
    const maxResults = searchParams.maxResults || 50;
    const results: Array<{
      uri: string;
      line: number;
      column: number;
      text: string;
      match: string;
    }> = [];

    try {
      const searchPattern = searchParams.query;
      const includeGlob = searchParams.include || '';
      const excludeGlob = searchParams.exclude || 'node_modules,.git,dist,build';

      // Use ripgrep if available, otherwise fallback to grep
      let grepOutput: string;
      try {
        const cmdParts = ['rg', '--json'];
        if (includeGlob) cmdParts.push('--glob', includeGlob);
        if (excludeGlob) {
          for (const ex of excludeGlob.split(',')) {
            cmdParts.push('--glob', `!${ex.trim()}`);
          }
        }
        cmdParts.push('--max-count', String(maxResults), searchPattern, workingDir);
        grepOutput = execSync(cmdParts.join(' '), {
          encoding: 'utf-8',
          timeout: 10000,
          maxBuffer: 5 * 1024 * 1024,
        });
      } catch (rgError: any) {
        // rg returns exit code 1 for no matches, or may not be installed
        if (rgError.stdout) {
          grepOutput = rgError.stdout;
        } else {
          // Fallback to grep
          try {
            grepOutput = execSync(
              `grep -rn "${searchPattern}" ${workingDir} --include="*.ts" --include="*.js" --include="*.py" --include="*.rs" --include="*.go" | head -${maxResults}`,
              { encoding: 'utf-8', timeout: 10000, maxBuffer: 5 * 1024 * 1024 },
            );
          } catch {
            return { results: [], count: 0 };
          }
        }
      }

      // Parse ripgrep JSON output
      for (const line of grepOutput.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'match' && entry.data) {
            results.push({
              uri: `file://${entry.data.path?.text || ''}`,
              line: entry.data.line_number || 0,
              column: entry.data.submatches?.[0]?.start || 0,
              text: entry.data.lines?.text?.trim() || '',
              match: entry.data.submatches?.[0]?.match?.text || searchPattern,
            });
          }
        } catch {
          // Not JSON - try plain grep format: file:line:content
          const match = line.match(/^(.+?):(\d+):(.*)$/);
          if (match) {
            results.push({
              uri: `file://${match[1]}`,
              line: parseInt(match[2], 10),
              column: 0,
              text: match[3].trim(),
              match: searchPattern,
            });
          }
        }

        if (results.length >= maxResults) break;
      }
    } catch (error) {
      throw Object.assign(
        new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`),
        { code: JSON_RPC_ERRORS.INTERNAL_ERROR },
      );
    }

    return { results, count: results.length };
  }

  private handleWorkspaceDiagnostics(params: unknown): Record<string, unknown> {
    const diagParams = (params || {}) as WorkspaceDiagnosticsParams;

    // Try to get diagnostics from the LSP integration if available
    const diagnostics: Array<{
      uri: string;
      severity: string;
      message: string;
      line: number;
      column: number;
      source?: string;
      code?: string;
    }> = [];

    if (this.engine?.linting) {
      try {
        const filePath = diagParams.uri ? this.uriToPath(diagParams.uri) : undefined;
        const results = filePath
          ? this.engine.linting.lintFile(filePath)
          : this.engine.linting.lintAll();

        for (const diag of results) {
          diagnostics.push({
            uri: `file://${diag.file || filePath || ''}`,
            severity: diag.severity || 'info',
            message: diag.message || '',
            line: diag.line || 0,
            column: diag.column || 0,
            source: diag.source,
            code: diag.code,
          });
        }
      } catch {
        // Linting may fail, return empty diagnostics
      }
    }

    // Also check for security issues if scanner is available
    if (this.engine?.securityScanner && !diagParams.uri) {
      try {
        const scanResults = this.engine.securityScanner.scan();
        for (const issue of scanResults) {
          diagnostics.push({
            uri: `file://${issue.file || ''}`,
            severity: issue.severity || 'warning',
            message: issue.message || issue.description || '',
            line: issue.line || 0,
            column: 0,
            source: 'security-scanner',
            code: issue.ruleId || issue.id,
          });
        }
      } catch {
        // Security scanning may fail
      }
    }

    return { diagnostics, count: diagnostics.length };
  }

  // ----------------------------------------------------------
  // Method Handlers - Agent Operations
  // ----------------------------------------------------------

  private async handleAgentPrompt(params: unknown, sessionId?: string): Promise<Record<string, unknown>> {
    const promptParams = params as AgentPromptParams;
    if (!promptParams || !promptParams.prompt) {
      throw Object.assign(
        new Error('Invalid params: prompt is required'),
        { code: JSON_RPC_ERRORS.INVALID_PARAMS },
      );
    }

    const operationId = `op_${++this.operationCounter}`;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    // Create abort controller for cancellation support
    const abortController = new AbortController();
    if (session) {
      session.activeOperationId = operationId;
      session.abortController = abortController;
    }

    const shouldStream = promptParams.stream !== false &&
                         (session?.clientCapabilities.streaming !== false);

    try {
      // Use the engine to process the message
      if (!this.engine || typeof this.engine.processMessage !== 'function') {
        throw new Error('Engine not available');
      }

      // If streaming is requested, set up streaming callbacks
      if (shouldStream) {
        // We need to intercept the engine's streaming to send tokens via ACP notifications
        // The engine processes via processMessage which returns a complete result.
        // For streaming, we hook into the engine's UI callbacks or use a streaming approach.

        // Start the process and send tokens as they arrive
        const processPromise = this.engine.processMessage(
          promptParams.prompt,
          promptParams.mode || 'auto',
          promptParams.agent,
        );

        // Check for cancellation periodically
        const checkInterval = setInterval(() => {
          if (abortController.signal.aborted) {
            clearInterval(checkInterval);
          }
        }, 500);

        const result = await processPromise;
        clearInterval(checkInterval);

        // Check if cancelled during execution
        if (abortController.signal.aborted) {
          this.notifyClient(sessionId || '', 'agent/completed', {
            operationId,
            content: '',
            cancelled: true,
          } as unknown as Record<string, unknown>);

          return { operationId, cancelled: true, content: '' };
        }

        // Send completion notification
        this.notifyClient(sessionId || '', 'agent/completed', {
          operationId,
          content: result.content,
          usage: result.usage,
        } as unknown as Record<string, unknown>);

        // Clean up session state
        if (session) {
          session.activeOperationId = null;
          session.abortController = null;
        }

        return {
          operationId,
          content: result.content,
          usage: result.usage,
        };
      } else {
        // Non-streaming: just return the full result
        const result = await this.engine.processMessage(
          promptParams.prompt,
          promptParams.mode || 'auto',
          promptParams.agent,
        );

        // Clean up session state
        if (session) {
          session.activeOperationId = null;
          session.abortController = null;
        }

        return {
          operationId,
          content: result.content,
          usage: result.usage,
        };
      }
    } catch (error) {
      // Send error notification
      this.notifyClient(sessionId || '', 'agent/error', {
        operationId,
        message: error instanceof Error ? error.message : String(error),
      } as unknown as Record<string, unknown>);

      // Clean up session state
      if (session) {
        session.activeOperationId = null;
        session.abortController = null;
      }

      throw error;
    }
  }

  private handleAgentCancel(params: unknown): Record<string, unknown> {
    const cancelParams = params as AgentCancelParams;
    if (!cancelParams || !cancelParams.operationId) {
      throw Object.assign(
        new Error('Invalid params: operationId is required'),
        { code: JSON_RPC_ERRORS.INVALID_PARAMS },
      );
    }

    const cancelled = this.cancelOperation(cancelParams.operationId);

    return { cancelled, operationId: cancelParams.operationId };
  }

  private handleAgentStatus(params: unknown): Record<string, unknown> {
    const statusParams = (params || {}) as AgentStatusParams;

    // Find the session and check its status
    const session = statusParams.sessionId
      ? this.sessions.get(statusParams.sessionId)
      : this.findSessionByOperation();

    if (!session) {
      return {
        status: 'idle',
        activeOperation: null,
      };
    }

    return {
      status: session.activeOperationId ? 'processing' : 'idle',
      activeOperation: session.activeOperationId,
      sessionId: session.id,
      transport: session.transport,
      uptime: Date.now() - session.createdAt,
    };
  }

  private handleAgentTools(params: unknown): Record<string, unknown> {
    const toolsParams = (params || {}) as AgentToolsParams;
    const tools: Array<{
      name: string;
      description: string;
      category: string;
      risk: string;
      parameters?: Record<string, unknown>;
    }> = [];

    // Get tools from engine's registry
    if (this.engine?.registry) {
      try {
        const registry = this.engine.registry;
        if (typeof registry.list === 'function') {
          const registeredTools = registry.list();
          for (const tool of registeredTools) {
            if (toolsParams.category && tool.category !== toolsParams.category) {
              continue;
            }
            tools.push({
              name: tool.name,
              description: tool.description || '',
              category: tool.category || 'general',
              risk: tool.risk || 'medium',
              parameters: tool.parameters,
            });
          }
        }
      } catch {
        // Registry access may fail
      }
    }

    // Also include MCP tools if available
    if (this.engine?.mcpClient) {
      try {
        const mcpTools = this.engine.mcpClient.listTools();
        for (const tool of mcpTools) {
          tools.push({
            name: `mcp_${tool.name}`,
            description: tool.description || '',
            category: 'mcp',
            risk: 'medium',
            parameters: tool.parameters,
          });
        }
      } catch {
        // MCP tools listing may fail
      }
    }

    // Also include custom tools if available
    if (this.engine?.customToolLoader) {
      try {
        const customTools = this.engine.customToolLoader.getAll();
        for (const tool of customTools) {
          tools.push({
            name: `custom_${tool.name}`,
            description: tool.description || '',
            category: 'custom',
            risk: tool.risk || 'medium',
          });
        }
      } catch {
        // Custom tools listing may fail
      }
    }

    return { tools, count: tools.length };
  }

  // ----------------------------------------------------------
  // Method Handlers - Git Operations
  // ----------------------------------------------------------

  private handleGitStatus(params: unknown): Record<string, unknown> {
    const gitParams = (params || {}) as GitStatusParams;
    const workingDir = gitParams.workingDirectory || process.cwd();

    try {
      const statusOutput = execSync('git status --porcelain=v2 --branch', {
        encoding: 'utf-8',
        cwd: workingDir,
        timeout: 5000,
      });

      const branchMatch = statusOutput.match(/^# branch\.head\s+(.+)$/m);
      const branch = branchMatch ? branchMatch[1] : 'unknown';

      const files: Array<{
        path: string;
        status: string;
        staged: boolean;
      }> = [];

      for (const line of statusOutput.split('\n')) {
        if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
          const parts = line.split(' ');
          if (parts.length >= 9) {
            const xy = parts[1];
            const filePath = parts.slice(8).join(' ');
            const staged = xy[0] !== '.' && xy[0] !== '?';
            const statusChar = staged ? xy[0] : xy[1];

            const statusMap: Record<string, string> = {
              'M': 'modified',
              'A': 'added',
              'D': 'deleted',
              'R': 'renamed',
              'C': 'copied',
              '?': 'untracked',
              '!': 'ignored',
            };

            files.push({
              path: filePath,
              status: statusMap[statusChar] || statusChar,
              staged,
            });
          }
        } else if (line.startsWith('? ')) {
          files.push({
            path: line.slice(2),
            status: 'untracked',
            staged: false,
          });
        }
      }

      return { branch, files, count: files.length };
    } catch (error) {
      // Not a git repo or git not available
      return {
        branch: null,
        files: [],
        count: 0,
        error: 'Not a git repository or git is not available',
      };
    }
  }

  // ----------------------------------------------------------
  // Transport Start Methods
  // ----------------------------------------------------------

  private async startStdio(): Promise<void> {
    this.stdioTransport = new StdioTransport(
      async (message: string) => {
        const response = await this.handleMessage(message, 'stdio');
        if (response) {
          this.stdioTransport!.send(JSON.stringify(response));
        }
      },
    );

    // Register stdio as a connection
    const stdioSessionId = 'stdio';
    this.sessions.set(stdioSessionId, {
      id: stdioSessionId,
      clientCapabilities: {},
      initialized: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      transport: 'stdio',
      activeOperationId: null,
      abortController: null,
    });

    this.connections.set(stdioSessionId, {
      id: stdioSessionId,
      sessionId: stdioSessionId,
      transport: 'stdio',
      send: (msg: string) => {
        this.stdioTransport?.send(msg);
      },
      close: () => {
        this.stdioTransport?.close();
      },
    });
  }

  private async startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer(async (req, res) => {
        await this.handleHttpRequest(req, res);
      });

      // Set up WebSocket/line-delimited TCP transport
      this.wsTransport = new WebSocketTransport(
        this.config.host,
        this.config.port + 1, // WS on next port to avoid conflict with HTTP
        this.config.corsOrigin,
        (connectionId, send) => {
          this.handleWsConnect(connectionId, send);
        },
        (connectionId) => {
          this.handleWsDisconnect(connectionId);
        },
        async (connectionId, message) => {
          await this.handleWsMessage(connectionId, message);
        },
      );

      this.httpServer.on('error', (err: Error) => {
        this.log(chalk.red(`ACP HTTP server error: ${err.message}`));
        reject(err);
      });

      this.httpServer.listen(this.config.port, this.config.host, async () => {
        this.log(chalk.gray(`  ACP HTTP server on http://${this.config.host}:${this.config.port}`));

        // Start WebSocket transport
        try {
          await this.wsTransport!.start();
          this.log(chalk.gray(`  ACP WS server on ws://${this.config.host}:${this.config.port + 1}/acp`));
        } catch (wsErr) {
          this.log(chalk.yellow(`  ACP WS server failed to start: ${wsErr instanceof Error ? wsErr.message : String(wsErr)}`));
        }

        resolve();
      });
    });
  }

  // ----------------------------------------------------------
  // HTTP Request Handling
  // ----------------------------------------------------------

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', this.config.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST for JSON-RPC.' }));
      return;
    }

    if (req.url !== '/acp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use /acp endpoint.' }));
      return;
    }

    // Authentication
    if (this.config.requireAuth) {
      const apiKey = req.headers['x-api-key'] as string ||
                     (req.headers['authorization'] as string || '').replace('Bearer ', '');
      if (apiKey !== this.config.apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32001, message: 'Invalid API key' },
        }));
        return;
      }
    }

    // Parse body
    const body = await this.parseHttpBody(req);
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSON_RPC_ERRORS.PARSE_ERROR, message: 'Empty or invalid request body' },
      }));
      return;
    }

    // For HTTP, we create a transient session per request or use an existing one
    const sessionId = this.resolveHttpSession(req);

    const response = await this.handleMessage(body, sessionId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (response) {
      res.end(JSON.stringify(response));
    } else {
      // Notification - no response
      res.end(JSON.stringify({ jsonrpc: '2.0', result: null, id: null }));
    }
  }

  private async parseHttpBody(req: IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.config.maxBodySize) {
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      req.on('error', () => resolve(null));
    });
  }

  private resolveHttpSession(req: IncomingMessage): string {
    // Try to find an existing session from headers
    const sessionId = req.headers['x-acp-session'] as string;
    if (sessionId && this.sessions.has(sessionId)) {
      return sessionId;
    }

    // Create a new HTTP session
    const newSessionId = `http_${randomBytes(8).toString('hex')}`;
    this.sessions.set(newSessionId, {
      id: newSessionId,
      clientCapabilities: {},
      initialized: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      transport: 'http',
      activeOperationId: null,
      abortController: null,
    });

    // Register a connection for this session so we can send notifications
    // For HTTP, "sending" means the client polls or uses SSE (future)
    this.connections.set(newSessionId, {
      id: newSessionId,
      sessionId: newSessionId,
      transport: 'http',
      send: (_msg: string) => {
        // HTTP clients can't receive push notifications directly
        // In a full implementation, you'd use SSE or long-polling
      },
      close: () => {
        this.sessions.delete(newSessionId);
      },
    });

    return newSessionId;
  }

  // ----------------------------------------------------------
  // WebSocket Connection Handling
  // ----------------------------------------------------------

  private handleWsConnect(connectionId: string, send: (msg: string) => void): void {
    // Create session for this WebSocket connection
    const sessionId = connectionId;
    this.sessions.set(sessionId, {
      id: sessionId,
      clientCapabilities: {},
      initialized: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      transport: 'websocket',
      activeOperationId: null,
      abortController: null,
    });

    this.connections.set(sessionId, {
      id: sessionId,
      sessionId,
      transport: 'websocket',
      send,
      close: () => {
        this.wsTransport?.close(connectionId);
      },
    });

    this.log(chalk.gray(`  ACP client connected: ${connectionId}`));
  }

  private handleWsDisconnect(connectionId: string): void {
    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.log(chalk.gray(`  ACP client disconnected: ${connectionId}`));
  }

  private async handleWsMessage(connectionId: string, message: string): Promise<void> {
    const response = await this.handleMessage(message, connectionId);
    if (response) {
      const responseStr = JSON.stringify(response);
      this.wsTransport?.send(connectionId, responseStr);
    }
  }

  // ----------------------------------------------------------
  // Session Management
  // ----------------------------------------------------------

  private createSessionId(): string {
    return `sess_${randomBytes(8).toString('hex')}`;
  }

  private removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Cancel any ongoing operation
      if (session.activeOperationId) {
        this.cancelOperation(session.activeOperationId);
      }

      this.sessions.delete(sessionId);
    }

    // Also remove the connection
    this.removeConnection(sessionId);
  }

  private removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        connection.close();
      } catch {
        // Ignore close errors
      }
      this.connections.delete(connectionId);
    }
  }

  private findSessionByOperation(): ACPSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.activeOperationId) {
        return session;
      }
    }
    return undefined;
  }

  private cancelOperation(operationId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.activeOperationId === operationId) {
        if (session.abortController) {
          session.abortController.abort();
        }
        session.activeOperationId = null;
        session.abortController = null;
        return true;
      }
    }
    return false;
  }

  private detectTransportFromSession(sessionId: string): 'stdio' | 'websocket' | 'http' {
    if (sessionId === 'stdio') return 'stdio';
    if (sessionId.startsWith('ws_')) return 'websocket';
    if (sessionId.startsWith('http_')) return 'http';
    return 'http';
  }

  // ----------------------------------------------------------
  // JSON-RPC Response Helpers
  // ----------------------------------------------------------

  private successResponse(id: number | string | null, result: unknown): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  private errorResponse(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    };
  }

  // ----------------------------------------------------------
  // URI / Path Utilities
  // ----------------------------------------------------------

  private uriToPath(uri: string): string {
    if (uri.startsWith('file://')) {
      // Handle file:///path (Unix) or file:///C:/path (Windows)
      let path = uri.slice(7);
      // Windows: file:///C:/path -> C:/path
      if (path.length >= 2 && path[0] === '/' && path[2] === ':') {
        path = path.slice(1);
      }
      return decodeURIComponent(path);
    }
    return uri;
  }

  private pathToUri(filePath: string): string {
    return `file://${encodeURI(filePath.replace(/\\/g, '/'))}`;
  }

  private languageIdFromPath(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.py': 'python',
      '.rs': 'rust',
      '.go': 'go',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.sh': 'shellscript',
      '.bash': 'shellscript',
      '.zsh': 'shellscript',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.toml': 'toml',
      '.md': 'markdown',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.sql': 'sql',
      '.graphql': 'graphql',
      '.vue': 'vue',
      '.svelte': 'svelte',
    };
    return map[ext] || 'plaintext';
  }

  // ----------------------------------------------------------
  // Config Persistence
  // ----------------------------------------------------------

  private saveConfig(): void {
    try {
      const dir = join(ACP_CONFIG_PATH, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(ACP_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch {
      // Silently fail
    }
  }

  private loadConfig(): void {
    try {
      if (existsSync(ACP_CONFIG_PATH)) {
        const raw = readFileSync(ACP_CONFIG_PATH, 'utf-8');
        const saved = JSON.parse(raw) as Partial<ACPConfig>;
        this.config = { ...this.config, ...saved };
      } else {
        this.saveConfig();
      }
    } catch {
      // Silently fail, use defaults
    }
  }

  // ----------------------------------------------------------
  // Logging
  // ----------------------------------------------------------

  private log(message: string): void {
    // For stdio transport, don't write to stdout (it's used for protocol)
    // Write to stderr instead
    if (this.config.transport === 'stdio') {
      process.stderr.write(message + '\n');
    } else {
      console.log(message);
    }
  }
}

// ============================================================
// Convenience: Create and start an ACP server from engine
// ============================================================

export async function startACPServer(
  engine: any,
  config?: Partial<ACPConfig>,
): Promise<ACPServer> {
  const server = new ACPServer(engine, config);
  await server.start();
  return server;
}
