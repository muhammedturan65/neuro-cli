// ============================================================
// NeuroCLI - Tool Registry
// Central tool management and execution system
// ============================================================

import { ToolDefinition, ToolResult, ApprovalRequest } from '../core/types.js';

export interface ToolExecutor {
  name: string;
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
  getApprovalRequest?: (args: Record<string, unknown>) => ApprovalRequest;
  risk: 'low' | 'medium' | 'high';
}

export interface ToolContext {
  workingDirectory: string;
  sessionId: string;
  agentName: string;
  onProgress?: (message: string) => void;
}

export class ToolRegistry {
  private tools: Map<string, ToolExecutor> = new Map();

  register(tool: ToolExecutor): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolExecutor | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolExecutor[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(toolNames?: string[]): ToolDefinition[] {
    if (toolNames) {
      return toolNames
        .map(name => this.tools.get(name)?.definition)
        .filter((d): d is ToolDefinition => d !== undefined);
    }
    return this.getAll().map(t => t.definition);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        toolCallId: `error_${Date.now()}`,
        content: `Unknown tool: ${name}`,
        isError: true,
      };
    }

    try {
      const content = await tool.execute(args, context);
      return {
        toolCallId: `tool_${Date.now()}`,
        content,
        isError: false,
      };
    } catch (error) {
      return {
        toolCallId: `error_${Date.now()}`,
        content: `Tool execution error (${name}): ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  getApprovalRequest(name: string, args: Record<string, unknown>): ApprovalRequest | null {
    const tool = this.tools.get(name);
    if (!tool || !tool.getApprovalRequest) return null;
    return tool.getApprovalRequest(args);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

// Global singleton
export const globalRegistry = new ToolRegistry();
