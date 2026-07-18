export interface IgnoreRule {
    pattern: string;
    negated: boolean;
    regex: RegExp;
    source: string;
}
export declare class NeuroIgnore {
    private rules;
    private cache;
    private projectRoot;
    private loaded;
    constructor(projectRoot: string);
    /**
     * Load ignore rules from all sources:
     *   1. Default patterns
     *   2. ~/.neuro/ignore  (global user rules)
     *   3. .neuroignore     (project-root rules)
     */
    load(): void;
    /**
     * Check whether a given file path should be ignored.
     * The path may be absolute or relative to projectRoot.
     *
     * Evaluation order matters: later rules override earlier ones.
     * Negated patterns (prefixed with !) un-ignore previously matched paths.
     */
    isIgnored(filePath: string): boolean;
    /**
     * Filter an array of paths, removing those that are ignored.
     */
    filterPaths(paths: string[]): string[];
    /**
     * Dynamically add a rule at runtime.
     */
    addRule(pattern: string, source?: string): void;
    /**
     * Remove a rule by its original pattern string.
     * Returns true if a rule was found and removed.
     */
    removeRule(pattern: string): boolean;
    /**
     * Return a shallow copy of the current rules list.
     */
    getRules(): IgnoreRule[];
    /**
     * Clear the result cache.
     */
    clearCache(): void;
    /**
     * Print all active rules to stdout (useful for debugging).
     */
    printRules(): void;
    static readonly DEFAULT_IGNORED: string[];
    /**
     * Load rules from a single file. Lines starting with # are comments.
     * Blank lines are skipped. Trailing whitespace is trimmed.
     */
    private loadFromFile;
    /**
     * Populate the default ignore rules.
     */
    private loadDefaultRules;
    /**
     * Convert a gitignore-style glob pattern into a RegExp.
     *
     * Supported features:
     *   *        matches anything except /
     *   **       matches anything including /
     *   ?        matches any single character except /
     *   [abc]    character class
     *   [a-z]    character range
     *   {a,b}    brace expansion (alternation)
     *   !prefix  negation (handled separately before this method)
     *
     * A trailing / means the pattern only matches directories; we keep
     * the regex flexible enough to match both for simplicity, but strip
     * the trailing slash indicator.
     */
    private patternToRegex;
    /**
     * Escape a string for use inside a RegExp.
     */
    private escapeRegex;
    /**
     * Ensure rules have been loaded before answering queries.
     */
    private ensureLoaded;
    /**
     * Convert a file path to a relative posix-style path from projectRoot.
     * - Absolute paths are made relative to projectRoot.
     * - Backslashes (Windows) are converted to forward slashes.
     * - Leading ./ is stripped.
     */
    private toRelativePosix;
    /**
     * Auto-detect common directories in the project root that should
     * typically be ignored (e.g. a large "vendor" or "dist" directory
     * that was not already covered by default patterns).
     */
    private autoDetectIgnorableDirs;
}
//# sourceMappingURL=neuroignore.d.ts.map