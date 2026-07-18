import { EventEmitter } from 'events';
export interface WorktreeInfo {
    name: string;
    path: string;
    branch: string;
    isCurrent: boolean;
    isBare: boolean;
    /** The commit hash the worktree is on */
    head: string;
}
export interface ConflictInfo {
    filePath: string;
    type: 'content' | 'delete_modify' | 'rename' | 'add_add';
    worktreeA: string;
    worktreeB: string;
    /** Lines with conflicts (approximate) */
    conflictingLines: number;
    /** Whether this conflict can be auto-resolved */
    autoResolvable: boolean;
}
export interface MergeResult {
    success: boolean;
    targetBranch: string;
    sourceWorktree: string;
    mergedFiles: string[];
    conflictFiles: string[];
    message: string;
    /** If there were conflicts, the raw conflict output */
    conflictOutput?: string;
}
export interface WorktreeStatus {
    name: string;
    branch: string;
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
    staged: number;
    isClean: boolean;
    /** List of modified file paths */
    modifiedFiles: string[];
}
export declare class GitWorktreeManager extends EventEmitter {
    private repoRoot;
    private agentBindings;
    constructor(repoRoot?: string);
    /**
     * Create a new git worktree for parallel development.
     * If no branch is specified, creates a new branch named after the worktree.
     */
    createWorktree(name: string, branch?: string): Promise<WorktreeInfo>;
    /**
     * Remove a git worktree. If merge is true, attempt to merge the branch first.
     */
    removeWorktree(name: string, options?: {
        force?: boolean;
        merge?: boolean;
    }): Promise<void>;
    /**
     * List all git worktrees in the repository.
     */
    listWorktrees(): Promise<WorktreeInfo[]>;
    /**
     * Bind an agent to a specific worktree. The agent will operate
     * within that worktree's directory.
     */
    bindAgentToWorktree(agentId: string, worktreeName: string): void;
    /**
     * Unbind an agent from its worktree.
     */
    unbindAgent(agentId: string): void;
    /**
     * Get the worktree name bound to an agent, or null if unbound.
     */
    getWorktreeForAgent(agentId: string): string | null;
    /**
     * Get all agent bindings.
     */
    getAgentBindings(): Array<{
        agentId: string;
        worktreeName: string;
    }>;
    /**
     * Detect potential conflicts between two worktrees by comparing
     * their modified files and checking for overlaps.
     */
    detectConflicts(worktreeA: string, worktreeB: string): Promise<ConflictInfo[]>;
    /**
     * Attempt to automatically merge a worktree's branch into the target branch.
     * Defaults to merging into the main branch.
     */
    autoMerge(worktreeName: string, targetBranch?: string): Promise<MergeResult>;
    /**
     * Get the status of a worktree (modified, added, deleted files, etc.).
     */
    getWorktreeStatus(name: string): Promise<WorktreeStatus>;
    /**
     * Remove all worktrees (except the main one) and optionally delete branches.
     */
    cleanup(): Promise<void>;
    /**
     * Execute a git command and return its output.
     */
    private execGit;
    /**
     * Parse the porcelain output of `git worktree list`.
     */
    private parseWorktreeList;
    /**
     * Derive a human-readable name from the worktree path or branch.
     */
    private worktreeNameFromPath;
    /**
     * Check whether a branch exists in the repository.
     */
    private branchExists;
    /**
     * Get the list of modified files in a worktree.
     */
    private getModifiedFiles;
    /**
     * Determine the type of conflict between two file modifications.
     */
    private determineConflictType;
    /**
     * Analyze the diff between the same file in two worktrees to estimate
     * conflict severity.
     */
    private analyzeFileDiff;
    /**
     * Extract changed line ranges from a unified diff output.
     */
    private extractChangedLineRanges;
    /**
     * Get the list of files changed in the last merge.
     */
    private getChangedFilesInMerge;
}
//# sourceMappingURL=git-worktree.d.ts.map