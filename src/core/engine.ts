// ============================================================
// NeuroCLI - NeuroEngine v4.0.0
// The main engine that ties everything together
// Now with: Sandbox, Plugin SDK, Enhanced MCP, Enhanced Approval,
// Model Router, Prompt Cache, Undo/Redo, Output Styles,
// Skill System, Custom Agents, Custom Tools, Ollama,
// Extended Thinking, Spending Monitor, NeuroIgnore,
// Telemetry, Vim Mode, i18n, Multimodal, Voice I/O,
// API Server, Cloud Sync, Web Dashboard,
// SKILL.md Standard, Auto Mode, Scheduled Tasks,
// Parallel Agents, Background Sessions, Browser Automation,
// Tree-sitter, Linting, Testing, Code Review,
// GitHub Integration, CI/CD, Plugin Bundles, Security Scanner
// ============================================================

import { NeuroConfig, Message, AgentExecution, PermissionMode } from '../core/types.js';
import { join } from 'path';
import { homedir } from 'os';
import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerAllTools } from '../tools/index.js';
import { BaseAgent, AgentCallbacks } from '../agents/base.js';
import { Orchestrator } from '../agents/orchestrator.js';
import { ContextManager } from '../core/context.js';
import { SessionManager } from '../core/session.js';
import { TerminalUI } from '../ui/renderer.js';
import { MODELS } from '../api/models.js';
import { ApprovalSystem } from '../core/approval.js';
import { MCPClient } from '../mcp/client.js';
import { DoomLoopProtection } from '../core/doom-loop.js';
import { FallbackChain } from '../core/fallback.js';
import { Sandbox } from '../core/sandbox.js';
import { PluginManager } from '../core/plugin-sdk.js';
import { UndoRedoSystem } from './undo-redo.js';
import { PromptCache } from './prompt-cache.js';
import { ModelRouter, RoutingDecision, EffortLevel } from './model-router.js';
import { StyleManager, OutputStyle } from './output-styles.js';
import { ExtendedThinking, ThinkingMode } from './extended-thinking.js';
import { SpendingMonitor, SpendingConfig } from './spending-warnings.js';
import { SkillSystem } from '../context/skill-system.js';
import { CustomAgentLoader, CustomAgentDefinition } from '../context/custom-agents.js';
import { CustomToolLoader, CustomToolDefinition } from '../context/custom-tools.js';
import { NeuroIgnore } from '../context/neuroignore.js';
import { OllamaProvider, OllamaConfig } from '../api/ollama.js';
import { TelemetrySystem, TelemetryConfig } from './telemetry.js';
import { VimModeManager, VimModeConfig } from './vim-mode.js';
import { I18nSystem, SupportedLocale } from './i18n.js';
import { MultimodalSupport, MultimodalConfig } from './multimodal.js';
import { VoiceIO, VoiceConfig } from './voice.js';
import { APIServer, APIServerConfig } from './api-server.js';
import { CloudSync, CloudSyncConfig } from './cloud-sync.js';
import { WebDashboard, DashboardConfig } from './web-dashboard.js';
import { SkillStandard } from '../context/skill-standard.js';
import { AutoMode, AutoModeConfig } from './auto-mode.js';
import { ScheduledTaskManager, ScheduledTaskConfig } from './scheduled-tasks.js';
import { ParallelAgentManager, ParallelAgentConfig } from './parallel-agents.js';
import { BackgroundSessionManager, BackgroundSessionConfig } from './background-session.js';
import { TreeSitterIntegration } from '../context/tree-sitter.js';
import { LintingIntegration, LinterConfig } from './linting.js';
import { TestingIntegration, TestingConfig } from './testing.js';
import { CodeReviewSystem, CodeReviewConfig } from './code-review.js';
import { SecurityScanner, SecurityScanConfig } from './security-scanner.js';
import { PluginBundleManager } from './plugin-bundle.js';

export class NeuroEngine {
  public config: NeuroConfig;
  public client: OpenRouterClient;
  public registry: ToolRegistry;
  public orchestrator: Orchestrator;
  public contextManager: ContextManager;
  public sessionManager: SessionManager;
  public ui: TerminalUI;
  public agents: Map<string, BaseAgent> = new Map();
  public mcpClient: MCPClient;
  public approval: ApprovalSystem;
  public doomLoop: DoomLoopProtection;
  public fallback: FallbackChain;
  public sandbox: Sandbox;
  public pluginManager: PluginManager;

  // v3.0 new systems
  public undoRedo: UndoRedoSystem;
  public promptCache: PromptCache;
  public modelRouter: ModelRouter;
  public styleManager: StyleManager;
  public extendedThinking: ExtendedThinking;
  public spendingMonitor: SpendingMonitor;
  public skillSystem: SkillSystem;
  public customAgentLoader: CustomAgentLoader;
  public customToolLoader: CustomToolLoader;
  public neuroIgnore: NeuroIgnore;
  public ollamaProvider: OllamaProvider;

  // P2/P3 new systems
  public telemetry: TelemetrySystem;
  public vimMode: VimModeManager;
  public i18n: I18nSystem;
  public multimodal: MultimodalSupport;
  public voice: VoiceIO;
  public apiServer: APIServer;
  public cloudSync: CloudSync;
  public dashboard: WebDashboard;

  // v4.0 new systems
  public skillStandard: SkillStandard;
  public autoMode: AutoMode;
  public scheduledTasks: ScheduledTaskManager;
  public parallelAgents: ParallelAgentManager;
  public backgroundSessions: BackgroundSessionManager;
  public treeSitter: TreeSitterIntegration;
  public linting: LintingIntegration;
  public testing: TestingIntegration;
  public codeReview: CodeReviewSystem;
  public securityScanner: SecurityScanner;
  public pluginBundles: PluginBundleManager;

  private autoApproveSet: Set<string>;
  private requireApprovalSet: Set<string>;

  constructor(config: NeuroConfig) {
    this.config = config;
    this.client = new OpenRouterClient(config.apiKey, config.baseUrl);
    this.registry = registerAllTools(new ToolRegistry());
    this.contextManager = new ContextManager(config.defaultModel, config.context.maxTokens);
    this.sessionManager = new SessionManager();
    this.ui = new TerminalUI(config.ui.theme, config.ui.showTokenCount, config.ui.showCost);

    this.autoApproveSet = new Set(config.tools.autoApprove);
    this.requireApprovalSet = new Set(config.tools.requireApproval);

    // Initialize core systems
    this.approval = new ApprovalSystem(config.permissionMode, {
      showDiffPreview: config.diffPreview,
      whitelist: config.tools.autoApprove,
      blacklist: config.tools.denied,
    });

    this.mcpClient = new MCPClient();

    this.doomLoop = new DoomLoopProtection(config.doomLoop, async (reason, state) => {
      this.ui.warning(`Doom loop detected: ${reason}. Pausing agent.`);
      return false;
    });

    this.fallback = new FallbackChain(this.client, config.fallbackChain);

    // Sandbox system
    this.sandbox = new Sandbox(config.sandbox);

    // Plugin system
    this.pluginManager = new PluginManager();

    // --- v3.0 Systems ---

    // Undo/Redo system
    this.undoRedo = new UndoRedoSystem();

    // Prompt cache
    this.promptCache = new PromptCache({
      cacheDir: config.promptCache.cacheDir,
      maxEntries: config.promptCache.maxEntries,
      ttlMs: config.promptCache.ttlMs,
      similarityThreshold: config.promptCache.similarityThreshold,
      enabled: config.promptCache.enabled,
    });

    // Model router
    this.modelRouter = new ModelRouter(
      {
        defaultModel: config.defaultModel,
        simpleModel: 'google/gemma-4-31b-it:free',
        moderateModel: 'qwen/qwen3-coder:free',
        complexModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        effortModels: {
          low: 'google/gemma-4-31b-it:free',
          medium: 'qwen/qwen3-coder:free',
          high: 'nvidia/nemotron-3-super-120b-a12b:free',
          ultrathink: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        },
        categoryOverrides: {},
        maxTokenBudget: config.context.maxTokens,
      },
      Object.fromEntries(
        Object.entries(MODELS).map(([id, m]) => [id, { name: m.name, contextWindow: m.contextWindow, maxOutput: m.maxOutput }])
      ),
    );

    // Output styles
    this.styleManager = new StyleManager(process.cwd());

    // Extended thinking
    this.extendedThinking = new ExtendedThinking({
      mode: 'none',
      showThinking: false,
    });

    // Spending monitor
    this.spendingMonitor = new SpendingMonitor({
      dailyLimit: config.spendingLimit > 0 ? config.spendingLimit : 0,
      sessionLimit: 0,
      autoStopAtLimit: config.spendingLimit > 0,
      trackByModel: true,
    });

    // Skill system
    this.skillSystem = new SkillSystem(process.cwd());
    this.skillSystem.discover();

    // Custom agents
    this.customAgentLoader = new CustomAgentLoader(process.cwd());
    this.customAgentLoader.discover();

    // Custom tools
    this.customToolLoader = new CustomToolLoader(process.cwd());
    this.customToolLoader.discover();

    // .neuroignore
    this.neuroIgnore = new NeuroIgnore(process.cwd());
    this.neuroIgnore.load();

    // Ollama provider
    this.ollamaProvider = new OllamaProvider({
      baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
      defaultModel: 'llama3',
    });

    // --- P2/P3 New Systems ---

    // Telemetry (opt-in, disabled by default)
    this.telemetry = new TelemetrySystem({
      enabled: false,
    });

    // Vim mode
    this.vimMode = new VimModeManager({
      enabled: false,
    });

    // i18n
    this.i18n = new I18nSystem();

    // Multimodal support
    this.multimodal = new MultimodalSupport();

    // Voice I/O
    this.voice = new VoiceIO({
      enabled: false,
    });

    // API server
    this.apiServer = new APIServer({
      enabled: false,
    });
    this.apiServer.setEngine(this);

    // Cloud sync
    this.cloudSync = new CloudSync({
      enabled: false,
    });

    // Web dashboard
    this.dashboard = new WebDashboard({
      enabled: false,
    });
    this.dashboard.setEngine(this);

    // --- v4.0 New Systems ---

    // SKILL.md standard (agentskills.io compliant)
    this.skillStandard = new SkillStandard();

    // Auto mode (full autonomous)
    this.autoMode = new AutoMode({
      enabled: false,
      safetyLevel: 'conservative',
      maxIterations: 50,
      maxCost: 0,
      maxTimeMs: 0,
      blockedCommands: ['rm -rf /', 'mkfs', 'dd if=/dev/zero'],
      blockedPatterns: ['/etc/passwd', '/etc/shadow'],
      autoCommit: false,
      autoTest: false,
      pauseOnError: true,
    });

    // Scheduled tasks (/loop)
    this.scheduledTasks = new ScheduledTaskManager();

    // Parallel agents
    this.parallelAgents = new ParallelAgentManager({
      maxConcurrent: 5,
    });

    // Background sessions
    this.backgroundSessions = new BackgroundSessionManager();

    // Tree-sitter integration (repo map)
    this.treeSitter = new TreeSitterIntegration(process.cwd());

    // Linting integration
    this.linting = new LintingIntegration(process.cwd(), {
      enabled: true,
      autoRunOnChange: false,
      autoFix: false,
      failOnError: false,
      timeout: 30000,
      excludePatterns: ['node_modules', '.git', 'dist'],
    });

    // Testing integration
    this.testing = new TestingIntegration(process.cwd(), {
      enabled: true,
      autoRunOnChange: false,
      runOnSave: false,
      coverageThreshold: 80,
      timeout: 60000,
      relatedTestsOnly: false,
    });

    // Code review
    this.codeReview = new CodeReviewSystem(process.cwd(), {
      enabled: true,
      autoReviewOnChange: false,
      focusAreas: ['security', 'performance', 'correctness', 'style'],
      severityThreshold: 'minor',
      excludePatterns: ['node_modules', '.git', 'dist'],
    });

    // Security scanner
    this.securityScanner = new SecurityScanner(process.cwd(), {
      enabled: true,
      autoScanOnChange: false,
      failOnSeverity: 'high',
      excludePatterns: ['node_modules', '.git', 'dist', 'coverage'],
      customRules: [],
    });

    // Plugin bundles
    this.pluginBundles = new PluginBundleManager(
      join(homedir(), '.neuro', 'bundles'),
    );

    // --- End v4.0 ---

    // --- End P2/P3 ---

    // --- End v3.0 ---

    // Connect MCP servers if configured
    if (config.mcp.autoConnect) {
      this.mcpClient.connectAll().then(count => {
        if (count > 0) this.ui.info(`MCP: ${count} server(s) connected`);
      }).catch(() => {});
    }

    // Load plugins
    this.pluginManager.loadAll().then(count => {
      if (count > 0) this.ui.info(`Plugins: ${count} loaded`);
    }).catch(() => {});

    // Register plugin tools with the tool registry
    this.registerPluginTools();

    // Register custom tools
    this.registerCustomTools();

    // Initialize agents from config
    this.initializeAgents();

    // Load custom agents from .neuro/agents/
    this.loadCustomAgents();

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
      model: 'qwen/qwen3-coder:free',
      temperature: 0.7,
      maxTokens: 4096,
      tools: [],
      maxIterations: 5,
    };

    this.orchestrator = new Orchestrator(
      orchestratorConfig,
      this.client,
      this.registry,
      process.cwd(),
      this.sessionManager.getCurrent()?.id || 'default',
    );

    // Register all agents with orchestrator
    for (const [name, agent] of this.agents) {
      this.orchestrator.registerAgent(agent);
    }
  }

  /**
   * Register plugin tools with the tool registry
   */
  private registerPluginTools(): void {
    const pluginTools = this.pluginManager.getToolDefinitions();
    for (const toolDef of pluginTools) {
      this.registry.register({
        name: toolDef.name,
        risk: toolDef.risk,
        execute: async (args, context) => {
          const result = await this.pluginManager.executeTool(toolDef.name, args, {
            workingDirectory: context.workingDirectory,
            sessionId: context.sessionId,
            agentName: context.agentName,
            onProgress: context.onProgress || (() => {}),
            callTool: async (name, callArgs) => {
              return this.registry.execute(name, callArgs, context);
            },
            memory: {
              get: () => undefined,
              set: () => {},
              delete: () => {},
              list: () => [],
            },
          });
          return result.content;
        },
      });
    }
  }

  /**
   * Register custom tools from .neuro/tools/
   */
  private registerCustomTools(): void {
    const customTools = this.customToolLoader.getAll();
    for (const toolDef of customTools) {
      const executor = this.customToolLoader.createExecutor(toolDef);
      this.registry.register({
        name: `custom_${toolDef.name}`,
        risk: toolDef.risk || 'medium',
        execute: async (args) => {
          try {
            const result = await executor(args);
            return typeof result === 'string' ? result : JSON.stringify(result);
          } catch (error) {
            return `Custom tool error: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      });
    }
  }

  /**
   * Load custom agents from .neuro/agents/
   */
  private loadCustomAgents(): void {
    const customAgents = this.customAgentLoader.getAll();
    const cwd = process.cwd();
    const sessionId = this.sessionManager.getCurrent()?.id || 'default';

    for (const def of customAgents) {
      const agentConfig = this.customAgentLoader.toAgentConfig(def, this.config.defaultModel);
      const agent = new BaseAgent(agentConfig, this.client, this.registry, cwd, sessionId);
      this.agents.set(def.name, agent);

      // Save to config custom agents
      if (!this.config.customAgents) this.config.customAgents = {};
      this.config.customAgents[def.name] = agentConfig;
    }
  }

  /**
   * Initialize all agents from config
   */
  private initializeAgents(): void {
    const sessionId = 'init';
    const cwd = process.cwd();

    // Built-in agents
    for (const [key, agentConfig] of Object.entries(this.config.agents)) {
      const overrideConfig = { ...agentConfig, model: this.config.defaultModel };
      const agent = new BaseAgent(
        overrideConfig,
        this.client,
        this.registry,
        cwd,
        sessionId,
      );
      this.agents.set(agentConfig.name, agent);
    }

    // Custom agents from config
    for (const [key, agentConfig] of Object.entries(this.config.customAgents || {})) {
      const overrideConfig = { ...agentConfig, model: this.config.defaultModel, isCustom: true };
      const agent = new BaseAgent(
        overrideConfig,
        this.client,
        this.registry,
        cwd,
        sessionId,
      );
      this.agents.set(agentConfig.name, agent);
    }
  }

  /**
   * Process a user message
   */
  async processMessage(
    message: string,
    mode: 'auto' | 'agent' | 'direct' = 'auto',
    targetAgent?: string,
  ): Promise<{ content: string; usage: TokenUsage; execution?: AgentExecution }> {
    // Check spending limit via spending monitor
    const limitCheck = this.spendingMonitor.checkLimit();
    if (!limitCheck.allowed) {
      this.ui.error(`Spending limit reached (${limitCheck.limitReached}). Use /spending to check or /config to adjust.`);
      return { content: 'Spending limit reached.', usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
    }

    // Auto-activate skills based on prompt
    const activatedSkills = this.skillSystem.autoActivate(message);
    if (activatedSkills.length > 0) {
      for (const skill of activatedSkills) {
        this.ui.info(`Skill activated: ${skill.skill.name} (${skill.activatedBy})`);
      }
    }

    // Model routing (if auto mode)
    let routeDecision: RoutingDecision | null = null;
    if (mode === 'auto') {
      routeDecision = this.modelRouter.route(message);
      if (routeDecision.model !== this.config.defaultModel) {
        this.ui.info(`Model router: ${routeDecision.complexity} task -> ${MODELS[routeDecision.model]?.name || routeDecision.model}`);
      }
    }

    // Check prompt cache
    if (this.promptCache && this.config.promptCache.enabled) {
      const session = this.sessionManager.getCurrent();
      if (session) {
        const cached = this.promptCache.get(
          routeDecision?.model || this.config.defaultModel,
          session.messages,
        );
        if (cached) {
          this.ui.info('Cache hit - using cached response');
          return {
            content: cached.response,
            usage: { inputTokens: cached.inputTokens, outputTokens: cached.outputTokens, cost: 0 },
          };
        }
      }
    }

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

    // Build system prompt additions from skills and styles
    const skillAdditions = this.skillSystem.getSystemPromptAdditions();
    const styleAddition = this.styleManager.getSystemPromptAddition();
    const thinkingAddition = this.extendedThinking.getSystemPromptAddition();

    // Build UI callbacks
    const callbacks: AgentCallbacks = {
      onThinking: (thinking) => this.ui.thinking(thinking),
      onToken: (token) => this.ui.streamingToken(token),
      onToolCall: (name, args) => {
        // Check .neuroignore for file paths
        if (args.path && typeof args.path === 'string' && this.neuroIgnore.isIgnored(args.path)) {
          this.ui.warning(`Ignored path: ${args.path} (matches .neuroignore rule)`);
          return;
        }
        // Sandbox check before tool execution
        if (this.sandbox.isEnabled() && !this.checkSandboxForTool(name, args)) {
          return;
        }
        this.ui.toolCall(name, args);

        // Record in undo/redo for file modification tools
        if (['write_file', 'edit_file', 'apply_diff', 'delete_file'].includes(name)) {
          // The undo/redo push will happen in the tool execution result handler
        }
      },
      onToolResult: (name, result, isError) => this.ui.toolResult(name, result, isError),
      onApprovalNeeded: async (name, args, risk) => {
        return this.handleApproval(name, args, risk as 'low' | 'medium' | 'high');
      },
      onIteration: (i, max) => {
        this.ui.info(`Iteration ${i}/${max}`);
      },
    };

    let result;
    const activeModel = routeDecision?.model || this.config.defaultModel;

    if (mode === 'direct' && targetAgent) {
      const agent = this.agents.get(targetAgent);
      if (!agent) {
        this.ui.error(`Agent not found: ${targetAgent}`);
        return { content: '', usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
      }
      this.ui.startStreaming();
      result = await agent.run(message, callbacks);
      this.ui.endStreaming();
    } else if (mode === 'agent') {
      const orchestrateResult = await this.orchestrator.orchestrate(message, callbacks);
      result = {
        content: orchestrateResult.content,
        toolCallsMade: 0,
        iterations: orchestrateResult.execution.iterations,
        usage: orchestrateResult.totalUsage,
        execution: orchestrateResult.execution,
      };
    } else {
      const complexity = routeDecision?.complexity || this.assessComplexity(message);
      if (complexity === 'simple') {
        const agent = this.agents.get('Coder');
        if (agent) {
          this.ui.startStreaming();
          result = await agent.run(message, callbacks);
          this.ui.endStreaming();
        } else {
          throw new Error('Coder agent not initialized');
        }
      } else {
        this.ui.thinking('Analyzing task complexity... Using multi-agent orchestration');
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

    // Parse extended thinking blocks from response
    const thinkingResult = this.extendedThinking.parseResponse(result.content);
    if (thinkingResult.hadThinking && this.extendedThinking.isDisplayEnabled()) {
      // Thinking blocks were already displayed during streaming
    }
    // Use cleaned response (without thinking blocks) if thinking is hidden
    if (thinkingResult.hadThinking && !this.extendedThinking.isDisplayEnabled()) {
      result.content = thinkingResult.cleanedResponse;
    }

    // Record spending
    const spendResult = this.spendingMonitor.record({
      model: activeModel,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cost: result.usage.cost,
      sessionId: this.sessionManager.getCurrent()?.id || 'unknown',
    });
    if (spendResult.warning) {
      this.ui.warning(spendResult.warning);
    }
    if (!spendResult.allowed) {
      this.ui.error('Spending limit reached. Operation completed but further requests may be blocked.');
    }

    // Cache the response if caching is enabled
    if (this.promptCache && this.config.promptCache.enabled && session) {
      this.promptCache.set(activeModel, session.messages, result.content, result.usage);
    }

    // Print usage
    this.ui.tokenUsage(result.usage, activeModel);

    // Update session
    this.sessionManager.addMessage({
      role: 'assistant',
      content: result.content,
      timestamp: Date.now(),
    });
    this.sessionManager.updateUsage(
      result.usage.inputTokens,
      result.usage.outputTokens,
      result.usage.cost,
    );
    this.sessionManager.save();

    return {
      content: result.content,
      usage: result.usage,
      execution: result.execution,
    };
  }

  /**
   * Check sandbox permissions for a tool call
   */
  private checkSandboxForTool(toolName: string, args: Record<string, unknown>): boolean {
    // File operations
    if (['write_file', 'edit_file', 'apply_diff'].includes(toolName)) {
      const path = args.path as string;
      if (path && !this.sandbox.canWrite(path)) {
        this.ui.warning(`Sandbox: Write access denied for ${path}`);
        return false;
      }
      // Check neuroignore
      if (path && this.neuroIgnore.isIgnored(path)) {
        this.ui.warning(`Ignored: ${path} is in .neuroignore`);
        return false;
      }
      // Backup file before modification
      if (path) this.sandbox.backupFile(path);
    }

    if (['delete_file'].includes(toolName)) {
      const path = args.path as string;
      if (path && !this.sandbox.canDelete(path)) {
        this.ui.warning(`Sandbox: Delete access denied for ${path}`);
        return false;
      }
      if (path && this.neuroIgnore.isIgnored(path)) {
        this.ui.warning(`Ignored: ${path} is in .neuroignore`);
        return false;
      }
    }

    if (['read_file', 'search_files', 'list_directory'].includes(toolName)) {
      const path = (args.path || args.directory) as string;
      if (path && !this.sandbox.canRead(path)) {
        this.ui.warning(`Sandbox: Read access denied for ${path}`);
        return false;
      }
      if (path && this.neuroIgnore.isIgnored(path)) {
        this.ui.warning(`Ignored: ${path} is in .neuroignore`);
        return false;
      }
    }

    // Command execution
    if (['run_command', 'bash'].includes(toolName)) {
      const command = args.command as string;
      if (command && !this.sandbox.canRunCommand(command)) {
        this.ui.warning('Sandbox: Command execution denied');
        return false;
      }
    }

    // Network access
    if (['web_search', 'web_fetch'].includes(toolName)) {
      if (!this.sandbox.canAccessNetwork()) {
        this.ui.warning('Sandbox: Network access denied');
        return false;
      }
    }

    return true;
  }

  /**
   * Handle tool approval using the enhanced ApprovalSystem
   */
  private async handleApproval(
    toolName: string,
    args: Record<string, unknown>,
    risk: 'low' | 'medium' | 'high',
  ): Promise<boolean> {
    if (this.autoApproveSet.has(toolName)) return true;

    const result = await this.approval.requestApproval(toolName, args, risk);
    return result.approved;
  }

  /**
   * Assess task complexity to decide execution mode
   * Now delegates to ModelRouter for more sophisticated analysis
   */
  private assessComplexity(message: string): 'simple' | 'moderate' | 'complex' {
    const decision = this.modelRouter.route(message);
    return decision.complexity;
  }

  /**
   * Switch the active model
   */
  switchModel(modelId: string): boolean {
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
  getSessionStats(): { inputTokens: number; outputTokens: number; cost: number; messages: number } {
    const session = this.sessionManager.getCurrent();
    if (!session) return { inputTokens: 0, outputTokens: 0, cost: 0, messages: 0 };
    return {
      inputTokens: session.totalInputTokens,
      outputTokens: session.totalOutputTokens,
      cost: session.totalCost,
      messages: session.messages.length,
    };
  }

  /**
   * Register a custom agent
   */
  registerCustomAgent(name: string, config: { description: string; systemPrompt: string; tools?: string[]; maxIterations?: number }): void {
    const agentConfig = {
      name,
      description: config.description,
      systemPrompt: config.systemPrompt,
      model: this.config.defaultModel,
      temperature: 0.5,
      maxTokens: 8192,
      tools: config.tools || [],
      maxIterations: config.maxIterations || 10,
      isCustom: true,
    };

    const agent = new BaseAgent(
      agentConfig,
      this.client,
      this.registry,
      process.cwd(),
      this.sessionManager.getCurrent()?.id || 'default',
    );

    this.agents.set(name, agent);
    this.orchestrator.registerAgent(agent);

    // Save to config
    if (!this.config.customAgents) this.config.customAgents = {};
    this.config.customAgents[name] = agentConfig;
  }
}
