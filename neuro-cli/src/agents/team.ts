// ============================================================
// NeuroCLI - Agent Teams with Inter-Agent Messaging
// (Like Claude Code's Agent Teams + Dynamic Workflows)
// ============================================================

import { BaseAgent, AgentCallbacks, AgentRunResult } from '../agents/base.js';
import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { ToolRegistry } from '../tools/registry.js';
import { AgentExecution } from '../core/types.js';

export interface TeamMessage {
  from: string;
  to: string | 'all';
  content: string;
  timestamp: number;
  type: 'task' | 'result' | 'question' | 'coordination' | 'status';
}

export interface TeamTask {
  id: string;
  description: string;
  assignedTo: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  dependsOn: string[];
}

export interface TeamResult {
  tasks: TeamTask[];
  messages: TeamMessage[];
  totalUsage: TokenUsage;
  execution: AgentExecution;
}

export class AgentTeam {
  private teamName: string;
  private lead: BaseAgent;
  private members: Map<string, BaseAgent> = new Map();
  private client: OpenRouterClient;
  private registry: ToolRegistry;
  private workingDirectory: string;
  private sessionId: string;

  private tasks: Map<string, TeamTask> = new Map();
  private messages: TeamMessage[] = [];
  private completedTasks: Set<string> = new Set();

  constructor(
    teamName: string,
    lead: BaseAgent,
    client: OpenRouterClient,
    registry: ToolRegistry,
    workingDirectory: string,
    sessionId: string,
  ) {
    this.teamName = teamName;
    this.lead = lead;
    this.client = client;
    this.registry = registry;
    this.workingDirectory = workingDirectory;
    this.sessionId = sessionId;
  }

  /**
   * Add a team member
   */
  addMember(agent: BaseAgent): void {
    this.members.set(agent.name, agent);
  }

  /**
   * Execute a task with the team
   */
  async execute(
    task: string,
    callbacks?: AgentCallbacks,
  ): Promise<TeamResult> {
    const startTime = Date.now();
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };

    // Step 1: Lead analyzes task and creates sub-tasks
    callbacks?.onThinking?.(`🧑‍💼 Lead "${this.lead.name}" is planning task distribution...`);

    const plan = await this.createTaskPlan(task, callbacks);
    
    // Step 2: Execute tasks with coordination
    callbacks?.onThinking?.(`📋 Plan: ${plan.length} sub-tasks created`);

    for (const teamTask of plan) {
      this.tasks.set(teamTask.id, teamTask);
    }

    // Execute tasks respecting dependencies
    let iteration = 0;
    const maxIterations = plan.length * 3; // Safety limit

    while (this.completedTasks.size < plan.length && iteration < maxIterations) {
      iteration++;

      // Find ready tasks
      const readyTasks = this.getReadyTasks();

      if (readyTasks.length === 0) {
        // Deadlock - mark remaining as failed
        for (const [id, task] of this.tasks) {
          if (task.status === 'pending') {
            task.status = 'failed';
            task.result = 'Deadlock: dependencies could not be resolved';
          }
        }
        break;
      }

      // Execute ready tasks (sequentially for safety, could parallelize)
      for (const teamTask of readyTasks) {
        const member = this.members.get(teamTask.assignedTo);
        if (!member) {
          teamTask.status = 'failed';
          teamTask.result = `Agent "${teamTask.assignedTo}" not found`;
          this.completedTasks.add(teamTask.id);
          continue;
        }

        teamTask.status = 'in_progress';
        callbacks?.onThinking?.(`🤖 ${teamTask.assignedTo} working on: ${teamTask.description.slice(0, 80)}...`);

        // Build context from previous task results
        let fullTask = teamTask.description;
        const depContext = this.getDependencyContext(teamTask);
        if (depContext) {
          fullTask += `\n\n## Context from teammates:\n${depContext}`;
        }

        try {
          const result = await member.run(fullTask, {
            onToken: callbacks?.onToken,
            onToolCall: callbacks?.onToolCall,
            onToolResult: callbacks?.onToolResult,
            onApprovalNeeded: callbacks?.onApprovalNeeded,
            onThinking: callbacks?.onThinking,
          });

          teamTask.status = 'completed';
          teamTask.result = result.content;
          totalUsage.inputTokens += result.usage.inputTokens;
          totalUsage.outputTokens += result.usage.outputTokens;
          totalUsage.cost += result.usage.cost;

          // Send result message to team
          this.sendMessage({
            from: teamTask.assignedTo,
            to: 'all',
            content: `Completed: ${teamTask.description}\nResult: ${result.content.slice(0, 500)}`,
            timestamp: Date.now(),
            type: 'result',
          });

          callbacks?.onThinking?.(`✅ ${teamTask.assignedTo} completed their task`);
        } catch (error) {
          teamTask.status = 'failed';
          teamTask.result = error instanceof Error ? error.message : String(error);

          this.sendMessage({
            from: teamTask.assignedTo,
            to: this.lead.name,
            content: `Failed: ${teamTask.description}\nError: ${teamTask.result}`,
            timestamp: Date.now(),
            type: 'result',
          });
        }

        this.completedTasks.add(teamTask.id);
      }
    }

    // Step 3: Lead synthesizes final result
    callbacks?.onThinking?.('🧑‍💼 Lead is synthesizing the final result...');

    const taskResults = Array.from(this.tasks.values())
      .map(t => `[${t.status}] ${t.assignedTo}: ${t.description}\n${t.result || 'No result'}`)
      .join('\n\n');

    const execution: AgentExecution = {
      agentName: `Team:${this.teamName}`,
      task,
      startTime,
      endTime: Date.now(),
      iterations: iteration,
      tokensUsed: totalUsage.inputTokens + totalUsage.outputTokens,
      status: 'completed',
    };

    return {
      tasks: Array.from(this.tasks.values()),
      messages: this.messages,
      totalUsage,
      execution,
    };
  }

  // ---- Private Methods ----

  private async createTaskPlan(task: string, callbacks?: AgentCallbacks): Promise<TeamTask[]> {
    const memberList = Array.from(this.members.entries())
      .map(([name, agent]) => `- ${name}: ${agent.description}`)
      .join('\n');

    const prompt = `You are the lead of agent team "${this.teamName}". Break down the following task into sub-tasks for your team members.

## Team Members
${memberList}

## Task
${task}

Create a JSON plan with sub-tasks. Each task should have:
- id: unique identifier (e.g., "t1", "t2")
- description: what the agent should do
- assignedTo: which team member
- dependsOn: array of task IDs this depends on (empty if none)

Respond with ONLY a JSON array of tasks.`;

    const response = await this.lead.query(prompt);

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const tasks = JSON.parse(jsonMatch[0]) as Array<{
          id: string;
          description: string;
          assignedTo: string;
          dependsOn: string[];
        }>;

        return tasks.map(t => ({
          id: t.id,
          description: t.description,
          assignedTo: t.assignedTo,
          status: 'pending' as const,
          dependsOn: t.dependsOn || [],
        }));
      }
    } catch {}

    // Fallback: assign everything to first member
    const firstMember = Array.from(this.members.keys())[0];
    return [{
      id: 't1',
      description: task,
      assignedTo: firstMember,
      status: 'pending',
      dependsOn: [],
    }];
  }

  private getReadyTasks(): TeamTask[] {
    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== 'pending') return false;
      if (task.dependsOn.length === 0) return true;
      return task.dependsOn.every(depId => {
        const dep = this.tasks.get(depId);
        return dep?.status === 'completed';
      });
    });
  }

  private getDependencyContext(task: TeamTask): string {
    if (task.dependsOn.length === 0) return '';

    return task.dependsOn
      .map(depId => {
        const dep = this.tasks.get(depId);
        if (!dep || dep.status !== 'completed') return '';
        return `### ${dep.assignedTo} (${dep.description})\n${dep.result?.slice(0, 1000) || 'No result'}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  private sendMessage(msg: TeamMessage): void {
    this.messages.push(msg);
  }
}
