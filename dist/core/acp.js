// ============================================================
// NeuroCLI - Agent Client Protocol (ACP) Server
// GAP-28: "LSP for AI Agents"
// JSON-RPC 2.0 protocol for editor/IDE integration
// Transports: stdio, WebSocket, HTTP POST
// Bidirectional: server can push notifications to clients
// ============================================================
import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
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
};
// ============================================================
// Default Configuration
// ============================================================
const ACP_CONFIG_PATH = join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.neuro', 'acp-config.json');
function generateApiKey() {
    return `acp_${randomBytes(32).toString('hex')}`;
}
function defaultConfig() {
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
// Stdio Transport
// ============================================================
class StdioTransport {
    buffer = '';
    onMessage;
    output;
    constructor(onMessage, output) {
        this.onMessage = onMessage;
        this.output = output || ((data) => process.stdout.write(data));
        this.setupInput();
    }
    setupInput() {
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => {
            this.buffer += chunk;
            this.processBuffer();
        });
        process.stdin.on('end', () => {
            // Client disconnected
        });
    }
    processBuffer() {
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1)
                break;
            const header = this.buffer.slice(0, headerEnd);
            const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch)
                break;
            const contentLength = parseInt(contentLengthMatch[1], 10);
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + contentLength;
            if (this.buffer.length < bodyEnd)
                break;
            const body = this.buffer.slice(bodyStart, bodyEnd);
            this.buffer = this.buffer.slice(bodyEnd);
            this.onMessage(body);
        }
    }
    send(message) {
        const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
        this.output(header + message);
    }
    close() {
        // For stdio, we don't close stdin/stdout
    }
}
// ============================================================
// WebSocket Transport (minimal, no external deps)
// ============================================================
class WebSocketTransport {
    connections = new Map();
    server = null;
    host;
    port;
    onConnect;
    onDisconnect;
    onMessage;
    corsOrigin;
    constructor(host, port, corsOrigin, onConnect, onDisconnect, onMessage) {
        this.host = host;
        this.port = port;
        this.corsOrigin = corsOrigin;
        this.onConnect = onConnect;
        this.onDisconnect = onDisconnect;
        this.onMessage = onMessage;
    }
    async start() {
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
            this.server.on('upgrade', (req, socket, head) => {
                if (req.url !== '/acp') {
                    socket.destroy();
                    return;
                }
                this.handleWebSocketUpgrade(socket, head);
            });
            this.server.on('error', (err) => {
                reject(err);
            });
            this.server.listen(this.port, this.host, () => {
                resolve();
            });
        });
    }
    handleWebSocketUpgrade(socket, head) {
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
        const send = (msg) => {
            try {
                socket.write(msg + '\n');
            }
            catch {
                // Socket may have been closed
            }
        };
        this.onConnect(connectionId, send);
        socket.on('data', (data) => {
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
    send(connectionId, message) {
        const entry = this.connections.get(connectionId);
        if (entry) {
            try {
                entry.socket.write(message + '\n');
            }
            catch {
                // Socket may have been closed
            }
        }
    }
    close(connectionId) {
        const entry = this.connections.get(connectionId);
        if (entry) {
            entry.socket.destroy();
            this.connections.delete(connectionId);
        }
    }
    async stop() {
        for (const [id, entry] of this.connections) {
            entry.socket.destroy();
        }
        this.connections.clear();
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            }
            else {
                resolve();
            }
        });
    }
}
// ============================================================
// ACP Server - Main Implementation
// ============================================================
export class ACPServer {
    config;
    engine; // NeuroEngine reference - typed as any to avoid circular imports
    sessions = new Map();
    connections = new Map();
    httpServer = null;
    wsTransport = null;
    stdioTransport = null;
    isRunning = false;
    startTime = 0;
    requestCount = 0;
    operationCounter = 0;
    // Server capabilities
    serverCapabilities = {
        textDocumentOperations: ['edit', 'read'],
        workspaceOperations: ['search', 'diagnostics'],
        agentOperations: ['prompt', 'cancel', 'status', 'tools'],
        streaming: true,
        toolNotifications: true,
        fileChangeNotifications: true,
        maxConcurrentSessions: 10,
    };
    serverInfo = {
        name: 'NeuroCLI ACP Server',
        version: '4.0.0',
        protocolVersion: '1.0.0',
    };
    constructor(engine, config) {
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
    async start() {
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
    async stop() {
        if (!this.isRunning)
            return;
        // Close all client connections
        for (const [id, connection] of this.connections) {
            try {
                connection.close();
            }
            catch {
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
            await new Promise((resolve) => {
                this.httpServer.close(() => resolve());
            });
            this.httpServer = null;
        }
        this.isRunning = false;
        this.log(chalk.gray('ACP server stopped.'));
    }
    /**
     * Check if server is running
     */
    getIsRunning() {
        return this.isRunning;
    }
    /**
     * Get server configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get server statistics
     */
    getStats() {
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
    printStatus() {
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
    async handleRequest(request, sessionId) {
        this.requestCount++;
        // Validate JSON-RPC version
        if (request.jsonrpc !== '2.0') {
            return this.errorResponse(request.id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC version. Must be "2.0".');
        }
        // Check session initialization (except for initialize method)
        const session = sessionId ? this.sessions.get(sessionId) : undefined;
        if (session && !session.initialized && request.method !== 'initialize') {
            return this.errorResponse(request.id, JSON_RPC_ERRORS.SERVER_NOT_INITIALIZED, 'Server not initialized. Send "initialize" request first.');
        }
        // Update session activity
        if (session) {
            session.lastActivity = Date.now();
        }
        // Route to method handler
        try {
            const result = await this.routeMethod(request.method, request.params, sessionId);
            return this.successResponse(request.id, result);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const code = error.code || JSON_RPC_ERRORS.INTERNAL_ERROR;
            return this.errorResponse(request.id, code, message);
        }
    }
    /**
     * Handle an incoming JSON-RPC notification
     */
    handleNotification(notification, sessionId) {
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
                    const opId = notification.params.id;
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
    async handleMessage(raw, sessionId) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return this.errorResponse(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error: invalid JSON.');
        }
        // Batch request support
        if (Array.isArray(parsed)) {
            if (parsed.length === 0) {
                return this.errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Empty batch request.');
            }
            const results = await Promise.all(parsed.map((item) => this.handleMessage(JSON.stringify(item), sessionId)));
            // Filter out nulls (notifications don't get responses)
            const responses = results.filter((r) => r !== null);
            return responses.length === 1 ? responses[0] : responses;
        }
        // Validate it's an object
        if (typeof parsed !== 'object' || parsed === null) {
            return this.errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid request: not an object.');
        }
        const message = parsed;
        // Is it a notification (no id) or a request (has id)?
        if ('method' in message && !('id' in message)) {
            // It's a notification
            this.handleNotification(message, sessionId);
            return null;
        }
        // It's a request
        return this.handleRequest(message, sessionId);
    }
    /**
     * Send a notification to all connected clients
     */
    notifyClients(method, params) {
        const notification = {
            jsonrpc: '2.0',
            method,
            params,
        };
        const message = JSON.stringify(notification);
        for (const [id, connection] of this.connections) {
            try {
                connection.send(message);
            }
            catch {
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
    notifyClient(sessionId, method, params) {
        const notification = {
            jsonrpc: '2.0',
            method,
            params,
        };
        const message = JSON.stringify(notification);
        const connection = this.connections.get(sessionId);
        if (connection) {
            try {
                connection.send(message);
            }
            catch {
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
    async routeMethod(method, params, sessionId) {
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
                throw Object.assign(new Error(`Method not found: ${method}`), { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND });
        }
    }
    // ----------------------------------------------------------
    // Method Handlers - Lifecycle
    // ----------------------------------------------------------
    handleInitialize(params, sessionId) {
        const initParams = (params || {});
        const clientCapabilities = (initParams.capabilities || {});
        const clientInfo = (initParams.clientInfo || {});
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
        }
        else {
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
    handleShutdown() {
        // Prepare for shutdown - cleanup but don't actually stop
        return { success: true };
    }
    // ----------------------------------------------------------
    // Method Handlers - Text Document Operations
    // ----------------------------------------------------------
    handleTextDocumentEdit(params) {
        const editParams = params;
        if (!editParams || !editParams.uri) {
            throw Object.assign(new Error('Invalid params: uri is required'), { code: JSON_RPC_ERRORS.INVALID_PARAMS });
        }
        const filePath = this.uriToPath(editParams.uri);
        // Read current file content
        let content;
        try {
            content = readFileSync(filePath, 'utf-8');
        }
        catch {
            // If file doesn't exist and we have edits with empty ranges, create it
            if (editParams.edits && editParams.edits.length > 0) {
                const hasCreateEdit = editParams.edits.some((e) => e.range.start.line === 0 &&
                    e.range.start.character === 0 &&
                    e.range.end.line === 0 &&
                    e.range.end.character === 0);
                if (hasCreateEdit) {
                    content = '';
                }
                else {
                    throw Object.assign(new Error(`File not found: ${filePath}`), { code: JSON_RPC_ERRORS.INTERNAL_ERROR });
                }
            }
            else {
                throw Object.assign(new Error(`File not found: ${filePath}`), { code: JSON_RPC_ERRORS.INTERNAL_ERROR });
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
            }
            else {
                replacement[0] = beforeLine + newLines[0] + afterLine;
            }
            lines.splice(startLine, endLine - startLine + 1, ...replacement);
        }
        // Write the modified content back
        const newContent = lines.join('\n');
        try {
            writeFileSync(filePath, newContent, 'utf-8');
        }
        catch (writeError) {
            throw Object.assign(new Error(`Failed to write file: ${writeError instanceof Error ? writeError.message : String(writeError)}`), { code: JSON_RPC_ERRORS.INTERNAL_ERROR });
        }
        // Notify clients about the file change
        this.notifyClients('workspace/fileChanged', {
            uri: editParams.uri,
            changeType: 'modified',
        });
        return {
            applied: true,
            editCount: editParams.edits?.length || 0,
        };
    }
    handleTextDocumentRead(params) {
        const readParams = params;
        if (!readParams || !readParams.uri) {
            throw Object.assign(new Error('Invalid params: uri is required'), { code: JSON_RPC_ERRORS.INVALID_PARAMS });
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
        }
        catch (error) {
            throw Object.assign(new Error(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`), { code: JSON_RPC_ERRORS.INTERNAL_ERROR });
        }
    }
    // ----------------------------------------------------------
    // Method Handlers - Workspace Operations
    // ----------------------------------------------------------
    handleWorkspaceSearch(params) {
        const searchParams = params;
        if (!searchParams || !searchParams.query) {
            throw Object.assign(new Error('Invalid params: query is required'), { code: JSON_RPC_ERRORS.INVALID_PARAMS });
        }
        const workingDir = this.engine?.config ? process.cwd() : process.cwd();
        const maxResults = searchParams.maxResults || 50;
        const results = [];
        try {
            const searchPattern = searchParams.query;
            const includeGlob = searchParams.include || '';
            const excludeGlob = searchParams.exclude || 'node_modules,.git,dist,build';
            // Use ripgrep if available, otherwise fallback to grep
            let grepOutput;
            try {
                const cmdParts = ['rg', '--json'];
                if (includeGlob)
                    cmdParts.push('--glob', includeGlob);
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
            }
            catch (rgError) {
                // rg returns exit code 1 for no matches, or may not be installed
                if (rgError.stdout) {
                    grepOutput = rgError.stdout;
                }
                else {
                    // Fallback to grep
                    try {
                        grepOutput = execSync(`grep -rn "${searchPattern}" ${workingDir} --include="*.ts" --include="*.js" --include="*.py" --include="*.rs" --include="*.go" | head -${maxResults}`, { encoding: 'utf-8', timeout: 10000, maxBuffer: 5 * 1024 * 1024 });
                    }
                    catch {
                        return { results: [], count: 0 };
                    }
                }
            }
            // Parse ripgrep JSON output
            for (const line of grepOutput.split('\n')) {
                if (!line.trim())
                    continue;
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
                }
                catch {
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
                if (results.length >= maxResults)
                    break;
            }
        }
        catch (error) {
            throw Object.assign(new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`), { code: JSON_RPC_ERRORS.INTERNAL_ERROR });
        }
        return { results, count: results.length };
    }
    handleWorkspaceDiagnostics(params) {
        const diagParams = (params || {});
        // Try to get diagnostics from the LSP integration if available
        const diagnostics = [];
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
            }
            catch {
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
            }
            catch {
                // Security scanning may fail
            }
        }
        return { diagnostics, count: diagnostics.length };
    }
    // ----------------------------------------------------------
    // Method Handlers - Agent Operations
    // ----------------------------------------------------------
    async handleAgentPrompt(params, sessionId) {
        const promptParams = params;
        if (!promptParams || !promptParams.prompt) {
            throw Object.assign(new Error('Invalid params: prompt is required'), { code: JSON_RPC_ERRORS.INVALID_PARAMS });
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
                const processPromise = this.engine.processMessage(promptParams.prompt, promptParams.mode || 'auto', promptParams.agent);
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
                    });
                    return { operationId, cancelled: true, content: '' };
                }
                // Send completion notification
                this.notifyClient(sessionId || '', 'agent/completed', {
                    operationId,
                    content: result.content,
                    usage: result.usage,
                });
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
            else {
                // Non-streaming: just return the full result
                const result = await this.engine.processMessage(promptParams.prompt, promptParams.mode || 'auto', promptParams.agent);
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
        }
        catch (error) {
            // Send error notification
            this.notifyClient(sessionId || '', 'agent/error', {
                operationId,
                message: error instanceof Error ? error.message : String(error),
            });
            // Clean up session state
            if (session) {
                session.activeOperationId = null;
                session.abortController = null;
            }
            throw error;
        }
    }
    handleAgentCancel(params) {
        const cancelParams = params;
        if (!cancelParams || !cancelParams.operationId) {
            throw Object.assign(new Error('Invalid params: operationId is required'), { code: JSON_RPC_ERRORS.INVALID_PARAMS });
        }
        const cancelled = this.cancelOperation(cancelParams.operationId);
        return { cancelled, operationId: cancelParams.operationId };
    }
    handleAgentStatus(params) {
        const statusParams = (params || {});
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
    handleAgentTools(params) {
        const toolsParams = (params || {});
        const tools = [];
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
            }
            catch {
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
            }
            catch {
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
            }
            catch {
                // Custom tools listing may fail
            }
        }
        return { tools, count: tools.length };
    }
    // ----------------------------------------------------------
    // Method Handlers - Git Operations
    // ----------------------------------------------------------
    handleGitStatus(params) {
        const gitParams = (params || {});
        const workingDir = gitParams.workingDirectory || process.cwd();
        try {
            const statusOutput = execSync('git status --porcelain=v2 --branch', {
                encoding: 'utf-8',
                cwd: workingDir,
                timeout: 5000,
            });
            const branchMatch = statusOutput.match(/^# branch\.head\s+(.+)$/m);
            const branch = branchMatch ? branchMatch[1] : 'unknown';
            const files = [];
            for (const line of statusOutput.split('\n')) {
                if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
                    const parts = line.split(' ');
                    if (parts.length >= 9) {
                        const xy = parts[1];
                        const filePath = parts.slice(8).join(' ');
                        const staged = xy[0] !== '.' && xy[0] !== '?';
                        const statusChar = staged ? xy[0] : xy[1];
                        const statusMap = {
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
                }
                else if (line.startsWith('? ')) {
                    files.push({
                        path: line.slice(2),
                        status: 'untracked',
                        staged: false,
                    });
                }
            }
            return { branch, files, count: files.length };
        }
        catch (error) {
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
    async startStdio() {
        this.stdioTransport = new StdioTransport(async (message) => {
            const response = await this.handleMessage(message, 'stdio');
            if (response) {
                this.stdioTransport.send(JSON.stringify(response));
            }
        });
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
            send: (msg) => {
                this.stdioTransport?.send(msg);
            },
            close: () => {
                this.stdioTransport?.close();
            },
        });
    }
    async startHttpServer() {
        return new Promise((resolve, reject) => {
            this.httpServer = createServer(async (req, res) => {
                await this.handleHttpRequest(req, res);
            });
            // Set up WebSocket/line-delimited TCP transport
            this.wsTransport = new WebSocketTransport(this.config.host, this.config.port + 1, // WS on next port to avoid conflict with HTTP
            this.config.corsOrigin, (connectionId, send) => {
                this.handleWsConnect(connectionId, send);
            }, (connectionId) => {
                this.handleWsDisconnect(connectionId);
            }, async (connectionId, message) => {
                await this.handleWsMessage(connectionId, message);
            });
            this.httpServer.on('error', (err) => {
                this.log(chalk.red(`ACP HTTP server error: ${err.message}`));
                reject(err);
            });
            this.httpServer.listen(this.config.port, this.config.host, async () => {
                this.log(chalk.gray(`  ACP HTTP server on http://${this.config.host}:${this.config.port}`));
                // Start WebSocket transport
                try {
                    await this.wsTransport.start();
                    this.log(chalk.gray(`  ACP WS server on ws://${this.config.host}:${this.config.port + 1}/acp`));
                }
                catch (wsErr) {
                    this.log(chalk.yellow(`  ACP WS server failed to start: ${wsErr instanceof Error ? wsErr.message : String(wsErr)}`));
                }
                resolve();
            });
        });
    }
    // ----------------------------------------------------------
    // HTTP Request Handling
    // ----------------------------------------------------------
    async handleHttpRequest(req, res) {
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
            const apiKey = req.headers['x-api-key'] ||
                (req.headers['authorization'] || '').replace('Bearer ', '');
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
        }
        else {
            // Notification - no response
            res.end(JSON.stringify({ jsonrpc: '2.0', result: null, id: null }));
        }
    }
    async parseHttpBody(req) {
        return new Promise((resolve) => {
            const chunks = [];
            let size = 0;
            req.on('data', (chunk) => {
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
    resolveHttpSession(req) {
        // Try to find an existing session from headers
        const sessionId = req.headers['x-acp-session'];
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
            send: (_msg) => {
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
    handleWsConnect(connectionId, send) {
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
    handleWsDisconnect(connectionId) {
        this.sessions.delete(connectionId);
        this.connections.delete(connectionId);
        this.log(chalk.gray(`  ACP client disconnected: ${connectionId}`));
    }
    async handleWsMessage(connectionId, message) {
        const response = await this.handleMessage(message, connectionId);
        if (response) {
            const responseStr = JSON.stringify(response);
            this.wsTransport?.send(connectionId, responseStr);
        }
    }
    // ----------------------------------------------------------
    // Session Management
    // ----------------------------------------------------------
    createSessionId() {
        return `sess_${randomBytes(8).toString('hex')}`;
    }
    removeSession(sessionId) {
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
    removeConnection(connectionId) {
        const connection = this.connections.get(connectionId);
        if (connection) {
            try {
                connection.close();
            }
            catch {
                // Ignore close errors
            }
            this.connections.delete(connectionId);
        }
    }
    findSessionByOperation() {
        for (const session of this.sessions.values()) {
            if (session.activeOperationId) {
                return session;
            }
        }
        return undefined;
    }
    cancelOperation(operationId) {
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
    detectTransportFromSession(sessionId) {
        if (sessionId === 'stdio')
            return 'stdio';
        if (sessionId.startsWith('ws_'))
            return 'websocket';
        if (sessionId.startsWith('http_'))
            return 'http';
        return 'http';
    }
    // ----------------------------------------------------------
    // JSON-RPC Response Helpers
    // ----------------------------------------------------------
    successResponse(id, result) {
        return {
            jsonrpc: '2.0',
            id,
            result,
        };
    }
    errorResponse(id, code, message, data) {
        return {
            jsonrpc: '2.0',
            id,
            error: { code, message, data },
        };
    }
    // ----------------------------------------------------------
    // URI / Path Utilities
    // ----------------------------------------------------------
    uriToPath(uri) {
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
    pathToUri(filePath) {
        return `file://${encodeURI(filePath.replace(/\\/g, '/'))}`;
    }
    languageIdFromPath(filePath) {
        const ext = extname(filePath).toLowerCase();
        const map = {
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
    saveConfig() {
        try {
            const dir = join(ACP_CONFIG_PATH, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(ACP_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch {
            // Silently fail
        }
    }
    loadConfig() {
        try {
            if (existsSync(ACP_CONFIG_PATH)) {
                const raw = readFileSync(ACP_CONFIG_PATH, 'utf-8');
                const saved = JSON.parse(raw);
                this.config = { ...this.config, ...saved };
            }
            else {
                this.saveConfig();
            }
        }
        catch {
            // Silently fail, use defaults
        }
    }
    // ----------------------------------------------------------
    // Logging
    // ----------------------------------------------------------
    log(message) {
        // For stdio transport, don't write to stdout (it's used for protocol)
        // Write to stderr instead
        if (this.config.transport === 'stdio') {
            process.stderr.write(message + '\n');
        }
        else {
            console.log(message);
        }
    }
}
// ============================================================
// Convenience: Create and start an ACP server from engine
// ============================================================
export async function startACPServer(engine, config) {
    const server = new ACPServer(engine, config);
    await server.start();
    return server;
}
//# sourceMappingURL=acp.js.map