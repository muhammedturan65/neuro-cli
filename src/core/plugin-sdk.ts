// ============================================================
// NeuroCLI - Plugin / Custom Tools SDK
// Allows users to define and register custom tools
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { ToolDefinition } from './types.js';

// --- Plugin Types ---

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
  list(): Array<{ key: string; value: string }>;
}

// --- Plugin Manager ---

const PLUGINS_DIR = join(homedir(), '.neuro', 'plugins');

export class PluginManager {
  private plugins: Map<string, NeuroPlugin> = new Map();
  private pluginContexts: Map<string, PluginContext> = new Map();
  private pluginMemories: Map<string, Map<string, string>> = new Map();

  /**
   * Load a plugin from a file path
   */
  async loadFromPath(pluginPath: string): Promise<void> {
    try {
      // Dynamic import for ESM plugins
      const module = await import(pluginPath);
      const plugin: NeuroPlugin = module.default || module;

      if (!plugin.name || !plugin.tools) {
        throw new Error('Invalid plugin: missing name or tools');
      }

      await this.register(plugin);
    } catch (error) {
      console.error(chalk.red(`  Failed to load plugin from ${pluginPath}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  /**
   * Load a plugin from the plugins directory
   */
  async loadByName(name: string): Promise<void> {
    const pluginPath = join(PLUGINS_DIR, name, 'index.js');
    if (!existsSync(pluginPath)) {
      throw new Error(`Plugin "${name}" not found at ${pluginPath}`);
    }
    await this.loadFromPath(pluginPath);
  }

  /**
   * Load all plugins from the plugins directory
   */
  async loadAll(): Promise<number> {
    if (!existsSync(PLUGINS_DIR)) return 0;

    let loaded = 0;
    const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const indexPath = join(PLUGINS_DIR, entry.name, 'index.js');
        if (existsSync(indexPath)) {
          try {
            await this.loadFromPath(indexPath);
            loaded++;
          } catch (error) {
            console.error(chalk.yellow(`  Plugin "${entry.name}" failed to load: ${error instanceof Error ? error.message : String(error)}`));
          }
        }
      }
    }

    return loaded;
  }

  /**
   * Register a plugin
   */
  async register(plugin: NeuroPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      await this.unregister(plugin.name);
    }

    // Set up plugin context
    const pluginDir = join(PLUGINS_DIR, plugin.name);
    const dataDir = join(pluginDir, 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const memory = new Map<string, string>();
    this.pluginMemories.set(plugin.name, memory);
    this.loadPluginMemory(plugin.name, memory);

    const context: PluginContext = {
      configDir: pluginDir,
      dataDir,
      log: (level, message) => {
        const prefix = chalk.gray(`[plugin:${plugin.name}]`);
        switch (level) {
          case 'info': console.log(`${prefix} ${message}`); break;
          case 'warn': console.log(`${prefix} ${chalk.yellow(message)}`); break;
          case 'error': console.log(`${prefix} ${chalk.red(message)}`); break;
        }
      },
      getConfig: () => {
        const configPath = join(pluginDir, 'config.json');
        if (existsSync(configPath)) {
          try { return JSON.parse(readFileSync(configPath, 'utf-8')); } catch { return {}; }
        }
        return {};
      },
    };

    this.pluginContexts.set(plugin.name, context);
    this.plugins.set(plugin.name, plugin);

    // Initialize plugin
    if (plugin.onInit) {
      try {
        await plugin.onInit(context);
      } catch (error) {
        console.error(chalk.yellow(`  Plugin "${plugin.name}" init failed: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    console.log(chalk.green(`  ✓ Plugin loaded: ${plugin.name} v${plugin.version} (${plugin.tools.length} tools)`));
  }

  /**
   * Unregister a plugin
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    if (plugin.onDestroy) {
      try { await plugin.onDestroy(); } catch {}
    }

    this.savePluginMemory(name);
    this.plugins.delete(name);
    this.pluginContexts.delete(name);
    this.pluginMemories.delete(name);
  }

  /**
   * Get all plugin tools as tool definitions
   */
  getToolDefinitions(): Array<ToolDefinition & { risk: 'low' | 'medium' | 'high'; pluginName: string }> {
    const definitions: Array<ToolDefinition & { risk: 'low' | 'medium' | 'high'; pluginName: string }> = [];
    for (const [pluginName, plugin] of this.plugins) {
      for (const tool of plugin.tools) {
        definitions.push({
          ...tool.definition,
          name: `plugin_${pluginName}__${tool.definition.name}`,
          risk: tool.risk,
          pluginName,
        });
      }
    }
    return definitions;
  }

  /**
   * Execute a plugin tool
   */
  async executeTool(
    fullToolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const parsed = this.parsePluginToolName(fullToolName);
    if (!parsed) throw new Error(`Not a plugin tool: ${fullToolName}`);

    const { pluginName, toolName } = parsed;
    const plugin = this.plugins.get(pluginName);
    if (!plugin) throw new Error(`Plugin not found: ${pluginName}`);

    const tool = plugin.tools.find(t => t.definition.name === toolName);
    if (!tool) throw new Error(`Tool "${toolName}" not found in plugin "${pluginName}"`);

    // Extend context with plugin memory
    const memory = this.pluginMemories.get(pluginName) || new Map();
    const extendedContext: ToolExecutionContext = {
      ...context,
      memory: {
        get: (key) => memory.get(key),
        set: (key, value) => memory.set(key, value),
        delete: (key) => memory.delete(key),
        list: () => Array.from(memory.entries()).map(([key, value]) => ({ key, value })),
      },
    };

    try {
      return await tool.execute(args, extendedContext);
    } catch (error) {
      return {
        content: `Plugin tool error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  /**
   * Parse a plugin tool name (plugin_name__tool_name)
   */
  parsePluginToolName(fullName: string): { pluginName: string; toolName: string } | null {
    if (!fullName.startsWith('plugin_')) return null;
    const rest = fullName.slice(7);
    const sep = rest.indexOf('__');
    if (sep === -1) return null;
    return { pluginName: rest.slice(0, sep), toolName: rest.slice(sep + 2) };
  }

  /**
   * List all loaded plugins
   */
  listPlugins(): Array<{ name: string; version: string; description: string; toolCount: number; author?: string }> {
    return Array.from(this.plugins.entries()).map(([name, plugin]) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      toolCount: plugin.tools.length,
      author: plugin.author,
    }));
  }

  /**
   * Check if a tool name belongs to a plugin
   */
  isPluginTool(toolName: string): boolean {
    return toolName.startsWith('plugin_') && toolName.includes('__');
  }

  // --- Plugin Memory Persistence ---

  private loadPluginMemory(pluginName: string, memory: Map<string, string>): void {
    const memPath = join(PLUGINS_DIR, pluginName, 'memory.json');
    if (existsSync(memPath)) {
      try {
        const data = JSON.parse(readFileSync(memPath, 'utf-8'));
        for (const [key, value] of Object.entries(data)) {
          memory.set(key, value as string);
        }
      } catch {}
    }
  }

  private savePluginMemory(pluginName: string): void {
    const memory = this.pluginMemories.get(pluginName);
    if (!memory || memory.size === 0) return;

    const memPath = join(PLUGINS_DIR, pluginName, 'memory.json');
    const dir = join(memPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const data = Object.fromEntries(memory);
    writeFileSync(memPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

// --- Plugin Template Helper ---

/**
 * Create a simple plugin with minimal boilerplate
 */
export function createPlugin(config: {
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
}): NeuroPlugin {
  return {
    name: config.name,
    version: config.version,
    description: config.description,
    author: config.author,
    tools: config.tools.map(tool => ({
      definition: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
      risk: tool.risk || 'medium',
      execute: async (args, context) => {
        const content = await tool.execute(args, context);
        return { content };
      },
    })),
  };
}
