import { Theme } from './theme.js';
import { TokenUsage } from '../core/types.js';
export declare class TerminalUI {
    theme: Theme;
    private showTokens;
    private showCost;
    private isStreaming;
    version: string;
    constructor(themeName?: string, showTokens?: boolean, showCost?: boolean);
    setVersion(v: string): void;
    banner(): void;
    userMessage(content: string): void;
    assistantMessage(content: string): void;
    streamingToken(token: string): void;
    startStreaming(): void;
    endStreaming(): void;
    thinking(message: string): void;
    toolCall(name: string, args: Record<string, unknown>): void;
    private formatToolArgs;
    toolResult(name: string, result: string, isError: boolean): void;
    approvalRequest(toolName: string, args: Record<string, unknown>, risk: 'low' | 'medium' | 'high'): boolean;
    tokenUsage(usage: TokenUsage, modelId: string): void;
    sessionStats(totalInput: number, totalOutput: number, totalCost: number): void;
    agentActivity(agentName: string, status: 'starting' | 'working' | 'done' | 'error'): void;
    error(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warning(message: string): void;
    separator(): void;
    codeBlock(code: string, language?: string): void;
    modelList(selectedModel: string): void;
    agentList(agents: Array<{
        name: string;
        description: string;
        model: string;
    }>): void;
    diffAdd(line: string): void;
    diffRemove(line: string): void;
    diffContext(line: string): void;
    diffHeader(file: string): void;
    private truncate;
    private byteSize;
}
//# sourceMappingURL=renderer.d.ts.map