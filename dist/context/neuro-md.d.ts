export interface NeuroMdLayer {
    scope: 'global' | 'user' | 'project' | 'local' | 'directory';
    path: string;
    content: string;
    size: number;
}
export declare class NeuroMdSystem {
    private workingDirectory;
    private layers;
    private watchers;
    private onChange?;
    constructor(workingDirectory: string, onChange?: () => void);
    /**
     * Load all NEURO.md layers in priority order
     * Global → User → Project → Local → Directory
     */
    load(): NeuroMdLayer[];
    /**
     * Get the combined context from all NEURO.md layers
     */
    getCombinedContext(): string;
    /**
     * Get total size of all layers
     */
    getTotalSize(): number;
    /**
     * Initialize a new NEURO.md in the project
     */
    initProject(): string;
    /**
     * Watch NEURO.md files for changes
     */
    startWatching(): void;
    /**
     * Stop watching NEURO.md files
     */
    stopWatching(): void;
    private tryLoadLayer;
    private loadRulesDirectory;
    /**
     * Process @import references in NEURO.md
     * e.g. @path/to/file.md → injects file contents
     */
    private processImports;
    private detectTechStack;
    private generateStarterMd;
}
//# sourceMappingURL=neuro-md.d.ts.map