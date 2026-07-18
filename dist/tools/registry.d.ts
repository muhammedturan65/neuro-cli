import { ToolDefinition, ToolResult, ApprovalRequest } from '../core/types.js';
export interface ToolExecutor {
    name: string;
    definition?: ToolDefinition;
    description?: string;
    parameters?: ToolDefinition['parameters'];
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
export declare class ToolRegistry {
    private tools;
    register(tool: ToolExecutor): void;
    unregister(name: string): void;
    get(name: string): ToolExecutor | undefined;
    getAll(): ToolExecutor[];
    getDefinitions(toolNames?: string[]): ToolDefinition[];
    execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
    getApprovalRequest(name: string, args: Record<string, unknown>): ApprovalRequest | null;
    has(name: string): boolean;
}
export declare const globalRegistry: ToolRegistry;
//# sourceMappingURL=registry.d.ts.map