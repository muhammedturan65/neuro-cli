// ============================================================
// NeuroCLI - Base Agent v5.0 (Claude Code-style Agentic Loop)
// Foundation class for all agents
// Key changes:
//   - No arbitrary iteration limits; loops until task is complete
//   - Self-evaluation after each LLM turn (is the task done?)
//   - Error recovery with alternative approaches
//   - Continuous tool chaining until the model says "I'm done"
//   - Doom-loop detection replaces hard iteration caps
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
  /** Called when the agent starts a new agentic cycle */
  onCycleStart?: (cycle: number, summary: string) => void;
  /** Called when the agent detects task completion */
  onTaskComplete?: (reason: string) => void;
  /** Signal to abort the agent loop (e.g. user pressed Ctrl+C) */
  abortSignal?: AbortSignal;
}

// Patterns that indicate the model considers the task complete
const TASK_COMPLETE_PATTERNS = [
  /\b(task|job|work|mission|assignment)\s+(is\s+)?(complete|done|finished|accomplished|fulfilled)\b/i,
  /\bi('ve| have)\s+(completed|finished|done|accomplished)\b/i,
  /\b(all|every)\s+(the\s+)?(task|step|item|file|change|modification)s?\s+(are|is|have been)\s+(done|complete|applied|made|created)\b/i,
  /\bnothing\s+(more|else)\s+(to\s+)?(do|change|modify|update)\b/i,
  /\beverything\s+(is\s+)?(done|complete|ready|set|in\s+place)\b/i,
];

// Patterns that indicate the model is still working
const STILL_WORKING_PATTERNS = [
  /\b(next|then|now|i\s+need\s+to|i\s+should|i\s+will|let\s+me)\b/i,
  /\b(create|write|modify|edit|update|add|remove|delete|fix|implement|refactor|install)\b/i,
  /\b(read|check|verify|test|run|execute|search|find|look)\b/i,
];

export class BaseAgent {
  protected config: AgentConfig;
  protected client: OpenRouterClient;
  protected registry: ToolRegistry;
  protected workingDirectory: string;
  protected sessionId: string;
  protected messages: Message[] = [];

  // Track repetitive actions for doom-loop detection
  private lastToolCalls: string[] = [];
  private repeatedActionCount = 0;
  private static readonly MAX_REPEATED_ACTIONS = 4;
  private static readonly MAX_CONSECUTIVE_ERRORS = 5;
  // Safety ceiling: prevent truly infinite loops (extremely high, only for runaway agents)
  private static readonly ABSOLUTE_MAX_CYCLES = 500;

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

  /** Access to agent config for model overrides etc. */
  get configModel(): string | undefined {
    return this.config.model;
  }

  set configModel(model: string | undefined) {
    this.config.model = model;
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
   * Build the system prompt with context — Claude Code-style
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

    // Claude Code-style guidelines: work until the task is TRULY done
    prompt += `\n\n## Critical Operating Guidelines
- You MUST continue working until the ENTIRE task is complete — do not stop after partial progress
- After each tool call, evaluate: "Is the task fully done? If not, what's the next step?"
- If a tool call fails, try a DIFFERENT approach — never repeat the exact same failed action
- If you encounter an error, analyze it, understand the root cause, and fix it before moving on
- When creating or modifying files, verify your changes by reading the file back
- When implementing features, check that all related files are updated consistently
- Be thorough: create ALL necessary files, update ALL relevant imports, handle ALL edge cases
- Do NOT say "I've completed the task" unless you have verified everything works
- Chain tools naturally: read → understand → plan → implement → verify → continue if needed
- If you realize the task requires more work than initially thought, KEEP GOING
- Never use phrases like "the rest is left as an exercise" or "you can continue from here"
- Your job is to deliver a COMPLETE, WORKING solution — not a partial outline`;

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
   * Detect if the model's response indicates the task is complete
   */
  private isTaskComplete(response: string, hasToolCalls: boolean): boolean {
    // If the model is still calling tools, it's not done
    if (hasToolCalls) return false;

    // Check for explicit completion signals
    for (const pattern of TASK_COMPLETE_PATTERNS) {
      if (pattern.test(response)) return true;
    }

    // If no tool calls and the response contains "still working" patterns, it might be stuck
    // But if there are no tool calls and no "still working" patterns, assume done
    const hasWorkingSignals = STILL_WORKING_PATTERNS.some(p => p.test(response));
    if (!hasWorkingSignals && !hasToolCalls) {
      // No tool calls + no "still working" language = probably done
      return true;
    }

    return false;
  }

  /**
   * Detect doom-loop: same tool+args repeated too many times
   */
  private detectDoomLoop(toolName: string, args: Record<string, unknown>): boolean {
    const callSig = `${toolName}:${JSON.stringify(args)}`;
    if (this.lastToolCalls.length >= BaseAgent.MAX_REPEATED_ACTIONS &&
        this.lastToolCalls.slice(-BaseAgent.MAX_REPEATED_ACTIONS).every(c => c === callSig)) {
      this.repeatedActionCount++;
      if (this.repeatedActionCount >= BaseAgent.MAX_REPEATED_ACTIONS) {
        return true;
      }
    } else {
      this.repeatedActionCount = 0;
    }
    this.lastToolCalls.push(callSig);
    // Keep only recent history
    if (this.lastToolCalls.length > 20) {
      this.lastToolCalls = this.lastToolCalls.slice(-20);
    }
    return false;
  }

  /**
   * Run the agent loop — Claude Code style: keep going until task is truly done
   */
  async run(
    task: string,
    callbacks?: AgentCallbacks,
    maxIterations?: number,
  ): Promise<AgentRunResult> {
    // maxIterations is now a SOFT ceiling with override for continued work
    // If not specified, we use our absolute max (effectively no limit)
    const softCap = maxIterations || this.config.maxIterations || BaseAgent.ABSOLUTE_MAX_CYCLES;
    const startTime = Date.now();
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
    let toolCallsMade = 0;
    let iteration = 0;
    let consecutiveErrors = 0;

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
    this.lastToolCalls = [];
    this.repeatedActionCount = 0;

    // Main agentic loop — Claude Code style: keep going until done
    for (iteration = 1; iteration <= BaseAgent.ABSOLUTE_MAX_CYCLES; iteration++) {
      // Check abort signal
      if (callbacks?.abortSignal?.aborted) {
        execution.status = 'cancelled';
        execution.result = 'Task cancelled by user';
        break;
      }

      // Report iteration progress (0 means "no fixed limit")
      callbacks?.onIteration?.(iteration, 0);

      // Get tool definitions for this agent
      const toolDefs = this.registry.getDefinitions(this.config.tools);

      // Prepare stream callbacks
      const streamCallbacks: StreamCallbacks = {
        onToken: (token) => callbacks?.onToken?.(token),
        onThinking: (thinking) => callbacks?.onThinking?.(thinking),
        onToolCall: (tc) => {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* malformed LLM args */ }
          callbacks?.onToolCall?.(tc.function.name, args);
        },
      };

      // Call LLM
      try {
        const response = await this.client.chat({
          model: this.config.model || 'qwen/qwen3-coder:free',
          messages: this.messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          stream: false,
        }, streamCallbacks);

        totalUsage.inputTokens += response.usage.inputTokens;
        totalUsage.outputTokens += response.usage.outputTokens;
        totalUsage.cost += response.usage.cost;

        // Reset error counter on successful response
        consecutiveErrors = 0;

        // Check if task is complete (no tool calls + completion signals)
        if (response.toolCalls.length === 0) {
          this.addAssistantMessage(response.content);

          if (this.isTaskComplete(response.content, false)) {
            callbacks?.onTaskComplete?.('Task completed successfully');
            execution.status = 'completed';
            execution.result = response.content;
            break;
          }

          // Model returned text without tool calls but didn't signal completion
          // This might be a summary or partial completion — check if we should continue
          // If the soft cap is reached and there are no tool calls, we're likely done
          if (iteration >= softCap) {
            execution.status = 'completed';
            execution.result = response.content;
            break;
          }

          // Otherwise, add a nudge to continue working
          this.addUserMessage('Continue working on the task. If there is more to do, use your tools. If the task is truly complete, say "Task complete" and summarize what was done.');
          continue;
        }

        // Process tool calls — the agent is still working
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

          // Doom-loop detection
          if (this.detectDoomLoop(toolName, args)) {
            const msg = `Doom loop detected: "${toolName}" called with the same arguments too many times. Breaking the loop.`;
            callbacks?.onThinking?.(msg);
            this.addToolResult(toolCall.id, msg, toolName, true);
            // Add a nudge to try a different approach
            this.addUserMessage('You seem to be stuck in a loop, calling the same tool with the same arguments repeatedly. Try a completely different approach to solve this problem.');
            break;
          }

          callbacks?.onToolCall?.(toolName, args);

          // Check if approval is needed
          const needsApproval = this.registry.getApprovalRequest(toolName, args);
          if (needsApproval && this.config.autoApprove !== true) {
            const approved = await callbacks?.onApprovalNeeded?.(
              toolName, args, needsApproval.risk
            ) ?? true;

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

          try {
            const result = await this.registry.execute(toolName, args, toolContext);
            this.addToolResult(toolCall.id, result.content, toolName, result.isError);
            callbacks?.onToolResult?.(toolName, result.content, result.isError || false);

            // If tool had an error, note it but continue (error recovery)
            if (result.isError) {
              consecutiveErrors++;
              if (consecutiveErrors >= BaseAgent.MAX_CONSECUTIVE_ERRORS) {
                // Add context about repeated failures
                this.addUserMessage(`The last ${consecutiveErrors} tool calls have resulted in errors. Please step back, analyze the situation, and try a completely different approach. Read relevant files first to understand the current state before making changes.`);
                consecutiveErrors = 0; // Reset after nudge
              }
            }
          } catch (toolError) {
            const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
            this.addToolResult(toolCall.id, `Tool execution error: ${errMsg}`, toolName, true);
            callbacks?.onToolResult?.(toolName, errMsg, true);
            consecutiveErrors++;
          }
        }

        // After processing all tool calls for this iteration, report cycle progress
        const cycleSummary = `${toolCallsMade} tools used, iteration ${iteration}`;
        callbacks?.onCycleStart?.(iteration, cycleSummary);

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        consecutiveErrors++;

        // If we've had too many consecutive API errors, stop
        if (consecutiveErrors >= BaseAgent.MAX_CONSECUTIVE_ERRORS) {
          this.addAssistantMessage(`Error encountered: ${errMsg}. Too many consecutive errors, stopping.`);
          execution.status = 'failed';
          execution.result = errMsg;
          break;
        }

        // Otherwise, add error to conversation and let the model try to recover
        this.addAssistantMessage(`Error encountered: ${errMsg}. Retrying...`);
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * consecutiveErrors));
        continue;
      }
    }

    // If we hit the absolute max, mark as completed (not failed — the work might be sufficient)
    if (iteration > BaseAgent.ABSOLUTE_MAX_CYCLES && execution.status === 'running') {
      execution.status = 'completed';
      execution.result = `Agent reached maximum processing cycles (${BaseAgent.ABSOLUTE_MAX_CYCLES}). The task has been worked on extensively. Review the results and provide further instructions if needed.`;
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
    try {
    const messages: Message[] = [
      { role: 'system', content: this.config.systemPrompt, timestamp: Date.now() },
      { role: 'user', content: prompt, timestamp: Date.now() },
    ];

    const response = await this.client.quickChat(
      this.config.model || 'anthropic/claude-sonnet-4',
      messages,
    );

    return response.content;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
