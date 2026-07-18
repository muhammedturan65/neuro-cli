import { Message, ToolCall, AgentConfig, AgentExecution } from '../core/types.js';
import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { ToolRegistry } from '../tools/registry.js';
export interface AgentRunResult {
    content: string;
    toolCallsMade: number;
    iterations: number;
    usage: TokenUsage;
    execution: AgentExecution;
}
export interface AgentCallbacks {
    onThinking?: (thinking: string) => void;
    onToken?: (token: string) => void;
    onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
    onToolResult?: (toolName: string, result: string, isError: boolean) => void;
    onApprovalNeeded?: (toolName: string, args: Record<string, unknown>, risk: string) => Promise<boolean>;
    onIteration?: (iteration: number, maxIterations: number) => void;
    onComplete?: (result: AgentRunResult) => void;
}
export declare class BaseAgent {
    protected config: AgentConfig;
    protected client: OpenRouterClient;
    protected registry: ToolRegistry;
    protected workingDirectory: string;
    protected sessionId: string;
    protected messages: Message[];
    constructor(config: AgentConfig, client: OpenRouterClient, registry: ToolRegistry, workingDirectory: string, sessionId: string);
    get name(): string;
    get description(): string;
    /** Access to agent config for model overrides etc. */
    get configModel(): string | undefined;
    set configModel(model: string | undefined);
    /**
     * Initialize agent with system prompt and context
     */
    protected initializeMessages(taskContext?: string): Message[];
    /**
     * Build the system prompt with context
     */
    protected buildSystemPrompt(taskContext?: string): string;
    /**
     * Add a user message to the conversation
     */
    addUserMessage(content: string): void;
    /**
     * Add an assistant message
     */
    protected addAssistantMessage(content: string, toolCalls?: ToolCall[]): void;
    /**
     * Add a tool result message
     */
    protected addToolResult(toolCallId: string, content: string, name: string, isError?: boolean): void;
    /**
     * Run the agent loop
     */
    run(task: string, callbacks?: AgentCallbacks, maxIterations?: number): Promise<AgentRunResult>;
    /**
     * Quick single-turn query (no tool loop)
     */
    query(prompt: string): Promise<string>;
}
//# sourceMappingURL=base.d.ts.map