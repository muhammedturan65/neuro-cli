// ============================================================
// NeuroCLI - Advanced AI Terminal Coding Assistant
// Core Types & Interfaces
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
