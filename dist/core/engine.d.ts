import { NeuroConfig, AgentExecution } from '../core/types.js';
import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { ToolRegistry } from '../tools/registry.js';
import { BaseAgent } from '../agents/base.js';
import { Orchestrator } from '../agents/orchestrator.js';
import { ContextManager } from '../core/context.js';
import { SessionManager } from '../core/session.js';
import { TerminalUI } from '../ui/renderer.js';
import { ApprovalSystem } from '../core/approval.js';
import { MCPClient } from '../mcp/client.js';
import { DoomLoopProtection } from '../core/doom-loop.js';
import { FallbackChain } from '../core/fallback.js';
import { Sandbox } from '../core/sandbox.js';
import { PluginManager } from '../core/plugin-sdk.js';
import { UndoRedoSystem } from './undo-redo.js';
import { PromptCache } from './prompt-cache.js';
import { ModelRouter } from './model-router.js';
import { StyleManager } from './output-styles.js';
import { ExtendedThinking } from './extended-thinking.js';
import { SpendingMonitor } from './spending-warnings.js';
import { SkillSystem } from '../context/skill-system.js';
import { CustomAgentLoader } from '../context/custom-agents.js';
import { CustomToolLoader } from '../context/custom-tools.js';
import { NeuroIgnore } from '../context/neuroignore.js';
import { OllamaProvider } from '../api/ollama.js';
import { TelemetrySystem } from './telemetry.js';
import { VimModeManager } from './vim-mode.js';
import { I18nSystem } from './i18n.js';
import { MultimodalSupport } from './multimodal.js';
import { VoiceIO } from './voice.js';
import { APIServer } from './api-server.js';
import { CloudSync } from './cloud-sync.js';
import { WebDashboard } from './web-dashboard.js';
import { SkillStandard } from '../context/skill-standard.js';
import { AutoMode } from './auto-mode.js';
import { ScheduledTaskManager } from './scheduled-tasks.js';
import { ParallelAgentManager } from './parallel-agents.js';
import { BackgroundSessionManager } from './background-session.js';
import { TreeSitterIntegration } from '../context/tree-sitter.js';
import { LintingIntegration } from './linting.js';
import { TestingIntegration } from './testing.js';
import { CodeReviewSystem } from './code-review.js';
import { SecurityScanner } from './security-scanner.js';
import { PluginBundleManager } from './plugin-bundle.js';
import { SubAgentManager } from './sub-agent.js';
import { ACPServer } from './acp.js';
import { OSSandboxManager } from './os-sandbox.js';
import { SpecDrivenPipeline } from './spec-driven.js';
import { LLMEvaluatorManager } from '../hooks/llm-evaluator.js';
import { MCPAppManager } from '../mcp/mcp-apps.js';
import { MultiModelOrchestrator } from './multi-model.js';
import { SmartMonitor } from './smart-monitor.js';
import { OutcomeGrader } from './outcome-grading.js';
import { ObservabilityManager } from './observability.js';
import { AutoCompactManager } from './auto-compact.js';
import { TerminalUX } from './terminal-ux.js';
import { MultiSessionManager } from './multi-session.js';
import { GitWorktreeManager } from './git-worktree.js';
import { AutoUpdater } from './updater.js';
export declare class NeuroEngine {
    config: NeuroConfig;
    client: OpenRouterClient;
    registry: ToolRegistry;
    orchestrator: Orchestrator;
    contextManager: ContextManager;
    sessionManager: SessionManager;
    ui: TerminalUI;
    agents: Map<string, BaseAgent>;
    mcpClient: MCPClient;
    approval: ApprovalSystem;
    doomLoop: DoomLoopProtection;
    fallback: FallbackChain;
    sandbox: Sandbox;
    pluginManager: PluginManager;
    undoRedo: UndoRedoSystem;
    promptCache: PromptCache;
    modelRouter: ModelRouter;
    styleManager: StyleManager;
    extendedThinking: ExtendedThinking;
    spendingMonitor: SpendingMonitor;
    skillSystem: SkillSystem;
    customAgentLoader: CustomAgentLoader;
    customToolLoader: CustomToolLoader;
    neuroIgnore: NeuroIgnore;
    ollamaProvider: OllamaProvider;
    telemetry: TelemetrySystem;
    vimMode: VimModeManager;
    i18n: I18nSystem;
    multimodal: MultimodalSupport;
    voice: VoiceIO;
    apiServer: APIServer;
    cloudSync: CloudSync;
    dashboard: WebDashboard;
    skillStandard: SkillStandard;
    autoMode: AutoMode;
    scheduledTasks: ScheduledTaskManager;
    parallelAgents: ParallelAgentManager;
    backgroundSessions: BackgroundSessionManager;
    treeSitter: TreeSitterIntegration;
    linting: LintingIntegration;
    testing: TestingIntegration;
    codeReview: CodeReviewSystem;
    securityScanner: SecurityScanner;
    pluginBundles: PluginBundleManager;
    subAgentSpawner: SubAgentManager;
    acp: ACPServer;
    osSandbox: OSSandboxManager;
    specDriven: SpecDrivenPipeline;
    llmEvaluator: LLMEvaluatorManager;
    mcpApps: MCPAppManager;
    multiModelOrchestrator: MultiModelOrchestrator;
    smartMonitor: SmartMonitor;
    outcomeGrading: OutcomeGrader;
    observability: ObservabilityManager;
    autoCompact: AutoCompactManager;
    terminalUX: TerminalUX;
    multiSession: MultiSessionManager;
    gitWorktree: GitWorktreeManager;
    updater: AutoUpdater;
    private autoApproveSet;
    private requireApprovalSet;
    constructor(config: NeuroConfig);
    /**
     * Register plugin tools with the tool registry
     */
    private registerPluginTools;
    /**
     * Register custom tools from .neuro/tools/
     */
    private registerCustomTools;
    /**
     * Load custom agents from .neuro/agents/
     */
    private loadCustomAgents;
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
     * Check sandbox permissions for a tool call
     */
    private checkSandboxForTool;
    /**
     * Handle tool approval using the enhanced ApprovalSystem
     */
    private handleApproval;
    /**
     * Assess task complexity to decide execution mode
     * Now delegates to ModelRouter for more sophisticated analysis
     */
    private assessComplexity;
    /**
     * Select the best agent for a given task category
     */
    private selectAgentForCategory;
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
    /**
     * Register a custom agent
     */
    registerCustomAgent(name: string, config: {
        description: string;
        systemPrompt: string;
        tools?: string[];
        maxIterations?: number;
    }): void;
}
//# sourceMappingURL=engine.d.ts.map