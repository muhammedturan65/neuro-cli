export interface LSPDiagnostic {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info' | 'hint';
    message: string;
    source?: string;
    code?: string;
}
export interface LSPDefinition {
    file: string;
    line: number;
    column: number;
    name: string;
    kind: string;
}
export interface LSPReference {
    file: string;
    line: number;
    column: number;
}
export declare class LSPManager {
    private servers;
    private workingDirectory;
    private diagnostics;
    private initialized;
    constructor(workingDirectory: string);
    /**
     * Initialize LSP servers based on project tech stack
     */
    initialize(): Promise<void>;
    /**
     * Get diagnostics for a file
     */
    getDiagnostics(filePath: string): LSPDiagnostic[];
    /**
     * Get all diagnostics across all files
     */
    getAllDiagnostics(): LSPDiagnostic[];
    /**
     * Get diagnostics as context string for LLM
     */
    getDiagnosticsContext(): string;
    /**
     * Request diagnostics for a file after edit
     */
    requestDiagnostics(filePath: string): Promise<LSPDiagnostic[]>;
    /**
     * Go to definition
     */
    gotoDefinition(filePath: string, line: number, column: number): Promise<LSPDefinition | null>;
    /**
     * Find references
     */
    findReferences(filePath: string, line: number, column: number): Promise<LSPReference[]>;
    /**
     * Shutdown all LSP servers
     */
    shutdown(): void;
    private detectLanguageServers;
    private findServerForFile;
}
//# sourceMappingURL=lsp-manager.d.ts.map