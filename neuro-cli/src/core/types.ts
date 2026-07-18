// ============================================================
// NeuroCLI - Advanced AI Terminal Coding Assistant
// Core Types & Interfaces - v2.0 with all new features
// ============================================================

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
  inputPrice: number;  // per 1M tokens
  outputPrice: number; // per 1M tokens
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

// Permission mode types
export type PermissionMode = 'manual' | 'auto' | 'plan' | 'yolo';

// Fallback model chain
export interface FallbackModelChain {
  models: string[];
  maxRetries: number;
  retryDelayMs: number;
}

// Doom loop protection config
export interface DoomLoopConfig {
  maxConsecutiveErrors: number;
  maxRepetitiveActions: number;
  similarityThreshold: number;
  autoBreak: boolean;
}

// Headless/CI mode options
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

// MCP server config
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

// Sandbox configuration type
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

// Prompt cache configuration
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

// Session export format
export interface SessionExport {
  version: string;
  exportedAt: number;
  session: Session;
  neuroVersion: string;
}
