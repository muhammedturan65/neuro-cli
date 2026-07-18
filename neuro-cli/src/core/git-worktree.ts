// ============================================================
// NeuroCLI - Git Worktree Integration (GAP-40)
// Parallel development using git worktrees with agent binding,
// conflict detection, and auto-merge. Uses only Node.js built-ins.
// ============================================================

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, resolve, basename } from 'path';

// ---- Exported Interfaces ----

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

// ---- Internal Types ----

interface AgentBinding {
  agentId: string;
  worktreeName: string;
  boundAt: number;
}

// ---- Constants ----

const DEFAULT_BRANCH = 'main';

// ============================================================
// GitWorktreeManager Class
// ============================================================

export class GitWorktreeManager extends EventEmitter {
  private repoRoot: string;
  private agentBindings: Map<string, AgentBinding> = new Map();

  constructor(repoRoot?: string) {
    super();
    this.repoRoot = repoRoot ?? process.cwd();
  }

  // ============================================================
  // Worktree Management
  // ============================================================

  /**
   * Create a new git worktree for parallel development.
   * If no branch is specified, creates a new branch named after the worktree.
   */
  async createWorktree(name: string, branch?: string): Promise<WorktreeInfo> {
    // Validate: no worktree with this name already exists
    const existing = await this.listWorktrees();
    const alreadyExists = existing.some((wt) => wt.name === name || wt.path.endsWith(name));
    if (alreadyExists) {
      throw new Error(`Worktree "${name}" already exists`);
    }

    const worktreeBranch = branch ?? name;
    const worktreePath = join(this.repoRoot, '..', basename(this.repoRoot) + '-' + name);

    // Determine whether the branch already exists
    const branchExists = await this.branchExists(worktreeBranch);

    const args = branchExists
      ? ['worktree', 'add', worktreePath, worktreeBranch]
      : ['worktree', 'add', '-b', worktreeBranch, worktreePath];

    const result = await this.execGit(args, this.repoRoot);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree "${name}": ${result.stderr}`);
    }

    // Get the HEAD of the new worktree
    const headResult = await this.execGit(['rev-parse', '--short', 'HEAD'], worktreePath);
    const head = headResult.exitCode === 0 ? headResult.stdout.trim() : 'unknown';

    const info: WorktreeInfo = {
      name,
      path: worktreePath,
      branch: worktreeBranch,
      isCurrent: false,
      isBare: false,
      head,
    };

    this.emit('worktree:created', name, info);
    return info;
  }

  /**
   * Remove a git worktree. If merge is true, attempt to merge the branch first.
   */
  async removeWorktree(name: string, options?: { force?: boolean; merge?: boolean }): Promise<void> {
    const existing = await this.listWorktrees();
    const worktree = existing.find((wt) => wt.name === name || wt.path.endsWith(name));

    if (!worktree) {
      throw new Error(`Worktree "${name}" not found`);
    }

    // If merge requested, attempt auto-merge first
    if (options?.merge) {
      try {
        await this.autoMerge(name);
      } catch (err) {
        if (!options.force) {
          throw new Error(
            `Merge failed for worktree "${name}": ${err instanceof Error ? err.message : String(err)}. ` +
            `Use force: true to remove anyway.`
          );
        }
      }
    }

    // Unbind any agents from this worktree
    const entries = Array.from(this.agentBindings.entries());
    for (const [agentId, binding] of entries) {
      if (binding.worktreeName === name) {
        this.agentBindings.delete(agentId);
      }
    }

    // Remove the worktree
    const forceFlag = options?.force ? '--force' : '';
    const args = ['worktree', 'remove', worktree.path];
    if (options?.force) {
      args.splice(2, 0, '--force');
    }

    const result = await this.execGit(args, this.repoRoot);

    if (result.exitCode !== 0) {
      // Try pruning as fallback
      await this.execGit(['worktree', 'prune'], this.repoRoot);

      // If the directory still exists, try to remove it manually
      if (existsSync(worktree.path)) {
        try {
          rmSync(worktree.path, { recursive: true, force: true });
        } catch {
          if (!options?.force) {
            throw new Error(`Failed to remove worktree directory: ${worktree.path}`);
          }
        }
      }
    }

    // Optionally delete the branch if it's not the default branch
    if (worktree.branch !== DEFAULT_BRANCH && worktree.branch !== 'master') {
      try {
        await this.execGit(['branch', '-d', worktree.branch], this.repoRoot);
      } catch {
        // Branch deletion is best-effort
      }
    }

    this.emit('worktree:removed', name);
  }

  /**
   * List all git worktrees in the repository.
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const result = await this.execGit(
      ['worktree', 'list', '--porcelain'],
      this.repoRoot
    );

    if (result.exitCode !== 0) {
      return [];
    }

    return this.parseWorktreeList(result.stdout);
  }

  // ============================================================
  // Agent-Worktree Binding
  // ============================================================

  /**
   * Bind an agent to a specific worktree. The agent will operate
   * within that worktree's directory.
   */
  bindAgentToWorktree(agentId: string, worktreeName: string): void {
    // Check if agent is already bound
    const existingBinding = this.agentBindings.get(agentId);
    if (existingBinding) {
      throw new Error(
        `Agent "${agentId}" is already bound to worktree "${existingBinding.worktreeName}". ` +
        `Unbind first before reassigning.`
      );
    }

    this.agentBindings.set(agentId, {
      agentId,
      worktreeName,
      boundAt: Date.now(),
    });

    this.emit('agent:bound', agentId, worktreeName);
  }

  /**
   * Unbind an agent from its worktree.
   */
  unbindAgent(agentId: string): void {
    const binding = this.agentBindings.get(agentId);
    if (!binding) {
      return; // Already unbound — no-op
    }

    this.agentBindings.delete(agentId);
    this.emit('agent:unbound', agentId, binding.worktreeName);
  }

  /**
   * Get the worktree name bound to an agent, or null if unbound.
   */
  getWorktreeForAgent(agentId: string): string | null {
    const binding = this.agentBindings.get(agentId);
    return binding?.worktreeName ?? null;
  }

  /**
   * Get all agent bindings.
   */
  getAgentBindings(): Array<{ agentId: string; worktreeName: string }> {
    const result: Array<{ agentId: string; worktreeName: string }> = [];
    const bindings = Array.from(this.agentBindings.values());
    for (const binding of bindings) {
      result.push({ agentId: binding.agentId, worktreeName: binding.worktreeName });
    }
    return result;
  }

  // ============================================================
  // Conflict Detection
  // ============================================================

  /**
   * Detect potential conflicts between two worktrees by comparing
   * their modified files and checking for overlaps.
   */
  async detectConflicts(worktreeA: string, worktreeB: string): Promise<ConflictInfo[]> {
    const worktrees = await this.listWorktrees();
    const wtA = worktrees.find((wt) => wt.name === worktreeA || wt.path.endsWith(worktreeA));
    const wtB = worktrees.find((wt) => wt.name === worktreeB || wt.path.endsWith(worktreeB));

    if (!wtA) {
      throw new Error(`Worktree "${worktreeA}" not found`);
    }
    if (!wtB) {
      throw new Error(`WorktreeB "${worktreeB}" not found`);
    }

    // Get modified files in each worktree
    const filesA = await this.getModifiedFiles(wtA.path);
    const filesB = await this.getModifiedFiles(wtB.path);

    const conflicts: ConflictInfo[] = [];

    // Find overlapping file paths
    const filesASet = new Set(filesA.map((f) => f.path));
    const filesBMap = new Map(filesB.map((f) => [f.path, f]));

    for (const fileA of filesA) {
      const fileB = filesBMap.get(fileA.path);
      if (!fileB) continue;

      // Both worktrees modified the same file — potential conflict
      const conflictType = this.determineConflictType(fileA, fileB);

      // Get the actual diff content to assess conflict severity
      const diffAnalysis = await this.analyzeFileDiff(wtA.path, wtB.path, fileA.path);

      const conflict: ConflictInfo = {
        filePath: fileA.path,
        type: conflictType,
        worktreeA: worktreeA,
        worktreeB: worktreeB,
        conflictingLines: diffAnalysis.conflictingLines,
        autoResolvable: diffAnalysis.autoResolvable,
      };

      conflicts.push(conflict);
    }

    // Check for delete/modify conflicts
    const deletedInA = new Set(
      filesA.filter((f) => f.status === 'deleted').map((f) => f.path)
    );
    const modifiedInB = new Set(
      filesB.filter((f) => f.status === 'modified' || f.status === 'added').map((f) => f.path)
    );

    for (const path of deletedInA) {
      if (modifiedInB.has(path) && !conflicts.some((c) => c.filePath === path)) {
        conflicts.push({
          filePath: path,
          type: 'delete_modify',
          worktreeA: worktreeA,
          worktreeB: worktreeB,
          conflictingLines: 0,
          autoResolvable: false,
        });
      }
    }

    const deletedInB = new Set(
      filesB.filter((f) => f.status === 'deleted').map((f) => f.path)
    );
    const modifiedInA = new Set(
      filesA.filter((f) => f.status === 'modified' || f.status === 'added').map((f) => f.path)
    );

    for (const path of deletedInB) {
      if (modifiedInA.has(path) && !conflicts.some((c) => c.filePath === path)) {
        conflicts.push({
          filePath: path,
          type: 'delete_modify',
          worktreeA: worktreeA,
          worktreeB: worktreeB,
          conflictingLines: 0,
          autoResolvable: false,
        });
      }
    }

    return conflicts;
  }

  // ============================================================
  // Auto-Merge
  // ============================================================

  /**
   * Attempt to automatically merge a worktree's branch into the target branch.
   * Defaults to merging into the main branch.
   */
  async autoMerge(worktreeName: string, targetBranch?: string): Promise<MergeResult> {
    const worktrees = await this.listWorktrees();
    const worktree = worktrees.find((wt) => wt.name === worktreeName || wt.path.endsWith(worktreeName));

    if (!worktree) {
      throw new Error(`Worktree "${worktreeName}" not found`);
    }

    const target = targetBranch ?? DEFAULT_BRANCH;

    // First, ensure the worktree's changes are committed
    const status = await this.getWorktreeStatus(worktreeName);
    if (!status.isClean) {
      // Stage and commit all changes in the worktree
      await this.execGit(['add', '-A'], worktree.path);
      await this.execGit(
        ['commit', '-m', `auto-commit: worktree "${worktreeName}" before merge`],
        worktree.path
      );
    }

    // Switch to the target branch in the main repo and merge
    // Use --no-edit to accept default merge message
    const mergeResult = await this.execGit(
      ['merge', worktree.branch, '--no-edit'],
      this.repoRoot
    );

    if (mergeResult.exitCode === 0) {
      // Merge succeeded
      const mergedFiles = await this.getChangedFilesInMerge();
      this.emit('worktree:merged', worktreeName, target, true);

      return {
        success: true,
        targetBranch: target,
        sourceWorktree: worktreeName,
        mergedFiles,
        conflictFiles: [],
        message: `Successfully merged "${worktree.branch}" into "${target}"`,
      };
    }

    // Merge had conflicts — check what files are conflicted
    const conflictCheck = await this.execGit(['diff', '--name-only', '--diff-filter=U'], this.repoRoot);
    const conflictFiles = conflictCheck.exitCode === 0
      ? conflictCheck.stdout.trim().split('\n').filter(Boolean)
      : [];

    // Abort the merge to leave the repo in a clean state
    await this.execGit(['merge', '--abort'], this.repoRoot);

    this.emit('worktree:merge-conflict', worktreeName, target, conflictFiles);

    return {
      success: false,
      targetBranch: target,
      sourceWorktree: worktreeName,
      mergedFiles: [],
      conflictFiles,
      message: `Merge conflict in ${conflictFiles.length} file(s): ${conflictFiles.join(', ')}`,
      conflictOutput: mergeResult.stderr || mergeResult.stdout,
    };
  }

  // ============================================================
  // Worktree Status
  // ============================================================

  /**
   * Get the status of a worktree (modified, added, deleted files, etc.).
   */
  async getWorktreeStatus(name: string): Promise<WorktreeStatus> {
    const worktrees = await this.listWorktrees();
    const worktree = worktrees.find((wt) => wt.name === name || wt.path.endsWith(name));

    if (!worktree) {
      throw new Error(`Worktree "${name}" not found`);
    }

    const statusResult = await this.execGit(
      ['status', '--porcelain=v1'],
      worktree.path
    );

    let modified = 0;
    let added = 0;
    let deleted = 0;
    let untracked = 0;
    let staged = 0;
    const modifiedFiles: string[] = [];

    if (statusResult.exitCode === 0) {
      const lines = statusResult.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const x = line[0];
        const y = line[1];
        const filePath = line.substring(3);

        // Index status (x)
        if (x === 'M' || x === 'A' || x === 'D' || x === 'R') {
          staged++;
        }

        // Working tree status (y) or combined
        if (y === 'M' || (x === 'M' && y === 'M')) {
          modified++;
          modifiedFiles.push(filePath);
        } else if (y === 'A' || x === 'A') {
          added++;
          modifiedFiles.push(filePath);
        } else if (y === 'D' || x === 'D') {
          deleted++;
          modifiedFiles.push(filePath);
        } else if (x === '?' && y === '?') {
          untracked++;
        } else if (x === 'M') {
          modified++;
          modifiedFiles.push(filePath);
        }
      }
    }

    return {
      name,
      branch: worktree.branch,
      modified,
      added,
      deleted,
      untracked,
      staged,
      isClean: modified === 0 && added === 0 && deleted === 0 && untracked === 0,
      modifiedFiles,
    };
  }

  // ============================================================
  // Cleanup
  // ============================================================

  /**
   * Remove all worktrees (except the main one) and optionally delete branches.
   */
  async cleanup(): Promise<void> {
    const worktrees = await this.listWorktrees();

    for (const worktree of worktrees) {
      // Skip the main worktree (the repo root itself)
      if (worktree.isCurrent) continue;

      try {
        await this.removeWorktree(worktree.name, { force: true });
      } catch {
        // Best-effort removal
      }
    }

    // Clear all agent bindings
    this.agentBindings.clear();

    // Prune any stale worktree references
    await this.execGit(['worktree', 'prune'], this.repoRoot);

    this.emit('worktree:cleanup');
  }

  // ============================================================
  // Private Helpers — Git Execution
  // ============================================================

  /**
   * Execute a git command and return its output.
   */
  private execGit(
    args: string[],
    cwd: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('close', (code) => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          exitCode: code ?? 0,
        });
      });

      child.on('error', (err) => {
        resolve({
          stdout: '',
          stderr: err.message,
          exitCode: 1,
        });
      });
    });
  }

  // ============================================================
  // Private Helpers — Parsing & Analysis
  // ============================================================

  /**
   * Parse the porcelain output of `git worktree list`.
   */
  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const blocks = output.trim().split('\n\n');

    for (const block of blocks) {
      if (!block.trim()) continue;

      let path = '';
      let head = '';
      let branch = '';
      let isBare = false;

      const lines = block.split('\n');
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.substring('worktree '.length);
        } else if (line.startsWith('HEAD ')) {
          head = line.substring('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          branch = line.substring('branch '.length);
          // Remove refs/heads/ prefix
          if (branch.startsWith('refs/heads/')) {
            branch = branch.substring('refs/heads/'.length);
          }
        } else if (line === 'bare') {
          isBare = true;
        }
      }

      const isCurrent = resolve(path) === resolve(this.repoRoot);
      const name = this.worktreeNameFromPath(path, branch);

      worktrees.push({
        name,
        path,
        branch,
        isCurrent,
        isBare,
        head: head.substring(0, 7), // short hash
      });
    }

    return worktrees;
  }

  /**
   * Derive a human-readable name from the worktree path or branch.
   */
  private worktreeNameFromPath(path: string, branch: string): string {
    // If the branch name is available and not HEAD, use it
    if (branch && branch !== 'detached HEAD') {
      return branch;
    }
    // Otherwise, use the directory name
    return basename(path);
  }

  /**
   * Check whether a branch exists in the repository.
   */
  private async branchExists(branch: string): Promise<boolean> {
    const result = await this.execGit(
      ['rev-parse', '--verify', branch],
      this.repoRoot
    );
    return result.exitCode === 0;
  }

  /**
   * Get the list of modified files in a worktree.
   */
  private async getModifiedFiles(
    worktreePath: string
  ): Promise<Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' }>> {
    const result = await this.execGit(
      ['status', '--porcelain=v1'],
      worktreePath
    );

    if (result.exitCode !== 0) return [];

    const files: Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' }> = [];

    const lines = result.stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const x = line[0];
      const y = line[1];
      // Extract file path (after the two status chars and a space)
      let filePath = line.substring(3);

      // Handle rename (path includes "old -> new")
      if (line.includes(' -> ')) {
        const parts = filePath.split(' -> ');
        filePath = parts[parts.length - 1];
      }

      let status: 'modified' | 'added' | 'deleted' | 'renamed';
      if (x === 'R' || y === 'R') {
        status = 'renamed';
      } else if (x === 'A' || y === 'A' || x === '?') {
        status = 'added';
      } else if (x === 'D' || y === 'D') {
        status = 'deleted';
      } else {
        status = 'modified';
      }

      files.push({ path: filePath, status });
    }

    return files;
  }

  /**
   * Determine the type of conflict between two file modifications.
   */
  private determineConflictType(
    fileA: { path: string; status: string },
    fileB: { path: string; status: string }
  ): ConflictInfo['type'] {
    if (fileA.status === 'added' && fileB.status === 'added') {
      return 'add_add';
    }
    if (
      (fileA.status === 'deleted' && fileB.status !== 'deleted') ||
      (fileB.status === 'deleted' && fileA.status !== 'deleted')
    ) {
      return 'delete_modify';
    }
    if (fileA.status === 'renamed' || fileB.status === 'renamed') {
      return 'rename';
    }
    return 'content';
  }

  /**
   * Analyze the diff between the same file in two worktrees to estimate
   * conflict severity.
   */
  private async analyzeFileDiff(
    worktreeAPath: string,
    worktreeBPath: string,
    filePath: string
  ): Promise<{ conflictingLines: number; autoResolvable: boolean }> {
    // Get the diff of each worktree's version against the merge base
    const diffA = await this.execGit(
      ['diff', 'HEAD', '--', filePath],
      worktreeAPath
    );
    const diffB = await this.execGit(
      ['diff', 'HEAD', '--', filePath],
      worktreeBPath
    );

    if (diffA.exitCode !== 0 || diffB.exitCode !== 0) {
      return { conflictingLines: 0, autoResolvable: false };
    }

    // Extract changed line ranges from each diff
    const rangesA = this.extractChangedLineRanges(diffA.stdout);
    const rangesB = this.extractChangedLineRanges(diffB.stdout);

    // Count overlapping lines
    let overlappingLines = 0;
    for (const rangeA of rangesA) {
      for (const rangeB of rangesB) {
        const overlapStart = Math.max(rangeA.start, rangeB.start);
        const overlapEnd = Math.min(rangeA.end, rangeB.end);
        if (overlapStart <= overlapEnd) {
          overlappingLines += overlapEnd - overlapStart + 1;
        }
      }
    }

    // If no overlapping changed lines, the merge should be auto-resolvable
    const autoResolvable = overlappingLines === 0;

    return {
      conflictingLines: overlappingLines,
      autoResolvable,
    };
  }

  /**
   * Extract changed line ranges from a unified diff output.
   */
  private extractChangedLineRanges(diffOutput: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];

    if (!diffOutput.trim()) return ranges;

    const lines = diffOutput.split('\n');
    for (const line of lines) {
      // Match hunk headers like @@ -10,5 +10,7 @@
      const match = line.match(/^@@@? -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@@?/);
      if (match) {
        const start = parseInt(match[1], 10);
        const count = match[2] ? parseInt(match[2], 10) : 1;
        ranges.push({ start, end: start + count - 1 });
      }
    }

    return ranges;
  }

  /**
   * Get the list of files changed in the last merge.
   */
  private async getChangedFilesInMerge(): Promise<string[]> {
    const result = await this.execGit(
      ['diff', '--name-only', 'HEAD~1', 'HEAD'],
      this.repoRoot
    );

    if (result.exitCode !== 0) return [];

    return result.stdout.trim().split('\n').filter(Boolean);
  }
}
