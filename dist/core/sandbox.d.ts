export interface SandboxConfig {
    /** Whether sandbox mode is enabled */
    enabled: boolean;
    /** Root directory - only files under this dir can be modified */
    rootDir: string;
    /** Allowed directories (in addition to rootDir) */
    allowedDirs: string[];
    /** Denied directories (even under rootDir) */
    deniedDirs: string[];
    /** Denied file patterns (glob) */
    deniedPatterns: string[];
    /** Whether to allow command execution */
    allowCommands: boolean;
    /** Allowed commands (whitelist) */
    allowedCommands: string[];
    /** Denied commands (blacklist) */
    deniedCommands: string[];
    /** Whether to create backups before modifications */
    backupOnModify: boolean;
    /** Backup directory */
    backupDir: string;
    /** Maximum file size that can be written (bytes) */
    maxFileSize: number;
    /** Whether to allow network access */
    allowNetwork: boolean;
    /** Whether to allow environment variable access */
    allowEnvAccess: boolean;
    /** Read-only mode (no modifications at all) */
    readOnly: boolean;
}
export interface SandboxViolation {
    type: 'file_write' | 'file_delete' | 'file_read' | 'command' | 'network' | 'env';
    path?: string;
    command?: string;
    reason: string;
    timestamp: number;
}
export declare const DEFAULT_SANDBOX_CONFIG: SandboxConfig;
export declare class Sandbox {
    private config;
    private violations;
    private backups;
    private originalContents;
    constructor(config?: Partial<SandboxConfig>);
    /**
     * Check if a file path is allowed for reading
     */
    canRead(filePath: string): boolean;
    /**
     * Check if a file path is allowed for writing
     */
    canWrite(filePath: string, contentSize?: number): boolean;
    /**
     * Check if a file can be deleted
     */
    canDelete(filePath: string): boolean;
    /**
     * Check if a command is allowed
     */
    canRunCommand(command: string): boolean;
    /**
     * Check if network access is allowed
     */
    canAccessNetwork(): boolean;
    /**
     * Check if environment variable access is allowed
     */
    canAccessEnv(): boolean;
    /**
     * Create a backup of a file before modification
     */
    backupFile(filePath: string): boolean;
    /**
     * Undo a file modification by restoring from backup
     */
    undoFile(filePath: string): boolean;
    /**
     * Undo all modifications made in this session
     */
    undoAll(): number;
    /**
     * Get all violations recorded
     */
    getViolations(): SandboxViolation[];
    /**
     * Get the number of violations
     */
    getViolationCount(): number;
    /**
     * Clear all violations
     */
    clearViolations(): void;
    /**
     * Enable sandbox mode
     */
    enable(): void;
    /**
     * Disable sandbox mode
     */
    disable(): void;
    /**
     * Check if sandbox is enabled
     */
    isEnabled(): boolean;
    /**
     * Toggle sandbox mode
     */
    toggle(): boolean;
    /**
     * Get current sandbox configuration
     */
    getConfig(): SandboxConfig;
    /**
     * Update sandbox configuration
     */
    updateConfig(updates: Partial<SandboxConfig>): void;
    /**
     * Print sandbox status
     */
    printStatus(): void;
    private resolvePath;
    private isUnderRootDir;
    private isInDeniedDir;
    private matchesDeniedPattern;
    private recordViolation;
}
//# sourceMappingURL=sandbox.d.ts.map