/**
 * NeuroCLI — SKILL.md Standard Compliance System
 *
 * Implements the agentskills.io specification for SKILL.md files.
 * Provides auto-discovery, parsing, activation, registry, and
 * cross-tool compatibility with Claude Code, Codex CLI, and GitHub Copilot.
 *
 * Uses only Node.js built-in modules (fs, path, os, crypto, https, http, url).
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import * as https from "https";
import * as http from "http";
import { URL } from "url";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** File name for skill definitions */
const SKILL_FILENAME = "SKILL.md";
/** Maximum allowed length for skill names */
const MAX_NAME_LENGTH = 64;
/** Regex for valid skill names: lowercase, digits, hyphens; must start with letter */
const VALID_NAME_REGEX = /^[a-z][a-z0-9-]{0,63}$/;
/** Default global skills directory relative to home */
const DEFAULT_GLOBAL_SKILLS_DIR = ".neuro/skills";
/** Default project-level skills directory */
const DEFAULT_PROJECT_SKILLS_DIR = ".neuro/skills";
/** Maximum number of nested directories to traverse during discovery */
const MAX_DISCOVERY_DEPTH = 5;
/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Neuro skill registry base URL */
const REGISTRY_BASE_URL = "https://registry.agentskills.io";
// ---------------------------------------------------------------------------
// YAML Frontmatter Parser
// ---------------------------------------------------------------------------
/**
 * Minimal YAML frontmatter parser that handles the subset of YAML used in
 * SKILL.md files. Supports scalars (strings, numbers, booleans) and
 * inline arrays (["a", "b"]). Does NOT depend on any external library.
 */
function parseFrontmatter(raw) {
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("---")) {
        return { metadata: {}, body: raw };
    }
    // Find the closing ---
    const firstDelimiterEnd = trimmed.indexOf("\n", 0);
    if (firstDelimiterEnd === -1) {
        return { metadata: {}, body: raw };
    }
    const secondDelimiter = trimmed.indexOf("\n---", firstDelimiterEnd);
    if (secondDelimiter === -1) {
        return { metadata: {}, body: raw };
    }
    const frontmatterText = trimmed.slice(firstDelimiterEnd + 1, secondDelimiter);
    const body = trimmed.slice(secondDelimiter + 4).trimStart();
    const metadata = {};
    // Parse line by line — handles top-level keys only (spec compliant)
    const lines = frontmatterText.split("\n");
    for (const line of lines) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        if (value === "") {
            continue;
        }
        // Inline array: ["a", "b", "c"]
        if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
            value = parseInlineArray(value);
        }
        // Quoted string
        else if (typeof value === "string") {
            value = unquote(value);
        }
        // Numeric
        else if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
            value = Number(value);
        }
        // Boolean
        else if (value === "true") {
            value = true;
        }
        else if (value === "false") {
            value = false;
        }
        metadata[key] = value;
    }
    return { metadata, body };
}
/**
 * Parse a YAML inline array like `["react", "nextjs", "frontend"]`.
 */
function parseInlineArray(raw) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "")
        return [];
    const items = [];
    let current = "";
    let inQuote = null;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (inQuote) {
            if (ch === inQuote) {
                inQuote = null;
            }
            else {
                current += ch;
            }
        }
        else if (ch === '"' || ch === "'") {
            inQuote = ch;
        }
        else if (ch === ",") {
            items.push(current.trim());
            current = "";
        }
        else {
            current += ch;
        }
    }
    if (current.trim()) {
        items.push(current.trim());
    }
    return items.map((s) => unquote(s));
}
/**
 * Remove surrounding quotes from a string value.
 */
function unquote(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
// ---------------------------------------------------------------------------
// Cross-Tool Compatibility Adapters
// ---------------------------------------------------------------------------
/**
 * Adapter for Claude Code skill format.
 * Claude Code uses a CLAUDE.md convention with similar frontmatter.
 */
function adaptFromClaudeCode(raw, filePath) {
    const warnings = [];
    const errors = [];
    // Claude Code files may not have structured frontmatter; attempt extraction
    const { metadata, body } = parseFrontmatter(raw);
    const name = metadata.name ||
        path.basename(path.dirname(filePath)).toLowerCase().replace(/\s+/g, "-");
    if (!VALID_NAME_REGEX.test(name)) {
        errors.push(`Invalid skill name "${name}". Must match ${VALID_NAME_REGEX.source}`);
    }
    const description = metadata.description ||
        metadata.trigger ||
        body.split("\n").find((l) => l.trim().length > 0) ||
        "";
    return {
        skill: {
            name,
            description,
            version: metadata.version || undefined,
            author: metadata.author || undefined,
            tags: Array.isArray(metadata.tags) ? metadata.tags : undefined,
            tools: Array.isArray(metadata.tools) ? metadata.tools : undefined,
            priority: typeof metadata.priority === "number" ? metadata.priority : 50,
            invoke: metadata.invoke || "auto",
            load: metadata.load || "on-demand",
            body,
            filePath,
            source: "project",
        },
        warnings,
        errors,
    };
}
/**
 * Adapter for Codex CLI skill format.
 * Codex CLI uses codex.md / AGENTS.md files.
 */
function adaptFromCodexCli(raw, filePath) {
    const { metadata, body } = parseFrontmatter(raw);
    const warnings = [];
    const errors = [];
    const name = metadata.name ||
        path.basename(path.dirname(filePath)).toLowerCase().replace(/\s+/g, "-");
    if (!VALID_NAME_REGEX.test(name)) {
        errors.push(`Invalid skill name "${name}". Must match ${VALID_NAME_REGEX.source}`);
    }
    // Codex CLI uses "triggers" (plural) or "when" as activation condition
    const description = metadata.description ||
        metadata.triggers ||
        metadata.when ||
        "";
    return {
        skill: {
            name,
            description,
            version: metadata.version || undefined,
            author: metadata.author || undefined,
            tags: Array.isArray(metadata.tags) ? metadata.tags : undefined,
            tools: Array.isArray(metadata.tools) ? metadata.tools : undefined,
            priority: typeof metadata.priority === "number" ? metadata.priority : 50,
            invoke: metadata.invoke || "auto",
            load: metadata.load || "on-demand",
            body,
            filePath,
            source: "project",
        },
        warnings,
        errors,
    };
}
/**
 * Adapter for GitHub Copilot skill format.
 * Copilot uses .github/copilot-skills/ with .md files.
 */
function adaptFromCopilot(raw, filePath) {
    const { metadata, body } = parseFrontmatter(raw);
    const warnings = [];
    const errors = [];
    const name = metadata.name ||
        path.basename(filePath, ".md").toLowerCase().replace(/\s+/g, "-");
    if (!VALID_NAME_REGEX.test(name)) {
        errors.push(`Invalid skill name "${name}". Must match ${VALID_NAME_REGEX.source}`);
    }
    // Copilot uses "appliesTo" or "whenToSuggest" as activation condition
    const description = metadata.description ||
        metadata.appliesTo ||
        metadata.whenToSuggest ||
        "";
    return {
        skill: {
            name,
            description,
            version: metadata.version || undefined,
            author: metadata.author || undefined,
            tags: Array.isArray(metadata.tags) ? metadata.tags : undefined,
            tools: Array.isArray(metadata.tools) ? metadata.tools : undefined,
            priority: typeof metadata.priority === "number" ? metadata.priority : 50,
            invoke: metadata.invoke || "auto",
            load: metadata.load || "on-demand",
            body,
            filePath,
            source: "project",
        },
        warnings,
        errors,
    };
}
// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
/**
 * Walk a directory tree up to `maxDepth` levels, returning all files named
 * `SKILL_FILENAME` or recognized cross-tool skill files.
 */
function walkForSkills(dir, maxDepth, currentDepth = 0) {
    const results = [];
    if (currentDepth > maxDepth)
        return results;
    if (!fs.existsSync(dir))
        return results;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return results;
    }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile()) {
            // Standard SKILL.md
            if (entry.name === SKILL_FILENAME) {
                results.push(fullPath);
            }
            // Cross-tool: Claude Code
            else if (entry.name === "CLAUDE.md") {
                results.push(fullPath);
            }
            // Cross-tool: Codex CLI
            else if (entry.name === "codex.md" || entry.name === "AGENTS.md") {
                results.push(fullPath);
            }
        }
        else if (entry.isDirectory()) {
            // Recurse into subdirectories (e.g. nested skill folders)
            if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
                results.push(...walkForSkills(fullPath, maxDepth, currentDepth + 1));
            }
        }
    }
    return results;
}
/**
 * Determine the source type based on file path.
 */
function determineSource(filePath, globalDir, projectDir) {
    const normalized = path.resolve(filePath);
    if (normalized.startsWith(path.resolve(globalDir))) {
        return "global";
    }
    return "project";
}
function detectFormat(filePath) {
    const base = path.basename(filePath);
    switch (base) {
        case "CLAUDE.md":
            return "claude";
        case "codex.md":
        case "AGENTS.md":
            return "codex";
        default:
            // Check for GitHub Copilot path pattern
            if (filePath.includes(path.join(".github", "copilot-skills"))) {
                return "copilot";
            }
            return "neuro";
    }
}
/**
 * Compute SHA-256 checksum of a string.
 */
function checksum(content) {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
/**
 * HTTP/HTTPS GET request that returns the body as a string.
 * Works with both http and https protocols using only built-in modules.
 */
function httpGet(urlStr) {
    return new Promise((resolve, reject) => {
        let client;
        try {
            const parsed = new URL(urlStr);
            client = parsed.protocol === "https:" ? https : http;
        }
        catch (err) {
            reject(new Error(`Invalid URL: ${urlStr}`));
            return;
        }
        client
            .get(urlStr, { timeout: 15000 }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Follow redirect
                httpGet(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`));
                return;
            }
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            res.on("error", reject);
        })
            .on("error", reject)
            .on("timeout", function () {
            this.destroy();
            reject(new Error(`Request timeout for ${urlStr}`));
        });
    });
}
/**
 * HTTP POST request that sends a JSON body and returns the response.
 */
function httpPost(urlStr, body) {
    return new Promise((resolve, reject) => {
        let client;
        try {
            const parsed = new URL(urlStr);
            client = parsed.protocol === "https:" ? https : http;
        }
        catch (err) {
            reject(new Error(`Invalid URL: ${urlStr}`));
            return;
        }
        const payload = JSON.stringify(body);
        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
            },
            timeout: 15000,
        };
        const req = client.request(urlStr, options, (res) => {
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`));
                });
                return;
            }
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            res.on("error", reject);
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error(`Request timeout for ${urlStr}`));
        });
        req.write(payload);
        req.end();
    });
}
// ---------------------------------------------------------------------------
// SkillStandard Class
// ---------------------------------------------------------------------------
/**
 * Core class implementing the agentskills.io SKILL.md standard compliance
 * system for NeuroCLI.
 *
 * Handles discovery, parsing, activation, installation, search, publishing,
 * and cross-tool compatibility.
 */
export class SkillStandard {
    globalSkillsDir;
    projectSkillsDir;
    enableCache;
    cacheTtlMs;
    registryBaseUrl;
    /** In-memory skill definitions, keyed by name */
    skills = new Map();
    /** Compact listing cache for agent activation */
    compactListing = [];
    /** Internal cache */
    cache = null;
    /** Local registry index (file-backed) */
    registryIndex = new Map();
    /** Path to the local registry file */
    registryFilePath;
    /** Whether discovery has been run at least once */
    discovered = false;
    constructor(options = {}) {
        this.globalSkillsDir =
            options.globalSkillsDir ||
                path.join(os.homedir(), DEFAULT_GLOBAL_SKILLS_DIR);
        this.projectSkillsDir =
            options.projectSkillsDir || DEFAULT_PROJECT_SKILLS_DIR;
        this.enableCache = options.enableCache ?? true;
        this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
        this.registryBaseUrl = options.registryBaseUrl || REGISTRY_BASE_URL;
        this.registryFilePath = path.join(this.globalSkillsDir, "..", "registry.json");
    }
    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    /**
     * Discover all skills from both global and project directories.
     * Reads ONLY the `name` and `description` from each skill's YAML
     * frontmatter for the compact listing, but also caches full definitions.
     *
     * @param projectRoot - The root directory of the current project
     * @returns Array of compact skill entries for agent activation
     */
    discoverSkills(projectRoot) {
        // Return cached if still valid
        if (this.enableCache && this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
            return this.cache.compactListing;
        }
        this.skills.clear();
        this.compactListing = [];
        const globalDir = this.globalSkillsDir;
        const localDir = path.resolve(projectRoot, this.projectSkillsDir);
        // Discover from global directory
        const globalFiles = walkForSkills(globalDir, MAX_DISCOVERY_DEPTH);
        for (const file of globalFiles) {
            const result = this.parseSkillMd(file);
            if (result.skill && result.errors.length === 0) {
                result.skill.source = "global";
                this.skills.set(result.skill.name, result.skill);
            }
        }
        // Discover from project directory
        const projectFiles = walkForSkills(localDir, MAX_DISCOVERY_DEPTH);
        for (const file of projectFiles) {
            const result = this.parseSkillMd(file);
            if (result.skill && result.errors.length === 0) {
                // Project skills override global skills with the same name
                result.skill.source = "project";
                this.skills.set(result.skill.name, result.skill);
            }
        }
        // Also check for GitHub Copilot skill files in .github/copilot-skills/
        const copilotDir = path.resolve(projectRoot, ".github/copilot-skills");
        const copilotFiles = walkForSkills(copilotDir, MAX_DISCOVERY_DEPTH);
        for (const file of copilotFiles) {
            const result = this.parseSkillMd(file);
            if (result.skill && result.errors.length === 0) {
                result.skill.source = "project";
                this.skills.set(result.skill.name, result.skill);
            }
        }
        // Build compact listing — sorted by priority descending, then name ascending
        this.compactListing = Array.from(this.skills.values())
            .map((s) => ({
            name: s.name,
            description: s.description,
            priority: s.priority ?? 50,
            invoke: s.invoke ?? "auto",
            load: s.load ?? "on-demand",
        }))
            .sort((a, b) => {
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            return a.name.localeCompare(b.name);
        });
        // Update cache
        if (this.enableCache) {
            this.cache = {
                compactListing: this.compactListing,
                skills: new Map(this.skills),
                timestamp: Date.now(),
            };
        }
        this.discovered = true;
        return this.compactListing;
    }
    /**
     * Parse a SKILL.md file according to the agentskills.io specification.
     * Supports cross-tool format detection and automatic adaptation.
     *
     * @param filePath - Absolute path to the SKILL.md (or compatible) file
     * @returns Parse result with skill definition, warnings, and errors
     */
    parseSkillMd(filePath) {
        const warnings = [];
        const errors = [];
        // Read file
        let raw;
        try {
            raw = fs.readFileSync(filePath, "utf8");
        }
        catch (err) {
            return {
                skill: null,
                warnings,
                errors: [
                    `Failed to read skill file at ${filePath}: ${err.message}`,
                ],
            };
        }
        // Detect format and adapt
        const format = detectFormat(filePath);
        let result;
        switch (format) {
            case "claude":
                result = adaptFromClaudeCode(raw, filePath);
                warnings.push(`Adapted from Claude Code format (CLAUDE.md). Some fields may need review.`);
                break;
            case "codex":
                result = adaptFromCodexCli(raw, filePath);
                warnings.push(`Adapted from Codex CLI format (${path.basename(filePath)}). Some fields may need review.`);
                break;
            case "copilot":
                result = adaptFromCopilot(raw, filePath);
                warnings.push(`Adapted from GitHub Copilot format. Some fields may need review.`);
                break;
            case "neuro":
            default:
                result = this.parseNeuroFormat(raw, filePath);
                break;
        }
        // Merge warnings
        warnings.push(...result.warnings);
        // Validate required fields
        if (result.skill) {
            // Validate name
            if (!result.skill.name) {
                errors.push("Required field 'name' is missing.");
                result.skill = null;
            }
            else if (!VALID_NAME_REGEX.test(result.skill.name)) {
                errors.push(`Invalid skill name "${result.skill.name}". Must be lowercase, start with a letter, contain only letters, digits, and hyphens, and be at most ${MAX_NAME_LENGTH} characters. Pattern: ${VALID_NAME_REGEX.source}`);
                result.skill = null;
            }
            // Validate description
            if (result.skill && !result.skill.description) {
                errors.push("Required field 'description' is missing.");
                result.skill = null;
            }
            // Validate version format if present
            if (result.skill && result.skill.version) {
                if (!/^\d+\.\d+\.\d+/.test(result.skill.version)) {
                    warnings.push(`Version "${result.skill.version}" does not follow semver (major.minor.patch).`);
                }
            }
            // Validate priority range
            if (result.skill && result.skill.priority !== undefined) {
                if (result.skill.priority < 0 || result.skill.priority > 100) {
                    warnings.push(`Priority ${result.skill.priority} is outside the recommended 0-100 range. Clamping.`);
                    result.skill.priority = Math.max(0, Math.min(100, result.skill.priority));
                }
            }
            // Set defaults
            if (result.skill) {
                result.skill.priority = result.skill.priority ?? 50;
                result.skill.invoke = result.skill.invoke ?? "auto";
                result.skill.load = result.skill.load ?? "on-demand";
                result.skill.source = determineSource(filePath, this.globalSkillsDir, this.projectSkillsDir);
            }
        }
        return {
            skill: result.skill,
            warnings,
            errors: [...errors, ...result.errors],
        };
    }
    /**
     * Get the compact listing of name+description pairs for agent activation.
     * This is the minimal information the agent sees to decide which skill
     * to activate. Must call discoverSkills() first.
     *
     * @returns Array of compact skill entries
     */
    getCompactListing() {
        if (!this.discovered) {
            return [];
        }
        return this.compactListing;
    }
    /**
     * Activate a skill if its description matches the current context or prompt.
     * For "auto" invoke skills, the description is used as a trigger condition.
     * For "explicit" invoke skills, the skill name must be directly referenced.
     *
     * @param name - The skill name to activate
     * @param prompt - The current user prompt or context for matching
     * @returns The full skill definition if activated, or null
     */
    activateSkill(name, prompt) {
        const skill = this.skills.get(name);
        if (!skill)
            return null;
        // For explicit invoke, only activate if the skill name is directly
        // referenced in the prompt
        if (skill.invoke === "explicit") {
            const namePatterns = [
                name,
                name.replace(/-/g, " "),
                name.replace(/-/g, "_"),
            ];
            const promptLower = prompt.toLowerCase();
            const isReferenced = namePatterns.some((p) => promptLower.includes(p.toLowerCase()));
            if (!isReferenced)
                return null;
        }
        // For auto invoke, check if the description matches the prompt context.
        // Use a simple keyword-overlap heuristic with a threshold.
        if (skill.invoke === "auto") {
            const descriptionKeywords = extractKeywords(skill.description);
            const promptKeywords = extractKeywords(prompt);
            if (descriptionKeywords.length > 0) {
                const overlap = descriptionKeywords.filter((k) => promptKeywords.includes(k));
                // Require at least 30% keyword overlap, or at least 1 match for
                // short descriptions
                const threshold = Math.max(1, Math.ceil(descriptionKeywords.length * 0.3));
                if (overlap.length < threshold)
                    return null;
            }
        }
        return skill;
    }
    /**
     * Install a skill from a URL or local path.
     *
     * @param source - URL (http/https) or local file path to the SKILL.md
     * @param options - Installation options
     * @returns The installed skill definition, or null on failure
     */
    async installSkill(source, options = {}) {
        const errors = [];
        let content;
        // Determine if source is a URL or local path
        if (source.startsWith("http://") || source.startsWith("https://")) {
            try {
                content = await httpGet(source);
            }
            catch (err) {
                return {
                    skill: null,
                    errors: [
                        `Failed to fetch skill from ${source}: ${err.message}`,
                    ],
                };
            }
        }
        else {
            // Local path
            const resolvedPath = path.resolve(source);
            if (!fs.existsSync(resolvedPath)) {
                return {
                    skill: null,
                    errors: [`Local path does not exist: ${resolvedPath}`],
                };
            }
            try {
                content = fs.readFileSync(resolvedPath, "utf8");
            }
            catch (err) {
                return {
                    skill: null,
                    errors: [
                        `Failed to read local file at ${resolvedPath}: ${err.message}`,
                    ],
                };
            }
        }
        // Parse the content
        const tempPath = path.join(os.tmpdir(), `neuro-skill-install-${Date.now()}.md`);
        try {
            fs.writeFileSync(tempPath, content, "utf8");
            const parseResult = this.parseSkillMd(tempPath);
            if (parseResult.errors.length > 0 || !parseResult.skill) {
                return {
                    skill: null,
                    errors: [...parseResult.errors, "Failed to parse skill content."],
                };
            }
            const skillName = options.name || parseResult.skill.name;
            if (!VALID_NAME_REGEX.test(skillName)) {
                return {
                    skill: null,
                    errors: [
                        `Invalid skill name "${skillName}". Must match ${VALID_NAME_REGEX.source}`,
                    ],
                };
            }
            // Determine target directory
            const targetDir = options.global
                ? path.join(this.globalSkillsDir, skillName)
                : path.join(path.resolve(options.projectRoot || process.cwd()), this.projectSkillsDir, skillName);
            ensureDir(targetDir);
            const targetPath = path.join(targetDir, SKILL_FILENAME);
            // If content came from a different format, re-serialize to standard SKILL.md
            const format = detectFormat(source);
            if (format !== "neuro" && parseResult.skill) {
                content = serializeToStandardFormat(parseResult.skill);
            }
            fs.writeFileSync(targetPath, content, "utf8");
            // Re-parse from final location
            const finalResult = this.parseSkillMd(targetPath);
            if (finalResult.skill) {
                finalResult.skill.source = options.global ? "global" : "project";
                this.skills.set(finalResult.skill.name, finalResult.skill);
                this.invalidateCache();
                // Update registry index
                this.updateRegistryEntry(finalResult.skill, source);
            }
            return { skill: finalResult.skill, errors: [] };
        }
        finally {
            // Clean up temp file
            try {
                fs.unlinkSync(tempPath);
            }
            catch {
                // Ignore cleanup errors
            }
        }
    }
    /**
     * Search available skills from the registry.
     * Searches both the local registry index and the remote registry.
     *
     * @param query - Search query string
     * @returns Array of matching registry entries
     */
    async searchSkills(query) {
        const results = [];
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/);
        // Search local registry first
        this.loadRegistryIndex();
        for (const entry of this.registryIndex.values()) {
            if (this.matchesQuery(entry, queryTerms)) {
                results.push(entry);
            }
        }
        // Search remote registry
        try {
            const remoteResults = await this.searchRemoteRegistry(query);
            for (const entry of remoteResults) {
                // Don't duplicate entries already found locally
                if (!results.some((r) => r.name === entry.name)) {
                    // Mark installation status
                    entry.installed = this.skills.has(entry.name);
                    results.push(entry);
                }
            }
        }
        catch {
            // Remote registry unavailable — return local results only
        }
        // Sort by relevance: installed first, then by name
        results.sort((a, b) => {
            if (a.installed !== b.installed)
                return a.installed ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return results;
    }
    /**
     * Publish a skill to the registry.
     *
     * @param skillPath - Path to the SKILL.md file or the skill directory
     * @returns The registry entry created, or null on failure
     */
    async publishSkill(skillPath) {
        const errors = [];
        // Resolve path
        const resolved = path.resolve(skillPath);
        let filePath;
        if (fs.statSync(resolved).isDirectory()) {
            filePath = path.join(resolved, SKILL_FILENAME);
        }
        else {
            filePath = resolved;
        }
        if (!fs.existsSync(filePath)) {
            return {
                entry: null,
                errors: [`Skill file not found at ${filePath}`],
            };
        }
        // Parse the skill
        const parseResult = this.parseSkillMd(filePath);
        if (parseResult.errors.length > 0 || !parseResult.skill) {
            return {
                entry: null,
                errors: [...parseResult.errors, "Cannot publish invalid skill."],
            };
        }
        const skill = parseResult.skill;
        // Read raw content for checksum
        const content = fs.readFileSync(filePath, "utf8");
        const entry = {
            name: skill.name,
            description: skill.description,
            version: skill.version || "1.0.0",
            author: skill.author || "unknown",
            tags: skill.tags || [],
            source: filePath,
            checksum: checksum(content),
            addedAt: new Date().toISOString(),
            installed: true,
        };
        // Attempt remote publish
        try {
            await httpPost(`${this.registryBaseUrl}/api/v1/skills`, {
                name: entry.name,
                description: entry.description,
                version: entry.version,
                author: entry.author,
                tags: entry.tags,
                checksum: entry.checksum,
                content,
            });
        }
        catch (err) {
            errors.push(`Remote publish failed: ${err.message}. Skill saved to local registry only.`);
        }
        // Update local registry
        this.loadRegistryIndex();
        this.registryIndex.set(entry.name, entry);
        this.saveRegistryIndex();
        return { entry, errors };
    }
    /**
     * Get the full content of an activated skill.
     * This should be called after activateSkill() returns a match.
     *
     * @param name - The skill name
     * @returns The full skill definition including the Markdown body, or null
     */
    getSkillContent(name) {
        const skill = this.skills.get(name);
        if (!skill)
            return null;
        // Re-read from disk to ensure we have the latest content
        try {
            const raw = fs.readFileSync(skill.filePath, "utf8");
            const result = this.parseSkillMd(skill.filePath);
            if (result.skill) {
                // Update the cached version
                this.skills.set(name, result.skill);
                return result.skill;
            }
        }
        catch {
            // Fall back to cached version
        }
        return skill;
    }
    /**
     * List all installed skills with their current status.
     *
     * @returns Array of skill definitions with status information
     */
    listInstalled() {
        return Array.from(this.skills.values()).map((skill) => ({
            ...skill,
            loaded: true,
            format: detectFormat(skill.filePath),
        }));
    }
    // -----------------------------------------------------------------------
    // Private Methods
    // -----------------------------------------------------------------------
    /**
     * Parse a standard Neuro SKILL.md file.
     */
    parseNeuroFormat(raw, filePath) {
        const warnings = [];
        const errors = [];
        const { metadata, body } = parseFrontmatter(raw);
        const name = metadata.name;
        const description = metadata.description;
        if (!name) {
            errors.push("Required field 'name' is missing from frontmatter.");
        }
        if (!description) {
            errors.push("Required field 'description' is missing from frontmatter.");
        }
        if (errors.length > 0) {
            return {
                skill: null,
                warnings,
                errors,
            };
        }
        const skill = {
            name: name,
            description: description,
            version: metadata.version || undefined,
            author: metadata.author || undefined,
            tags: Array.isArray(metadata.tags) ? metadata.tags : undefined,
            tools: Array.isArray(metadata.tools) ? metadata.tools : undefined,
            priority: typeof metadata.priority === "number" ? metadata.priority : undefined,
            invoke: metadata.invoke || undefined,
            load: metadata.load || undefined,
            body,
            filePath,
            source: "project", // Will be overridden by caller
        };
        return { skill, warnings, errors };
    }
    /**
     * Invalidate the discovery cache.
     */
    invalidateCache() {
        this.cache = null;
        this.discovered = false;
        this.compactListing = [];
    }
    /**
     * Load the local registry index from disk.
     */
    loadRegistryIndex() {
        this.registryIndex.clear();
        if (!fs.existsSync(this.registryFilePath))
            return;
        try {
            const raw = fs.readFileSync(this.registryFilePath, "utf8");
            const data = JSON.parse(raw);
            for (const entry of data) {
                // Verify installation status
                const skillDir = path.join(this.globalSkillsDir, entry.name);
                entry.installed = fs.existsSync(path.join(skillDir, SKILL_FILENAME));
                this.registryIndex.set(entry.name, entry);
            }
        }
        catch {
            // Corrupted or empty registry — start fresh
        }
    }
    /**
     * Save the local registry index to disk.
     */
    saveRegistryIndex() {
        ensureDir(path.dirname(this.registryFilePath));
        const data = Array.from(this.registryIndex.values());
        fs.writeFileSync(this.registryFilePath, JSON.stringify(data, null, 2), "utf8");
    }
    /**
     * Update a single registry entry.
     */
    updateRegistryEntry(skill, source) {
        this.loadRegistryIndex();
        try {
            const content = fs.readFileSync(skill.filePath, "utf8");
            const entry = {
                name: skill.name,
                description: skill.description,
                version: skill.version || "1.0.0",
                author: skill.author || "unknown",
                tags: skill.tags || [],
                source,
                checksum: checksum(content),
                addedAt: new Date().toISOString(),
                installed: true,
            };
            this.registryIndex.set(skill.name, entry);
            this.saveRegistryIndex();
        }
        catch {
            // Silently fail — non-critical
        }
    }
    /**
     * Search the remote skill registry.
     */
    async searchRemoteRegistry(query) {
        const url = `${this.registryBaseUrl}/api/v1/skills/search?q=${encodeURIComponent(query)}`;
        const raw = await httpGet(url);
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
            return data;
        }
        if (data && Array.isArray(data.results)) {
            return data.results;
        }
        return [];
    }
    /**
     * Check if a registry entry matches the given query terms.
     */
    matchesQuery(entry, queryTerms) {
        const searchable = [
            entry.name,
            entry.description,
            entry.author,
            ...entry.tags,
        ]
            .join(" ")
            .toLowerCase();
        return queryTerms.every((term) => searchable.includes(term));
    }
}
// ---------------------------------------------------------------------------
// Standalone utility functions
// ---------------------------------------------------------------------------
/**
 * Extract meaningful keywords from a text string.
 * Removes stop words and normalizes for comparison.
 */
function extractKeywords(text) {
    const stopWords = new Set([
        "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from",
        "has", "have", "how", "i", "if", "in", "is", "it", "its", "just",
        "me", "my", "no", "not", "of", "on", "or", "our", "out", "own",
        "say", "she", "so", "than", "that", "the", "their", "them", "then",
        "there", "these", "they", "this", "to", "up", "us", "very", "was",
        "we", "what", "when", "which", "who", "will", "with", "would", "you",
        "your", "can", "could", "should", "shall", "may", "might", "must",
    ]);
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/[\s-]+/)
        .filter((word) => word.length > 1 && !stopWords.has(word));
}
/**
 * Serialize a StandardSkillDefinition back into a valid SKILL.md format.
 * Used when converting cross-tool formats to the standard format.
 */
function serializeToStandardFormat(skill) {
    const lines = ["---"];
    lines.push(`name: ${skill.name}`);
    lines.push(`description: "${skill.description.replace(/"/g, '\\"')}"`);
    if (skill.version)
        lines.push(`version: "${skill.version}"`);
    if (skill.author)
        lines.push(`author: "${skill.author}"`);
    if (skill.tags && skill.tags.length > 0) {
        lines.push(`tags: [${skill.tags.map((t) => `"${t}"`).join(", ")}]`);
    }
    if (skill.tools && skill.tools.length > 0) {
        lines.push(`tools: [${skill.tools.map((t) => `"${t}"`).join(", ")}]`);
    }
    if (skill.priority !== undefined)
        lines.push(`priority: ${skill.priority}`);
    if (skill.invoke)
        lines.push(`invoke: ${skill.invoke}`);
    if (skill.load)
        lines.push(`load: ${skill.load}`);
    lines.push("---");
    lines.push("");
    if (skill.body) {
        lines.push(skill.body);
    }
    return lines.join("\n");
}
/**
 * Create a new SKILL.md file at the specified path.
 * Convenience function for bootstrapping new skills.
 */
export function createSkillFile(dirPath, definition) {
    ensureDir(dirPath);
    const skill = {
        ...definition,
        body: definition.body || `# ${definition.name}\n\nSkill content goes here.\n`,
        filePath: "",
        source: "project",
    };
    const content = serializeToStandardFormat(skill);
    const filePath = path.join(dirPath, SKILL_FILENAME);
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
}
/**
 * Validate a skill name against the specification requirements.
 */
export function validateSkillName(name) {
    const errors = [];
    if (!name) {
        errors.push("Name is required.");
    }
    else {
        if (name.length > MAX_NAME_LENGTH) {
            errors.push(`Name exceeds maximum length of ${MAX_NAME_LENGTH} characters (got ${name.length}).`);
        }
        if (!/^[a-z]/.test(name)) {
            errors.push("Name must start with a lowercase letter.");
        }
        if (/[^a-z0-9-]/.test(name)) {
            errors.push("Name must contain only lowercase letters, digits, and hyphens.");
        }
        if (name.endsWith("-")) {
            errors.push("Name must not end with a hyphen.");
        }
        if (name.includes("--")) {
            errors.push("Name must not contain consecutive hyphens.");
        }
    }
    return { valid: errors.length === 0, errors };
}
//# sourceMappingURL=skill-standard.js.map