export interface RepoMap {
    root: string;
    files: FileMap[];
    totalSymbols: number;
    totalFiles: number;
    languageBreakdown: Record<string, number>;
    generatedAt: number;
}
export interface FileMap {
    path: string;
    language: string;
    symbols: SymbolInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
    summary: string;
}
export interface SymbolInfo {
    name: string;
    kind: 'class' | 'function' | 'method' | 'variable' | 'interface' | 'type' | 'enum' | 'constant' | 'namespace' | 'import';
    line: number;
    endLine: number;
    signature?: string;
    modifiers?: string[];
    children?: SymbolInfo[];
}
export interface ImportInfo {
    source: string;
    items: string[];
    line: number;
    isTypeOnly: boolean;
}
export interface ExportInfo {
    name: string;
    kind: string;
    line: number;
    isDefault: boolean;
    isReexport: boolean;
}
export interface CallGraphNode {
    name: string;
    kind: string;
    line: number;
    calls: string[];
    calledBy: string[];
}
export interface DiagnosticInfo {
    line: number;
    column: number;
    severity: 'error' | 'warning';
    message: string;
    rule?: string;
}
export interface OutlineNode {
    name: string;
    kind: SymbolInfo['kind'];
    line: number;
    endLine: number;
    icon: string;
    children: OutlineNode[];
    signature?: string;
}
export declare class TreeSitterIntegration {
    private projectRoot;
    private fileCache;
    private repoMapCache;
    private repoMapCacheTime;
    private readonly CACHE_TTL;
    constructor(projectRoot: string);
    analyzeFile(filePath: string): FileMap | null;
    analyzeDirectory(dirPath: string, maxDepth?: number): FileMap[];
    buildRepoMap(projectRoot?: string): RepoMap;
    getSymbols(filePath: string): SymbolInfo[];
    getCallGraph(filePath: string): CallGraphNode[];
    getDependencies(filePath: string): ImportInfo[];
    findDefinition(symbol: string, projectRoot?: string): Array<{
        file: string;
        line: number;
        kind: string;
    }>;
    findReferences(symbol: string, projectRoot?: string): Array<{
        file: string;
        line: number;
        context: string;
    }>;
    getOutline(filePath: string): OutlineNode[];
    detectLanguage(filePath: string): string;
    getDiagnostics(filePath: string): DiagnosticInfo[];
    formatRepoMap(projectRoot?: string, maxTokens?: number): string;
    invalidateCache(filePath?: string): void;
    private resolvePath;
    private readFile;
    private parseContent;
    private walkDirectory;
    private generateFileSummary;
    private extractCalls;
    private symbolToOutline;
    private getSymbolIcon;
}
//# sourceMappingURL=tree-sitter.d.ts.map