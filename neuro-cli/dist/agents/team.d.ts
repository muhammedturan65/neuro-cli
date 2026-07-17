import { BaseAgent, AgentCallbacks } from '../agents/base.js';
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
export declare class AgentTeam {
    private teamName;
    private lead;
    private members;
    private client;
    private registry;
    private workingDirectory;
    private sessionId;
    private tasks;
    private messages;
    private completedTasks;
    constructor(teamName: string, lead: BaseAgent, client: OpenRouterClient, registry: ToolRegistry, workingDirectory: string, sessionId: string);
    /**
     * Add a team member
     */
    addMember(agent: BaseAgent): void;
    /**
     * Execute a task with the team
     */
    execute(task: string, callbacks?: AgentCallbacks): Promise<TeamResult>;
    private createTaskPlan;
    private getReadyTasks;
    private getDependencyContext;
    private sendMessage;
}
//# sourceMappingURL=team.d.ts.map