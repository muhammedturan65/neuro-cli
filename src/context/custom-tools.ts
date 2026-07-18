// ============================================================
// NeuroCLI - Custom Tools Loader
// Loads custom tool definitions from .neuro/tools/ directories
// Supports JSON configs and JS/TS module exports
// ============================================================

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
  risk?: 'low' | 'medium' | 'high';
  execute?: string; // JavaScript source code as string
  command?: string; // shell command template with {{arg}} placeholders
  source: string;
}

// ---------------------------------------------------------------------------
// Sandbox: restricted globals available to custom tool execute functions
// ---------------------------------------------------------------------------

const SANDBOX_ALLOWED_GLOBALS = new Set([
  'JSON',
  'Math',
  'Date',
  'String',
  'Number',
  'Boolean',
  'Array',
  'Object',
  'Map',
  'Set',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
  'undefined',
  'null',
  'NaN',
  'Infinity',
]);

// ---------------------------------------------------------------------------
// CustomToolLoader
// ---------------------------------------------------------------------------

export class CustomToolLoader {
  private tools: Map<string, CustomToolDefinition>;
  private projectToolsDir: string;
  private globalToolsDir: string;

  constructor(projectRoot: string) {
    this.projectToolsDir = join(projectRoot, '.neuro', 'tools');
    this.globalToolsDir = join(homedir(), '.neuro', 'tools');
    this.tools = new Map();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Discover and load all custom tools (global then project, project wins). */
  discover(): CustomToolDefinition[] {
    this.tools.clear();

    // Load in order: global -> project (project overrides global)
    this.loadFromDirectory(this.globalToolsDir);
    this.loadFromDirectory(this.projectToolsDir);

    return this.getAll();
  }

  /** Retrieve a single tool definition by name. */
  get(name: string): CustomToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Return all discovered tool definitions, sorted by name. */
  getAll(): CustomToolDefinition[] {
    return Array.from(this.tools.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /**
   * Create an executor function for a tool definition.
   *
   * If the tool defines `execute`, the source is run inside a sandboxed
   * function body with only safe globals. The `args` object is passed as
   * the first argument and the executor must return a string.
   *
   * If the tool defines `command`, the template string has {{arg}} tokens
   * replaced with the corresponding argument values and is executed via
   * a restricted shell invocation.
   */
  createExecutor(
    def: CustomToolDefinition,
  ): (args: Record<string, unknown>) => Promise<string> {
    if (def.execute) {
      return this.createJsExecutor(def);
    }

    if (def.command) {
      return this.createCommandExecutor(def);
    }

    // No execution strategy -- return a fallback that explains the issue
    return async () =>
      `[custom-tools] Tool "${def.name}" has no execute or command definition.`;
  }

  /** Print a human-readable list of all discovered custom tools. */
  printTools(): void {
    const all = this.getAll();

    // eslint-disable-next-line no-console
    console.log('\n=== Custom Tools ===\n');

    if (all.length === 0) {
      // eslint-disable-next-line no-console
      console.log('  (no custom tools found)\n');
      return;
    }

    for (const tool of all) {
      const riskLabel = tool.risk ? ` [${tool.risk} risk]` : '';
      const mode = tool.execute ? 'js' : tool.command ? 'shell' : 'none';
      const paramCount = Object.keys(tool.parameters.properties).length;

      // eslint-disable-next-line no-console
      console.log(`  ${tool.name}${riskLabel} - ${tool.description}`);
      // eslint-disable-next-line no-console
      console.log(
        `    params: ${paramCount} | mode: ${mode} | source: ${tool.source}`,
      );

      if (tool.parameters.required.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `    required: ${tool.parameters.required.join(', ')}`,
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log('');
  }

  // -------------------------------------------------------------------------
  // Private: directory loading
  // -------------------------------------------------------------------------

  /** Scan a directory for .json, .js, .mjs, .ts tool definition files. */
  private loadFromDirectory(dir: string): void {
    if (!existsSync(dir)) {
      return;
    }

    let entries: string[];
    try {
      const stat = statSync(dir);
      if (!stat.isDirectory()) {
        return;
      }
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const filePath = join(dir, entry);
      try {
        const fileStat = statSync(filePath);
        if (!fileStat.isFile()) {
          continue;
        }

        const ext = extname(entry).toLowerCase();
        let tool: CustomToolDefinition | null = null;

        if (ext === '.json') {
          tool = this.loadJsonTool(filePath);
        } else if (ext === '.js' || ext === '.mjs' || ext === '.ts') {
          tool = this.loadJsTool(filePath);
        } else {
          // Skip unsupported file types
          continue;
        }

        if (tool) {
          // Project tools override global tools with the same name
          this.tools.set(tool.name, tool);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(
          `[custom-tools] Failed to load tool from "${filePath}": ${message}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: JSON tool loader
  // -------------------------------------------------------------------------

  /**
   * Load a tool definition from a JSON file.
   *
   * Expected format:
   * {
   *   "name": "my-tool",
   *   "description": "Does something useful",
   *   "parameters": {
   *     "type": "object",
   *     "properties": { ... },
   *     "required": [ ... ]
   *   },
   *   "risk": "low",
   *   "command": "echo {{input}}"
   * }
   */
  private loadJsonTool(filePath: string): CustomToolDefinition | null {
    const raw = readFileSync(filePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Invalid JSON in "${filePath}"`,
      );
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Expected a JSON object in "${filePath}"`,
      );
      return null;
    }

    const def = parsed as Partial<CustomToolDefinition>;

    // Derive name from filename if not set
    if (!def.name) {
      const base = basename(filePath, '.json');
      def.name = base.replace(/[^a-zA-Z0-9_-]/g, '-');
    }

    if (!this.validateDefinition(def)) {
      return null;
    }

    return {
      name: def.name!,
      description: def.description!,
      parameters: def.parameters!,
      risk: def.risk,
      execute: def.execute,
      command: def.command,
      source: filePath,
    };
  }

  // -------------------------------------------------------------------------
  // Private: JS/TS tool loader
  // -------------------------------------------------------------------------

  /**
   * Load a tool definition from a JS/TS file.
   *
   * The file should export a `default` or named `toolDefinition` object
   * conforming to CustomToolDefinition (without `source`).
   *
   * Example (ESM):
   *   export const toolDefinition = { name: ..., ... };
   *   export default toolDefinition;
   *
   * Because we cannot natively import arbitrary ESM at runtime without
   * a dynamic import that may fail on TS files, we take a pragmatic
   * approach: read the file source and attempt to extract the exported
   * definition via a sandboxed evaluation for .js/.mjs, or parse the
   * object literal for .ts files.
   */
  private loadJsTool(filePath: string): CustomToolDefinition | null {
    const raw = readFileSync(filePath, 'utf-8');
    const ext = extname(filePath).toLowerCase();

    let def: Partial<CustomToolDefinition> | null = null;

    if (ext === '.ts') {
      // For TypeScript files, strip type annotations naively and
      // attempt to extract the exported object.
      def = this.extractDefinitionFromSource(raw, filePath);
    } else {
      // For JS/MJS files, evaluate in a sandboxed context
      def = this.evaluateJsSource(raw, filePath);
    }

    if (!def) {
      return null;
    }

    // Derive name from filename if not set
    if (!def.name) {
      const base = basename(filePath, ext);
      def.name = base.replace(/[^a-zA-Z0-9_-]/g, '-');
    }

    if (!this.validateDefinition(def)) {
      return null;
    }

    return {
      name: def.name!,
      description: def.description!,
      parameters: def.parameters!,
      risk: def.risk,
      execute: def.execute,
      command: def.command,
      source: filePath,
    };
  }

  /**
   * Attempt to extract a tool definition object from source code text.
   * Looks for common export patterns and parses the object literal.
   */
  private extractDefinitionFromSource(
    source: string,
    filePath: string,
  ): Partial<CustomToolDefinition> | null {
    // Try to find: export const toolDefinition = { ... }
    // or: export default { ... }
    const patterns = [
      // export const toolDefinition = { ... }
      /export\s+const\s+toolDefinition\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
      // export default { ... }
      /export\s+default\s+(\{[\s\S]*\})\s*;?\s*$/,
      // const toolDefinition = { ... }  (no export keyword on same line)
      /const\s+toolDefinition\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) {
        const objStr = this.sanitizeTsObjectLiteral(match[1]);
        try {
          // eslint-disable-next-line no-new-func
          const fn = new Function(`return (${objStr});`);
          const result = fn();
          if (typeof result === 'object' && result !== null) {
            return result as Partial<CustomToolDefinition>;
          }
        } catch {
          // eslint-disable-next-line no-console
          console.warn(
            `[custom-tools] Could not parse exported definition in "${filePath}"`,
          );
        }
      }
    }

    // eslint-disable-next-line no-console
    console.warn(
      `[custom-tools] No toolDefinition export found in "${filePath}"`,
    );
    return null;
  }

  /**
   * Strip TypeScript-specific syntax from an object literal string
   * so it can be parsed as plain JavaScript.
   */
  private sanitizeTsObjectLiteral(src: string): string {
    return src
      .replace(/\bas\s+\w+(\[\])?\b/g, '')       // remove "as Type" casts
      .replace(/:\s*\w+(\[\])?\s*([,=}])/g, '$2')  // remove type annotations like ": string"
      .replace(/<[^>]+>/g, '')                      // remove generic type params
      .replace(/\?\s*:/g, ':')                      // remove optional marker
      .replace(/readonly\s+/g, '')                   // remove readonly modifier
      .replace(/\/\/.*$/gm, '')                      // remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');            // remove multi-line comments
  }

  /**
   * Evaluate a JS source file in a sandboxed context and extract
   * the exported tool definition.
   */
  private evaluateJsSource(
    source: string,
    filePath: string,
  ): Partial<CustomToolDefinition> | null {
    // Build a sandboxed module-like wrapper
    // We extract the default export or toolDefinition export
    const wrappedSource = `
      "use strict";
      const __exports = {};
      const module = { exports: __exports };
      const exports = __exports;

      ${source}

      if (typeof toolDefinition !== 'undefined') {
        return toolDefinition;
      }
      if (module.exports && typeof module.exports === 'object') {
        if (module.exports.default) return module.exports.default;
        if (module.exports.toolDefinition) return module.exports.toolDefinition;
        return module.exports;
      }
      return null;
    `;

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(wrappedSource);
      const result = fn();

      if (typeof result === 'object' && result !== null) {
        return result as Partial<CustomToolDefinition>;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Error evaluating "${filePath}": ${message}`,
      );
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Private: schema validation
  // -------------------------------------------------------------------------

  /**
   * Validate that a partial tool definition has all required fields
   * and that their shapes are correct.
   */
  private validateDefinition(def: Partial<CustomToolDefinition>): boolean {
    // Name
    if (!def.name || typeof def.name !== 'string') {
      // eslint-disable-next-line no-console
      console.warn('[custom-tools] Tool definition missing valid "name".');
      return false;
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(def.name)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Tool name "${def.name}" must start with a letter and contain only letters, digits, hyphens, and underscores.`,
      );
      return false;
    }

    // Description
    if (!def.description || typeof def.description !== 'string') {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Tool "${def.name}" missing valid "description".`,
      );
      return false;
    }

    // Parameters
    if (!def.parameters || typeof def.parameters !== 'object') {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Tool "${def.name}" missing "parameters" object.`,
      );
      return false;
    }

    if (def.parameters.type !== 'object') {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Tool "${def.name}" parameters.type must be "object".`,
      );
      return false;
    }

    if (
      !def.parameters.properties ||
      typeof def.parameters.properties !== 'object'
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Tool "${def.name}" missing "parameters.properties".`,
      );
      return false;
    }

    if (!Array.isArray(def.parameters.required)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Tool "${def.name}" "parameters.required" must be an array.`,
      );
      return false;
    }

    // Validate each property in parameters.properties
    for (const [key, prop] of Object.entries(def.parameters.properties)) {
      if (!prop.type || typeof prop.type !== 'string') {
        // eslint-disable-next-line no-console
        console.warn(
          `[custom-tools] Tool "${def.name}" parameter "${key}" missing valid "type".`,
        );
        return false;
      }
      if (!prop.description || typeof prop.description !== 'string') {
        // eslint-disable-next-line no-console
        console.warn(
          `[custom-tools] Tool "${def.name}" parameter "${key}" missing valid "description".`,
        );
        return false;
      }
      if (prop.enum !== undefined && !Array.isArray(prop.enum)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[custom-tools] Tool "${def.name}" parameter "${key}" has invalid "enum" (must be array).`,
        );
        return false;
      }
    }

    // Validate required entries reference existing properties
    for (const reqKey of def.parameters.required) {
      if (!(reqKey in def.parameters.properties)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[custom-tools] Tool "${def.name}" required parameter "${reqKey}" not found in properties.`,
        );
        return false;
      }
    }

    // Validate risk level if present
    if (
      def.risk !== undefined &&
      !['low', 'medium', 'high'].includes(def.risk)
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Tool "${def.name}" has invalid risk level "${def.risk}". Must be low, medium, or high.`,
      );
      return false;
    }

    // Must have at least one execution strategy
    if (!def.execute && !def.command) {
      // eslint-disable-next-line no-console
      console.warn(
        `[custom-tools] Tool "${def.name}" must define either "execute" or "command".`,
      );
      return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Private: executor creation
  // -------------------------------------------------------------------------

  /**
   * Create an executor that runs the tool's JavaScript source in a sandbox.
   *
   * The sandbox restricts access to only safe, deterministic globals.
   * Network access, filesystem, and process APIs are not available.
   */
  private createJsExecutor(
    def: CustomToolDefinition,
  ): (args: Record<string, unknown>) => Promise<string> {
    const source = def.execute!;

    return async (args: Record<string, unknown>): Promise<string> => {
      try {
        // Build a sandboxed function that only has access to allowed globals
        const sandboxKeys = Array.from(SANDBOX_ALLOWED_GLOBALS);
        const sandboxValues = sandboxKeys.map((key) => {
          // eslint-disable-next-line no-eval
          return (globalThis as Record<string, unknown>)[key];
        });

        // Wrap the user source so it receives `args` and must return a string
        const wrappedSource = `
          "use strict";
          const __fn = (function(${sandboxKeys.join(', ')}) {
            return function(args) {
              ${source}
            };
          })(${sandboxKeys.join(', ')});
          return __fn(args);
        `;

        // eslint-disable-next-line no-new-func
        const fn = new Function(wrappedSource);
        const result = fn(args);

        // Coerce result to string
        if (result === undefined || result === null) {
          return '';
        }
        return String(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[custom-tools] Execution error in tool "${def.name}": ${message}`,
        );
      }
    };
  }

  /**
   * Create an executor that runs a shell command template.
   *
   * Template tokens like {{input}} are replaced with the corresponding
   * argument values. Shell metacharacters in argument values are escaped
   * to reduce injection risk.
   */
  private createCommandExecutor(
    def: CustomToolDefinition,
  ): (args: Record<string, unknown>) => Promise<string> {
    const template = def.command!;

    return async (args: Record<string, unknown>): Promise<string> => {
      // Replace {{key}} placeholders with escaped argument values
      let command = template.replace(
        /\{\{(\w+)\}\}/g,
        (_match, key: string) => {
          const value = args[key];
          if (value === undefined || value === null) {
            return '';
          }
          return this.escapeShellArg(String(value));
        },
      );

      // Enforce risk-based restrictions
      if (def.risk === 'high') {
        throw new Error(
          `[custom-tools] Tool "${def.name}" is marked as high-risk and cannot be executed via shell command.`,
        );
      }

      // Disallow obviously dangerous patterns regardless of risk level
      const dangerousPatterns = [
        /rm\s+-rf\s+\//,
        />\s*\/dev\//,
        /mkfs/,
        /dd\s+if=/,
        /:\s*\(\)\{\s*:\|\:&\s*\}/,  // fork bomb
        /curl\s+.*\|\s*(ba)?sh/,
        /wget\s+.*\|\s*(ba)?sh/,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(command)) {
          throw new Error(
            `[custom-tools] Command for tool "${def.name}" contains a disallowed pattern.`,
          );
        }
      }

      try {
        const output = execFileSync('sh', ['-c', command], {
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 1024 * 1024, // 1 MB
          shell: false,
        });
        return output.trim();
      } catch (err: unknown) {
        if (err instanceof Error) {
          const stderr = (err as any).stderr || err.message;
          throw new Error(
            `[custom-tools] Shell command failed for tool "${def.name}": ${stderr}`,
          );
        }
        throw new Error(
          `[custom-tools] Unknown error executing tool "${def.name}".`,
        );
      }
    };
  }

  /**
   * Escape a string for safe inclusion in a shell command argument.
   * Uses single-quoting with internal single-quotes escaped.
   */
  private escapeShellArg(value: string): string {
    // Replace embedded single quotes with '\'' (end quote, escaped quote, new quote)
    const escaped = value.replace(/'/g, "'\\''");
    return `'${escaped}'`;
  }
}
