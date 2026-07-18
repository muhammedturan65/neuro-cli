export interface CustomToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required: string[];
    };
    risk?: 'low' | 'medium' | 'high';
    execute?: string;
    command?: string;
    source: string;
}
export declare class CustomToolLoader {
    private tools;
    private projectToolsDir;
    private globalToolsDir;
    constructor(projectRoot: string);
    /** Discover and load all custom tools (global then project, project wins). */
    discover(): CustomToolDefinition[];
    /** Retrieve a single tool definition by name. */
    get(name: string): CustomToolDefinition | undefined;
    /** Return all discovered tool definitions, sorted by name. */
    getAll(): CustomToolDefinition[];
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
    createExecutor(def: CustomToolDefinition): (args: Record<string, unknown>) => Promise<string>;
    /** Print a human-readable list of all discovered custom tools. */
    printTools(): void;
    /** Scan a directory for .json, .js, .mjs, .ts tool definition files. */
    private loadFromDirectory;
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
    private loadJsonTool;
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
    private loadJsTool;
    /**
     * Attempt to extract a tool definition object from source code text.
     * Looks for common export patterns and parses the object literal.
     */
    private extractDefinitionFromSource;
    /**
     * Strip TypeScript-specific syntax from an object literal string
     * so it can be parsed as plain JavaScript.
     */
    private sanitizeTsObjectLiteral;
    /**
     * Evaluate a JS source file in a sandboxed context and extract
     * the exported tool definition.
     */
    private evaluateJsSource;
    /**
     * Validate that a partial tool definition has all required fields
     * and that their shapes are correct.
     */
    private validateDefinition;
    /**
     * Create an executor that runs the tool's JavaScript source in a sandbox.
     *
     * The sandbox restricts access to only safe, deterministic globals.
     * Network access, filesystem, and process APIs are not available.
     */
    private createJsExecutor;
    /**
     * Create an executor that runs a shell command template.
     *
     * Template tokens like {{input}} are replaced with the corresponding
     * argument values. Shell metacharacters in argument values are escaped
     * to reduce injection risk.
     */
    private createCommandExecutor;
    /**
     * Escape a string for safe inclusion in a shell command argument.
     * Uses single-quoting with internal single-quotes escaped.
     */
    private escapeShellArg;
}
//# sourceMappingURL=custom-tools.d.ts.map