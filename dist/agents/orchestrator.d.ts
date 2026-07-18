import { BaseAgent, AgentRunResult, AgentCallbacks } from './base.js';
import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { ToolRegistry } from '../tools/registry.js';
import { AgentConfig, AgentExecution } from '../core/types.js';
export interface SubAgentTask {
    agent: string;
    task: string;
    context?: string;
    dependsOn?: string[];
}
export interface OrchestratedPlan {
    tasks: SubAgentTask[];
    reasoning: string;
}
export interface OrchestratorResult {
    content: string;
    plan: OrchestratedPlan | null;
    agentResults: Map<string, AgentRunResult>;
    totalUsage: TokenUsage;
    execution: AgentExecution;
}
export declare class Orchestrator extends BaseAgent {
    private agents;
    constructor(config: AgentConfig, client: OpenRouterClient, registry: ToolRegistry, workingDirectory: string, sessionId: string);
    /**
     * Register a sub-agent
     */
    registerAgent(agent: BaseAgent): void;
    /**
     * Get all registered agents
     */
    getAgents(): BaseAgent[];
    /**
     * Plan the task decomposition using the orchestrator model
     */
    plan(task: string, callbacks?: AgentCallbacks): Promise<OrchestratedPlan>;
    /**
     * Execute a planned task with sub-agents — Claude Code style
     * Sub-agents run until their tasks are complete.
     * After all tasks complete, verify the overall result and re-plan if needed.
     */
    orchestrate(task: string, callbacks?: AgentCallbacks, autoPlan?: boolean): Promise<OrchestratorResult>;
    /**
     * Direct run - delegate to the most appropriate agent
     */
    runDirect(task: string, agentName: string, callbacks?: AgentCallbacks): Promise<AgentRunResult>;
}
//# sourceMappingURL=orchestrator.d.ts.map