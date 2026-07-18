export type ShellType = 'bash' | 'zsh' | 'fish';
export interface CompletionOptions {
    commands: Array<{
        name: string;
        description: string;
        options: Array<{
            flags: string;
            description: string;
        }>;
        subcommands?: Array<{
            name: string;
            description: string;
        }>;
    }>;
    models: string[];
    themes: string[];
    permissionModes: string[];
    agents: string[];
    slashCommands: string[];
}
export declare class ShellCompletionGenerator {
    private options;
    constructor(options: CompletionOptions);
    /**
     * Generate a completion script for the given shell type.
     */
    generate(shell: ShellType): string;
    generateBash(): string;
    generateZsh(): string;
    generateFish(): string;
    writeToFile(shell: ShellType, filePath: string): void;
    static getDefaultOptions(): CompletionOptions;
    /**
     * Escape a string for safe embedding in a bash double-quoted context.
     * Escapes: backslash, double-quote, dollar, backtick, and exclamation.
     */
    private bashEscape;
    /**
     * Escape a string for safe embedding in a zsh single-quoted context.
     * Inside single quotes only the single quote itself needs escaping;
     * zsh uses '\'' (end quote, escaped quote, reopen quote).
     */
    private zshEscape;
    /**
     * Escape a string for safe embedding in a fish completion description
     * or argument. Fish uses single quotes; escape single quotes and
     * backslashes.
     */
    private fishEscape;
}
//# sourceMappingURL=shell-completion.d.ts.map