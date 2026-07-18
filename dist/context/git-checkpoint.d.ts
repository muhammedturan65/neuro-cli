export interface Checkpoint {
    id: string;
    timestamp: number;
    message: string;
    files: string[];
    hash?: string;
}
export declare class GitCheckpointSystem {
    private workingDirectory;
    private shadowRepo;
    private autoCommit;
    private checkpoints;
    constructor(workingDirectory: string, autoCommit?: boolean);
    /**
     * Initialize the checkpoint system
     */
    initialize(): boolean;
    /**
     * Create a checkpoint before risky operations
     */
    createCheckpoint(message: string): Checkpoint | null;
    /**
     * Restore to a checkpoint
     */
    restore(checkpointId: string): boolean;
    /**
     * Undo the last checkpoint
     */
    undo(): boolean;
    /**
     * List all checkpoints
     */
    listCheckpoints(): Checkpoint[];
    /**
     * Get changed files since last commit
     */
    getChangedFiles(): string[];
    /**
     * Get diff of changes
     */
    getDiff(): string;
    /**
     * Auto-commit changes with a message
     */
    autoCommitChanges(message: string): string | null;
    private isGitRepo;
    private ensureShadowRepo;
    private saveShadowSnapshot;
    private restoreShadowSnapshot;
    private hashString;
}
//# sourceMappingURL=git-checkpoint.d.ts.map