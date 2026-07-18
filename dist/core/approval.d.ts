import { Interface as ReadLineInterface } from 'readline';
export type PermissionMode = 'manual' | 'auto' | 'plan' | 'yolo';
export interface ApprovalResult {
    approved: boolean;
    remember: boolean;
    always?: boolean;
    edited?: boolean;
}
export interface ApprovalConfig {
    mode: PermissionMode;
    /** Tools that are auto-approved without asking */
    whitelist: string[];
    /** Tools that are always denied */
    blacklist: string[];
    /** Whether to show diff preview before file modifications */
    showDiffPreview: boolean;
    /** Whether to batch-approve similar operations */
    batchApprove: boolean;
    /** Maximum number of consecutive approvals before re-asking (0 = unlimited) */
    maxConsecutiveAutoApproves: number;
    /** Whether to persist "always" decisions across sessions */
    persistDecisions: boolean;
}
export interface ToolApprovalStats {
    toolName: string;
    approved: number;
    denied: number;
    avgResponseTimeMs: number;
}
export declare class ApprovalSystem {
    private mode;
    private sessionApprovals;
    private deniedTools;
    private persistentApprovals;
    private whitelist;
    private blacklist;
    private showDiffPreview;
    private batchApprove;
    private maxConsecutiveAutoApproves;
    private persistDecisions;
    private consecutiveAutoApproves;
    private rl;
    private mainRl;
    private stats;
    private pendingBatch;
    private batchTimer;
    private autoApprovePatterns;
    constructor(mode?: PermissionMode, config?: Partial<ApprovalConfig>);
    setMode(mode: PermissionMode): void;
    getMode(): PermissionMode;
    cycleMode(): PermissionMode;
    getModeDescription(): string;
    getModeIcon(): string;
    addToWhitelist(toolName: string): void;
    removeFromWhitelist(toolName: string): void;
    addToBlacklist(toolName: string): void;
    removeFromBlacklist(toolName: string): void;
    getWhitelist(): string[];
    getBlacklist(): string[];
    requestApproval(toolName: string, args: Record<string, unknown>, risk: 'low' | 'medium' | 'high', description?: string): Promise<ApprovalResult>;
    private isFileModification;
    private promptWithDiffPreview;
    private promptUser;
    requestBatchApproval(toolName: string, args: Record<string, unknown>, risk: 'low' | 'medium' | 'high', description?: string): Promise<ApprovalResult>;
    private processBatch;
    private isBlacklisted;
    private isWhitelisted;
    private getPattern;
    private getAlwaysKey;
    /**
     * Set the main readline interface from index.ts
     * This prevents creating a second readline on the same stdin
     */
    setMainReadline(rl: ReadLineInterface): void;
    private readline;
    close(): void;
    addAutoApprove(toolName: string): void;
    reset(): void;
    private recordStats;
    getStats(): ToolApprovalStats[];
    private loadPersistentDecisions;
    private savePersistentDecisions;
    /**
     * Print approval statistics
     */
    printStats(): void;
}
//# sourceMappingURL=approval.d.ts.map