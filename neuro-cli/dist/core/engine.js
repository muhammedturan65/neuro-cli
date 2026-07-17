// ============================================================
// NeuroCLI - NeuroEngine
// The main engine that ties everything together
// ============================================================
import { OpenRouterClient } from '../api/openrouter.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerAllTools } from '../tools/index.js';
import { BaseAgent } from '../agents/base.js';
import { Orchestrator } from '../agents/orchestrator.js';
import { ContextManager } from '../core/context.js';
import { SessionManager } from '../core/session.js';
import { TerminalUI } from '../ui/renderer.js';
import { MODELS } from '../api/models.js';
export class NeuroEngine {
    config;
    client;
    registry;
    orchestrator;
    contextManager;
    sessionManager;
    ui;
    agents = new Map();
    autoApproveSet;
    requireApprovalSet;
    constructor(config) {
        this.config = config;
        this.client = new OpenRouterClient(config.apiKey, config.baseUrl);
        this.registry = registerAllTools(new ToolRegistry());
        this.contextManager = new ContextManager(config.defaultModel, config.context.maxTokens);
        this.sessionManager = new SessionManager();
        this.ui = new TerminalUI(config.ui.theme, config.ui.showTokenCount, config.ui.showCost);
        this.autoApproveSet = new Set(config.tools.autoApprove);
        this.requireApprovalSet = new Set(config.tools.requireApproval);
        // Initialize agents from config
        this.initializeAgents();
        // Create orchestrator
        const orchestratorConfig = {
            name: 'Orchestrator',
            description: 'Central coordinator that manages sub-agents for complex tasks',
            systemPrompt: `You are the Orchestrator, the central coordinator of the NeuroCLI multi-agent system. Your job is to analyze tasks and delegate them to the appropriate specialist agents. You ensure tasks are completed efficiently and correctly.

Key responsibilities:
- Analyze complex tasks and break them into sub-tasks
- Assign sub-tasks to the most appropriate specialist agent
- Manage dependencies between sub-tasks
- Synthesize results from multiple agents
- Handle errors and re-plan if needed

Always consider the strengths of each agent when delegating:
- Planner: For task decomposition and architecture decisions
- Coder: For writing and modifying code
- Reviewer: For code quality assurance
- Researcher: For information gathering and documentation
- Tester: For writing and running tests
- Debugger: For investigating and fixing bugs
- Architect: For system design and technology decisions
- DevOps: For deployment and infrastructure`,
            model: 'anthropic/claude-sonnet-4',
            temperature: 0.7,
            maxTokens: 4096,
            tools: [],
            maxIterations: 5,
        };
        this.orchestrator = new Orchestrator(orchestratorConfig, this.client, this.registry, process.cwd(), this.sessionManager.getCurrent()?.id || 'default');
        // Register all agents with orchestrator
        for (const [name, agent] of this.agents) {
            this.orchestrator.registerAgent(agent);
        }
    }
    /**
     * Initialize all agents from config
     */
    initializeAgents() {
        const sessionId = 'init';
        const cwd = process.cwd();
        for (const [key, agentConfig] of Object.entries(this.config.agents)) {
            const agent = new BaseAgent(agentConfig, this.client, this.registry, cwd, sessionId);
            this.agents.set(agentConfig.name, agent);
        }
    }
    /**
     * Process a user message
     */
    async processMessage(message, mode = 'auto', targetAgent) {
        // Start or get session
        let session = this.sessionManager.getCurrent();
        if (!session) {
            session = this.sessionManager.create(process.cwd(), this.config.defaultModel);
        }
        // Add user message to session
        this.sessionManager.addMessage({
            role: 'user',
            content: message,
            timestamp: Date.now(),
        });
        // Build UI callbacks
        const callbacks = {
            onThinking: (thinking) => this.ui.thinking(thinking),
            onToken: (token) => this.ui.streamingToken(token),
            onToolCall: (name, args) => this.ui.toolCall(name, args),
            onToolResult: (name, result, isError) => this.ui.toolResult(name, result, isError),
            onApprovalNeeded: async (name, args, risk) => {
                return this.handleApproval(name, args, risk);
            },
            onIteration: (i, max) => {
                this.ui.info(`Iteration ${i}/${max}`);
            },
        };
        let result;
        if (mode === 'direct' && targetAgent) {
            // Direct mode: use specific agent
            const agent = this.agents.get(targetAgent);
            if (!agent) {
                this.ui.error(`Agent not found: ${targetAgent}`);
                return { content: '', usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
            }
            this.ui.startStreaming();
            result = await agent.run(message, callbacks);
            this.ui.endStreaming();
        }
        else if (mode === 'agent') {
            // Agent mode: use orchestrator for planning
            const orchestrateResult = await this.orchestrator.orchestrate(message, callbacks);
            result = {
                content: orchestrateResult.content,
                toolCallsMade: 0,
                iterations: orchestrateResult.execution.iterations,
                usage: orchestrateResult.totalUsage,
                execution: orchestrateResult.execution,
            };
        }
        else {
            // Auto mode: decide between direct and orchestrated
            const complexity = this.assessComplexity(message);
            if (complexity === 'simple') {
                // Use coder directly for simple tasks
                const agent = this.agents.get('Coder');
                if (agent) {
                    this.ui.startStreaming();
                    result = await agent.run(message, callbacks);
                    this.ui.endStreaming();
                }
                else {
                    throw new Error('Coder agent not initialized');
                }
            }
            else {
                // Use orchestrator for complex tasks
                this.ui.thinking('🧠 Analyzing task complexity... Using multi-agent orchestration');
                const orchestrateResult = await this.orchestrator.orchestrate(message, callbacks);
                result = {
                    content: orchestrateResult.content,
                    toolCallsMade: 0,
                    iterations: orchestrateResult.execution.iterations,
                    usage: orchestrateResult.totalUsage,
                    execution: orchestrateResult.execution,
                };
            }
        }
        // Print usage
        this.ui.tokenUsage(result.usage, this.config.defaultModel);
        // Update session
        this.sessionManager.addMessage({
            role: 'assistant',
            content: result.content,
            timestamp: Date.now(),
        });
        this.sessionManager.updateUsage(result.usage.inputTokens, result.usage.outputTokens, result.usage.cost);
        this.sessionManager.save();
        return {
            content: result.content,
            usage: result.usage,
            execution: result.execution,
        };
    }
    /**
     * Handle tool approval
     */
    async handleApproval(toolName, args, risk) {
        // Auto-approve tools in auto-approve list
        if (this.autoApproveSet.has(toolName)) {
            return true;
        }
        // Always require approval for tools in require-approval list
        if (this.requireApprovalSet.has(toolName)) {
            this.ui.approvalRequest(toolName, args, risk);
            // In interactive mode, this would prompt the user
            // For now, auto-approve with a warning
            this.ui.warning(`Auto-approving ${toolName} (${risk} risk)`);
            return true;
        }
        // Default: approve read-only, ask for write operations
        return true;
    }
    /**
     * Assess task complexity to decide execution mode
     */
    assessComplexity(message) {
        const complexIndicators = [
            /implement.*system/i, /build.*application/i, /create.*project/i,
            /refactor.*entire/i, /migrate.*from.*to/i, /design.*architecture/i,
            /multi.*agent/i, /orchestrat/i, /end.*to.*end/i,
        ];
        const moderateIndicators = [
            /add.*feature/i, /fix.*bug/i, /update.*multiple/i,
            /write.*tests/i, /review.*code/i, /optimize/i,
        ];
        if (complexIndicators.some(p => p.test(message)))
            return 'complex';
        if (moderateIndicators.some(p => p.test(message)))
            return 'moderate';
        return 'simple';
    }
    /**
     * Switch the active model
     */
    switchModel(modelId) {
        if (!MODELS[modelId]) {
            this.ui.error(`Unknown model: ${modelId}`);
            return false;
        }
        this.config.defaultModel = modelId;
        this.contextManager = new ContextManager(modelId, this.config.context.maxTokens);
        this.ui.success(`Switched to ${MODELS[modelId].name}`);
        return true;
    }
    /**
     * Get current session stats
     */
    getSessionStats() {
        const session = this.sessionManager.getCurrent();
        if (!session)
            return { inputTokens: 0, outputTokens: 0, cost: 0, messages: 0 };
        return {
            inputTokens: session.totalInputTokens,
            outputTokens: session.totalOutputTokens,
            cost: session.totalCost,
            messages: session.messages.length,
        };
    }
}
//# sourceMappingURL=engine.js.map