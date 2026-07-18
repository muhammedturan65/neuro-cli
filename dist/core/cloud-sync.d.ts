export interface CloudSyncConfig {
    /** Whether cloud sync is enabled */
    enabled: boolean;
    /** Storage backend: 'gist' for GitHub Gist */
    backend: 'gist' | 'local';
    /** GitHub token for Gist API */
    githubToken: string;
    /** Gist ID for storing sessions */
    gistId: string;
    /** Whether to auto-sync on session end */
    autoSync: boolean;
    /** Sync interval in ms (0 = manual only) */
    syncIntervalMs: number;
    /** Max sessions to keep in cloud */
    maxCloudSessions: number;
    /** Whether to include session content (vs just metadata) */
    includeContent: boolean;
    /** Local sync directory */
    localSyncDir: string;
}
export interface SyncMetadata {
    sessionId: string;
    lastSyncedAt: number;
    checksum: string;
    version: number;
    source: 'local' | 'cloud';
}
export interface SyncConflict {
    sessionId: string;
    localVersion: number;
    cloudVersion: number;
    localChecksum: string;
    cloudChecksum: string;
    localUpdatedAt: number;
    cloudUpdatedAt: number;
    resolution: 'local' | 'cloud' | 'merge' | 'pending';
}
export interface SyncResult {
    pushed: number;
    pulled: number;
    conflicts: SyncConflict[];
    errors: string[];
    duration: number;
}
export interface CloudSession {
    id: string;
    createdAt: number;
    updatedAt: number;
    model: string;
    messageCount: number;
    totalCost: number;
    description?: string;
    tags: string[];
    messages?: Array<{
        role: string;
        content: string;
        timestamp: number;
    }>;
    checksum: string;
    version: number;
}
export declare class CloudSync {
    private config;
    private syncMetadata;
    private isSyncing;
    private lastSyncAt;
    private syncTimer;
    constructor(config?: Partial<CloudSyncConfig>);
    /**
     * Check if cloud sync is enabled
     */
    isEnabled(): boolean;
    /**
     * Enable cloud sync
     */
    enable(): void;
    /**
     * Disable cloud sync
     */
    disable(): void;
    /**
     * Toggle cloud sync
     */
    toggle(): boolean;
    /**
     * Push local sessions to cloud
     */
    push(): Promise<SyncResult>;
    /**
     * Pull sessions from cloud
     */
    pull(): Promise<SyncResult>;
    /**
     * Full sync (push + pull)
     */
    sync(): Promise<SyncResult>;
    /**
     * Resolve a sync conflict
     */
    resolveConflict(sessionId: string, resolution: 'local' | 'cloud' | 'merge'): boolean;
    /**
     * Export sessions to a local file
     */
    exportSessions(filePath?: string): string;
    /**
     * Import sessions from a file
     */
    importSessions(filePath: string): number;
    /**
     * Get sync status
     */
    getStatus(): {
        enabled: boolean;
        backend: string;
        lastSyncAt: number;
        syncedSessions: number;
        isSyncing: boolean;
        gistConfigured: boolean;
    };
    /**
     * Set GitHub token
     */
    setGitHubToken(token: string): void;
    /**
     * Get/set gist ID
     */
    setGistId(gistId: string): void;
    /**
     * Get config
     */
    getConfig(): CloudSyncConfig;
    /**
     * Print sync status
     */
    printStatus(): void;
    private startAutoSync;
    private stopAutoSync;
    private getLocalSessions;
    private getLocalSession;
    private toCloudSession;
    private saveLocalSession;
    private pushSession;
    private pushToGist;
    private pushToLocal;
    private fetchCloudSessions;
    private fetchFromGist;
    private fetchFromLocal;
    private computeChecksum;
    private errorResult;
    private ensureLocalSyncDir;
    private saveConfig;
    private loadConfig;
    private loadSyncMetadata;
    private persistSyncMetadata;
}
//# sourceMappingURL=cloud-sync.d.ts.map