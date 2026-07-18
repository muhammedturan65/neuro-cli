// ============================================================
// NeuroCLI - MCP (Model Context Protocol) Client
// Full MCP support: stdio, SSE, HTTP transports
// With reconnect, health-check, resource support, and streaming
// ============================================================

import { ChildProcess, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ToolDefinition } from '../core/types.js';
import chalk from 'chalk';

// --- MCP Types ---

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

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// --- MCP Client ---

export class MCPClient {
  private processes: Map<string, ChildProcess> = new Map();
  private nextId = 1;
  private pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
  private tools: Map<string, MCPTool[]> = new Map();
  private resources: Map<string, MCPResource[]> = new Map();
  private prompts: Map<string, MCPPrompt[]> = new Map();
  private servers: Map<string, MCPServerConfig> = new Map();
  private inputBuffers: Map<string, string> = new Map();
  private configPath: string;
  private connectionStates: Map<string, MCPConnectionState> = new Map();
  private healthCheckTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private eventSource: Map<string, { close: () => void }> = new Map();
  private sseEventHandlers: Map<string, (event: string, data: string) => void> = new Map();

  constructor(configPath?: string) {
    this.configPath = configPath || join(homedir(), '.neuro', 'mcp.json');
  }

  loadConfig(): MCPConfig {
    const projectConfig = join(process.cwd(), '.neuro', 'mcp.json');
    const paths = [projectConfig, this.configPath];
    let merged: MCPConfig = { mcpServers: {} };
    for (const p of paths) {
      if (existsSync(p)) {
        try {
          const data = JSON.parse(readFileSync(p, 'utf-8'));
          if (data.mcpServers) Object.assign(merged.mcpServers, data.mcpServers);
        } catch {}
      }
    }
    return merged;
  }

  saveConfig(config: MCPConfig, global: boolean = true): void {
    const path = global ? this.configPath : join(process.cwd(), '.neuro', 'mcp.json');
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
  }

  addServer(name: string, config: MCPServerConfig): void {
    const cfg = this.loadConfig();
    cfg.mcpServers[name] = config;
    this.saveConfig(cfg);
  }

  removeServer(name: string): boolean {
    const cfg = this.loadConfig();
    if (!cfg.mcpServers[name]) return false;
    delete cfg.mcpServers[name];
    this.saveConfig(cfg);
    return true;
  }

  listServers(): Array<{ name: string; config: MCPServerConfig; connected: boolean; toolCount: number; resourceCount: number }> {
    const cfg = this.loadConfig();
    const result: Array<{ name: string; config: MCPServerConfig; connected: boolean; toolCount: number; resourceCount: number }> = [];
    for (const [name, config] of Object.entries(cfg.mcpServers)) {
      result.push({
        name,
        config,
        connected: this.processes.has(name) || this.eventSource.has(name),
        toolCount: this.tools.get(name)?.length || 0,
        resourceCount: this.resources.get(name)?.length || 0,
      });
    }
    return result;
  }

  // --- Connection State ---

  getConnectionStates(): MCPConnectionState[] {
    return Array.from(this.connectionStates.values());
  }

  getConnectionState(name: string): MCPConnectionState | undefined {
    return this.connectionStates.get(name);
  }

  private setConnectionState(name: string, status: MCPConnectionState['status'], error?: string): void {
    const existing = this.connectionStates.get(name);
    this.connectionStates.set(name, {
      name,
      status,
      lastConnected: status === 'connected' ? Date.now() : existing?.lastConnected,
      lastError: error || existing?.lastError,
      reconnectAttempts: status === 'reconnecting' ? (existing?.reconnectAttempts || 0) + 1 : 0,
      toolCount: this.tools.get(name)?.length || 0,
      resourceCount: this.resources.get(name)?.length || 0,
      promptCount: this.prompts.get(name)?.length || 0,
    });
  }

  // --- Health Check ---

  private startHealthCheck(name: string): void {
    this.stopHealthCheck(name);
    const config = this.servers.get(name);
    if (!config) return;

    const interval = config.healthCheckIntervalMs || 60000;
    const timer = setInterval(async () => {
      try {
        await this.sendRequest(name, 'ping', {});
        this.setConnectionState(name, 'connected');
      } catch {
        this.setConnectionState(name, 'error', 'Health check failed');
        // Attempt reconnect if auto-reconnect is enabled
        if (config.autoReconnect !== false) {
          this.attemptReconnect(name, config);
        }
      }
    }, interval);

    this.healthCheckTimers.set(name, timer);
  }

  private stopHealthCheck(name: string): void {
    const timer = this.healthCheckTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(name);
    }
  }

  // --- Reconnect ---

  private attemptReconnect(name: string, config: MCPServerConfig): void {
    const state = this.connectionStates.get(name);
    const maxAttempts = config.maxReconnectAttempts || 3;
    if (state && state.reconnectAttempts >= maxAttempts) {
      this.setConnectionState(name, 'error', `Max reconnect attempts (${maxAttempts}) reached`);
      return;
    }

    this.setConnectionState(name, 'reconnecting');
    const delay = Math.min(1000 * Math.pow(2, state?.reconnectAttempts || 0), 30000);

    // Clear existing reconnect timer
    const existingTimer = this.reconnectTimers.get(name);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
      try {
        console.log(chalk.gray(`  MCP: Reconnecting to ${name}...`));
        await this.connect(name, config);
        console.log(chalk.green(`  MCP: Reconnected to ${name}`));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.setConnectionState(name, 'error', `Reconnect failed: ${errMsg}`);
        // Try again
        this.attemptReconnect(name, config);
      }
    }, delay);

    this.reconnectTimers.set(name, timer);
  }

  // --- Connect All ---

  async connectAll(): Promise<number> {
    const cfg = this.loadConfig();
    let connected = 0;
    for (const [name, config] of Object.entries(cfg.mcpServers)) {
      if (config.disabled) continue;
      try {
        await this.connect(name, config);
        connected++;
      } catch (error) {
        console.error(`MCP: Failed to connect to ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return connected;
  }

  // --- Connect ---

  async connect(name: string, config: MCPServerConfig): Promise<void> {
    if (this.processes.has(name) || this.eventSource.has(name)) {
      await this.disconnect(name);
    }
    this.servers.set(name, config);
    this.setConnectionState(name, 'connecting');

    try {
      if (config.transport === 'stdio') {
        await this.connectStdio(name, config);
      } else if (config.transport === 'sse') {
        await this.connectSSE(name, config);
      } else if (config.transport === 'http') {
        // HTTP doesn't maintain a persistent connection
        this.setConnectionState(name, 'connected');
      }
      await this.initialize(name);
      this.startHealthCheck(name);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.setConnectionState(name, 'error', errMsg);
      throw error;
    }
  }

  // --- stdio Transport ---

  private async connectStdio(name: string, config: MCPServerConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...config.env };
      const proc = spawn(config.command!, config.args || [], { env, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
      let initialized = false;
      const timeout = setTimeout(() => {
        if (!initialized) {
          reject(new Error(`MCP server ${name} initialization timed out`));
          proc.kill();
        }
      }, config.timeout || 30000);

      proc.stdout!.on('data', (data: Buffer) => {
        const chunk = data.toString();
        const existing = this.inputBuffers.get(name) || '';
        this.inputBuffers.set(name, existing + chunk);
        let buffer = this.inputBuffers.get(name)!;
        const lines = buffer.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line) {
            try {
              const response = JSON.parse(line);
              this.handleResponse(name, response);
            } catch {}
          }
        }
        this.inputBuffers.set(name, lines[lines.length - 1]);
      });

      proc.stderr!.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.error(chalk.gray(`  MCP [${name}]: ${msg}`));
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        this.processes.delete(name);
        this.setConnectionState(name, 'error', err.message);
        if (!initialized) reject(err);
        else if (this.servers.get(name)?.autoReconnect !== false) {
          this.attemptReconnect(name, this.servers.get(name)!);
        }
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        this.processes.delete(name);
        if (code !== 0 && code !== null) {
          this.setConnectionState(name, 'error', `Process exited with code ${code}`);
          if (this.servers.get(name)?.autoReconnect !== false) {
            this.attemptReconnect(name, this.servers.get(name)!);
          }
        } else {
          this.setConnectionState(name, 'disconnected');
        }
      });

      this.processes.set(name, proc);
      initialized = true;
      clearTimeout(timeout);
      resolve();
    });
  }

  // --- SSE Transport ---

  private async connectSSE(name: string, config: MCPServerConfig): Promise<void> {
    if (!config.url) throw new Error(`No URL for SSE MCP server ${name}`);

    return new Promise((resolve, reject) => {
      try {
        const url = new URL(config.url!);
        const headers: Record<string, string> = {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...config.headers,
        };

        // Use native fetch for SSE
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`SSE connection to ${name} timed out`));
        }, config.timeout || 30000);

        let resolved = false;

        // Simple SSE client using fetch
        fetch(config.url!, {
          method: 'GET',
          headers,
          signal: controller.signal,
        }).then(async (response) => {
          clearTimeout(timeout);
          if (!response.ok) {
            throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body for SSE');

          const decoder = new TextDecoder();
          let buffer = '';
          let eventType = '';
          let eventData = '';

          // Store the close handler
          this.eventSource.set(name, {
            close: () => {
              controller.abort();
              reader.cancel().catch(() => {});
            }
          });

          this.setConnectionState(name, 'connected');
          resolved = true;
          resolve();

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  eventType = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                  eventData = line.slice(6);
                } else if (line === '' && eventData) {
                  // End of event
                  this.handleSSEEvent(name, eventType, eventData);
                  eventType = '';
                  eventData = '';
                }
              }
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              this.setConnectionState(name, 'error', `SSE stream error: ${error instanceof Error ? error.message : String(error)}`);
              if (this.servers.get(name)?.autoReconnect !== false) {
                this.attemptReconnect(name, this.servers.get(name)!);
              }
            }
          }
        }).catch((error) => {
          clearTimeout(timeout);
          this.setConnectionState(name, 'error', error.message);
          if (!resolved) reject(error);
          else if (this.servers.get(name)?.autoReconnect !== false) {
            this.attemptReconnect(name, this.servers.get(name)!);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleSSEEvent(serverName: string, eventType: string, data: string): void {
    try {
      const parsed = JSON.parse(data);
      if (parsed.jsonrpc && parsed.id !== undefined) {
        this.handleResponse(serverName, parsed as JSONRPCResponse);
      }
    } catch {
      // Not a JSON-RPC response, might be a server notification
      const handler = this.sseEventHandlers.get(serverName);
      if (handler) handler(eventType, data);
    }
  }

  /**
   * Register a custom SSE event handler
   */
  onSSEEvent(serverName: string, handler: (event: string, data: string) => void): void {
    this.sseEventHandlers.set(serverName, handler);
  }

  // --- Disconnect ---

  async disconnect(name: string): Promise<void> {
    this.stopHealthCheck(name);

    const reconnectTimer = this.reconnectTimers.get(name);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(name);
    }

    const es = this.eventSource.get(name);
    if (es) {
      es.close();
      this.eventSource.delete(name);
    }

    const proc = this.processes.get(name);
    if (proc) {
      proc.kill();
      this.processes.delete(name);
    }

    this.tools.delete(name);
    this.resources.delete(name);
    this.prompts.delete(name);
    this.servers.delete(name);
    this.inputBuffers.delete(name);
    this.sseEventHandlers.delete(name);
    this.setConnectionState(name, 'disconnected');
  }

  async disconnectAll(): Promise<void> {
    for (const name of Array.from(this.processes.keys())) await this.disconnect(name);
    for (const name of Array.from(this.eventSource.keys())) await this.disconnect(name);
  }

  // --- Initialize ---

  private async initialize(name: string): Promise<void> {
    try {
      await this.sendRequest(name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: true },
          sampling: {},
        },
        clientInfo: { name: 'neuro-cli', version: '2.0.0' },
      });
      await this.sendNotification(name, 'notifications/initialized', {});

      // List tools
      try {
        const toolsResult = await this.sendRequest(name, 'tools/list', {}) as { tools: MCPTool[] };
        this.tools.set(name, toolsResult.tools || []);
      } catch {}

      // List resources
      try {
        const resourcesResult = await this.sendRequest(name, 'resources/list', {}) as { resources: MCPResource[] };
        this.resources.set(name, resourcesResult.resources || []);
      } catch {}

      // List prompts
      try {
        const promptsResult = await this.sendRequest(name, 'prompts/list', {}) as { prompts: MCPPrompt[] };
        this.prompts.set(name, promptsResult.prompts || []);
      } catch {}

      this.setConnectionState(name, 'connected');
    } catch (error) {
      console.error(`MCP: Failed to initialize ${name}: ${error instanceof Error ? error.message : String(error)}`);
      this.setConnectionState(name, 'error', error instanceof Error ? error.message : String(error));
    }
  }

  // --- Tool Calls ---

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const config = this.servers.get(serverName);
    if (!config) throw new Error(`MCP server ${serverName} not found`);

    if (config.transport === 'http') {
      return this.callToolHTTP(serverName, toolName, args);
    }
    return this.sendRequest(serverName, 'tools/call', { name: toolName, arguments: args });
  }

  private async callToolHTTP(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const config = this.servers.get(serverName);
    if (!config?.url) throw new Error(`No URL for MCP server ${serverName}`);

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });

    const data = await response.json() as JSONRPCResponse;
    if (data.error) throw new Error(`MCP error from ${serverName}: ${data.error.message}`);
    return data.result;
  }

  // --- Resource Access ---

  async readResource(serverName: string, uri: string): Promise<unknown> {
    const config = this.servers.get(serverName);
    if (!config) throw new Error(`MCP server ${serverName} not found`);

    if (config.transport === 'http') {
      const response = await fetch(config.url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...config.headers },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'resources/read',
          params: { uri },
        }),
      });
      const data = await response.json() as JSONRPCResponse;
      if (data.error) throw new Error(`MCP resource error: ${data.error.message}`);
      return data.result;
    }
    return this.sendRequest(serverName, 'resources/read', { uri });
  }

  // --- Prompt Access ---

  async getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<unknown> {
    const config = this.servers.get(serverName);
    if (!config) throw new Error(`MCP server ${serverName} not found`);

    if (config.transport === 'http') {
      const response = await fetch(config.url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...config.headers },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'prompts/get',
          params: { name: promptName, arguments: args || {} },
        }),
      });
      const data = await response.json() as JSONRPCResponse;
      if (data.error) throw new Error(`MCP prompt error: ${data.error.message}`);
      return data.result;
    }
    return this.sendRequest(serverName, 'prompts/get', { name: promptName, arguments: args || {} });
  }

  // --- JSON-RPC Transport ---

  private sendRequest(serverName: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const proc = this.processes.get(serverName);
    if (!proc || !proc.stdin?.writable) {
      // Try SSE
      if (this.eventSource.has(serverName)) {
        return this.sendRequestSSE(serverName, method, params);
      }
      return Promise.reject(new Error(`MCP server ${serverName} not connected`));
    }

    const id = this.nextId++;
    const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request to ${serverName} timed out`));
      }, this.servers.get(serverName)?.timeout || 30000);

      this.pendingRequests.set(id, { resolve, reject, timer: timeout });
      if (proc.stdin) {
        proc.stdin.write(JSON.stringify(request) + '\n');
      } else {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error(`MCP server ${serverName} stdin not available`));
      }
    });
  }

  private async sendRequestSSE(serverName: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const config = this.servers.get(serverName);
    if (!config?.url) throw new Error(`No URL for SSE MCP server ${serverName}`);

    // For SSE transport, we use a separate POST request for sending
    // The response will come back through the SSE stream
    const id = this.nextId++;
    const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };

    // Create a pending request that will be resolved by the SSE handler
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP SSE request to ${serverName} timed out`));
      }, config.timeout || 30000);

      this.pendingRequests.set(id, { resolve, reject, timer: timeout });

      // Send via HTTP POST to the same endpoint
      const postUrl = (config.url || '').replace(/\/sse$/, '/message') || config.url || '';
      fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...config.headers },
        body: JSON.stringify(request),
      }).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  private async sendNotification(serverName: string, method: string, params: Record<string, unknown>): Promise<void> {
    const proc = this.processes.get(serverName);
    if (proc && proc.stdin?.writable) {
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }
    // For SSE/HTTP, notifications are best-effort
  }

  private handleResponse(_serverName: string, response: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);
    if (response.error) pending.reject(new Error(response.error.message));
    else pending.resolve(response.result);
  }

  // --- Tool Definitions for AI ---

  getAllTools(): Array<{ serverName: string; tool: MCPTool }> {
    const result: Array<{ serverName: string; tool: MCPTool }> = [];
    for (const [serverName, tools] of this.tools) {
      for (const tool of tools) result.push({ serverName, tool });
    }
    return result;
  }

  getToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const [serverName, tools] of this.tools) {
      for (const tool of tools) {
        definitions.push({
          name: `mcp_${serverName}__${tool.name}`,
          description: `[MCP:${serverName}] ${tool.description}`,
          parameters: {
            type: 'object',
            properties: (tool.inputSchema.properties || {}) as Record<string, { type: string; description: string; enum?: string[] }>,
            required: tool.inputSchema.required || [],
          },
        });
      }
    }
    return definitions;
  }

  getAllResources(): Array<{ serverName: string; resource: MCPResource }> {
    const result: Array<{ serverName: string; resource: MCPResource }> = [];
    for (const [serverName, resources] of this.resources) {
      for (const resource of resources) result.push({ serverName, resource });
    }
    return result;
  }

  getAllPrompts(): Array<{ serverName: string; prompt: MCPPrompt }> {
    const result: Array<{ serverName: string; prompt: MCPPrompt }> = [];
    for (const [serverName, prompts] of this.prompts) {
      for (const prompt of prompts) result.push({ serverName, prompt });
    }
    return result;
  }

  parseMCPToolName(fullName: string): { serverName: string; toolName: string } | null {
    if (!fullName.startsWith('mcp_')) return null;
    const rest = fullName.slice(4);
    const sep = rest.indexOf('__');
    if (sep === -1) return null;
    return { serverName: rest.slice(0, sep), toolName: rest.slice(sep + 2) };
  }

  isConnected(name: string): boolean {
    return this.processes.has(name) || this.eventSource.has(name);
  }

  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  // --- Diagnostics ---

  /**
   * Print a health report of all MCP connections
   */
  healthReport(): void {
    const states = this.getConnectionStates();
    if (states.length === 0) {
      console.log(chalk.gray('  No MCP servers configured.'));
      return;
    }

    console.log(chalk.bold('\n  MCP Health Report:\n'));
    for (const state of states) {
      const statusIcon = state.status === 'connected' ? chalk.green('●') :
                         state.status === 'connecting' ? chalk.yellow('◎') :
                         state.status === 'reconnecting' ? chalk.yellow('↻') :
                         chalk.red('○');
      const lastConnected = state.lastConnected
        ? new Date(state.lastConnected).toLocaleTimeString()
        : 'never';
      console.log(`  ${statusIcon} ${chalk.cyan(state.name.padEnd(20))} ${state.status.padEnd(15)} tools: ${chalk.green(String(state.toolCount))}  resources: ${chalk.green(String(state.resourceCount))}  prompts: ${chalk.green(String(state.promptCount))}  last: ${chalk.gray(lastConnected)}`);
      if (state.lastError) {
        console.log(`    ${chalk.red('⚠ ' + state.lastError)}`);
      }
    }
    console.log();
  }
}
