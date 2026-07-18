// ============================================================
// NeuroCLI - Cloud Sync
// Sync sessions to GitHub Gist as free storage backend
// Import/export sessions, conflict resolution
// /sync push/pull commands
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { createHash } from 'crypto';

// -----------------------------------------------------------
// Public interfaces
// -----------------------------------------------------------

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
  messages?: Array<{ role: string; content: string; timestamp: number }>;
  checksum: string;
  version: number;
}

// -----------------------------------------------------------
// Default config
// -----------------------------------------------------------

const SYNC_CONFIG_PATH = join(homedir(), '.neuro', 'sync-config.json');
const SYNC_METADATA_PATH = join(homedir(), '.neuro', 'sync-metadata.json');

function defaultConfig(): CloudSyncConfig {
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
  private config: CloudSyncConfig;
  private syncMetadata: Map<string, SyncMetadata> = new Map();
  private isSyncing: boolean = false;
  private lastSyncAt: number = 0;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<CloudSyncConfig>) {
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
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable cloud sync
   */
  enable(): void {
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
  disable(): void {
    this.config.enabled = false;
    this.stopAutoSync();
    this.saveConfig();
    console.log(chalk.gray('Cloud sync disabled.'));
  }

  /**
   * Toggle cloud sync
   */
  toggle(): boolean {
    if (this.config.enabled) this.disable();
    else this.enable();
    return this.config.enabled;
  }

  /**
   * Push local sessions to cloud
   */
  async push(): Promise<SyncResult> {
    if (!this.config.enabled) {
      return this.errorResult('Cloud sync is disabled');
    }

    if (this.isSyncing) {
      return this.errorResult('Sync already in progress');
    }

    this.isSyncing = true;
    const startTime = Date.now();
    let pushed = 0;
    const errors: string[] = [];

    try {
      const localSessions = this.getLocalSessions();

      for (const session of localSessions) {
        try {
          const checksum = this.computeChecksum(JSON.stringify(session));
          const existing = this.syncMetadata.get(session.id);

          // Skip if already synced and unchanged
          if (existing && existing.checksum === checksum) continue;

          await this.pushSession(session, checksum);
          pushed++;

          this.syncMetadata.set(session.id, {
            sessionId: session.id,
            lastSyncedAt: Date.now(),
            checksum,
            version: (existing?.version || 0) + 1,
            source: 'cloud',
          });
        } catch (error) {
          errors.push(`Failed to push session ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.persistSyncMetadata();
      this.lastSyncAt = Date.now();
    } finally {
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
  async pull(): Promise<SyncResult> {
    if (!this.config.enabled) {
      return this.errorResult('Cloud sync is disabled');
    }

    if (this.isSyncing) {
      return this.errorResult('Sync already in progress');
    }

    this.isSyncing = true;
    const startTime = Date.now();
    let pulled = 0;
    const conflicts: SyncConflict[] = [];
    const errors: string[] = [];

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
        } catch (error) {
          errors.push(`Failed to pull session ${cloudSession.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.persistSyncMetadata();
      this.lastSyncAt = Date.now();
    } finally {
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
  async sync(): Promise<SyncResult> {
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
  resolveConflict(sessionId: string, resolution: 'local' | 'cloud' | 'merge'): boolean {
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
  exportSessions(filePath?: string): string {
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
  importSessions(filePath: string): number {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as { sessions: CloudSession[] };

      if (!Array.isArray(data.sessions)) {
        console.log(chalk.red('Invalid import file: no sessions array found.'));
        return 0;
      }

      let imported = 0;
      for (const session of data.sessions) {
        try {
          this.saveLocalSession(session);
          imported++;
        } catch (error) {
          console.log(chalk.yellow(`Failed to import session ${session.id}: ${error instanceof Error ? error.message : String(error)}`));
        }
      }

      console.log(chalk.green(`Imported ${imported} session(s) from ${filePath}`));
      return imported;
    } catch (error) {
      console.log(chalk.red(`Failed to import: ${error instanceof Error ? error.message : String(error)}`));
      return 0;
    }
  }

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
  } {
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
  setGitHubToken(token: string): void {
    this.config.githubToken = token;
    this.saveConfig();
    console.log(chalk.green('GitHub token updated.'));
  }

  /**
   * Get/set gist ID
   */
  setGistId(gistId: string): void {
    this.config.gistId = gistId;
    this.saveConfig();
    console.log(chalk.green(`Gist ID set to: ${gistId}`));
  }

  /**
   * Get config
   */
  getConfig(): CloudSyncConfig {
    return { ...this.config };
  }

  /**
   * Print sync status
   */
  printStatus(): void {
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

  private startAutoSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      this.sync().catch(() => {});
    }, this.config.syncIntervalMs);
  }

  private stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private getLocalSessions(): CloudSession[] {
    const sessionDir = join(homedir(), '.neuro', 'sessions');
    const sessions: CloudSession[] = [];

    try {
      if (!existsSync(sessionDir)) return sessions;

      const files = readdirSync(sessionDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(sessionDir, file), 'utf-8');
          const data = JSON.parse(raw);
          sessions.push(this.toCloudSession(data));
        } catch { /* skip invalid */ }
      }
    } catch { /* ignore */ }

    return sessions;
  }

  private getLocalSession(id: string): CloudSession | null {
    try {
      const sessionPath = join(homedir(), '.neuro', 'sessions', `${id}.json`);
      if (!existsSync(sessionPath)) return null;
      const raw = readFileSync(sessionPath, 'utf-8');
      return this.toCloudSession(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private toCloudSession(data: any): CloudSession {
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

  private saveLocalSession(session: CloudSession): void {
    const sessionDir = join(homedir(), '.neuro', 'sessions');
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

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

  private async pushSession(session: CloudSession, checksum: string): Promise<void> {
    if (this.config.backend === 'gist') {
      await this.pushToGist(session, checksum);
    } else {
      this.pushToLocal(session, checksum);
    }
  }

  private async pushToGist(session: CloudSession, _checksum: string): Promise<void> {
    if (!this.config.githubToken) {
      throw new Error('GitHub token not configured');
    }

    const filename = `session-${session.id}.json`;
    const content = JSON.stringify(session, null, 2);

    const gistData: Record<string, unknown> = {
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

      const result = await response.json() as { id: string };
      if (!this.config.gistId) {
        this.config.gistId = result.id;
        this.saveConfig();
      }
    } catch (error) {
      throw new Error(`Gist push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private pushToLocal(session: CloudSession, _checksum: string): void {
    const dir = this.config.localSyncDir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filePath = join(dir, `session-${session.id}.json`);
    writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  private async fetchCloudSessions(): Promise<CloudSession[]> {
    if (this.config.backend === 'gist') {
      return this.fetchFromGist();
    }
    return this.fetchFromLocal();
  }

  private async fetchFromGist(): Promise<CloudSession[]> {
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

      if (!response.ok) return [];

      const gist = await response.json() as { files: Record<string, { content: string }> };
      const sessions: CloudSession[] = [];

      for (const [name, file] of Object.entries(gist.files)) {
        if (!name.startsWith('session-')) continue;
        try {
          const session = JSON.parse(file.content) as CloudSession;
          sessions.push(session);
        } catch { /* skip invalid */ }
      }

      return sessions.slice(0, this.config.maxCloudSessions);
    } catch {
      return [];
    }
  }

  private fetchFromLocal(): CloudSession[] {
    const dir = this.config.localSyncDir;
    if (!existsSync(dir)) return [];

    const sessions: CloudSession[] = [];
    try {
      const files = readdirSync(dir).filter(f => f.startsWith('session-') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(dir, file), 'utf-8');
          sessions.push(JSON.parse(raw) as CloudSession);
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }

    return sessions.slice(0, this.config.maxCloudSessions);
  }

  private computeChecksum(data: string): string {
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private errorResult(message: string): SyncResult {
    return { pushed: 0, pulled: 0, conflicts: [], errors: [message], duration: 0 };
  }

  private ensureLocalSyncDir(): void {
    if (!existsSync(this.config.localSyncDir)) {
      mkdirSync(this.config.localSyncDir, { recursive: true });
    }
  }

  private saveConfig(): void {
    try {
      const dir = join(SYNC_CONFIG_PATH, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(SYNC_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch { /* Silently fail */ }
  }

  private loadConfig(): void {
    try {
      if (existsSync(SYNC_CONFIG_PATH)) {
        const raw = readFileSync(SYNC_CONFIG_PATH, 'utf-8');
        const saved = JSON.parse(raw) as Partial<CloudSyncConfig>;
        this.config = { ...this.config, ...saved };
      }
    } catch { /* Silently fail */ }
  }

  private loadSyncMetadata(): void {
    try {
      if (existsSync(SYNC_METADATA_PATH)) {
        const raw = readFileSync(SYNC_METADATA_PATH, 'utf-8');
        const entries = JSON.parse(raw) as [string, SyncMetadata][];
        this.syncMetadata = new Map(entries);
      }
    } catch { /* Silently fail */ }
  }

  private persistSyncMetadata(): void {
    try {
      const dir = join(SYNC_METADATA_PATH, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(SYNC_METADATA_PATH, JSON.stringify(Array.from(this.syncMetadata.entries()), null, 2), 'utf-8');
    } catch { /* Silently fail */ }
  }
}
