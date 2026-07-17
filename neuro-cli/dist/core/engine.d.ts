import { NeuroConfig, AgentExecution } from '../core/types.js';
import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { ToolRegistry } from '../tools/registry.js';
import { BaseAgent } from '../agents/base.js';
import { Orchestrator } from '../agents/orchestrator.js';
import { ContextManager } from '../core/context.js';
import { SessionManager } from '../core/session.js';
import { TerminalUI } from '../ui/renderer.js';
export declare class NeuroEngine {
    config: NeuroConfig;
    client: OpenRouterClient;
    registry: ToolRegistry;
    orchestrator: Orchestrator;
    contextManager: ContextManager;
    sessionManager: SessionManager;
    ui: TerminalUI;
    agents: Map<string, BaseAgent>;
    private autoApproveSet;
    private requireApprovalSet;
    constructor(config: NeuroConfig);
    /**
     * Initialize all agents from config
     */
    private initializeAgents;
    /**
     * Process a user message
     */
    processMessage(message: string, mode?: 'auto' | 'agent' | 'direct', targetAgent?: string): Promise<{
        content: string;
        usage: TokenUsage;
        execution?: AgentExecution;
    }>;
    /**
     * Handle tool approval
     */
    private handleApproval;
    /**
     * Assess task complexity to decide execution mode
     */
    private assessComplexity;
    /**
     * Switch the active model
     */
    switchModel(modelId: string): boolean;
    /**
     * Get current session stats
     */
    getSessionStats(): {
        inputTokens: number;
        outputTokens: number;
        cost: number;
        messages: number;
    };
}
//# sourceMappingURL=engine.d.ts.map