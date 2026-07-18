// ============================================================
// NeuroCLI - Base Agent
// Foundation class for all agents
// ============================================================
import { MODELS } from '../api/models.js';
export class BaseAgent {
    config;
    client;
    registry;
    workingDirectory;
    sessionId;
    messages = [];
    constructor(config, client, registry, workingDirectory, sessionId) {
        this.config = config;
        this.client = client;
        this.registry = registry;
        this.workingDirectory = workingDirectory;
        this.sessionId = sessionId;
    }
    get name() {
        return this.config.name;
    }
    get description() {
        return this.config.description;
    }
    /** Access to agent config for model overrides etc. */
    get configModel() {
        return this.config.model;
    }
    set configModel(model) {
        this.config.model = model;
    }
    /**
     * Initialize agent with system prompt and context
     */
    initializeMessages(taskContext) {
        const systemContent = this.buildSystemPrompt(taskContext);
        this.messages = [
            { role: 'system', content: systemContent, timestamp: Date.now() },
        ];
        return this.messages;
    }
    /**
     * Build the system prompt with context
     */
    buildSystemPrompt(taskContext) {
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
    addUserMessage(content) {
        this.messages.push({ role: 'user', content, timestamp: Date.now() });
    }
    /**
     * Add an assistant message
     */
    addAssistantMessage(content, toolCalls) {
        this.messages.push({ role: 'assistant', content, toolCalls, timestamp: Date.now() });
    }
    /**
     * Add a tool result message
     */
    addToolResult(toolCallId, content, name, isError = false) {
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
    async run(task, callbacks, maxIterations) {
        const maxIter = maxIterations || this.config.maxIterations || 10;
        const startTime = Date.now();
        let totalUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
        let toolCallsMade = 0;
        let iteration = 0;
        const execution = {
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
            const streamCallbacks = {
                onToken: (token) => callbacks?.onToken?.(token),
                onThinking: (thinking) => callbacks?.onThinking?.(thinking),
                onToolCall: (tc) => {
                    let args = {};
                    try {
                        args = JSON.parse(tc.function.arguments);
                    }
                    catch { /* malformed LLM args */ }
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
                    stream: false, // Disable streaming for better compatibility with free models
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
                    let args;
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    }
                    catch {
                        args = {};
                    }
                    const toolName = toolCall.function.name;
                    toolCallsMade++;
                    callbacks?.onToolCall?.(toolName, args);
                    // Check if approval is needed
                    const needsApproval = this.registry.getApprovalRequest(toolName, args);
                    if (needsApproval && this.config.autoApprove !== true) {
                        const approved = await callbacks?.onApprovalNeeded?.(toolName, args, needsApproval.risk) ?? true; // Default to approve if no callback
                        if (!approved) {
                            this.addToolResult(toolCall.id, 'User denied this tool call.', toolName);
                            callbacks?.onToolResult?.(toolName, 'Denied by user', false);
                            continue;
                        }
                    }
                    // Execute tool
                    const toolContext = {
                        workingDirectory: this.workingDirectory,
                        sessionId: this.sessionId,
                        agentName: this.config.name,
                        onProgress: (msg) => callbacks?.onThinking?.(msg),
                    };
                    const result = await this.registry.execute(toolName, args, toolContext);
                    // Use the original tool_call_id from the assistant's tool call, not the registry's generated one
                    this.addToolResult(toolCall.id, result.content, toolName, result.isError);
                    callbacks?.onToolResult?.(toolName, result.content, result.isError || false);
                }
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                this.addAssistantMessage(`Error encountered: ${errMsg}`);
                execution.status = 'failed';
                execution.result = errMsg;
                break;
            }
        }
        if (iteration > maxIter && execution.status === 'running') {
            execution.status = 'completed';
            execution.result = `Max iterations reached (${maxIter}). The task may not be fully completed. Consider using a higher effort level or switching to /orchestrate mode for complex tasks.`;
        }
        execution.endTime = Date.now();
        execution.iterations = iteration;
        execution.tokensUsed = totalUsage.inputTokens + totalUsage.outputTokens;
        const result = {
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
    async query(prompt) {
        try {
            const messages = [
                { role: 'system', content: this.config.systemPrompt, timestamp: Date.now() },
                { role: 'user', content: prompt, timestamp: Date.now() },
            ];
            const response = await this.client.quickChat(this.config.model || 'anthropic/claude-sonnet-4', messages);
            return response.content;
        }
        catch (error) {
            return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}
//# sourceMappingURL=base.js.map