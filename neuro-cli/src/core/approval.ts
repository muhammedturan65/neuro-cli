// ============================================================
// NeuroCLI - Enhanced Approval System
// Real interactive approval with diff preview, batch approve,
// whitelist/blacklist, and multiple permission modes
// ============================================================

import { createInterface, Interface as ReadLineInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { DiffPreview, FileDiff } from './diff-preview.js';

export type PermissionMode = 'manual' | 'auto' | 'plan' | 'yolo';

export interface ApprovalResult {
  approved: boolean;
  remember: boolean;       // remember this decision for the session
  always?: boolean;        // remember for all future sessions (persisted)
  edited?: boolean;        // user edited the args before approving
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

const APPROVALS_PATH = join(homedir(), '.neuro', 'approvals.json');

export class ApprovalSystem {
  private mode: PermissionMode = 'manual';
  private sessionApprovals: Map<string, boolean> = new Map();
  private deniedTools: Set<string> = new Set();
  private persistentApprovals: Map<string, boolean> = new Map();
  private whitelist: Set<string> = new Set();
  private blacklist: Set<string> = new Set();
  private showDiffPreview: boolean = true;
  private batchApprove: boolean = true;
  private maxConsecutiveAutoApproves: number = 0;
  private persistDecisions: boolean = true;
  private consecutiveAutoApproves: number = 0;
  private rl: ReadLineInterface | null = null;

  private stats: Map<string, { approved: number; denied: number; totalResponseMs: number }> = new Map();
  private pendingBatch: Array<{
    toolName: string;
    args: Record<string, unknown>;
    risk: 'low' | 'medium' | 'high';
    description?: string;
    resolve: (result: ApprovalResult) => void;
  }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  private autoApprovePatterns: string[] = [
    'read_file', 'search_files', 'list_directory', 'web_search', 'web_fetch',
    'recall_memory', 'project_context', 'todowrite',
  ];

  constructor(mode?: PermissionMode, config?: Partial<ApprovalConfig>) {
    if (mode) this.mode = mode;
    if (config) {
      if (config.whitelist) this.whitelist = new Set(config.whitelist);
      if (config.blacklist) this.blacklist = new Set(config.blacklist);
      if (config.showDiffPreview !== undefined) this.showDiffPreview = config.showDiffPreview;
      if (config.batchApprove !== undefined) this.batchApprove = config.batchApprove;
      if (config.maxConsecutiveAutoApproves !== undefined) this.maxConsecutiveAutoApproves = config.maxConsecutiveAutoApproves;
      if (config.persistDecisions !== undefined) this.persistDecisions = config.persistDecisions;
    }
    this.loadPersistentDecisions();
  }

  setMode(mode: PermissionMode): void { this.mode = mode; }
  getMode(): PermissionMode { return this.mode; }

  cycleMode(): PermissionMode {
    const modes: PermissionMode[] = ['manual', 'auto', 'plan', 'yolo'];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length];
    return this.mode;
  }

  getModeDescription(): string {
    const descriptions: Record<PermissionMode, string> = {
      manual: 'Ask for every action',
      auto: 'Auto-approve safe operations, ask for dangerous ones',
      plan: 'Read-only mode - no modifications allowed',
      yolo: 'Auto-approve everything (dangerous)',
    };
    return descriptions[this.mode];
  }

  getModeIcon(): string {
    const icons: Record<PermissionMode, string> = { manual: '🛡️', auto: '⚡', plan: '📖', yolo: '🔥' };
    return icons[this.mode];
  }

  // --- Whitelist/Blacklist ---

  addToWhitelist(toolName: string): void { this.whitelist.add(toolName); this.savePersistentDecisions(); }
  removeFromWhitelist(toolName: string): void { this.whitelist.delete(toolName); }
  addToBlacklist(toolName: string): void { this.blacklist.add(toolName); this.savePersistentDecisions(); }
  removeFromBlacklist(toolName: string): void { this.blacklist.delete(toolName); }
  getWhitelist(): string[] { return Array.from(this.whitelist); }
  getBlacklist(): string[] { return Array.from(this.blacklist); }

  // --- Main Approval Logic ---

  async requestApproval(
    toolName: string,
    args: Record<string, unknown>,
    risk: 'low' | 'medium' | 'high',
    description?: string,
  ): Promise<ApprovalResult> {
    const startTime = Date.now();

    // 1. Blacklist check
    if (this.isBlacklisted(toolName)) {
      this.recordStats(toolName, false, Date.now() - startTime);
      return { approved: false, remember: false };
    }

    // 2. Whitelist check
    if (this.isWhitelisted(toolName)) {
      this.recordStats(toolName, true, Date.now() - startTime);
      return { approved: true, remember: true };
    }

    // 3. Persistent "always" decisions
    const alwaysKey = this.getAlwaysKey(toolName, args);
    if (this.persistentApprovals.has(alwaysKey)) {
      const approved = this.persistentApprovals.get(alwaysKey)!;
      this.recordStats(toolName, approved, Date.now() - startTime);
      return { approved, remember: true, always: true };
    }

    // 4. Session-level approvals
    const pattern = `${toolName}:${this.getPattern(args)}`;
    if (this.sessionApprovals.has(pattern)) {
      const approved = this.sessionApprovals.get(pattern)!;
      this.recordStats(toolName, approved, Date.now() - startTime);

      if (approved && this.maxConsecutiveAutoApproves > 0) {
        this.consecutiveAutoApproves++;
        if (this.consecutiveAutoApproves > this.maxConsecutiveAutoApproves) {
          this.consecutiveAutoApproves = 0;
          return this.promptUser(toolName, args, risk, description);
        }
      }
      return { approved, remember: true };
    }

    // 5. Plan mode
    if (this.mode === 'plan') {
      const isReadOnly = this.autoApprovePatterns.includes(toolName) || this.isWhitelisted(toolName);
      this.recordStats(toolName, isReadOnly, Date.now() - startTime);
      return { approved: isReadOnly, remember: false };
    }

    // 6. Yolo mode
    if (this.mode === 'yolo') {
      this.recordStats(toolName, true, Date.now() - startTime);
      return { approved: true, remember: false };
    }

    // 7. Auto mode
    if (this.mode === 'auto') {
      if (risk === 'low' && (this.autoApprovePatterns.includes(toolName) || this.isWhitelisted(toolName))) {
        this.recordStats(toolName, true, Date.now() - startTime);
        return { approved: true, remember: false };
      }
    }

    // 8. Known safe tools
    if (risk === 'low' && this.autoApprovePatterns.includes(toolName)) {
      this.recordStats(toolName, true, Date.now() - startTime);
      return { approved: true, remember: false };
    }

    // 9. Diff preview for file modification tools
    if (this.showDiffPreview && this.isFileModification(toolName, args)) {
      return this.promptWithDiffPreview(toolName, args, risk, description);
    }

    // 10. Interactive prompt
    return this.promptUser(toolName, args, risk, description);
  }

  // --- Diff Preview Integration ---

  private isFileModification(toolName: string, args: Record<string, unknown>): boolean {
    return ['write_file', 'edit_file', 'apply_diff', 'delete_file'].includes(toolName);
  }

  private async promptWithDiffPreview(
    toolName: string,
    args: Record<string, unknown>,
    risk: 'low' | 'medium' | 'high',
    description?: string,
  ): Promise<ApprovalResult> {
    let diff: FileDiff | null = null;
    try {
      if (toolName === 'edit_file' && args.path && args.old_text && args.new_text) {
        diff = DiffPreview.createEditDiff(args.path as string, args.old_text as string, args.new_text as string);
      } else if (toolName === 'write_file' && args.path && args.content) {
        const oldContent = (args.old_content as string) || '';
        diff = DiffPreview.createDiff(oldContent, args.content as string, args.path as string);
      } else if (toolName === 'apply_diff' && args.diff) {
        console.log();
        console.log(chalk.cyan('  ━━━ Diff to Apply ━━━'));
        console.log(chalk.gray(String(args.diff)));
        console.log();
      }
    } catch { /* Diff preview failed, continue without it */ }

    if (diff) DiffPreview.renderDiff(diff);
    return this.promptUser(toolName, args, risk, description);
  }

  // --- Interactive Prompt ---

  private async promptUser(
    toolName: string,
    args: Record<string, unknown>,
    risk: 'low' | 'medium' | 'high',
    description?: string,
  ): Promise<ApprovalResult> {
    const riskColors = { low: chalk.green, medium: chalk.yellow, high: chalk.red };
    const riskIcons = { low: '🟢', medium: '🟡', high: '🔴' };

    console.log();
    console.log(`  ${riskIcons[risk]} ${riskColors[risk].bold(`Approval needed [${risk} risk]`)}`);
    console.log(`  ${chalk.cyan('Tool:')} ${chalk.white.bold(toolName)}`);

    if (description) {
      console.log(`  ${chalk.cyan('Description:')} ${chalk.gray(description)}`);
    }

    const argEntries = Object.entries(args);
    if (argEntries.length > 0) {
      console.log(`  ${chalk.cyan('Arguments:')}`);
      for (const [key, value] of argEntries.slice(0, 5)) {
        const val = typeof value === 'string' && value.length > 80 ? value.slice(0, 80) + '...' : String(value);
        console.log(`    ${chalk.gray(key)}: ${chalk.white(val)}`);
      }
      if (argEntries.length > 5) {
        console.log(`    ${chalk.gray(`...and ${argEntries.length - 5} more`)}`);
      }
    }

    console.log();
    console.log(`  ${chalk.gray('y')} = Yes  ${chalk.gray('n')} = No  ${chalk.gray('a')} = Yes always (session)  ${chalk.gray('A')} = Yes always (persist)  ${chalk.gray('e')} = Edit args  ${chalk.gray('d')} = Show diff`);

    const answer = await this.readline(`${riskIcons[risk]} Allow ${toolName}? [y/n/a/A/e/d]: `);
    const startTime = Date.now();

    switch (answer.toLowerCase().trim()) {
      case 'y':
      case 'yes':
        this.recordStats(toolName, true, Date.now() - startTime);
        this.consecutiveAutoApproves++;
        return { approved: true, remember: false };

      case 'a':
      case 'always': {
        const pattern = `${toolName}:${this.getPattern(args)}`;
        this.sessionApprovals.set(pattern, true);
        this.recordStats(toolName, true, Date.now() - startTime);
        this.consecutiveAutoApproves++;
        return { approved: true, remember: true };
      }

      case 'A': {
        const alwaysKey = this.getAlwaysKey(toolName, args);
        this.persistentApprovals.set(alwaysKey, true);
        this.whitelist.add(toolName);
        if (this.persistDecisions) this.savePersistentDecisions();
        this.recordStats(toolName, true, Date.now() - startTime);
        this.consecutiveAutoApproves++;
        return { approved: true, remember: true, always: true };
      }

      case 'e':
      case 'edit':
        console.log(chalk.gray('  Edit mode: modify the arguments and press Enter to approve, or "cancel" to deny'));
        const editedArgs = await this.readline('  New args (JSON): ');
        try {
          JSON.parse(editedArgs);
          this.recordStats(toolName, true, Date.now() - startTime);
          return { approved: true, remember: false, edited: true };
        } catch {
          this.recordStats(toolName, false, Date.now() - startTime);
          return { approved: false, remember: false };
        }

      case 'd': {
        if (this.isFileModification(toolName, args)) {
          return this.promptWithDiffPreview(toolName, args, risk, description);
        }
        console.log(chalk.gray('  No diff available for this tool.'));
        return this.promptUser(toolName, args, risk, description);
      }

      case 'n':
      case 'no':
      default:
        this.deniedTools.add(toolName);
        this.consecutiveAutoApproves = 0;
        this.recordStats(toolName, false, Date.now() - startTime);
        return { approved: false, remember: false };
    }
  }

  // --- Batch Approval ---

  async requestBatchApproval(
    toolName: string,
    args: Record<string, unknown>,
    risk: 'low' | 'medium' | 'high',
    description?: string,
  ): Promise<ApprovalResult> {
    if (!this.batchApprove || this.mode === 'yolo') {
      return this.requestApproval(toolName, args, risk, description);
    }

    return new Promise((resolve) => {
      this.pendingBatch.push({ toolName, args, risk, description, resolve });
      if (this.batchTimer) clearTimeout(this.batchTimer);
      this.batchTimer = setTimeout(() => { this.processBatch(); }, 500);
    });
  }

  private async processBatch(): Promise<void> {
    const batch = [...this.pendingBatch];
    this.pendingBatch = [];
    this.batchTimer = null;

    if (batch.length === 0) return;
    if (batch.length === 1) {
      const item = batch[0];
      const result = await this.requestApproval(item.toolName, item.args, item.risk, item.description);
      item.resolve(result);
      return;
    }

    const groups = new Map<string, typeof batch>();
    for (const item of batch) {
      if (!groups.has(item.toolName)) groups.set(item.toolName, []);
      groups.get(item.toolName)!.push(item);
    }

    console.log();
    console.log(chalk.bold.cyan(`  ━━━ Batch Approval (${batch.length} operations) ━━━`));
    for (const [toolName, items] of groups) {
      console.log(`  ${chalk.cyan(toolName)}: ${chalk.white(`${items.length} operations`)}`);
      for (const item of items.slice(0, 3)) {
        const preview = item.args.path || item.args.command || item.description || '';
        console.log(`    - ${chalk.gray(String(preview).slice(0, 60))}`);
      }
      if (items.length > 3) console.log(`    ${chalk.gray(`...and ${items.length - 3} more`)}`);
    }

    console.log();
    console.log(`  ${chalk.gray('y')} = Approve all  ${chalk.gray('n')} = Deny all  ${chalk.gray('r')} = Review each`);
    const answer = await this.readline('  Batch approve? [y/n/r]: ');

    switch (answer.toLowerCase().trim()) {
      case 'y':
      case 'yes':
        for (const item of batch) {
          const pattern = `${item.toolName}:${this.getPattern(item.args)}`;
          this.sessionApprovals.set(pattern, true);
          item.resolve({ approved: true, remember: true });
        }
        break;
      case 'r':
      case 'review':
        for (const item of batch) {
          const result = await this.requestApproval(item.toolName, item.args, item.risk, item.description);
          item.resolve(result);
        }
        break;
      default:
        for (const item of batch) item.resolve({ approved: false, remember: false });
        break;
    }
  }

  // --- Helpers ---

  private isBlacklisted(toolName: string): boolean { return this.blacklist.has(toolName); }

  private isWhitelisted(toolName: string): boolean {
    if (this.whitelist.has(toolName)) return true;
    for (const pattern of this.whitelist) {
      if (pattern.endsWith('*') && toolName.startsWith(pattern.slice(0, -1))) return true;
    }
    return false;
  }

  private getPattern(args: Record<string, unknown>): string {
    if (args.command && typeof args.command === 'string') return args.command.split(' ')[0];
    if (args.path && typeof args.path === 'string') {
      return args.path.includes('.') ? '.' + args.path.split('.').pop() : '*';
    }
    return '*';
  }

  private getAlwaysKey(toolName: string, args: Record<string, unknown>): string {
    return `${toolName}:${this.getPattern(args)}`;
  }

  private readline(prompt: string): Promise<string> {
    if (!this.rl) this.rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => { this.rl!.question(prompt, (answer) => resolve(answer)); });
  }

  close(): void {
    if (this.rl) { this.rl.close(); this.rl = null; }
    if (this.batchTimer) { clearTimeout(this.batchTimer); this.batchTimer = null; }
  }

  addAutoApprove(toolName: string): void {
    if (!this.autoApprovePatterns.includes(toolName)) this.autoApprovePatterns.push(toolName);
  }

  reset(): void {
    this.sessionApprovals.clear();
    this.deniedTools.clear();
    this.consecutiveAutoApproves = 0;
  }

  // --- Statistics ---

  private recordStats(toolName: string, approved: boolean, responseTimeMs: number): void {
    const existing = this.stats.get(toolName) || { approved: 0, denied: 0, totalResponseMs: 0 };
    if (approved) existing.approved++; else existing.denied++;
    existing.totalResponseMs += responseTimeMs;
    this.stats.set(toolName, existing);
  }

  getStats(): ToolApprovalStats[] {
    const result: ToolApprovalStats[] = [];
    for (const [toolName, data] of this.stats) {
      const total = data.approved + data.denied;
      result.push({ toolName, approved: data.approved, denied: data.denied, avgResponseTimeMs: total > 0 ? Math.round(data.totalResponseMs / total) : 0 });
    }
    return result.sort((a, b) => (b.approved + b.denied) - (a.approved + a.denied));
  }

  // --- Persistent Decisions ---

  private loadPersistentDecisions(): void {
    if (!this.persistDecisions) return;
    try {
      if (existsSync(APPROVALS_PATH)) {
        const data = JSON.parse(readFileSync(APPROVALS_PATH, 'utf-8'));
        if (data.whitelist) this.whitelist = new Set(data.whitelist);
        if (data.blacklist) this.blacklist = new Set(data.blacklist);
        if (data.alwaysApprove) {
          for (const [key, val] of Object.entries(data.alwaysApprove)) {
            this.persistentApprovals.set(key, val as boolean);
          }
        }
      }
    } catch { /* Ignore errors */ }
  }

  private savePersistentDecisions(): void {
    if (!this.persistDecisions) return;
    try {
      const dir = join(APPROVALS_PATH, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data = {
        whitelist: Array.from(this.whitelist),
        blacklist: Array.from(this.blacklist),
        alwaysApprove: Object.fromEntries(this.persistentApprovals),
      };
      writeFileSync(APPROVALS_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* Ignore errors */ }
  }

  /**
   * Print approval statistics
   */
  printStats(): void {
    const stats = this.getStats();
    if (stats.length === 0) { console.log(chalk.gray('  No approval data yet.')); return; }
    console.log(chalk.bold('\n  Approval Statistics:\n'));
    console.log(`  ${'Tool'.padEnd(25)} ${'Approved'.padEnd(10)} ${'Denied'.padEnd(10)} ${'Avg Time'.padEnd(10)}`);
    console.log(`  ${'─'.repeat(55)}`);
    for (const stat of stats) {
      console.log(`  ${chalk.cyan(stat.toolName.padEnd(25))} ${chalk.green(String(stat.approved).padEnd(10))} ${chalk.red(String(stat.denied).padEnd(10))} ${chalk.gray((stat.avgResponseTimeMs + 'ms').padEnd(10))}`);
    }
    console.log();
  }
}
