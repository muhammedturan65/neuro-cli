export interface UpdateCheckResult {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    source: 'npm' | 'github' | 'cache';
    changelog?: string;
    checkedAt: number;
}
export interface UpdaterConfig {
    /** Package name on npm registry */
    packageName: string;
    /** Current installed version */
    currentVersion: string;
    /** GitHub owner/repo for releases fallback */
    githubRepo: string;
    /** How often to check for updates (ms), default: 24 hours */
    checkInterval: number;
    /** Directory to store update state */
    stateDir: string;
    /** Whether to auto-check on startup */
    autoCheck: boolean;
    /** Whether to auto-update without asking */
    autoUpdate: boolean;
    /** npm registry URL */
    registryUrl: string;
    /** Whether to show changelog on update */
    showChangelog: boolean;
    /** Whether to notify about prereleases */
    includePrerelease: boolean;
    /** Custom update command (default: npm update -g) */
    updateCommand?: string;
}
export interface UpdateState {
    lastCheckTime: number;
    lastKnownVersion: string;
    lastCheckSource: 'npm' | 'github' | 'cache';
    dismissedVersions: string[];
    skippedCheckReason?: string;
}
export declare class AutoUpdater {
    private config;
    private state;
    private stateFile;
    private lastCheckResult;
    constructor(config: Partial<UpdaterConfig> & {
        currentVersion: string;
    });
    private loadState;
    private saveState;
    /**
     * Check if enough time has passed since last check
     */
    shouldCheck(): boolean;
    /**
     * Get time until next check is due
     */
    timeUntilNextCheck(): number;
    /**
     * Check for updates from npm registry
     */
    checkForUpdate(force?: boolean): Promise<UpdateCheckResult>;
    /**
     * Check npm registry API directly
     */
    private checkNpmRegistry;
    /**
     * Check GitHub releases API
     */
    private checkGitHubReleases;
    /**
     * Check using `npm view` command (fallback)
     */
    private checkNpmView;
    /**
     * Extract changelog from npm package data
     */
    private extractChangelog;
    /**
     * Perform the self-update
     * Returns true if update was successful
     */
    performUpdate(version?: string): Promise<{
        success: boolean;
        message: string;
        newVersion?: string;
    }>;
    /**
     * Verify that the update was successful
     */
    private verifyUpdate;
    /**
     * Dismiss a specific version (don't notify again)
     */
    dismissVersion(version: string): void;
    /**
     * Check if a version has been dismissed
     */
    isDismissed(version: string): boolean;
    /**
     * Display update notification banner
     */
    showUpdateNotification(result: UpdateCheckResult): void;
    /**
     * Display detailed update info with changelog
     */
    showUpdateDetails(result: UpdateCheckResult): void;
    /**
     * Show "up to date" message
     */
    showUpToDate(): void;
    /**
     * Format time duration in human-readable format
     */
    private formatDuration;
    /**
     * Run background update check on startup.
     * Returns the check result if an update is available, null otherwise.
     */
    checkOnStartup(): Promise<UpdateCheckResult | null>;
    /**
     * Interactive update flow — check, show, and optionally update
     */
    interactiveUpdate(): Promise<void>;
    /**
     * Set auto-check on/off
     */
    setAutoCheck(enabled: boolean): void;
    /**
     * Set auto-update on/off
     */
    setAutoUpdate(enabled: boolean): void;
    /**
     * Set check interval in hours
     */
    setCheckInterval(hours: number): void;
    /**
     * Get current updater config
     */
    getConfig(): Readonly<UpdaterConfig>;
    /**
     * Get last check result
     */
    getLastCheck(): UpdateCheckResult | null;
    /**
     * Reset dismissed versions
     */
    resetDismissed(): void;
    /**
     * Force next check on startup
     */
    forceNextCheck(): void;
}
export declare function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult>;
export declare function performSelfUpdate(currentVersion: string, version?: string): Promise<{
    success: boolean;
    message: string;
    newVersion?: string;
}>;
//# sourceMappingURL=updater.d.ts.map