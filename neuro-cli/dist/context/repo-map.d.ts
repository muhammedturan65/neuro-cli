export interface RepoMapEntry {
    file: string;
    language: string;
    definitions: string[];
    references: string[];
    lineCount: number;
}
export interface RepoMap {
    entries: RepoMapEntry[];
    totalFiles: number;
    totalLines: number;
    languages: Record<string, number>;
    summary: string;
}
export declare class RepositoryMapper {
    private workingDirectory;
    private cached;
    constructor(workingDirectory: string);
    /**
     * Build a repository map
     */
    build(maxFiles?: number): RepoMap;
    /**
     * Get the repo map as a compact string for LLM context
     */
    getContextString(maxEntries?: number): string;
    /**
     * Invalidate cache
     */
    invalidate(): void;
    private getSourceFiles;
    private mapFile;
    private extractDefinitions;
    private extractReferences;
    private getLanguage;
    private buildSummary;
}
//# sourceMappingURL=repo-map.d.ts.map