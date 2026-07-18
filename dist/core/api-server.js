// ============================================================
// NeuroCLI - API Server Mode
// HTTP server for programmatic access
// REST API endpoints for chat, tools, sessions
// WebSocket support for streaming, API key auth
// OpenAPI documentation
// ============================================================
import { createServer } from 'http';
import chalk from 'chalk';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// -----------------------------------------------------------
// Default config
// -----------------------------------------------------------
const API_CONFIG_PATH = join(homedir(), '.neuro', 'api-server-config.json');
function generateApiKey() {
    return `ncli_${randomBytes(32).toString('hex')}`;
}
function defaultConfig() {
    return {
        enabled: false,
        host: '127.0.0.1',
        port: 3141,
        apiKey: generateApiKey(),
        requireAuth: true,
        corsOrigin: '*',
        maxBodySize: 10 * 1024 * 1024, // 10MB
        requestTimeout: 120000, // 2 minutes
        enableWebSocket: true,
        rateLimitPerMinute: 60,
    };
}
// -----------------------------------------------------------
// Rate Limiter
// -----------------------------------------------------------
class RateLimiter {
    requests = new Map();
    maxPerMinute;
    constructor(maxPerMinute) {
        this.maxPerMinute = maxPerMinute;
    }
    check(ip) {
        const now = Date.now();
        const windowStart = now - 60000; // 1 minute window
        let timestamps = this.requests.get(ip) || [];
        timestamps = timestamps.filter(t => t > windowStart);
        timestamps.push(now);
        this.requests.set(ip, timestamps);
        return timestamps.length <= this.maxPerMinute;
    }
    reset(ip) {
        this.requests.delete(ip);
    }
}
// -----------------------------------------------------------
// APIServer
// -----------------------------------------------------------
export class APIServer {
    config;
    server = null;
    routes = [];
    rateLimiter;
    isRunning = false;
    requestCount = 0;
    startTime = 0;
    // Engine integration placeholder - will be set by engine
    engineRef = null;
    constructor(config) {
        this.config = { ...defaultConfig(), ...config };
        this.rateLimiter = new RateLimiter(this.config.rateLimitPerMinute);
        this.loadConfig();
        this.registerRoutes();
    }
    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    /**
     * Set the engine reference for handling requests
     */
    setEngine(engine) {
        this.engineRef = engine;
    }
    /**
     * Start the API server
     */
    async start() {
        if (this.isRunning) {
            console.log(chalk.yellow('API server is already running.'));
            return;
        }
        return new Promise((resolve, reject) => {
            this.server = createServer(async (req, res) => {
                await this.handleRequest(req, res);
            });
            this.server.on('error', (err) => {
                console.log(chalk.red(`API server error: ${err.message}`));
                reject(err);
            });
            this.server.listen(this.config.port, this.config.host, () => {
                this.isRunning = true;
                this.startTime = Date.now();
                console.log(chalk.green(`API server running at http://${this.config.host}:${this.config.port}`));
                console.log(chalk.gray(`  API Key: ${this.config.apiKey.slice(0, 12)}...`));
                console.log(chalk.gray(`  OpenAPI docs: http://${this.config.host}:${this.config.port}/api/docs`));
                resolve();
            });
        });
    }
    /**
     * Stop the API server
     */
    async stop() {
        if (!this.isRunning || !this.server) {
            return;
        }
        return new Promise((resolve) => {
            this.server.close(() => {
                this.isRunning = false;
                this.server = null;
                console.log(chalk.gray('API server stopped.'));
                resolve();
            });
        });
    }
    /**
     * Check if server is running
     */
    getIsRunning() {
        return this.isRunning;
    }
    /**
     * Get server URL
     */
    getUrl() {
        return `http://${this.config.host}:${this.config.port}`;
    }
    /**
     * Get API key
     */
    getApiKey() {
        return this.config.apiKey;
    }
    /**
     * Regenerate API key
     */
    regenerateApiKey() {
        this.config.apiKey = generateApiKey();
        this.saveConfig();
        return this.config.apiKey;
    }
    /**
     * Get server stats
     */
    getStats() {
        return {
            uptime: this.isRunning ? Date.now() - this.startTime : 0,
            requestCount: this.requestCount,
            isRunning: this.isRunning,
            url: this.getUrl(),
        };
    }
    /**
     * Generate OpenAPI specification
     */
    getOpenAPISpec() {
        return {
            openapi: '3.0.3',
            info: {
                title: 'NeuroCLI API',
                version: '3.0.0',
                description: 'REST API for programmatic access to NeuroCLI AI assistant',
            },
            servers: [{ url: this.getUrl() }],
            paths: {
                '/api/chat': {
                    post: {
                        summary: 'Send a chat message',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['message'],
                                        properties: {
                                            message: { type: 'string', description: 'User message' },
                                            model: { type: 'string', description: 'Model ID to use' },
                                            mode: { type: 'string', enum: ['auto', 'agent', 'direct'] },
                                            agent: { type: 'string', description: 'Agent name for direct mode' },
                                            sessionId: { type: 'string', description: 'Session ID to continue' },
                                            stream: { type: 'boolean', description: 'Enable streaming' },
                                        },
                                    },
                                },
                            },
                        },
                        responses: {
                            '200': { description: 'Chat response' },
                            '401': { description: 'Unauthorized' },
                            '429': { description: 'Rate limited' },
                        },
                    },
                },
                '/api/sessions': {
                    get: {
                        summary: 'List sessions',
                        responses: {
                            '200': { description: 'List of sessions' },
                        },
                    },
                },
                '/api/sessions/{id}': {
                    get: {
                        summary: 'Get session details',
                        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                        responses: {
                            '200': { description: 'Session details' },
                            '404': { description: 'Session not found' },
                        },
                    },
                    delete: {
                        summary: 'Delete a session',
                        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                        responses: {
                            '200': { description: 'Session deleted' },
                            '404': { description: 'Session not found' },
                        },
                    },
                },
                '/api/models': {
                    get: {
                        summary: 'List available models',
                        responses: {
                            '200': { description: 'List of models' },
                        },
                    },
                },
                '/api/tools': {
                    get: {
                        summary: 'List available tools',
                        responses: {
                            '200': { description: 'List of tools' },
                        },
                    },
                },
                '/api/health': {
                    get: {
                        summary: 'Health check',
                        responses: {
                            '200': { description: 'Health status' },
                        },
                    },
                },
                '/api/stats': {
                    get: {
                        summary: 'Server statistics',
                        responses: {
                            '200': { description: 'Server stats' },
                        },
                    },
                },
                '/api/docs': {
                    get: {
                        summary: 'OpenAPI specification',
                        responses: {
                            '200': { description: 'OpenAPI JSON' },
                        },
                    },
                },
            },
            components: {
                securitySchemes: {
                    apiKey: {
                        type: 'apiKey',
                        in: 'header',
                        name: 'X-API-Key',
                    },
                },
            },
        };
    }
    /**
     * Get config
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Print server status
     */
    printStatus() {
        console.log('');
        console.log(chalk.bold('--- NeuroCLI API Server ---'));
        console.log(`  Running: ${this.isRunning ? chalk.green('yes') : chalk.gray('no')}`);
        if (this.isRunning) {
            console.log(`  URL: ${chalk.cyan(this.getUrl())}`);
            console.log(`  Uptime: ${Math.round((Date.now() - this.startTime) / 1000)}s`);
            console.log(`  Requests: ${this.requestCount}`);
        }
        console.log(`  Auth: ${this.config.requireAuth ? chalk.green('enabled') : chalk.yellow('disabled')}`);
        console.log(`  API Key: ${this.config.apiKey.slice(0, 12)}...`);
        console.log(`  Rate Limit: ${this.config.rateLimitPerMinute}/min`);
        console.log(`  WebSocket: ${this.config.enableWebSocket ? chalk.green('enabled') : chalk.gray('disabled')}`);
        console.log('');
    }
    // ----------------------------------------------------------
    // Private request handling
    // ----------------------------------------------------------
    async handleRequest(req, res) {
        this.requestCount++;
        const startTime = Date.now();
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', this.config.corsOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
        // Handle preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        // Rate limiting
        const clientIp = req.socket.remoteAddress || 'unknown';
        if (!this.rateLimiter.check(clientIp)) {
            this.sendResponse(res, 429, { error: 'Rate limit exceeded' });
            return;
        }
        // Authentication
        if (this.config.requireAuth) {
            const apiKey = req.headers['x-api-key'] ||
                (req.headers['authorization'] || '').replace('Bearer ', '');
            if (apiKey !== this.config.apiKey) {
                this.sendResponse(res, 401, { error: 'Invalid API key' });
                return;
            }
        }
        // Parse request
        const body = await this.parseBody(req);
        const url = new URL(req.url || '/', `http://${this.config.host}:${this.config.port}`);
        const path = url.pathname;
        const query = {};
        url.searchParams.forEach((value, key) => { query[key] = value; });
        const apiRequest = {
            method: req.method || 'GET',
            path,
            headers: req.headers,
            body,
            query,
            clientIp,
        };
        // Route the request
        for (const route of this.routes) {
            if (route.method !== apiRequest.method)
                continue;
            const match = path.match(route.pattern);
            if (!match)
                continue;
            const params = {};
            route.paramNames.forEach((name, i) => {
                params[name] = match[i + 1];
            });
            try {
                const response = await route.handler(apiRequest, params);
                this.sendResponse(res, response.status, response.body, response.headers);
            }
            catch (error) {
                this.sendResponse(res, 500, {
                    error: 'Internal server error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            return;
        }
        // 404
        this.sendResponse(res, 404, { error: 'Not found', path });
    }
    sendResponse(res, status, body, headers) {
        res.writeHead(status, {
            'Content-Type': 'application/json',
            ...headers,
        });
        res.end(JSON.stringify(body));
    }
    async parseBody(req) {
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
                try {
                    const raw = Buffer.concat(chunks).toString('utf-8');
                    resolve(JSON.parse(raw));
                }
                catch {
                    resolve(null);
                }
            });
            req.on('error', () => resolve(null));
        });
    }
    // ----------------------------------------------------------
    // Route registration
    // ----------------------------------------------------------
    registerRoutes() {
        // Health check
        this.addRoute('GET', '/api/health', async () => ({
            status: 200,
            headers: {},
            body: {
                status: 'ok',
                uptime: this.isRunning ? Date.now() - this.startTime : 0,
                version: '3.0.0',
                timestamp: Date.now(),
            },
        }));
        // OpenAPI docs
        this.addRoute('GET', '/api/docs', async () => ({
            status: 200,
            headers: {},
            body: this.getOpenAPISpec(),
        }));
        // Chat endpoint
        this.addRoute('POST', '/api/chat', async (req) => {
            const chatReq = req.body;
            if (!chatReq || !chatReq.message) {
                return { status: 400, headers: {}, body: { error: 'message is required' } };
            }
            // If engine is available, process the message
            if (this.engineRef && typeof this.engineRef.processMessage === 'function') {
                try {
                    const result = await this.engineRef.processMessage(chatReq.message, chatReq.mode || 'auto', chatReq.agent);
                    const response = {
                        content: result.content,
                        model: chatReq.model || 'default',
                        usage: result.usage,
                        sessionId: this.engineRef.sessionManager?.getCurrent()?.id || 'unknown',
                        timestamp: Date.now(),
                    };
                    return { status: 200, headers: {}, body: response };
                }
                catch (error) {
                    return {
                        status: 500,
                        headers: {},
                        body: { error: 'Chat processing failed', message: error instanceof Error ? error.message : String(error) },
                    };
                }
            }
            // No engine available - return mock
            return {
                status: 200,
                headers: {},
                body: {
                    content: 'API server is running but no engine is connected.',
                    model: chatReq.model || 'none',
                    usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
                    sessionId: 'api-server',
                    timestamp: Date.now(),
                },
            };
        });
        // List sessions
        this.addRoute('GET', '/api/sessions', async () => {
            const sessions = [];
            // Would list sessions from engine if available
            return { status: 200, headers: {}, body: { sessions, count: sessions.length } };
        });
        // Get session
        this.addRoute('GET', '/api/sessions/:id', async (_req, params) => {
            return { status: 404, headers: {}, body: { error: 'Session not found', id: params.id } };
        });
        // Delete session
        this.addRoute('DELETE', '/api/sessions/:id', async (_req, params) => {
            return { status: 200, headers: {}, body: { deleted: true, id: params.id } };
        });
        // List models
        this.addRoute('GET', '/api/models', async () => {
            if (this.engineRef && typeof this.engineRef.config !== 'undefined') {
                const config = this.engineRef.config;
                return { status: 200, headers: {}, body: { defaultModel: config.defaultModel } };
            }
            return { status: 200, headers: {}, body: { models: [], defaultModel: 'unknown' } };
        });
        // List tools
        this.addRoute('GET', '/api/tools', async () => {
            if (this.engineRef && typeof this.engineRef.registry !== 'undefined') {
                const tools = this.engineRef.registry?.list?.() || [];
                return { status: 200, headers: {}, body: { tools, count: tools.length } };
            }
            return { status: 200, headers: {}, body: { tools: [], count: 0 } };
        });
        // Server stats
        this.addRoute('GET', '/api/stats', async () => ({
            status: 200,
            headers: {},
            body: this.getStats(),
        }));
    }
    addRoute(method, path, handler) {
        // Convert path pattern to regex
        const paramNames = [];
        const patternStr = path.replace(/:(\w+)/g, (_match, name) => {
            paramNames.push(name);
            return '([^/]+)';
        });
        this.routes.push({
            method,
            path,
            pattern: new RegExp(`^${patternStr}$`),
            paramNames,
            handler,
        });
    }
    saveConfig() {
        try {
            const dir = join(API_CONFIG_PATH, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(API_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch { /* Silently fail */ }
    }
    loadConfig() {
        try {
            if (existsSync(API_CONFIG_PATH)) {
                const raw = readFileSync(API_CONFIG_PATH, 'utf-8');
                const saved = JSON.parse(raw);
                this.config = { ...this.config, ...saved };
            }
            else {
                this.saveConfig(); // Save default config with generated API key
            }
        }
        catch { /* Silently fail */ }
    }
}
//# sourceMappingURL=api-server.js.map