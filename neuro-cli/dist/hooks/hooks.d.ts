export type HookEvent = 'SessionStart' | 'SessionEnd' | 'BeforeAgent' | 'AfterAgent' | 'BeforeModel' | 'AfterModel' | 'BeforeTool' | 'AfterTool' | 'AfterToolFailure' | 'PermissionRequest' | 'PermissionDenied' | 'UserPromptSubmit' | 'PreCompact' | 'PostCompact' | 'SubagentStart' | 'SubagentStop' | 'FileChanged' | 'CwdChanged' | 'ConfigChange';
export type HookType = 'command' | 'http' | 'prompt' | 'agent';
export interface HookDefinition {
    event: HookEvent;
    type: HookType;
    command?: string;
    url?: string;
    prompt?: string;
    matcher?: string;
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
export declare class HooksSystem {
    private hooks;
    private globalHooks;
    /**
     * Register a hook
     */
    register(hook: HookDefinition): void;
    /**
     * Register a global hook that fires on all events
     */
    registerGlobal(hook: HookDefinition): void;
    /**
     * Unregister a hook
     */
    unregister(event: HookEvent, index: number): void;
    /**
     * Get all hooks for an event
     */
    getHooks(event: HookEvent): HookDefinition[];
    /**
     * Execute all hooks for an event
     */
    execute(event: HookEvent, context: HookContext): Promise<HookResult>;
    /**
     * Execute a single hook
     */
    private executeHook;
    private executeCommandHook;
    private executeHttpHook;
    /**
     * Load hooks from config
     */
    loadFromConfig(config: {
        hooks?: HookDefinition[];
    }): void;
    /**
     * List all registered hooks
     */
    list(): Array<{
        event: HookEvent;
        hooks: HookDefinition[];
    }>;
}
//# sourceMappingURL=hooks.d.ts.map