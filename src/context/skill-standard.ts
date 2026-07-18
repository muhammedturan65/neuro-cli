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
// Interfaces
// ---------------------------------------------------------------------------

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
 * Internal cache entry for discovery results.
 */
interface CacheEntry {
  compactListing: SkillCompactEntry[];
  skills: Map<string, StandardSkillDefinition>;
  timestamp: number;
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

// ---------------------------------------------------------------------------
// YAML Frontmatter Parser
// ---------------------------------------------------------------------------

/**
 * Minimal YAML frontmatter parser that handles the subset of YAML used in
 * SKILL.md files. Supports scalars (strings, numbers, booleans) and
 * inline arrays (["a", "b"]). Does NOT depend on any external library.
 */
function parseFrontmatter(raw: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
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

  const metadata: Record<string, unknown> = {};

  // Parse line by line — handles top-level keys only (spec compliant)
  const lines = frontmatterText.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

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
    } else if (value === "false") {
      value = false;
    }

    metadata[key] = value;
  }

  return { metadata, body };
}

/**
 * Parse a YAML inline array like `["react", "nextjs", "frontend"]`.
 */
function parseInlineArray(raw: string): string[] {
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];

  const items: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ",") {
      items.push(current.trim());
      current = "";
    } else {
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
function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
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
function adaptFromClaudeCode(raw: string, filePath: string): ParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Claude Code files may not have structured frontmatter; attempt extraction
  const { metadata, body } = parseFrontmatter(raw);

  const name =
    (metadata.name as string) ||
    path.basename(path.dirname(filePath)).toLowerCase().replace(/\s+/g, "-");

  if (!VALID_NAME_REGEX.test(name)) {
    errors.push(
      `Invalid skill name "${name}". Must match ${VALID_NAME_REGEX.source}`
    );
  }

  const description =
    (metadata.description as string) ||
    (metadata.trigger as string) ||
    body.split("\n").find((l) => l.trim().length > 0) ||
    "";

  return {
    skill: {
      name,
      description,
      version: (metadata.version as string) || undefined,
      author: (metadata.author as string) || undefined,
      tags: Array.isArray(metadata.tags) ? (metadata.tags as string[]) : undefined,
      tools: Array.isArray(metadata.tools) ? (metadata.tools as string[]) : undefined,
      priority: typeof metadata.priority === "number" ? metadata.priority : 50,
      invoke: (metadata.invoke as "explicit" | "auto") || "auto",
      load: (metadata.load as "startup" | "on-demand") || "on-demand",
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
function adaptFromCodexCli(raw: string, filePath: string): ParseResult {
  const { metadata, body } = parseFrontmatter(raw);
  const warnings: string[] = [];
  const errors: string[] = [];

  const name =
    (metadata.name as string) ||
    path.basename(path.dirname(filePath)).toLowerCase().replace(/\s+/g, "-");

  if (!VALID_NAME_REGEX.test(name)) {
    errors.push(
      `Invalid skill name "${name}". Must match ${VALID_NAME_REGEX.source}`
    );
  }

  // Codex CLI uses "triggers" (plural) or "when" as activation condition
  const description =
    (metadata.description as string) ||
    (metadata.triggers as string) ||
    (metadata.when as string) ||
    "";

  return {
    skill: {
      name,
      description,
      version: (metadata.version as string) || undefined,
      author: (metadata.author as string) || undefined,
      tags: Array.isArray(metadata.tags) ? (metadata.tags as string[]) : undefined,
      tools: Array.isArray(metadata.tools) ? (metadata.tools as string[]) : undefined,
      priority: typeof metadata.priority === "number" ? metadata.priority : 50,
      invoke: (metadata.invoke as "explicit" | "auto") || "auto",
      load: (metadata.load as "startup" | "on-demand") || "on-demand",
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
function adaptFromCopilot(raw: string, filePath: string): ParseResult {
  const { metadata, body } = parseFrontmatter(raw);
  const warnings: string[] = [];
  const errors: string[] = [];

  const name =
    (metadata.name as string) ||
    path.basename(filePath, ".md").toLowerCase().replace(/\s+/g, "-");

  if (!VALID_NAME_REGEX.test(name)) {
    errors.push(
      `Invalid skill name "${name}". Must match ${VALID_NAME_REGEX.source}`
    );
  }

  // Copilot uses "appliesTo" or "whenToSuggest" as activation condition
  const description =
    (metadata.description as string) ||
    (metadata.appliesTo as string) ||
    (metadata.whenToSuggest as string) ||
    "";

  return {
    skill: {
      name,
      description,
      version: (metadata.version as string) || undefined,
      author: (metadata.author as string) || undefined,
      tags: Array.isArray(metadata.tags) ? (metadata.tags as string[]) : undefined,
      tools: Array.isArray(metadata.tools) ? (metadata.tools as string[]) : undefined,
      priority: typeof metadata.priority === "number" ? metadata.priority : 50,
      invoke: (metadata.invoke as "explicit" | "auto") || "auto",
      load: (metadata.load as "startup" | "on-demand") || "on-demand",
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
function walkForSkills(
  dir: string,
  maxDepth: number,
  currentDepth: number = 0
): string[] {
  const results: string[] = [];

  if (currentDepth > maxDepth) return results;
  if (!fs.existsSync(dir)) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
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
    } else if (entry.isDirectory()) {
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
function determineSource(
  filePath: string,
  globalDir: string,
  projectDir: string
): "global" | "project" {
  const normalized = path.resolve(filePath);
  if (normalized.startsWith(path.resolve(globalDir))) {
    return "global";
  }
  return "project";
}

/**
 * Detect the skill format from the file name.
 */
type SkillFormat = "neuro" | "claude" | "codex" | "copilot";

function detectFormat(filePath: string): SkillFormat {
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
function checksum(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * HTTP/HTTPS GET request that returns the body as a string.
 * Works with both http and https protocols using only built-in modules.
 */
function httpGet(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let client: typeof http | typeof https;
    try {
      const parsed = new URL(urlStr);
      client = parsed.protocol === "https:" ? https : http;
    } catch (err) {
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

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      })
      .on("error", reject)
      .on("timeout", function (this: http.ClientRequest) {
        this.destroy();
        reject(new Error(`Request timeout for ${urlStr}`));
      });
  });
}

/**
 * HTTP POST request that sends a JSON body and returns the response.
 */
function httpPost(urlStr: string, body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    let client: typeof http | typeof https;
    try {
      const parsed = new URL(urlStr);
      client = parsed.protocol === "https:" ? https : http;
    } catch (err) {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }

    const payload = JSON.stringify(body);
    const options: https.RequestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 15000,
    };

    const req = client.request(urlStr, options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          reject(
            new Error(
              `HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`
            )
          );
        });
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
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
  private globalSkillsDir: string;
  private projectSkillsDir: string;
  private enableCache: boolean;
  private cacheTtlMs: number;
  private registryBaseUrl: string;

  /** In-memory skill definitions, keyed by name */
  private skills: Map<string, StandardSkillDefinition> = new Map();

  /** Compact listing cache for agent activation */
  private compactListing: SkillCompactEntry[] = [];

  /** Internal cache */
  private cache: CacheEntry | null = null;

  /** Local registry index (file-backed) */
  private registryIndex: Map<string, SkillRegistryEntry> = new Map();

  /** Path to the local registry file */
  private registryFilePath: string;

  /** Whether discovery has been run at least once */
  private discovered: boolean = false;

  constructor(options: SkillStandardOptions = {}) {
    this.globalSkillsDir =
      options.globalSkillsDir ||
      path.join(os.homedir(), DEFAULT_GLOBAL_SKILLS_DIR);

    this.projectSkillsDir =
      options.projectSkillsDir || DEFAULT_PROJECT_SKILLS_DIR;

    this.enableCache = options.enableCache ?? true;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    this.registryBaseUrl = options.registryBaseUrl || REGISTRY_BASE_URL;

    this.registryFilePath = path.join(
      this.globalSkillsDir,
      "..",
      "registry.json"
    );
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
  discoverSkills(projectRoot: string): SkillCompactEntry[] {
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
      .map((s): SkillCompactEntry => ({
        name: s.name,
        description: s.description,
        priority: s.priority ?? 50,
        invoke: s.invoke ?? "auto",
        load: s.load ?? "on-demand",
      }))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
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
  parseSkillMd(filePath: string): ParseResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Read file
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      return {
        skill: null,
        warnings,
        errors: [
          `Failed to read skill file at ${filePath}: ${(err as Error).message}`,
        ],
      };
    }

    // Detect format and adapt
    const format = detectFormat(filePath);
    let result: ParseResult;

    switch (format) {
      case "claude":
        result = adaptFromClaudeCode(raw, filePath);
        warnings.push(
          `Adapted from Claude Code format (CLAUDE.md). Some fields may need review.`
        );
        break;
      case "codex":
        result = adaptFromCodexCli(raw, filePath);
        warnings.push(
          `Adapted from Codex CLI format (${path.basename(filePath)}). Some fields may need review.`
        );
        break;
      case "copilot":
        result = adaptFromCopilot(raw, filePath);
        warnings.push(
          `Adapted from GitHub Copilot format. Some fields may need review.`
        );
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
      } else if (!VALID_NAME_REGEX.test(result.skill.name)) {
        errors.push(
          `Invalid skill name "${result.skill.name}". Must be lowercase, start with a letter, contain only letters, digits, and hyphens, and be at most ${MAX_NAME_LENGTH} characters. Pattern: ${VALID_NAME_REGEX.source}`
        );
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
          warnings.push(
            `Version "${result.skill.version}" does not follow semver (major.minor.patch).`
          );
        }
      }

      // Validate priority range
      if (result.skill && result.skill.priority !== undefined) {
        if (result.skill.priority < 0 || result.skill.priority > 100) {
          warnings.push(
            `Priority ${result.skill.priority} is outside the recommended 0-100 range. Clamping.`
          );
          result.skill.priority = Math.max(
            0,
            Math.min(100, result.skill.priority)
          );
        }
      }

      // Set defaults
      if (result.skill) {
        result.skill.priority = result.skill.priority ?? 50;
        result.skill.invoke = result.skill.invoke ?? "auto";
        result.skill.load = result.skill.load ?? "on-demand";
        result.skill.source = determineSource(
          filePath,
          this.globalSkillsDir,
          this.projectSkillsDir
        );
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
  getCompactListing(): SkillCompactEntry[] {
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
  activateSkill(
    name: string,
    prompt: string
  ): StandardSkillDefinition | null {
    const skill = this.skills.get(name);
    if (!skill) return null;

    // For explicit invoke, only activate if the skill name is directly
    // referenced in the prompt
    if (skill.invoke === "explicit") {
      const namePatterns = [
        name,
        name.replace(/-/g, " "),
        name.replace(/-/g, "_"),
      ];
      const promptLower = prompt.toLowerCase();
      const isReferenced = namePatterns.some((p) =>
        promptLower.includes(p.toLowerCase())
      );
      if (!isReferenced) return null;
    }

    // For auto invoke, check if the description matches the prompt context.
    // Use a simple keyword-overlap heuristic with a threshold.
    if (skill.invoke === "auto") {
      const descriptionKeywords = extractKeywords(skill.description);
      const promptKeywords = extractKeywords(prompt);

      if (descriptionKeywords.length > 0) {
        const overlap = descriptionKeywords.filter((k) =>
          promptKeywords.includes(k)
        );
        // Require at least 30% keyword overlap, or at least 1 match for
        // short descriptions
        const threshold = Math.max(1, Math.ceil(descriptionKeywords.length * 0.3));
        if (overlap.length < threshold) return null;
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
  async installSkill(
    source: string,
    options: {
      /** Install to global directory instead of project directory */
      global?: boolean;
      /** Override the skill name (auto-detected from frontmatter by default) */
      name?: string;
      /** Project root for project-level installs */
      projectRoot?: string;
    } = {}
  ): Promise<{ skill: StandardSkillDefinition | null; errors: string[] }> {
    const errors: string[] = [];
    let content: string;

    // Determine if source is a URL or local path
    if (source.startsWith("http://") || source.startsWith("https://")) {
      try {
        content = await httpGet(source);
      } catch (err) {
        return {
          skill: null,
          errors: [
            `Failed to fetch skill from ${source}: ${(err as Error).message}`,
          ],
        };
      }
    } else {
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
      } catch (err) {
        return {
          skill: null,
          errors: [
            `Failed to read local file at ${resolvedPath}: ${(err as Error).message}`,
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
        : path.join(
            path.resolve(options.projectRoot || process.cwd()),
            this.projectSkillsDir,
            skillName
          );

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
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tempPath);
      } catch {
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
  async searchSkills(query: string): Promise<SkillRegistryEntry[]> {
    const results: SkillRegistryEntry[] = [];
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
    } catch {
      // Remote registry unavailable — return local results only
    }

    // Sort by relevance: installed first, then by name
    results.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
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
  async publishSkill(
    skillPath: string
  ): Promise<{ entry: SkillRegistryEntry | null; errors: string[] }> {
    const errors: string[] = [];

    // Resolve path
    const resolved = path.resolve(skillPath);
    let filePath: string;

    if (fs.statSync(resolved).isDirectory()) {
      filePath = path.join(resolved, SKILL_FILENAME);
    } else {
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

    const entry: SkillRegistryEntry = {
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
    } catch (err) {
      errors.push(
        `Remote publish failed: ${(err as Error).message}. Skill saved to local registry only.`
      );
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
  getSkillContent(name: string): StandardSkillDefinition | null {
    const skill = this.skills.get(name);
    if (!skill) return null;

    // Re-read from disk to ensure we have the latest content
    try {
      const raw = fs.readFileSync(skill.filePath, "utf8");
      const result = this.parseSkillMd(skill.filePath);
      if (result.skill) {
        // Update the cached version
        this.skills.set(name, result.skill);
        return result.skill;
      }
    } catch {
      // Fall back to cached version
    }

    return skill;
  }

  /**
   * List all installed skills with their current status.
   *
   * @returns Array of skill definitions with status information
   */
  listInstalled(): Array<
    StandardSkillDefinition & {
      /** Whether the skill is currently loaded in memory */
      loaded: boolean;
      /** The skill format origin */
      format: SkillFormat;
    }
  > {
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
  private parseNeuroFormat(raw: string, filePath: string): ParseResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    const { metadata, body } = parseFrontmatter(raw);

    const name = metadata.name as string | undefined;
    const description = metadata.description as string | undefined;

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

    const skill: StandardSkillDefinition = {
      name: name!,
      description: description!,
      version: (metadata.version as string) || undefined,
      author: (metadata.author as string) || undefined,
      tags: Array.isArray(metadata.tags) ? (metadata.tags as string[]) : undefined,
      tools: Array.isArray(metadata.tools) ? (metadata.tools as string[]) : undefined,
      priority: typeof metadata.priority === "number" ? metadata.priority : undefined,
      invoke: (metadata.invoke as "explicit" | "auto") || undefined,
      load: (metadata.load as "startup" | "on-demand") || undefined,
      body,
      filePath,
      source: "project", // Will be overridden by caller
    };

    return { skill, warnings, errors };
  }

  /**
   * Invalidate the discovery cache.
   */
  private invalidateCache(): void {
    this.cache = null;
    this.discovered = false;
    this.compactListing = [];
  }

  /**
   * Load the local registry index from disk.
   */
  private loadRegistryIndex(): void {
    this.registryIndex.clear();
    if (!fs.existsSync(this.registryFilePath)) return;

    try {
      const raw = fs.readFileSync(this.registryFilePath, "utf8");
      const data = JSON.parse(raw) as Array<SkillRegistryEntry>;
      for (const entry of data) {
        // Verify installation status
        const skillDir = path.join(this.globalSkillsDir, entry.name);
        entry.installed = fs.existsSync(path.join(skillDir, SKILL_FILENAME));
        this.registryIndex.set(entry.name, entry);
      }
    } catch {
      // Corrupted or empty registry — start fresh
    }
  }

  /**
   * Save the local registry index to disk.
   */
  private saveRegistryIndex(): void {
    ensureDir(path.dirname(this.registryFilePath));
    const data = Array.from(this.registryIndex.values());
    fs.writeFileSync(this.registryFilePath, JSON.stringify(data, null, 2), "utf8");
  }

  /**
   * Update a single registry entry.
   */
  private updateRegistryEntry(
    skill: StandardSkillDefinition,
    source: string
  ): void {
    this.loadRegistryIndex();

    try {
      const content = fs.readFileSync(skill.filePath, "utf8");
      const entry: SkillRegistryEntry = {
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
    } catch {
      // Silently fail — non-critical
    }
  }

  /**
   * Search the remote skill registry.
   */
  private async searchRemoteRegistry(
    query: string
  ): Promise<SkillRegistryEntry[]> {
    const url = `${this.registryBaseUrl}/api/v1/skills/search?q=${encodeURIComponent(query)}`;
    const raw = await httpGet(url);
    const data = JSON.parse(raw);

    if (Array.isArray(data)) {
      return data as SkillRegistryEntry[];
    }

    if (data && Array.isArray(data.results)) {
      return data.results as SkillRegistryEntry[];
    }

    return [];
  }

  /**
   * Check if a registry entry matches the given query terms.
   */
  private matchesQuery(
    entry: SkillRegistryEntry,
    queryTerms: string[]
  ): boolean {
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
function extractKeywords(text: string): string[] {
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
function serializeToStandardFormat(skill: StandardSkillDefinition): string {
  const lines: string[] = ["---"];

  lines.push(`name: ${skill.name}`);
  lines.push(`description: "${skill.description.replace(/"/g, '\\"')}"`);

  if (skill.version) lines.push(`version: "${skill.version}"`);
  if (skill.author) lines.push(`author: "${skill.author}"`);
  if (skill.tags && skill.tags.length > 0) {
    lines.push(`tags: [${skill.tags.map((t) => `"${t}"`).join(", ")}]`);
  }
  if (skill.tools && skill.tools.length > 0) {
    lines.push(`tools: [${skill.tools.map((t) => `"${t}"`).join(", ")}]`);
  }
  if (skill.priority !== undefined) lines.push(`priority: ${skill.priority}`);
  if (skill.invoke) lines.push(`invoke: ${skill.invoke}`);
  if (skill.load) lines.push(`load: ${skill.load}`);

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
export function createSkillFile(
  dirPath: string,
  definition: Omit<StandardSkillDefinition, "filePath" | "source" | "body"> & {
    body?: string;
  }
): string {
  ensureDir(dirPath);

  const skill: StandardSkillDefinition = {
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
export function validateSkillName(name: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!name) {
    errors.push("Name is required.");
  } else {
    if (name.length > MAX_NAME_LENGTH) {
      errors.push(
        `Name exceeds maximum length of ${MAX_NAME_LENGTH} characters (got ${name.length}).`
      );
    }
    if (!/^[a-z]/.test(name)) {
      errors.push("Name must start with a lowercase letter.");
    }
    if (/[^a-z0-9-]/.test(name)) {
      errors.push(
        "Name must contain only lowercase letters, digits, and hyphens."
      );
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
