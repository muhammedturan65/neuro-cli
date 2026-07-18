export interface OutputStyle {
    name: string;
    description: string;
    systemPromptAddition: string;
    formatRules: {
        codeBlocks: 'minimal' | 'detailed' | 'annotated';
        explanations: 'brief' | 'moderate' | 'thorough';
        examples: boolean;
        stepByStep: boolean;
        includeReasoning: boolean;
        language: 'technical' | 'simple' | 'academic' | 'casual';
    };
}
export declare class StyleManager {
    private currentStyle;
    private styles;
    private stylesDir;
    private projectStylesDir;
    constructor(workingDirectory: string);
    /** Return the currently active style. */
    getStyle(): OutputStyle;
    /** Switch to a named style. Returns true on success. */
    setStyle(name: string): boolean;
    /** Return all available styles (built-in + custom). */
    listStyles(): OutputStyle[];
    /** Return the system-prompt addition string for the active style. */
    getSystemPromptAddition(): string;
    /** Scan both global and project style directories for custom styles. */
    discoverCustomStyles(): void;
    /** Load a single style from a markdown file path. */
    loadStyleFromFile(filePath: string): OutputStyle | null;
    /** Pretty-print all styles to stdout (used by /style command). */
    printStyles(): void;
    private loadBuiltinStyles;
    /**
     * Parse a markdown file with YAML frontmatter into an OutputStyle.
     *
     * Expected format:
     * ---
     * description: Short description of the style
     * codeBlocks: minimal | detailed | annotated
     * explanations: brief | moderate | thorough
     * examples: true | false
     * stepByStep: true | false
     * includeReasoning: true | false
     * language: technical | simple | academic | casual
     * ---
     *
     * The body of the markdown becomes the systemPromptAddition.
     */
    private parseStyleMarkdown;
    private loadStylesFromDirectory;
    private getPersistencePath;
    private persistStylePreference;
    private readPersistedStyle;
}
//# sourceMappingURL=output-styles.d.ts.map