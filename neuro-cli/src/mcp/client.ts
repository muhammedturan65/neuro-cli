// ============================================================
// NeuroCLI - MCP (Model Context Protocol) Client
// Full MCP support: stdio, SSE, HTTP transports
// ============================================================

import { ChildProcess, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ToolDefinition } from '../core/types.js';

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
  private servers: Map<string, MCPServerConfig> = new Map();
  private inputBuffers: Map<string, string> = new Map();
  private configPath: string;

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

  listServers(): Array<{ name: string; config: MCPServerConfig; connected: boolean; toolCount: number }> {
    const cfg = this.loadConfig();
    const result: Array<{ name: string; config: MCPServerConfig; connected: boolean; toolCount: number }> = [];
    for (const [name, config] of Object.entries(cfg.mcpServers)) {
      result.push({ name, config, connected: this.processes.has(name), toolCount: this.tools.get(name)?.length || 0 });
    }
    return result;
  }

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

  async connect(name: string, config: MCPServerConfig): Promise<void> {
    if (this.processes.has(name)) await this.disconnect(name);
    this.servers.set(name, config);
    if (config.transport === 'stdio') {
      await this.connectStdio(name, config);
    }
    await this.initialize(name);
  }

  private async connectStdio(name: string, config: MCPServerConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...config.env };
      const proc = spawn(config.command!, config.args || [], { env, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
      let initialized = false;
      const timeout = setTimeout(() => { if (!initialized) { reject(new Error(`MCP server ${name} initialization timed out`)); proc.kill(); } }, config.timeout || 30000);

      proc.stdout!.on('data', (data: Buffer) => {
        const chunk = data.toString();
        const existing = this.inputBuffers.get(name) || '';
        this.inputBuffers.set(name, existing + chunk);
        let buffer = this.inputBuffers.get(name)!;
        const lines = buffer.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line) { try { const response = JSON.parse(line); this.handleResponse(name, response); } catch {} }
        }
        this.inputBuffers.set(name, lines[lines.length - 1]);
      });

      proc.on('error', (err) => { clearTimeout(timeout); this.processes.delete(name); if (!initialized) reject(err); });
      proc.on('exit', () => { clearTimeout(timeout); this.processes.delete(name); });
      this.processes.set(name, proc);
      initialized = true;
      clearTimeout(timeout);
      resolve();
    });
  }

  async disconnect(name: string): Promise<void> {
    const proc = this.processes.get(name);
    if (proc) { proc.kill(); this.processes.delete(name); }
    this.tools.delete(name); this.resources.delete(name); this.servers.delete(name); this.inputBuffers.delete(name);
  }

  async disconnectAll(): Promise<void> {
    for (const name of Array.from(this.processes.keys())) await this.disconnect(name);
  }

  private async initialize(name: string): Promise<void> {
    try {
      await this.sendRequest(name, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'neuro-cli', version: '1.0.0' } });
      await this.sendNotification(name, 'notifications/initialized', {});
      try { const toolsResult = await this.sendRequest(name, 'tools/list', {}) as { tools: MCPTool[] }; this.tools.set(name, toolsResult.tools || []); } catch {}
      try { const resourcesResult = await this.sendRequest(name, 'resources/list', {}) as { resources: MCPResource[] }; this.resources.set(name, resourcesResult.resources || []); } catch {}
    } catch (error) { console.error(`MCP: Failed to initialize ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const config = this.servers.get(serverName);
    if (config?.transport === 'sse' || config?.transport === 'http') return this.callToolHTTP(serverName, toolName, args);
    return this.sendRequest(serverName, 'tools/call', { name: toolName, arguments: args });
  }

  private async callToolHTTP(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const config = this.servers.get(serverName);
    if (!config?.url) throw new Error(`No URL for MCP server ${serverName}`);
    const response = await fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...config.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name: toolName, arguments: args } }) });
    const data = await response.json() as JSONRPCResponse;
    if (data.error) throw new Error(`MCP error from ${serverName}: ${data.error.message}`);
    return data.result;
  }

  private sendRequest(serverName: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const proc = this.processes.get(serverName);
    if (!proc || !proc.stdin?.writable) return Promise.reject(new Error(`MCP server ${serverName} not connected`));
    const id = this.nextId++;
    const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pendingRequests.delete(id); reject(new Error(`MCP request to ${serverName} timed out`)); }, this.servers.get(serverName)?.timeout || 30000);
      this.pendingRequests.set(id, { resolve, reject, timer: timeout });
      proc.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private async sendNotification(serverName: string, method: string, params: Record<string, unknown>): Promise<void> {
    const proc = this.processes.get(serverName);
    if (!proc || !proc.stdin?.writable) return;
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  private handleResponse(_serverName: string, response: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pendingRequests.delete(response.id);
    if (response.error) pending.reject(new Error(response.error.message)); else pending.resolve(response.result);
  }

  getAllTools(): Array<{ serverName: string; tool: MCPTool }> {
    const result: Array<{ serverName: string; tool: MCPTool }> = [];
    for (const [serverName, tools] of this.tools) for (const tool of tools) result.push({ serverName, tool });
    return result;
  }

  getToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const [serverName, tools] of this.tools) {
      for (const tool of tools) {
        definitions.push({
          name: `mcp_${serverName}__${tool.name}`,
          description: `[MCP:${serverName}] ${tool.description}`,
          parameters: { type: 'object', properties: (tool.inputSchema.properties || {}) as Record<string, { type: string; description: string; enum?: string[] }>, required: tool.inputSchema.required || [] },
        });
      }
    }
    return definitions;
  }

  parseMCPToolName(fullName: string): { serverName: string; toolName: string } | null {
    if (!fullName.startsWith('mcp_')) return null;
    const rest = fullName.slice(4);
    const sep = rest.indexOf('__');
    if (sep === -1) return null;
    return { serverName: rest.slice(0, sep), toolName: rest.slice(sep + 2) };
  }

  isConnected(name: string): boolean { return this.processes.has(name); }
  getServerNames(): string[] { return Array.from(this.servers.keys()); }
}
