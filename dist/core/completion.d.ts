import { CompleterResult } from 'readline';
export declare class CompletionEngine {
    private slashCommands;
    private modelIds;
    private agentNames;
    private cwd;
    private commandHistory;
    private maxHistory;
    private historyPath;
    private permissionModes;
    private themes;
    private mcpSubcommands;
    private skillSubcommands;
    private cacheSubcommands;
    private ignoreSubcommands;
    private styleNames;
    private thinkingModes;
    private effortLevels;
    private telemetrySubcommands;
    private syncSubcommands;
    private voiceSubcommands;
    private locales;
    private serverSubcommands;
    private dashboardSubcommands;
    private fileExtensions;
    constructor(cwd?: string);
    setAgentNames(names: string[]): void;
    addHistory(command: string): void;
    private loadHistory;
    private saveHistory;
    getHistory(): string[];
    searchHistory(prefix: string): string[];
    complete: (line: string) => CompleterResult;
    private completeSlashCommand;
    private completeModel;
    private completeAgent;
    private completeFilePath;
    private completeSessionId;
    private looksLikeFilePath;
    /**
     * Display completion suggestions nicely
     */
    static displaySuggestions(suggestions: string[]): void;
    /**
     * Get contextual help for a partial command
     */
    getContextualHelp(partial: string): string | null;
}
//# sourceMappingURL=completion.d.ts.map