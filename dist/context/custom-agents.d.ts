export interface CustomAgentDefinition {
    name: string;
    description: string;
    systemPrompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: string[];
    maxIterations?: number;
    tags?: string[];
    isCustom: boolean;
    source: string;
}
export declare class CustomAgentLoader {
    private agents;
    private projectAgentsDir;
    private globalAgentsDir;
    private watchers;
    private onChange?;
    constructor(projectRoot: string, onChange?: () => void);
    /**
     * Discover all custom agents from project and global directories.
     * Global agents are loaded first so project-level agents with the same
     * name take precedence (last-write-wins).
     */
    discover(): CustomAgentDefinition[];
    /**
     * Get a single agent definition by name.
     */
    get(name: string): CustomAgentDefinition | undefined;
    /**
     * Get all discovered custom agent definitions.
     */
    getAll(): CustomAgentDefinition[];
    /**
     * Convert a CustomAgentDefinition into a standard AgentConfig object
     * merged with default values.
     */
    toAgentConfig(def: CustomAgentDefinition, defaultModel: string): {
        name: string;
        description: string;
        systemPrompt: string;
        model: string;
        temperature: number;
        maxTokens: number;
        tools: string[];
        maxIterations: number;
        isCustom: boolean;
        tags: string[];
    };
    /**
     * Print a formatted list of discovered custom agents to stdout.
     */
    printAgents(): void;
    /**
     * Enable file watching for hot-reload of agent definitions.
     * Calls the onChange callback (or re-discovers) when files change.
     */
    enableWatch(): void;
    /**
     * Disable all file watchers.
     */
    disableWatch(): void;
    /**
     * Load agent definitions from a single directory.
     */
    private loadFromDirectory;
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
    private parseAgentFile;
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
    private parseSimpleYaml;
}
//# sourceMappingURL=custom-agents.d.ts.map