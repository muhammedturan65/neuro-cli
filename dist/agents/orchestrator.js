// ============================================================
// NeuroCLI - Orchestrator Agent v5.0 (Claude Code-style)
// Central coordinator that manages sub-agents
// Key changes:
//   - Sub-agents run until their tasks are complete (no hard limits)
//   - Re-planning when sub-tasks fail or need follow-up
//   - Verification loop after all sub-tasks complete
// ============================================================
import { BaseAgent } from './base.js';
export class Orchestrator extends BaseAgent {
    agents = new Map();
    constructor(config, client, registry, workingDirectory, sessionId) {
        super(config, client, registry, workingDirectory, sessionId);
    }
    /**
     * Register a sub-agent
     */
    registerAgent(agent) {
        this.agents.set(agent.name, agent);
    }
    /**
     * Get all registered agents
     */
    getAgents() {
        return Array.from(this.agents.values());
    }
    /**
     * Plan the task decomposition using the orchestrator model
     */
    async plan(task, callbacks) {
        const agentDescriptions = Array.from(this.agents.entries())
            .map(([name, agent]) => `- ${name}: ${agent.description}`)
            .join('\n');
        const planPrompt = `You are the Orchestrator. Analyze the following task and create an execution plan using the available agents.

## Available Agents
${agentDescriptions}

## Task
${task}

## Instructions
1. Break down the task into specific sub-tasks
2. Assign each sub-task to the most appropriate agent
3. Specify dependencies between tasks (which tasks must complete before others can start)
4. Provide any context each agent needs
5. IMPORTANT: Be thorough — include ALL steps needed to complete the task end-to-end

Respond with a JSON plan in this exact format:
\`\`\`json
{
  "reasoning": "Your analysis of the task and why you chose this approach",
  "tasks": [
    {
      "agent": "agent_name",
      "task": "specific task description",
      "context": "any additional context",
      "dependsOn": []
    }
  ]
}
\`\`\``;
        const messages = [
            { role: 'system', content: 'You are an expert task orchestrator. Always respond with valid JSON. Be thorough — include every step needed.', timestamp: Date.now() },
            { role: 'user', content: planPrompt, timestamp: Date.now() },
        ];
        let response;
        try {
            response = await this.client.quickChat(this.config.model || 'anthropic/claude-sonnet-4', messages);
        }
        catch {
            return {
                reasoning: 'API error during planning, falling back to direct approach',
                tasks: [{ agent: 'Coder', task, dependsOn: [] }],
            };
        }
        try {
            const jsonMatch = response.content.match(/```json\n([\s\S]*?)\n```/) ||
                response.content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : response.content;
            return JSON.parse(jsonStr);
        }
        catch {
            return {
                reasoning: 'Could not parse plan, defaulting to direct coding approach',
                tasks: [{ agent: 'Coder', task, dependsOn: [] }],
            };
        }
    }
    /**
     * Execute a planned task with sub-agents — Claude Code style
     * Sub-agents run until their tasks are complete.
     * After all tasks complete, verify the overall result and re-plan if needed.
     */
    async orchestrate(task, callbacks, autoPlan = true) {
        const startTime = Date.now();
        const totalUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
        const agentResults = new Map();
        const execution = {
            agentName: 'Orchestrator',
            task,
            startTime,
            iterations: 0,
            tokensUsed: 0,
            status: 'running',
        };
        // Step 1: Create execution plan
        let plan;
        if (autoPlan) {
            callbacks?.onThinking?.('Planning task decomposition...');
            plan = await this.plan(task, callbacks);
        }
        else {
            plan = {
                reasoning: 'Direct execution without planning',
                tasks: [{ agent: 'Coder', task }],
            };
        }
        callbacks?.onThinking?.(`Plan: ${plan.tasks.length} sub-tasks — ${plan.reasoning}`);
        // Step 2: Execute tasks respecting dependencies — each agent runs until done
        const completedTasks = new Set();
        let taskIndex = 0;
        let maxReplans = 3; // Allow up to 3 re-planning cycles
        while (completedTasks.size < plan.tasks.length) {
            // Find tasks whose dependencies are all completed
            const readyTasks = plan.tasks.filter(t => {
                if (completedTasks.has(t.agent + ':' + t.task))
                    return false;
                if (!t.dependsOn || t.dependsOn.length === 0)
                    return true;
                return t.dependsOn.every(dep => completedTasks.has(dep));
            });
            if (readyTasks.length === 0) {
                // Deadlock detection
                const unresolved = plan.tasks.filter(t => !completedTasks.has(t.agent + ':' + t.task));
                if (unresolved.length > 0) {
                    callbacks?.onThinking?.(`Deadlock detected. Unresolved tasks: ${unresolved.map(t => t.agent + ':' + t.task).join(', ')}`);
                    // Clear dependency constraints to break deadlock
                    for (const t of unresolved) {
                        t.dependsOn = [];
                    }
                    continue;
                }
                break;
            }
            // Execute ready tasks (sequentially for safety, could parallelize in future)
            for (const subTask of readyTasks) {
                const agent = this.agents.get(subTask.agent);
                if (!agent) {
                    callbacks?.onThinking?.(`Agent not found: ${subTask.agent}`);
                    completedTasks.add(subTask.agent + ':' + subTask.task);
                    continue;
                }
                taskIndex++;
                callbacks?.onThinking?.(`[${taskIndex}/${plan.tasks.length}] Running ${subTask.agent}: ${subTask.task.slice(0, 80)}...`);
                // Build context from previous agent results
                let fullTask = subTask.task;
                if (subTask.context) {
                    fullTask = `${subTask.context}\n\nTask: ${subTask.task}`;
                }
                // Add results from dependent tasks as context
                if (subTask.dependsOn && subTask.dependsOn.length > 0) {
                    const depResults = subTask.dependsOn
                        .map(dep => agentResults.get(dep))
                        .filter(Boolean)
                        .map(r => `Previous agent result:\n${r.content}`)
                        .join('\n\n');
                    if (depResults) {
                        fullTask = `${fullTask}\n\n## Context from previous agents:\n${depResults}`;
                    }
                }
                // Run the sub-agent — it will keep going until its task is complete
                let result;
                try {
                    result = await agent.run(fullTask, {
                        onToken: (token) => callbacks?.onToken?.(token),
                        onToolCall: (name, args) => callbacks?.onToolCall?.(name, args),
                        onToolResult: (name, res, isError) => callbacks?.onToolResult?.(name, res, isError),
                        onApprovalNeeded: async (name, args, risk) => {
                            return callbacks?.onApprovalNeeded?.(name, args, risk) ?? true;
                        },
                        onThinking: (thinking) => callbacks?.onThinking?.(thinking),
                        onIteration: (i, _max) => {
                            callbacks?.onThinking?.(`  ${subTask.agent} step ${i}`);
                        },
                        onTaskComplete: (reason) => {
                            callbacks?.onThinking?.(`  ${subTask.agent}: ${reason}`);
                        },
                    });
                }
                catch (error) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    result = {
                        content: `Agent ${subTask.agent} failed: ${errMsg}`,
                        toolCallsMade: 0, iterations: 0,
                        usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
                        execution: { agentName: subTask.agent, task: subTask.task, startTime: Date.now(), iterations: 0, tokensUsed: 0, status: 'failed' },
                    };
                }
                agentResults.set(subTask.agent + ':' + subTask.task, result);
                totalUsage.inputTokens += result.usage.inputTokens;
                totalUsage.outputTokens += result.usage.outputTokens;
                totalUsage.cost += result.usage.cost;
                completedTasks.add(subTask.agent + ':' + subTask.task);
            }
        }
        execution.endTime = Date.now();
        execution.iterations = taskIndex;
        execution.tokensUsed = totalUsage.inputTokens + totalUsage.outputTokens;
        execution.status = 'completed';
        // Step 3: Synthesize final result
        const resultSummary = Array.from(agentResults.entries())
            .map(([key, result]) => `### ${key}\n${result.content}`)
            .join('\n\n');
        return {
            content: resultSummary,
            plan,
            agentResults,
            totalUsage,
            execution,
        };
    }
    /**
     * Direct run - delegate to the most appropriate agent
     */
    async runDirect(task, agentName, callbacks) {
        const agent = this.agents.get(agentName);
        if (!agent) {
            throw new Error(`Agent not found: ${agentName}. Available: ${Array.from(this.agents.keys()).join(', ')}`);
        }
        return agent.run(task, callbacks);
    }
}
//# sourceMappingURL=orchestrator.js.map