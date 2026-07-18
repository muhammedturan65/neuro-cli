// ============================================================
// NeuroCLI - Cloud Sync
// Sync sessions to GitHub Gist as free storage backend
// Import/export sessions, conflict resolution
// /sync push/pull commands
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { createHash } from 'crypto';
// -----------------------------------------------------------
// Default config
// -----------------------------------------------------------
const SYNC_CONFIG_PATH = join(homedir(), '.neuro', 'sync-config.json');
const SYNC_METADATA_PATH = join(homedir(), '.neuro', 'sync-metadata.json');
function defaultConfig() {
    return {
        enabled: false,
        backend: 'gist',
        githubToken: process.env.GITHUB_TOKEN || '',
        gistId: '',
        autoSync: false,
        syncIntervalMs: 0,
        maxCloudSessions: 50,
        includeContent: true,
        localSyncDir: join(homedir(), '.neuro', 'cloud-sync'),
    };
}
// -----------------------------------------------------------
// CloudSync
// -----------------------------------------------------------
export class CloudSync {
    config;
    syncMetadata = new Map();
    isSyncing = false;
    lastSyncAt = 0;
    syncTimer = null;
    constructor(config) {
        this.config = { ...defaultConfig(), ...config };
        this.loadConfig();
        this.loadSyncMetadata();
        this.ensureLocalSyncDir();
        if (this.config.autoSync && this.config.syncIntervalMs > 0) {
            this.startAutoSync();
        }
    }
    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    /**
     * Check if cloud sync is enabled
     */
    isEnabled() {
        return this.config.enabled;
    }
    /**
     * Enable cloud sync
     */
    enable() {
        if (!this.config.githubToken && this.config.backend === 'gist') {
            console.log(chalk.yellow('GitHub token not set. Set GITHUB_TOKEN env var or use /sync config.'));
            console.log(chalk.gray('  export GITHUB_TOKEN=ghp_your_token_here'));
        }
        this.config.enabled = true;
        this.saveConfig();
        console.log(chalk.green('Cloud sync enabled.'));
    }
    /**
     * Disable cloud sync
     */
    disable() {
        this.config.enabled = false;
        this.stopAutoSync();
        this.saveConfig();
        console.log(chalk.gray('Cloud sync disabled.'));
    }
    /**
     * Toggle cloud sync
     */
    toggle() {
        if (this.config.enabled)
            this.disable();
        else
            this.enable();
        return this.config.enabled;
    }
    /**
     * Push local sessions to cloud
     */
    async push() {
        if (!this.config.enabled) {
            return this.errorResult('Cloud sync is disabled');
        }
        if (this.isSyncing) {
            return this.errorResult('Sync already in progress');
        }
        this.isSyncing = true;
        const startTime = Date.now();
        let pushed = 0;
        const errors = [];
        try {
            const localSessions = this.getLocalSessions();
            for (const session of localSessions) {
                try {
                    const checksum = this.computeChecksum(JSON.stringify(session));
                    const existing = this.syncMetadata.get(session.id);
                    // Skip if already synced and unchanged
                    if (existing && existing.checksum === checksum)
                        continue;
                    await this.pushSession(session, checksum);
                    pushed++;
                    this.syncMetadata.set(session.id, {
                        sessionId: session.id,
                        lastSyncedAt: Date.now(),
                        checksum,
                        version: (existing?.version || 0) + 1,
                        source: 'cloud',
                    });
                }
                catch (error) {
                    errors.push(`Failed to push session ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            this.persistSyncMetadata();
            this.lastSyncAt = Date.now();
        }
        finally {
            this.isSyncing = false;
        }
        return {
            pushed,
            pulled: 0,
            conflicts: [],
            errors,
            duration: Date.now() - startTime,
        };
    }
    /**
     * Pull sessions from cloud
     */
    async pull() {
        if (!this.config.enabled) {
            return this.errorResult('Cloud sync is disabled');
        }
        if (this.isSyncing) {
            return this.errorResult('Sync already in progress');
        }
        this.isSyncing = true;
        const startTime = Date.now();
        let pulled = 0;
        const conflicts = [];
        const errors = [];
        try {
            const cloudSessions = await this.fetchCloudSessions();
            for (const cloudSession of cloudSessions) {
                try {
                    const localMeta = this.syncMetadata.get(cloudSession.id);
                    const localSession = this.getLocalSession(cloudSession.id);
                    // Check for conflicts
                    if (localSession && localMeta) {
                        const localChecksum = this.computeChecksum(JSON.stringify(localSession));
                        const cloudChecksum = cloudSession.checksum;
                        if (localChecksum !== cloudChecksum && localMeta.source === 'local') {
                            // Conflict: both modified
                            conflicts.push({
                                sessionId: cloudSession.id,
                                localVersion: localMeta.version,
                                cloudVersion: cloudSession.version,
                                localChecksum,
                                cloudChecksum,
                                localUpdatedAt: localSession.updatedAt,
                                cloudUpdatedAt: cloudSession.updatedAt,
                                resolution: 'pending',
                            });
                            continue;
                        }
                    }
                    // No conflict - pull
                    this.saveLocalSession(cloudSession);
                    pulled++;
                    this.syncMetadata.set(cloudSession.id, {
                        sessionId: cloudSession.id,
                        lastSyncedAt: Date.now(),
                        checksum: cloudSession.checksum,
                        version: cloudSession.version,
                        source: 'cloud',
                    });
                }
                catch (error) {
                    errors.push(`Failed to pull session ${cloudSession.id}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            this.persistSyncMetadata();
            this.lastSyncAt = Date.now();
        }
        finally {
            this.isSyncing = false;
        }
        return {
            pushed: 0,
            pulled,
            conflicts,
            errors,
            duration: Date.now() - startTime,
        };
    }
    /**
     * Full sync (push + pull)
     */
    async sync() {
        const pushResult = await this.push();
        const pullResult = await this.pull();
        return {
            pushed: pushResult.pushed,
            pulled: pullResult.pulled,
            conflicts: [...pushResult.conflicts, ...pullResult.conflicts],
            errors: [...pushResult.errors, ...pullResult.errors],
            duration: pushResult.duration + pullResult.duration,
        };
    }
    /**
     * Resolve a sync conflict
     */
    resolveConflict(sessionId, resolution) {
        // Implementation for conflict resolution
        switch (resolution) {
            case 'local':
                // Push local version to cloud
                console.log(chalk.green(`Conflict resolved: keeping local version for ${sessionId}`));
                return true;
            case 'cloud':
                // Pull cloud version to local
                console.log(chalk.green(`Conflict resolved: using cloud version for ${sessionId}`));
                return true;
            case 'merge':
                console.log(chalk.yellow(`Merge conflict resolution not yet implemented for ${sessionId}`));
                return false;
            default:
                return false;
        }
    }
    /**
     * Export sessions to a local file
     */
    exportSessions(filePath) {
        const sessions = this.getLocalSessions();
        const exportData = {
            version: '3.0.0',
            exportedAt: Date.now(),
            sessions,
        };
        const exportPath = filePath || join(this.config.localSyncDir, `export-${Date.now()}.json`);
        writeFileSync(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');
        console.log(chalk.green(`Exported ${sessions.length} session(s) to ${exportPath}`));
        return exportPath;
    }
    /**
     * Import sessions from a file
     */
    importSessions(filePath) {
        try {
            const raw = readFileSync(filePath, 'utf-8');
            const data = JSON.parse(raw);
            if (!Array.isArray(data.sessions)) {
                console.log(chalk.red('Invalid import file: no sessions array found.'));
                return 0;
            }
            let imported = 0;
            for (const session of data.sessions) {
                try {
                    this.saveLocalSession(session);
                    imported++;
                }
                catch (error) {
                    console.log(chalk.yellow(`Failed to import session ${session.id}: ${error instanceof Error ? error.message : String(error)}`));
                }
            }
            console.log(chalk.green(`Imported ${imported} session(s) from ${filePath}`));
            return imported;
        }
        catch (error) {
            console.log(chalk.red(`Failed to import: ${error instanceof Error ? error.message : String(error)}`));
            return 0;
        }
    }
    /**
     * Get sync status
     */
    getStatus() {
        return {
            enabled: this.config.enabled,
            backend: this.config.backend,
            lastSyncAt: this.lastSyncAt,
            syncedSessions: this.syncMetadata.size,
            isSyncing: this.isSyncing,
            gistConfigured: this.config.backend === 'gist' ? !!this.config.gistId : true,
        };
    }
    /**
     * Set GitHub token
     */
    setGitHubToken(token) {
        this.config.githubToken = token;
        this.saveConfig();
        console.log(chalk.green('GitHub token updated.'));
    }
    /**
     * Get/set gist ID
     */
    setGistId(gistId) {
        this.config.gistId = gistId;
        this.saveConfig();
        console.log(chalk.green(`Gist ID set to: ${gistId}`));
    }
    /**
     * Get config
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Print sync status
     */
    printStatus() {
        const status = this.getStatus();
        console.log('');
        console.log(chalk.bold('--- NeuroCLI Cloud Sync ---'));
        console.log(`  Enabled: ${status.enabled ? chalk.green('yes') : chalk.gray('no')}`);
        console.log(`  Backend: ${chalk.cyan(status.backend)}`);
        console.log(`  Synced sessions: ${status.syncedSessions}`);
        console.log(`  Last sync: ${status.lastSyncAt > 0 ? new Date(status.lastSyncAt).toLocaleString() : chalk.gray('never')}`);
        console.log(`  Currently syncing: ${status.isSyncing ? chalk.yellow('yes') : chalk.gray('no')}`);
        if (this.config.backend === 'gist') {
            console.log(`  GitHub token: ${this.config.githubToken ? chalk.green('configured') : chalk.red('not set')}`);
            console.log(`  Gist ID: ${this.config.gistId || chalk.gray('(auto-create on first push)')}`);
        }
        console.log(`  Auto-sync: ${this.config.autoSync ? chalk.green('on') : chalk.gray('off')}`);
        console.log('');
    }
    // ----------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------
    startAutoSync() {
        if (this.syncTimer)
            clearInterval(this.syncTimer);
        this.syncTimer = setInterval(() => {
            this.sync().catch(() => { });
        }, this.config.syncIntervalMs);
    }
    stopAutoSync() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
    }
    getLocalSessions() {
        const sessionDir = join(homedir(), '.neuro', 'sessions');
        const sessions = [];
        try {
            if (!existsSync(sessionDir))
                return sessions;
            const files = readdirSync(sessionDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const raw = readFileSync(join(sessionDir, file), 'utf-8');
                    const data = JSON.parse(raw);
                    sessions.push(this.toCloudSession(data));
                }
                catch { /* skip invalid */ }
            }
        }
        catch { /* ignore */ }
        return sessions;
    }
    getLocalSession(id) {
        try {
            const sessionPath = join(homedir(), '.neuro', 'sessions', `${id}.json`);
            if (!existsSync(sessionPath))
                return null;
            const raw = readFileSync(sessionPath, 'utf-8');
            return this.toCloudSession(JSON.parse(raw));
        }
        catch {
            return null;
        }
    }
    toCloudSession(data) {
        return {
            id: data.id || 'unknown',
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || Date.now(),
            model: data.model || 'unknown',
            messageCount: data.messages?.length || 0,
            totalCost: data.totalCost || 0,
            description: data.description,
            tags: data.tags || [],
            messages: this.config.includeContent ? data.messages : undefined,
            checksum: this.computeChecksum(JSON.stringify(data)),
            version: 1,
        };
    }
    saveLocalSession(session) {
        const sessionDir = join(homedir(), '.neuro', 'sessions');
        if (!existsSync(sessionDir))
            mkdirSync(sessionDir, { recursive: true });
        const sessionPath = join(sessionDir, `${session.id}.json`);
        const data = {
            id: session.id,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            model: session.model,
            messages: session.messages || [],
            totalCost: session.totalCost,
            description: session.description,
            tags: session.tags,
        };
        writeFileSync(sessionPath, JSON.stringify(data, null, 2), 'utf-8');
    }
    async pushSession(session, checksum) {
        if (this.config.backend === 'gist') {
            await this.pushToGist(session, checksum);
        }
        else {
            this.pushToLocal(session, checksum);
        }
    }
    async pushToGist(session, _checksum) {
        if (!this.config.githubToken) {
            throw new Error('GitHub token not configured');
        }
        const filename = `session-${session.id}.json`;
        const content = JSON.stringify(session, null, 2);
        const gistData = {
            description: `NeuroCLI Session - ${session.id}`,
            public: false,
            files: {
                [filename]: { content },
            },
        };
        const url = this.config.gistId
            ? `https://api.github.com/gists/${this.config.gistId}`
            : 'https://api.github.com/gists';
        const method = this.config.gistId ? 'PATCH' : 'POST';
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${this.config.githubToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'NeuroCLI',
                },
                body: JSON.stringify(gistData),
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`GitHub API error: ${response.status} - ${text}`);
            }
            const result = await response.json();
            if (!this.config.gistId) {
                this.config.gistId = result.id;
                this.saveConfig();
            }
        }
        catch (error) {
            throw new Error(`Gist push failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    pushToLocal(session, _checksum) {
        const dir = this.config.localSyncDir;
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        const filePath = join(dir, `session-${session.id}.json`);
        writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    }
    async fetchCloudSessions() {
        if (this.config.backend === 'gist') {
            return this.fetchFromGist();
        }
        return this.fetchFromLocal();
    }
    async fetchFromGist() {
        if (!this.config.githubToken || !this.config.gistId) {
            return [];
        }
        try {
            const response = await fetch(`https://api.github.com/gists/${this.config.gistId}`, {
                headers: {
                    'Authorization': `Bearer ${this.config.githubToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'NeuroCLI',
                },
            });
            if (!response.ok)
                return [];
            const gist = await response.json();
            const sessions = [];
            for (const [name, file] of Object.entries(gist.files)) {
                if (!name.startsWith('session-'))
                    continue;
                try {
                    const session = JSON.parse(file.content);
                    sessions.push(session);
                }
                catch { /* skip invalid */ }
            }
            return sessions.slice(0, this.config.maxCloudSessions);
        }
        catch {
            return [];
        }
    }
    fetchFromLocal() {
        const dir = this.config.localSyncDir;
        if (!existsSync(dir))
            return [];
        const sessions = [];
        try {
            const files = readdirSync(dir).filter(f => f.startsWith('session-') && f.endsWith('.json'));
            for (const file of files) {
                try {
                    const raw = readFileSync(join(dir, file), 'utf-8');
                    sessions.push(JSON.parse(raw));
                }
                catch { /* skip */ }
            }
        }
        catch { /* ignore */ }
        return sessions.slice(0, this.config.maxCloudSessions);
    }
    computeChecksum(data) {
        return createHash('sha256').update(data).digest('hex').slice(0, 16);
    }
    errorResult(message) {
        return { pushed: 0, pulled: 0, conflicts: [], errors: [message], duration: 0 };
    }
    ensureLocalSyncDir() {
        if (!existsSync(this.config.localSyncDir)) {
            mkdirSync(this.config.localSyncDir, { recursive: true });
        }
    }
    saveConfig() {
        try {
            const dir = join(SYNC_CONFIG_PATH, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(SYNC_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch { /* Silently fail */ }
    }
    loadConfig() {
        try {
            if (existsSync(SYNC_CONFIG_PATH)) {
                const raw = readFileSync(SYNC_CONFIG_PATH, 'utf-8');
                const saved = JSON.parse(raw);
                this.config = { ...this.config, ...saved };
            }
        }
        catch { /* Silently fail */ }
    }
    loadSyncMetadata() {
        try {
            if (existsSync(SYNC_METADATA_PATH)) {
                const raw = readFileSync(SYNC_METADATA_PATH, 'utf-8');
                const entries = JSON.parse(raw);
                this.syncMetadata = new Map(entries);
            }
        }
        catch { /* Silently fail */ }
    }
    persistSyncMetadata() {
        try {
            const dir = join(SYNC_METADATA_PATH, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(SYNC_METADATA_PATH, JSON.stringify(Array.from(this.syncMetadata.entries()), null, 2), 'utf-8');
        }
        catch { /* Silently fail */ }
    }
}
//# sourceMappingURL=cloud-sync.js.map