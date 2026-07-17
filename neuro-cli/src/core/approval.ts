// ============================================================
// NeuroCLI - Approval System
// Real interactive approval with multiple permission modes
// ============================================================

import { createInterface, Interface as ReadLineInterface } from 'readline';
import chalk from 'chalk';

export type PermissionMode = 'manual' | 'auto' | 'plan' | 'yolo';

export interface ApprovalResult {
  approved: boolean;
  remember: boolean;  // remember this decision for the session
}

export class ApprovalSystem {
  private mode: PermissionMode = 'manual';
  private sessionApprovals: Map<string, boolean> = new Map(); // tool pattern -> approved
  private deniedTools: Set<string> = new Set();
  private autoApprovePatterns: string[] = [
    'read_file', 'search_files', 'list_directory', 'web_search', 'web_fetch',
    'recall_memory', 'project_context', 'todowrite',
  ];
  private rl: ReadLineInterface | null = null;

  constructor(mode?: PermissionMode) {
    if (mode) this.mode = mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

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
    const icons: Record<PermissionMode, string> = {
      manual: '🛡️',
      auto: '⚡',
      plan: '📖',
      yolo: '🔥',
    };
    return icons[this.mode];
  }

  async requestApproval(
    toolName: string,
    args: Record<string, unknown>,
    risk: 'low' | 'medium' | 'high',
    description?: string,
  ): Promise<ApprovalResult> {
    // Plan mode: deny all modifications
    if (this.mode === 'plan') {
      const isReadOnly = this.autoApprovePatterns.includes(toolName);
      if (!isReadOnly) {
        return { approved: false, remember: false };
      }
      return { approved: true, remember: false };
    }

    // Yolo mode: approve everything
    if (this.mode === 'yolo') {
      return { approved: true, remember: false };
    }

    // Auto mode: auto-approve low-risk, ask for medium/high
    if (this.mode === 'auto') {
      if (risk === 'low' && this.autoApprovePatterns.includes(toolName)) {
        return { approved: true, remember: false };
      }
      if (risk === 'high') {
        // Still ask for high-risk even in auto mode
        return this.promptUser(toolName, args, risk, description);
      }
      // Medium risk: ask
      return this.promptUser(toolName, args, risk, description);
    }

    // Manual mode: check session approvals first, then ask
    const pattern = `${toolName}:${this.getPattern(args)}`;
    if (this.sessionApprovals.has(pattern)) {
      return { approved: this.sessionApprovals.get(pattern)!, remember: true };
    }

    if (this.deniedTools.has(toolName)) {
      return { approved: false, remember: false };
    }

    // Auto-approve known safe tools even in manual mode
    if (risk === 'low' && this.autoApprovePatterns.includes(toolName)) {
      return { approved: true, remember: false };
    }

    return this.promptUser(toolName, args, risk, description);
  }

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

    // Show relevant args
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
    console.log(`  ${chalk.gray('y')} = Yes  ${chalk.gray('n')} = No  ${chalk.gray('a')} = Yes always (this session)  ${chalk.gray('e')} = Edit args`);

    const answer = await this.readline(`${riskIcons[risk]} Allow ${toolName}? [y/n/a/e]: `);

    switch (answer.toLowerCase().trim()) {
      case 'y':
      case 'yes':
        return { approved: true, remember: false };
      case 'a':
      case 'always':
        const pattern = `${toolName}:${this.getPattern(args)}`;
        this.sessionApprovals.set(pattern, true);
        return { approved: true, remember: true };
      case 'e':
      case 'edit':
        // Future: allow editing args before execution
        return { approved: true, remember: false };
      case 'n':
      case 'no':
      default:
        this.deniedTools.add(toolName);
        return { approved: false, remember: false };
    }
  }

  private getPattern(args: Record<string, unknown>): string {
    // Create a pattern for session approvals (e.g., "run_command:git *" or "write_file:*.ts")
    if (args.command && typeof args.command === 'string') {
      const cmd = args.command.split(' ')[0];
      return cmd;
    }
    if (args.path && typeof args.path === 'string') {
      const ext = args.path.includes('.') ? '.' + args.path.split('.').pop() : '*';
      return ext;
    }
    return '*';
  }

  private readline(prompt: string): Promise<string> {
    if (!this.rl) {
      this.rl = createInterface({ input: process.stdin, output: process.stdout });
    }
    return new Promise((resolve) => {
      this.rl!.question(prompt, (answer) => resolve(answer));
    });
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  addAutoApprove(toolName: string): void {
    if (!this.autoApprovePatterns.includes(toolName)) {
      this.autoApprovePatterns.push(toolName);
    }
  }

  reset(): void {
    this.sessionApprovals.clear();
    this.deniedTools.clear();
  }
}
