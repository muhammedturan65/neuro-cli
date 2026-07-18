import { Theme } from './theme.js';
import { TokenUsage } from '../core/types.js';
export declare class TerminalUI {
    theme: Theme;
    private showTokens;
    private showCost;
    constructor(themeName?: string, showTokens?: boolean, showCost?: boolean);
    /**
     * Print the banner / splash screen
     */
    banner(): void;
    /**
     * Print user message
     */
    userMessage(content: string): void;
    /**
     * Print assistant message with markdown-like formatting
     */
    assistantMessage(content: string): void;
    /**
     * Print streaming token
     */
    streamingToken(token: string): void;
    /**
     * Start streaming block
     */
    startStreaming(): void;
    /**
     * End streaming block
     */
    endStreaming(): void;
    /**
     * Print thinking indicator
     */
    thinking(message: string): void;
    /**
     * Print tool call
     */
    toolCall(name: string, args: Record<string, unknown>): void;
    /**
     * Print tool result
     */
    toolResult(name: string, result: string, isError: boolean): void;
    /**
     * Print approval request
     */
    approvalRequest(toolName: string, args: Record<string, unknown>, risk: 'low' | 'medium' | 'high'): boolean;
    /**
     * Print token usage
     */
    tokenUsage(usage: TokenUsage, modelId: string): void;
    /**
     * Print session stats
     */
    sessionStats(totalInput: number, totalOutput: number, totalCost: number): void;
    /**
     * Print agent activity
     */
    agentActivity(agentName: string, status: 'starting' | 'working' | 'done' | 'error'): void;
    /**
     * Print error
     */
    error(message: string): void;
    /**
     * Print info
     */
    info(message: string): void;
    /**
     * Print success
     */
    success(message: string): void;
    /**
     * Print warning
     */
    warning(message: string): void;
    /**
     * Print separator
     */
    separator(): void;
    /**
     * Print code block
     */
    codeBlock(code: string, language?: string): void;
    /**
     * Print model selection menu
     */
    modelList(selectedModel: string): void;
    /**
     * Print agent list
     */
    agentList(agents: Array<{
        name: string;
        description: string;
        model: string;
    }>): void;
}
//# sourceMappingURL=renderer.d.ts.map