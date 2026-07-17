// ============================================================
// NeuroCLI - Base Agent
// Foundation class for all agents
// ============================================================

import { Message, ToolCall, AgentConfig, AgentExecution } from '../core/types.js';
import { OpenRouterClient, StreamCallbacks, TokenUsage } from '../api/openrouter.js';
import { ToolRegistry, ToolContext } from '../tools/registry.js';
import { MODELS } from '../api/models.js';

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

export class BaseAgent {
  protected config: AgentConfig;
  protected client: OpenRouterClient;
  protected registry: ToolRegistry;
  protected workingDirectory: string;
  protected sessionId: string;
  protected messages: Message[] = [];

  constructor(
    config: AgentConfig,
    client: OpenRouterClient,
    registry: ToolRegistry,
    workingDirectory: string,
    sessionId: string,
  ) {
    this.config = config;
    this.client = client;
    this.registry = registry;
    this.workingDirectory = workingDirectory;
    this.sessionId = sessionId;
  }

  get name(): string {
    return this.config.name;
  }

  get description(): string {
    return this.config.description;
  }

  /**
   * Initialize agent with system prompt and context
   */
  protected initializeMessages(taskContext?: string): Message[] {
    const systemContent = this.buildSystemPrompt(taskContext);
    this.messages = [
      { role: 'system', content: systemContent, timestamp: Date.now() },
    ];
    return this.messages;
  }

  /**
   * Build the system prompt with context
   */
  protected buildSystemPrompt(taskContext?: string): string {
    const model = MODELS[this.config.model || ''];
    const cwd = this.workingDirectory;

    let prompt = this.config.systemPrompt;
    prompt += `\n\n## Environment`;
    prompt += `\n- Working Directory: ${cwd}`;
    prompt += `\n- Current Model: ${model?.name || this.config.model}`;
    prompt += `\n- Agent: ${this.config.name} (${this.config.description})`;
    prompt += `\n- Available Tools: ${(this.config.tools || []).join(', ')}`;

    if (taskContext) {
      prompt += `\n\n## Task Context\n${taskContext}`;
    }

    prompt += `\n\n## Guidelines
- Be precise and thorough in your responses
- Use tools to verify your assumptions before making changes
- When modifying files, make minimal, targeted changes
- Always read a file before editing it
- Report what you've done and what still needs to be done
- If you encounter errors, analyze them before retrying
- Do NOT repeat the same action if it failed - try a different approach`;

    return prompt;
  }

  /**
   * Add a user message to the conversation
   */
  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content, timestamp: Date.now() });
  }

  /**
   * Add an assistant message
   */
  protected addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    this.messages.push({ role: 'assistant', content, toolCalls, timestamp: Date.now() });
  }

  /**
   * Add a tool result message
   */
  protected addToolResult(toolCallId: string, content: string, name: string, isError: boolean = false): void {
    this.messages.push({
      role: 'tool',
      content: isError ? `ERROR: ${content}` : content,
      toolCallId,
      name,
      timestamp: Date.now(),
    });
  }

  /**
   * Run the agent loop
   */
  async run(
    task: string,
    callbacks?: AgentCallbacks,
    maxIterations?: number,
  ): Promise<AgentRunResult> {
    const maxIter = maxIterations || this.config.maxIterations || 10;
    const startTime = Date.now();
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
    let toolCallsMade = 0;
    let iteration = 0;

    const execution: AgentExecution = {
      agentName: this.config.name,
      task,
      startTime,
      iterations: 0,
      tokensUsed: 0,
      status: 'running',
    };

    // Initialize messages
    this.initializeMessages();
    this.addUserMessage(task);

    for (iteration = 1; iteration <= maxIter; iteration++) {
      callbacks?.onIteration?.(iteration, maxIter);

      // Get tool definitions for this agent
      const toolDefs = this.registry.getDefinitions(this.config.tools);

      // Prepare stream callbacks
      const streamCallbacks: StreamCallbacks = {
        onToken: (token) => callbacks?.onToken?.(token),
        onThinking: (thinking) => callbacks?.onThinking?.(thinking),
        onToolCall: (tc) => callbacks?.onToolCall?.(tc.function.name, JSON.parse(tc.function.arguments)),
      };

      // Call LLM
      try {
        const response = await this.client.chat({
          model: this.config.model || 'anthropic/claude-sonnet-4',
          messages: this.messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        }, streamCallbacks);

        totalUsage.inputTokens += response.usage.inputTokens;
        totalUsage.outputTokens += response.usage.outputTokens;
        totalUsage.cost += response.usage.cost;

        // If no tool calls, we're done
        if (response.toolCalls.length === 0) {
          this.addAssistantMessage(response.content);
          execution.status = 'completed';
          execution.result = response.content;
          break;
        }

        // Process tool calls
        this.addAssistantMessage(response.content, response.toolCalls);

        for (const toolCall of response.toolCalls) {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = {};
          }

          const toolName = toolCall.function.name;
          toolCallsMade++;

          callbacks?.onToolCall?.(toolName, args);

          // Check if approval is needed
          const needsApproval = this.registry.getApprovalRequest(toolName, args);
          if (needsApproval && this.config.autoApprove !== true) {
            const approved = await callbacks?.onApprovalNeeded?.(
              toolName, args, needsApproval.risk
            ) ?? true; // Default to approve if no callback

            if (!approved) {
              this.addToolResult(toolCall.id, 'User denied this tool call.', toolName);
              callbacks?.onToolResult?.(toolName, 'Denied by user', false);
              continue;
            }
          }

          // Execute tool
          const toolContext: ToolContext = {
            workingDirectory: this.workingDirectory,
            sessionId: this.sessionId,
            agentName: this.config.name,
            onProgress: (msg) => callbacks?.onThinking?.(msg),
          };

          const result = await this.registry.execute(toolName, args, toolContext);
          this.addToolResult(result.toolCallId, result.content, toolName, result.isError);
          callbacks?.onToolResult?.(toolName, result.content, result.isError || false);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.addAssistantMessage(`Error encountered: ${errMsg}`);
        execution.status = 'failed';
        execution.result = errMsg;
        break;
      }
    }

    if (iteration > maxIter) {
      execution.status = 'completed';
      execution.result = 'Max iterations reached';
    }

    execution.endTime = Date.now();
    execution.iterations = iteration;
    execution.tokensUsed = totalUsage.inputTokens + totalUsage.outputTokens;

    const result: AgentRunResult = {
      content: this.messages.filter(m => m.role === 'assistant' && !m.toolCalls?.length).pop()?.content || '',
      toolCallsMade,
      iterations: iteration,
      usage: totalUsage,
      execution,
    };

    callbacks?.onComplete?.(result);
    return result;
  }

  /**
   * Quick single-turn query (no tool loop)
   */
  async query(prompt: string): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: this.config.systemPrompt, timestamp: Date.now() },
      { role: 'user', content: prompt, timestamp: Date.now() },
    ];

    const response = await this.client.quickChat(
      this.config.model || 'anthropic/claude-sonnet-4',
      messages,
    );

    return response.content;
  }
}
