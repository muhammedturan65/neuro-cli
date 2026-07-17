// ============================================================
// NeuroCLI - Git Auto-Commit & Checkpointing
// (Like Aider's auto-commit + Gemini CLI's shadow repo)
// ============================================================

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';

export interface Checkpoint {
  id: string;
  timestamp: number;
  message: string;
  files: string[];
  hash?: string;
}

export class GitCheckpointSystem {
  private workingDirectory: string;
  private shadowRepo: string;
  private autoCommit: boolean;
  private checkpoints: Checkpoint[] = [];

  constructor(workingDirectory: string, autoCommit: boolean = true) {
    this.workingDirectory = workingDirectory;
    this.autoCommit = autoCommit;
    // Shadow repo for checkpointing (doesn't interfere with user's git)
    const projectHash = this.hashString(workingDirectory);
    this.shadowRepo = join(homedir(), '.neuro', 'checkpoints', projectHash);
  }

  /**
   * Initialize the checkpoint system
   */
  initialize(): boolean {
    if (!this.isGitRepo()) return false;
    this.ensureShadowRepo();
    return true;
  }

  /**
   * Create a checkpoint before risky operations
   */
  createCheckpoint(message: string): Checkpoint | null {
    const changedFiles = this.getChangedFiles();
    if (changedFiles.length === 0) {
      return null;
    }

    const checkpoint: Checkpoint = {
      id: `cp_${Date.now()}`,
      timestamp: Date.now(),
      message,
      files: changedFiles,
    };

    // Option 1: Git stash-based checkpoint (quick)
    if (this.autoCommit) {
      try {
        // Stage all changes
        execSync('git add -A', { cwd: this.workingDirectory, encoding: 'utf-8' });
        // Commit with checkpoint marker
        const commitMsg = `neuro:checkpoint ${message}`;
        execSync(`git commit -m "${commitMsg}" --no-gpg-sign`, {
          cwd: this.workingDirectory,
          encoding: 'utf-8',
        });
        const hash = execSync('git rev-parse HEAD', {
          cwd: this.workingDirectory,
          encoding: 'utf-8',
        }).trim();
        checkpoint.hash = hash;
      } catch {
        // Nothing to commit or commit failed
      }
    }

    // Option 2: Shadow repo snapshot
    this.saveShadowSnapshot(checkpoint);

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  /**
   * Restore to a checkpoint
   */
  restore(checkpointId: string): boolean {
    const checkpoint = this.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) return false;

    // Try git restore first
    if (checkpoint.hash) {
      try {
        execSync(`git reset --hard ${checkpoint.hash}`, {
          cwd: this.workingDirectory,
          encoding: 'utf-8',
        });
        return true;
      } catch {}
    }

    // Fallback: restore from shadow repo
    return this.restoreShadowSnapshot(checkpoint);
  }

  /**
   * Undo the last checkpoint
   */
  undo(): boolean {
    if (this.checkpoints.length === 0) return false;
    const lastCheckpoint = this.checkpoints[this.checkpoints.length - 1];
    return this.restore(lastCheckpoint.id);
  }

  /**
   * List all checkpoints
   */
  listCheckpoints(): Checkpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Get changed files since last commit
   */
  getChangedFiles(): string[] {
    try {
      const status = execSync('git status --porcelain', {
        cwd: this.workingDirectory,
        encoding: 'utf-8',
      });
      return status.trim().split('\n')
        .filter(l => l.trim())
        .map(l => l.slice(3).trim());
    } catch {
      return [];
    }
  }

  /**
   * Get diff of changes
   */
  getDiff(): string {
    try {
      return execSync('git diff', {
        cwd: this.workingDirectory,
        encoding: 'utf-8',
      });
    } catch {
      return '';
    }
  }

  /**
   * Auto-commit changes with a message
   */
  autoCommitChanges(message: string): string | null {
    if (!this.autoCommit) return null;
    if (!this.isGitRepo()) return null;

    const changed = this.getChangedFiles();
    if (changed.length === 0) return null;

    try {
      execSync('git add -A', { cwd: this.workingDirectory, encoding: 'utf-8' });
      execSync(`git commit -m "neuro: ${message}" --no-gpg-sign`, {
        cwd: this.workingDirectory,
        encoding: 'utf-8',
      });
      const hash = execSync('git rev-parse --short HEAD', {
        cwd: this.workingDirectory,
        encoding: 'utf-8',
      }).trim();
      return hash;
    } catch {
      return null;
    }
  }

  // ---- Private ----

  private isGitRepo(): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: this.workingDirectory,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  private ensureShadowRepo(): void {
    if (!existsSync(this.shadowRepo)) {
      mkdirSync(this.shadowRepo, { recursive: true });
    }
    // Initialize shadow repo if needed
    const gitDir = join(this.shadowRepo, '.git');
    if (!existsSync(gitDir)) {
      try {
        execSync('git init', { cwd: this.shadowRepo, encoding: 'utf-8' });
      } catch {}
    }
  }

  private saveShadowSnapshot(checkpoint: Checkpoint): void {
    const snapshotDir = join(this.shadowRepo, checkpoint.id);
    if (!existsSync(snapshotDir)) {
      mkdirSync(snapshotDir, { recursive: true });
    }

    // Save checkpoint metadata
    writeFileSync(
      join(snapshotDir, 'meta.json'),
      JSON.stringify(checkpoint, null, 2),
      'utf-8'
    );

    // Copy changed files to snapshot
    for (const file of checkpoint.files) {
      const src = join(this.workingDirectory, file);
      const dst = join(snapshotDir, 'files', file);
      if (existsSync(src)) {
        try {
          mkdirSync(join(dst, '..'), { recursive: true });
          const { copyFileSync } = require('fs');
          copyFileSync(src, dst);
        } catch {}
      }
    }
  }

  private restoreShadowSnapshot(checkpoint: Checkpoint): boolean {
    const snapshotDir = join(this.shadowRepo, checkpoint.id, 'files');
    if (!existsSync(snapshotDir)) return false;

    for (const file of checkpoint.files) {
      const src = join(snapshotDir, file);
      const dst = join(this.workingDirectory, file);
      if (existsSync(src)) {
        try {
          const { copyFileSync } = require('fs');
          mkdirSync(join(dst, '..'), { recursive: true });
          copyFileSync(src, dst);
        } catch {}
      }
    }

    return true;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}
