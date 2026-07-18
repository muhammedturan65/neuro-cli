// ============================================================
// NeuroCLI - Custom Agents Loader
// Loads agent definitions from .neuro/agents/ (project) and
// ~/.neuro/agents/ (global). Supports markdown files with YAML
// frontmatter, similar to Claude Code's agent system.
// ============================================================
import { readFileSync, readdirSync, existsSync, statSync, watchFile, unwatchFile } from 'fs';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
// ---------------------------------------------------------------------------
// Custom Agent Loader
// ---------------------------------------------------------------------------
export class CustomAgentLoader {
    agents;
    projectAgentsDir;
    globalAgentsDir;
    watchers = [];
    onChange;
    constructor(projectRoot, onChange) {
        this.agents = new Map();
        this.projectAgentsDir = join(projectRoot, '.neuro', 'agents');
        this.globalAgentsDir = join(homedir(), '.neuro', 'agents');
        this.onChange = onChange;
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Discover all custom agents from project and global directories.
     * Global agents are loaded first so project-level agents with the same
     * name take precedence (last-write-wins).
     */
    discover() {
        this.agents.clear();
        // Load global agents first (lower priority)
        this.loadFromDirectory(this.globalAgentsDir);
        // Load project agents second (higher priority, overrides global)
        this.loadFromDirectory(this.projectAgentsDir);
        return this.getAll();
    }
    /**
     * Get a single agent definition by name.
     */
    get(name) {
        return this.agents.get(name);
    }
    /**
     * Get all discovered custom agent definitions.
     */
    getAll() {
        return Array.from(this.agents.values());
    }
    /**
     * Convert a CustomAgentDefinition into a standard AgentConfig object
     * merged with default values.
     */
    toAgentConfig(def, defaultModel) {
        return {
            name: def.name,
            description: def.description,
            systemPrompt: def.systemPrompt,
            model: def.model ?? defaultModel,
            temperature: def.temperature ?? 0.7,
            maxTokens: def.maxTokens ?? 4096,
            tools: def.tools ?? [],
            maxIterations: def.maxIterations ?? 10,
            isCustom: true,
            tags: def.tags ?? [],
        };
    }
    /**
     * Print a formatted list of discovered custom agents to stdout.
     */
    printAgents() {
        const agents = this.getAll();
        if (agents.length === 0) {
            console.log('No custom agents found.');
            console.log('');
            console.log('  Place agent definition files in:');
            console.log(`    Project:  ${this.projectAgentsDir}/`);
            console.log(`    Global:   ${this.globalAgentsDir}/`);
            console.log('');
            console.log('  Agent files are markdown with YAML frontmatter:');
            console.log('    ---');
            console.log('    name: my-agent');
            console.log('    description: Does something useful');
            console.log('    ---');
            console.log('    System prompt body goes here...');
            return;
        }
        console.log(`Custom agents (${agents.length}):`);
        console.log('');
        for (const agent of agents) {
            const tags = agent.tags && agent.tags.length > 0
                ? ` [${agent.tags.join(', ')}]`
                : '';
            const model = agent.model ? ` (model: ${agent.model})` : '';
            const source = agent.source.includes('.neuro/agents/')
                ? agent.source.split('.neuro/agents/')[1]
                : agent.source;
            console.log(`  ${agent.name}${tags}${model}`);
            console.log(`    ${agent.description}`);
            console.log(`    source: ${source}`);
            console.log('');
        }
    }
    // -------------------------------------------------------------------------
    // Hot-reload
    // -------------------------------------------------------------------------
    /**
     * Enable file watching for hot-reload of agent definitions.
     * Calls the onChange callback (or re-discovers) when files change.
     */
    enableWatch() {
        this.disableWatch();
        const watchDir = (dir) => {
            if (!existsSync(dir))
                return;
            try {
                const entries = readdirSync(dir);
                for (const entry of entries) {
                    const fullPath = join(dir, entry);
                    if (!statSync(fullPath).isFile())
                        continue;
                    const ext = extname(entry).toLowerCase();
                    if (ext !== '.md' && ext !== '.markdown')
                        continue;
                    watchFile(fullPath, { interval: 2000 }, () => {
                        // Re-discover on change
                        this.discover();
                        this.onChange?.();
                    });
                    this.watchers.push({
                        path: fullPath,
                        close: () => unwatchFile(fullPath),
                    });
                }
            }
            catch {
                // Directory may not be readable; skip silently
            }
        };
        watchDir(this.globalAgentsDir);
        watchDir(this.projectAgentsDir);
    }
    /**
     * Disable all file watchers.
     */
    disableWatch() {
        for (const w of this.watchers) {
            w.close();
        }
        this.watchers = [];
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Load agent definitions from a single directory.
     */
    loadFromDirectory(dir) {
        if (!existsSync(dir))
            return;
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            // Directory not readable; skip
            return;
        }
        for (const entry of entries) {
            const fullPath = join(dir, entry);
            let stat;
            try {
                stat = statSync(fullPath);
            }
            catch {
                continue;
            }
            if (!stat.isFile())
                continue;
            const ext = extname(entry).toLowerCase();
            if (ext !== '.md' && ext !== '.markdown')
                continue;
            try {
                const content = readFileSync(fullPath, 'utf-8');
                const agent = this.parseAgentFile(content, fullPath);
                if (agent) {
                    this.agents.set(agent.name, agent);
                }
            }
            catch (err) {
                console.warn(`[custom-agents] Failed to parse ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    /**
     * Parse a markdown file with YAML frontmatter into a CustomAgentDefinition.
     *
     * Expected format:
     *   ---
     *   name: my-agent
     *   description: A helpful description
     *   model: claude-sonnet-4-20250514
     *   temperature: 0.5
     *   maxTokens: 2048
     *   tools:
     *     - read
     *     - write
     *   maxIterations: 5
     *   tags:
     *     - coding
     *     - review
     *   ---
     *   You are a specialized code review assistant...
     */
    parseAgentFile(content, filePath) {
        // Match frontmatter delimited by --- at the start of the file
        const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
        const match = content.match(frontmatterRegex);
        if (!match) {
            console.warn(`[custom-agents] No YAML frontmatter found in ${filePath}`);
            return null;
        }
        const yamlStr = match[1];
        const body = content.slice(match[0].length).trim();
        const raw = this.parseSimpleYaml(yamlStr);
        // Derive name: explicit > filename fallback
        const derivedName = typeof raw.name === 'string' && raw.name.trim()
            ? raw.name.trim()
            : basename(filePath, extname(filePath));
        // Derive description
        const description = typeof raw.description === 'string' && raw.description.trim()
            ? raw.description.trim()
            : '';
        // Validate required fields
        if (!body) {
            console.warn(`[custom-agents] Missing system prompt body in ${filePath}`);
            return null;
        }
        if (!description) {
            console.warn(`[custom-agents] Missing "description" field in frontmatter of ${filePath}`);
            return null;
        }
        // Parse optional fields with type coercion
        const model = typeof raw.model === 'string' ? raw.model : undefined;
        const temperature = typeof raw.temperature === 'number'
            ? raw.temperature
            : typeof raw.temperature === 'string'
                ? parseFloat(raw.temperature)
                : undefined;
        const validTemperature = temperature !== undefined && !isNaN(temperature)
            ? temperature
            : undefined;
        const maxTokens = typeof raw.maxTokens === 'number'
            ? raw.maxTokens
            : typeof raw.maxTokens === 'string'
                ? parseInt(raw.maxTokens, 10)
                : undefined;
        const validMaxTokens = maxTokens !== undefined && !isNaN(maxTokens) && maxTokens > 0
            ? maxTokens
            : undefined;
        const maxIterations = typeof raw.maxIterations === 'number'
            ? raw.maxIterations
            : typeof raw.maxIterations === 'string'
                ? parseInt(raw.maxIterations, 10)
                : undefined;
        const validMaxIterations = maxIterations !== undefined && !isNaN(maxIterations) && maxIterations > 0
            ? maxIterations
            : undefined;
        const tools = Array.isArray(raw.tools)
            ? raw.tools.filter((t) => typeof t === 'string')
            : undefined;
        const tags = Array.isArray(raw.tags)
            ? raw.tags.filter((t) => typeof t === 'string')
            : undefined;
        return {
            name: derivedName,
            description,
            systemPrompt: body,
            model,
            temperature: validTemperature,
            maxTokens: validMaxTokens,
            tools,
            maxIterations: validMaxIterations,
            tags,
            isCustom: true,
            source: filePath,
        };
    }
    /**
     * Minimal YAML parser that handles the flat key-value structures and
     * simple arrays typical of agent frontmatter.
     *
     * Supports:
     *   key: value
     *   key: "quoted value"
     *   key:
     *     - item1
     *     - item2
     *   key:
     *     - "quoted item"
     *
     * Does NOT support:
     *   Nested objects, multiline strings (|, >), anchors, etc.
     */
    parseSimpleYaml(yaml) {
        const result = {};
        const lines = yaml.split(/\r?\n/);
        let currentKey = null;
        let currentArray = null;
        const unquote = (s) => {
            const trimmed = s.trim();
            if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
                (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
                return trimmed.slice(1, -1);
            }
            return trimmed;
        };
        const coerceValue = (s) => {
            const trimmed = s.trim();
            if (trimmed === '')
                return null;
            // Quoted strings stay as strings
            if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
                (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
                return unquote(trimmed);
            }
            // Booleans
            if (trimmed.toLowerCase() === 'true')
                return true;
            if (trimmed.toLowerCase() === 'false')
                return false;
            // Null
            if (trimmed.toLowerCase() === 'null' || trimmed === '~')
                return null;
            // Numbers
            const asNum = Number(trimmed);
            if (trimmed !== '' && !isNaN(asNum) && isFinite(asNum)) {
                return asNum;
            }
            return trimmed;
        };
        for (const line of lines) {
            // Skip empty lines and comments
            if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
                continue;
            }
            // Array item: "  - value"
            const arrayMatch = line.match(/^(\s+)-\s+(.*)$/);
            if (arrayMatch && currentKey !== null && currentArray !== null) {
                const itemValue = coerceValue(arrayMatch[2]);
                if (itemValue !== null) {
                    currentArray.push(itemValue);
                }
                continue;
            }
            // Key-value pair: "key: value"
            const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
            if (kvMatch) {
                // Flush previous array if any
                if (currentKey !== null && currentArray !== null) {
                    result[currentKey] = currentArray;
                }
                currentKey = kvMatch[1];
                const rawValue = kvMatch[2].trim();
                // Key with no value on this line -> start array
                if (rawValue === '') {
                    currentArray = [];
                }
                else {
                    const value = coerceValue(rawValue);
                    result[currentKey] = value;
                    currentArray = null;
                }
                continue;
            }
            // Fallback: treat indented lines under an array key as array items
            if (currentKey !== null && currentArray !== null) {
                const stripped = line.trim();
                if (stripped.startsWith('- ')) {
                    const itemValue = coerceValue(stripped.slice(2));
                    if (itemValue !== null) {
                        currentArray.push(itemValue);
                    }
                }
            }
        }
        // Flush last array
        if (currentKey !== null && currentArray !== null) {
            result[currentKey] = currentArray;
        }
        return result;
    }
}
//# sourceMappingURL=custom-agents.js.map