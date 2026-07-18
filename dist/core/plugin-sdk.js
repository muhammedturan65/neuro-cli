// ============================================================
// NeuroCLI - Plugin / Custom Tools SDK
// Allows users to define and register custom tools
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
// --- Plugin Manager ---
const PLUGINS_DIR = join(homedir(), '.neuro', 'plugins');
export class PluginManager {
    plugins = new Map();
    pluginContexts = new Map();
    pluginMemories = new Map();
    /**
     * Load a plugin from a file path
     */
    async loadFromPath(pluginPath) {
        try {
            // Dynamic import for ESM plugins
            const module = await import(pluginPath);
            const plugin = module.default || module;
            if (!plugin.name || !plugin.tools) {
                throw new Error('Invalid plugin: missing name or tools');
            }
            await this.register(plugin);
        }
        catch (error) {
            console.error(chalk.red(`  Failed to load plugin from ${pluginPath}: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    /**
     * Load a plugin from the plugins directory
     */
    async loadByName(name) {
        const pluginPath = join(PLUGINS_DIR, name, 'index.js');
        if (!existsSync(pluginPath)) {
            throw new Error(`Plugin "${name}" not found at ${pluginPath}`);
        }
        await this.loadFromPath(pluginPath);
    }
    /**
     * Load all plugins from the plugins directory
     */
    async loadAll() {
        if (!existsSync(PLUGINS_DIR))
            return 0;
        let loaded = 0;
        const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const indexPath = join(PLUGINS_DIR, entry.name, 'index.js');
                if (existsSync(indexPath)) {
                    try {
                        await this.loadFromPath(indexPath);
                        loaded++;
                    }
                    catch (error) {
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
    async register(plugin) {
        if (this.plugins.has(plugin.name)) {
            await this.unregister(plugin.name);
        }
        // Set up plugin context
        const pluginDir = join(PLUGINS_DIR, plugin.name);
        const dataDir = join(pluginDir, 'data');
        if (!existsSync(dataDir))
            mkdirSync(dataDir, { recursive: true });
        const memory = new Map();
        this.pluginMemories.set(plugin.name, memory);
        this.loadPluginMemory(plugin.name, memory);
        const context = {
            configDir: pluginDir,
            dataDir,
            log: (level, message) => {
                const prefix = chalk.gray(`[plugin:${plugin.name}]`);
                switch (level) {
                    case 'info':
                        console.log(`${prefix} ${message}`);
                        break;
                    case 'warn':
                        console.log(`${prefix} ${chalk.yellow(message)}`);
                        break;
                    case 'error':
                        console.log(`${prefix} ${chalk.red(message)}`);
                        break;
                }
            },
            getConfig: () => {
                const configPath = join(pluginDir, 'config.json');
                if (existsSync(configPath)) {
                    try {
                        return JSON.parse(readFileSync(configPath, 'utf-8'));
                    }
                    catch {
                        return {};
                    }
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
            }
            catch (error) {
                console.error(chalk.yellow(`  Plugin "${plugin.name}" init failed: ${error instanceof Error ? error.message : String(error)}`));
            }
        }
        console.log(chalk.green(`  ✓ Plugin loaded: ${plugin.name} v${plugin.version} (${plugin.tools.length} tools)`));
    }
    /**
     * Unregister a plugin
     */
    async unregister(name) {
        const plugin = this.plugins.get(name);
        if (!plugin)
            return;
        if (plugin.onDestroy) {
            try {
                await plugin.onDestroy();
            }
            catch { }
        }
        this.savePluginMemory(name);
        this.plugins.delete(name);
        this.pluginContexts.delete(name);
        this.pluginMemories.delete(name);
    }
    /**
     * Get all plugin tools as tool definitions
     */
    getToolDefinitions() {
        const definitions = [];
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
    async executeTool(fullToolName, args, context) {
        const parsed = this.parsePluginToolName(fullToolName);
        if (!parsed)
            throw new Error(`Not a plugin tool: ${fullToolName}`);
        const { pluginName, toolName } = parsed;
        const plugin = this.plugins.get(pluginName);
        if (!plugin)
            throw new Error(`Plugin not found: ${pluginName}`);
        const tool = plugin.tools.find(t => t.definition.name === toolName);
        if (!tool)
            throw new Error(`Tool "${toolName}" not found in plugin "${pluginName}"`);
        // Extend context with plugin memory
        const memory = this.pluginMemories.get(pluginName) || new Map();
        const extendedContext = {
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
        }
        catch (error) {
            return {
                content: `Plugin tool error: ${error instanceof Error ? error.message : String(error)}`,
                isError: true,
            };
        }
    }
    /**
     * Parse a plugin tool name (plugin_name__tool_name)
     */
    parsePluginToolName(fullName) {
        if (!fullName.startsWith('plugin_'))
            return null;
        const rest = fullName.slice(7);
        const sep = rest.indexOf('__');
        if (sep === -1)
            return null;
        return { pluginName: rest.slice(0, sep), toolName: rest.slice(sep + 2) };
    }
    /**
     * List all loaded plugins
     */
    listPlugins() {
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
    isPluginTool(toolName) {
        return toolName.startsWith('plugin_') && toolName.includes('__');
    }
    // --- Plugin Memory Persistence ---
    loadPluginMemory(pluginName, memory) {
        const memPath = join(PLUGINS_DIR, pluginName, 'memory.json');
        if (existsSync(memPath)) {
            try {
                const data = JSON.parse(readFileSync(memPath, 'utf-8'));
                for (const [key, value] of Object.entries(data)) {
                    memory.set(key, value);
                }
            }
            catch { }
        }
    }
    savePluginMemory(pluginName) {
        const memory = this.pluginMemories.get(pluginName);
        if (!memory || memory.size === 0)
            return;
        const memPath = join(PLUGINS_DIR, pluginName, 'memory.json');
        const dir = join(memPath, '..');
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        const data = Object.fromEntries(memory);
        writeFileSync(memPath, JSON.stringify(data, null, 2), 'utf-8');
    }
}
// --- Plugin Template Helper ---
/**
 * Create a simple plugin with minimal boilerplate
 */
export function createPlugin(config) {
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
//# sourceMappingURL=plugin-sdk.js.map