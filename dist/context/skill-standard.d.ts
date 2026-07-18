/**
 * NeuroCLI — SKILL.md Standard Compliance System
 *
 * Implements the agentskills.io specification for SKILL.md files.
 * Provides auto-discovery, parsing, activation, registry, and
 * cross-tool compatibility with Claude Code, Codex CLI, and GitHub Copilot.
 *
 * Uses only Node.js built-in modules (fs, path, os, crypto, https, http, url).
 */
/**
 * Represents a fully-parsed SKILL.md definition conforming to the
 * agentskills.io specification.
 */
export interface StandardSkillDefinition {
    /** Unique skill name (lowercase, hyphens, max 64 chars) — REQUIRED */
    name: string;
    /** Trigger condition for agent activation — REQUIRED */
    description: string;
    /** Semantic version string — optional */
    version?: string;
    /** Author or organisation — optional */
    author?: string;
    /** Searchable tags — optional */
    tags?: string[];
    /** Tools this skill requires access to — optional */
    tools?: string[];
    /** Priority 0-100 (higher = more important) — optional, default 50 */
    priority?: number;
    /** Invocation mode: "explicit" (user-triggered) or "auto" (agent decides) */
    invoke?: "explicit" | "auto";
    /** Load timing: "startup" or "on-demand" — optional, default "on-demand" */
    load?: "startup" | "on-demand";
    /** Full Markdown body after frontmatter */
    body: string;
    /** Absolute file-system path to the SKILL.md file */
    filePath: string;
    /** Source of the skill: "global" or "project" */
    source: "global" | "project";
}
/**
 * Minimal representation used for the compact listing that the agent sees
 * when deciding which skill to activate.
 */
export interface SkillCompactEntry {
    name: string;
    description: string;
    priority: number;
    invoke: "explicit" | "auto";
    load: "startup" | "on-demand";
}
/**
 * Result of parsing a SKILL.md file — includes both the definition and
 * any validation warnings encountered.
 */
export interface ParseResult {
    skill: StandardSkillDefinition | null;
    warnings: string[];
    errors: string[];
}
/**
 * Represents an entry in the Neuro skill registry (local or remote).
 */
export interface SkillRegistryEntry {
    /** Unique skill name */
    name: string;
    /** Human-readable description */
    description: string;
    /** Semantic version */
    version: string;
    /** Author */
    author: string;
    /** Tags */
    tags: string[];
    /** Download URL or local path */
    source: string;
    /** SHA-256 checksum of the SKILL.md content */
    checksum: string;
    /** ISO-8601 timestamp of when the entry was added */
    addedAt: string;
    /** Whether the skill is currently installed locally */
    installed: boolean;
}
/**
 * Options for the SkillStandard constructor.
 */
export interface SkillStandardOptions {
    /** Override the global skills directory (default: ~/.neuro/skills) */
    globalSkillsDir?: string;
    /** Override the project skills directory (default: .neuro/skills) */
    projectSkillsDir?: string;
    /** Whether to enable caching (default: true) */
    enableCache?: boolean;
    /** Cache TTL in milliseconds (default: 300 000) */
    cacheTtlMs?: number;
    /** Custom registry base URL (default: https://registry.agentskills.io) */
    registryBaseUrl?: string;
}
/**
 * Detect the skill format from the file name.
 */
type SkillFormat = "neuro" | "claude" | "codex" | "copilot";
/**
 * Core class implementing the agentskills.io SKILL.md standard compliance
 * system for NeuroCLI.
 *
 * Handles discovery, parsing, activation, installation, search, publishing,
 * and cross-tool compatibility.
 */
export declare class SkillStandard {
    private globalSkillsDir;
    private projectSkillsDir;
    private enableCache;
    private cacheTtlMs;
    private registryBaseUrl;
    /** In-memory skill definitions, keyed by name */
    private skills;
    /** Compact listing cache for agent activation */
    private compactListing;
    /** Internal cache */
    private cache;
    /** Local registry index (file-backed) */
    private registryIndex;
    /** Path to the local registry file */
    private registryFilePath;
    /** Whether discovery has been run at least once */
    private discovered;
    constructor(options?: SkillStandardOptions);
    /**
     * Discover all skills from both global and project directories.
     * Reads ONLY the `name` and `description` from each skill's YAML
     * frontmatter for the compact listing, but also caches full definitions.
     *
     * @param projectRoot - The root directory of the current project
     * @returns Array of compact skill entries for agent activation
     */
    discoverSkills(projectRoot: string): SkillCompactEntry[];
    /**
     * Parse a SKILL.md file according to the agentskills.io specification.
     * Supports cross-tool format detection and automatic adaptation.
     *
     * @param filePath - Absolute path to the SKILL.md (or compatible) file
     * @returns Parse result with skill definition, warnings, and errors
     */
    parseSkillMd(filePath: string): ParseResult;
    /**
     * Get the compact listing of name+description pairs for agent activation.
     * This is the minimal information the agent sees to decide which skill
     * to activate. Must call discoverSkills() first.
     *
     * @returns Array of compact skill entries
     */
    getCompactListing(): SkillCompactEntry[];
    /**
     * Activate a skill if its description matches the current context or prompt.
     * For "auto" invoke skills, the description is used as a trigger condition.
     * For "explicit" invoke skills, the skill name must be directly referenced.
     *
     * @param name - The skill name to activate
     * @param prompt - The current user prompt or context for matching
     * @returns The full skill definition if activated, or null
     */
    activateSkill(name: string, prompt: string): StandardSkillDefinition | null;
    /**
     * Install a skill from a URL or local path.
     *
     * @param source - URL (http/https) or local file path to the SKILL.md
     * @param options - Installation options
     * @returns The installed skill definition, or null on failure
     */
    installSkill(source: string, options?: {
        /** Install to global directory instead of project directory */
        global?: boolean;
        /** Override the skill name (auto-detected from frontmatter by default) */
        name?: string;
        /** Project root for project-level installs */
        projectRoot?: string;
    }): Promise<{
        skill: StandardSkillDefinition | null;
        errors: string[];
    }>;
    /**
     * Search available skills from the registry.
     * Searches both the local registry index and the remote registry.
     *
     * @param query - Search query string
     * @returns Array of matching registry entries
     */
    searchSkills(query: string): Promise<SkillRegistryEntry[]>;
    /**
     * Publish a skill to the registry.
     *
     * @param skillPath - Path to the SKILL.md file or the skill directory
     * @returns The registry entry created, or null on failure
     */
    publishSkill(skillPath: string): Promise<{
        entry: SkillRegistryEntry | null;
        errors: string[];
    }>;
    /**
     * Get the full content of an activated skill.
     * This should be called after activateSkill() returns a match.
     *
     * @param name - The skill name
     * @returns The full skill definition including the Markdown body, or null
     */
    getSkillContent(name: string): StandardSkillDefinition | null;
    /**
     * List all installed skills with their current status.
     *
     * @returns Array of skill definitions with status information
     */
    listInstalled(): Array<StandardSkillDefinition & {
        /** Whether the skill is currently loaded in memory */
        loaded: boolean;
        /** The skill format origin */
        format: SkillFormat;
    }>;
    /**
     * Parse a standard Neuro SKILL.md file.
     */
    private parseNeuroFormat;
    /**
     * Invalidate the discovery cache.
     */
    private invalidateCache;
    /**
     * Load the local registry index from disk.
     */
    private loadRegistryIndex;
    /**
     * Save the local registry index to disk.
     */
    private saveRegistryIndex;
    /**
     * Update a single registry entry.
     */
    private updateRegistryEntry;
    /**
     * Search the remote skill registry.
     */
    private searchRemoteRegistry;
    /**
     * Check if a registry entry matches the given query terms.
     */
    private matchesQuery;
}
/**
 * Create a new SKILL.md file at the specified path.
 * Convenience function for bootstrapping new skills.
 */
export declare function createSkillFile(dirPath: string, definition: Omit<StandardSkillDefinition, "filePath" | "source" | "body"> & {
    body?: string;
}): string;
/**
 * Validate a skill name against the specification requirements.
 */
export declare function validateSkillName(name: string): {
    valid: boolean;
    errors: string[];
};
export {};
//# sourceMappingURL=skill-standard.d.ts.map