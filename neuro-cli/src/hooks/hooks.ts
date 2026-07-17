// ============================================================
// NeuroCLI - Hooks System
// Lifecycle event hooks (like Claude Code's 30+ events)
// ============================================================

export type HookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'BeforeAgent'
  | 'AfterAgent'
  | 'BeforeModel'
  | 'AfterModel'
  | 'BeforeTool'
  | 'AfterTool'
  | 'AfterToolFailure'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'PostCompact'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'FileChanged'
  | 'CwdChanged'
  | 'ConfigChange';

export type HookType = 'command' | 'http' | 'prompt' | 'agent';

export interface HookDefinition {
  event: HookEvent;
  type: HookType;
  command?: string;           // Shell command to run
  url?: string;               // HTTP URL to POST
  prompt?: string;            // LLM prompt to evaluate
  matcher?: string;           // Filter by tool name or pattern
  enabled?: boolean;
}

export interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  prompt?: string;
  modelResponse?: string;
  error?: string;
  workingDirectory: string;
  sessionId: string;
  timestamp: number;
}

export interface HookResult {
  action: 'continue' | 'block' | 'modify' | 'retry';
  modifiedArgs?: Record<string, unknown>;
  modifiedPrompt?: string;
  additionalContext?: string;
  reason?: string;
}

export class HooksSystem {
  private hooks: Map<HookEvent, HookDefinition[]> = new Map();
  private globalHooks: HookDefinition[] = [];

  /**
   * Register a hook
   */
  register(hook: HookDefinition): void {
    if (!this.hooks.has(hook.event)) {
      this.hooks.set(hook.event, []);
    }
    this.hooks.get(hook.event)!.push(hook);
  }

  /**
   * Register a global hook that fires on all events
   */
  registerGlobal(hook: HookDefinition): void {
    this.globalHooks.push(hook);
  }

  /**
   * Unregister a hook
   */
  unregister(event: HookEvent, index: number): void {
    const hooks = this.hooks.get(event);
    if (hooks) hooks.splice(index, 1);
  }

  /**
   * Get all hooks for an event
   */
  getHooks(event: HookEvent): HookDefinition[] {
    return this.hooks.get(event) || [];
  }

  /**
   * Execute all hooks for an event
   */
  async execute(event: HookEvent, context: HookContext): Promise<HookResult> {
    const hooks = [
      ...this.globalHooks.filter(h => h.enabled !== false),
      ...(this.hooks.get(event) || []).filter(h => h.enabled !== false),
    ];

    // Filter by matcher
    const matchingHooks = hooks.filter(h => {
      if (!h.matcher) return true;
      if (context.toolName) {
        return new RegExp(h.matcher).test(context.toolName);
      }
      return true;
    });

    for (const hook of matchingHooks) {
      const result = await this.executeHook(hook, context);
      if (result.action === 'block') {
        return result; // Stop on block
      }
      if (result.action === 'modify' && result.modifiedArgs) {
        context.toolArgs = { ...context.toolArgs, ...result.modifiedArgs };
      }
      if (result.additionalContext) {
        // Inject additional context for the LLM
      }
    }

    return { action: 'continue' };
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: HookDefinition, context: HookContext): Promise<HookResult> {
    switch (hook.type) {
      case 'command':
        return this.executeCommandHook(hook, context);
      case 'http':
        return this.executeHttpHook(hook, context);
      case 'prompt':
        return { action: 'continue', additionalContext: hook.prompt };
      case 'agent':
        return { action: 'continue', additionalContext: hook.command };
      default:
        return { action: 'continue' };
    }
  }

  private async executeCommandHook(hook: HookDefinition, context: HookContext): Promise<HookResult> {
    if (!hook.command) return { action: 'continue' };

    try {
      const { execSync } = await import('child_process');
      const env = {
        NEURO_EVENT: context.event,
        NEURO_TOOL: context.toolName || '',
        NEURO_SESSION: context.sessionId,
        NEURO_CWD: context.workingDirectory,
      };

      const result = execSync(hook.command, {
        encoding: 'utf-8',
        cwd: context.workingDirectory,
        timeout: 10000,
        env: { ...process.env, ...env },
      }).trim();

      // Parse hook output for actions
      if (result.startsWith('BLOCK:')) {
        return { action: 'block', reason: result.replace('BLOCK:', '').trim() };
      }
      if (result.startsWith('CONTEXT:')) {
        return { action: 'continue', additionalContext: result.replace('CONTEXT:', '').trim() };
      }

      return { action: 'continue' };
    } catch (error) {
      return { action: 'continue', reason: `Hook error: ${error}` };
    }
  }

  private async executeHttpHook(hook: HookDefinition, context: HookContext): Promise<HookResult> {
    if (!hook.url) return { action: 'continue' };

    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json() as any;
        return {
          action: data.action || 'continue',
          additionalContext: data.context,
          reason: data.reason,
        };
      }

      return { action: 'continue' };
    } catch {
      return { action: 'continue', reason: 'HTTP hook failed' };
    }
  }

  /**
   * Load hooks from config
   */
  loadFromConfig(config: { hooks?: HookDefinition[] }): void {
    if (config.hooks) {
      for (const hook of config.hooks) {
        this.register(hook);
      }
    }
  }

  /**
   * List all registered hooks
   */
  list(): Array<{ event: HookEvent; hooks: HookDefinition[] }> {
    const result: Array<{ event: HookEvent; hooks: HookDefinition[] }> = [];
    for (const [event, hooks] of this.hooks) {
      result.push({ event, hooks });
    }
    return result;
  }
}
