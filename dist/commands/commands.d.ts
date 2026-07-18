export interface CustomCommand {
    name: string;
    description: string;
    prompt: string;
    args?: string[];
    model?: string;
    tools?: string[];
    autoApprove?: boolean;
    subagent?: boolean;
}
export declare class CommandSystem {
    private commands;
    private workingDirectory;
    constructor(workingDirectory: string);
    /**
     * Discover and load custom commands
     */
    discover(): CustomCommand[];
    /**
     * Get a command by name
     */
    get(name: string): CustomCommand | undefined;
    /**
     * Get all commands
     */
    getAll(): CustomCommand[];
    /**
     * Parse a slash command input
     */
    parse(input: string): {
        command: CustomCommand;
        args: string;
    } | null;
    /**
     * Build the final prompt from a command template and args
     */
    buildPrompt(command: CustomCommand, args: string): string;
    private discoverFromDirectory;
    private parseCommandFile;
    private parseSimpleYaml;
    private loadBundledCommands;
}
//# sourceMappingURL=commands.d.ts.map