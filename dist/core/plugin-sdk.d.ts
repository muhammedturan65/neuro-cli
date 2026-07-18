import { ToolDefinition } from './types.js';
export interface NeuroPlugin {
    /** Unique plugin name */
    name: string;
    /** Plugin version */
    version: string;
    /** Plugin description */
    description: string;
    /** Author name */
    author?: string;
    /** Tools provided by this plugin */
    tools: NeuroTool[];
    /** Initialize hook - called when plugin is loaded */
    onInit?: (context: PluginContext) => void | Promise<void>;
    /** Cleanup hook - called when plugin is unloaded */
    onDestroy?: () => void | Promise<void>;
}
export interface NeuroTool {
    /** Tool definition for the AI model */
    definition: ToolDefinition;
    /** Risk level for approval system */
    risk: 'low' | 'medium' | 'high';
    /** Implementation function */
    execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}
export interface ToolExecutionContext {
    /** Current working directory */
    workingDirectory: string;
    /** Session ID */
    sessionId: string;
    /** Agent name using this tool */
    agentName: string;
    /** Send progress updates to the UI */
    onProgress: (message: string) => void;
    /** Access to other tools */
    callTool: (toolName: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
    /** Access to session memory */
    memory: PluginMemory;
}
export interface ToolExecutionResult {
    content: string;
    isError?: boolean;
    metadata?: Record<string, unknown>;
}
export interface PluginContext {
    /** Plugin configuration directory (~/.neuro/plugins/<name>/) */
    configDir: string;
    /** Plugin data directory for persistent storage */
    dataDir: string;
    /** Logger */
    log: (level: 'info' | 'warn' | 'error', message: string) => void;
    /** Access NeuroCLI configuration */
    getConfig: () => Record<string, unknown>;
}
export interface PluginMemory {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    list(): Array<{
        key: string;
        value: string;
    }>;
}
export declare class PluginManager {
    private plugins;
    private pluginContexts;
    private pluginMemories;
    /**
     * Load a plugin from a file path
     */
    loadFromPath(pluginPath: string): Promise<void>;
    /**
     * Load a plugin from the plugins directory
     */
    loadByName(name: string): Promise<void>;
    /**
     * Load all plugins from the plugins directory
     */
    loadAll(): Promise<number>;
    /**
     * Register a plugin
     */
    register(plugin: NeuroPlugin): Promise<void>;
    /**
     * Unregister a plugin
     */
    unregister(name: string): Promise<void>;
    /**
     * Get all plugin tools as tool definitions
     */
    getToolDefinitions(): Array<ToolDefinition & {
        risk: 'low' | 'medium' | 'high';
        pluginName: string;
    }>;
    /**
     * Execute a plugin tool
     */
    executeTool(fullToolName: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult>;
    /**
     * Parse a plugin tool name (plugin_name__tool_name)
     */
    parsePluginToolName(fullName: string): {
        pluginName: string;
        toolName: string;
    } | null;
    /**
     * List all loaded plugins
     */
    listPlugins(): Array<{
        name: string;
        version: string;
        description: string;
        toolCount: number;
        author?: string;
    }>;
    /**
     * Check if a tool name belongs to a plugin
     */
    isPluginTool(toolName: string): boolean;
    private loadPluginMemory;
    private savePluginMemory;
}
/**
 * Create a simple plugin with minimal boilerplate
 */
export declare function createPlugin(config: {
    name: string;
    version: string;
    description: string;
    author?: string;
    tools: Array<{
        name: string;
        description: string;
        parameters: ToolDefinition['parameters'];
        risk?: 'low' | 'medium' | 'high';
        execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<string>;
    }>;
}): NeuroPlugin;
//# sourceMappingURL=plugin-sdk.d.ts.map