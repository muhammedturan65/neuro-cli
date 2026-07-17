// ============================================================
// NeuroCLI - Tab Completion System
// Slash commands, file paths, model names, agent names
// ============================================================

import { CompleterResult, Completer } from 'readline';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename, dirname, extname } from 'path';
import { MODELS } from '../api/models.js';
import { homedir } from 'os';

export class CompletionEngine {
  private slashCommands: Map<string, string> = new Map();
  private modelIds: string[] = [];
  private agentNames: string[] = [];
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
    this.modelIds = Object.keys(MODELS);

    // Built-in slash commands
    const commands: [string, string][] = [
      ['help', 'Show help message'],
      ['model', 'Switch or list models'],
      ['agent', 'Switch or list agents'],
      ['auto', 'Auto mode (smart orchestration)'],
      ['orchestrate', 'Multi-agent orchestration mode'],
      ['plan', 'Plan mode (read-only)'],
      ['direct', 'Direct agent mode'],
      ['stats', 'Show session statistics'],
      ['theme', 'Switch UI theme'],
      ['clear', 'Clear terminal'],
      ['exit', 'Exit NeuroCLI'],
      ['quit', 'Exit NeuroCLI'],
      ['resume', 'Resume a previous session'],
      ['compact', 'Compact conversation context'],
      ['undo', 'Undo last change'],
      ['redo', 'Redo undone change'],
      ['mcp', 'Manage MCP servers'],
      ['fork', 'Fork current session'],
      ['init', 'Initialize NEURO.md for this project'],
    ];
    for (const [cmd, desc] of commands) {
      this.slashCommands.set(cmd, desc);
    }
  }

  setAgentNames(names: string[]): void {
    this.agentNames = names;
  }

  /**
   * Main completion handler for readline
   */
  complete = (line: string): CompleterResult => {
    // Slash command completion
    if (line.startsWith('/')) {
      return this.completeSlashCommand(line);
    }

    // File path completion (for paths starting with ./ or / or ~)
    if (this.looksLikeFilePath(line)) {
      return this.completeFilePath(line);
    }

    // Default: try slash commands
    return this.completeSlashCommand('/' + line);
  };

  private completeSlashCommand(line: string): CompleterResult {
    const partial = line.slice(1).toLowerCase(); // Remove /
    const parts = partial.split(/\s+/);

    // First part: command name
    if (parts.length === 1) {
      const matches = Array.from(this.slashCommands.keys())
        .filter(cmd => cmd.startsWith(partial))
        .map(cmd => '/' + cmd + ' ');

      if (matches.length === 1) {
        // Auto-include description for single match
        const cmd = matches[0].trim().slice(1);
        const desc = this.slashCommands.get(cmd);
        return [matches, line];
      }

      return [matches.length > 0 ? matches : Array.from(this.slashCommands.keys()).map(c => '/' + c + ' '), line];
    }

    // Second part: context-specific completion
    const command = parts[0];
    const argPartial = parts.slice(1).join(' ');

    switch (command) {
      case 'model':
        return [this.modelIds.filter(m => m.startsWith(argPartial) || MODELS[m]?.name.toLowerCase().startsWith(argPartial.toLowerCase())), line];

      case 'agent':
        return [this.agentNames.filter(a => a.toLowerCase().startsWith(argPartial.toLowerCase())), line];

      case 'theme':
        return [['dracula', 'dark', 'nord', 'light'].filter(t => t.startsWith(argPartial)), line];

      case 'resume':
        return this.completeSessionId(argPartial, line);

      case 'mcp':
        return [['add', 'list', 'remove', 'connect', 'disconnect'].filter(c => c.startsWith(argPartial)), line];

      default:
        return [[], line];
    }
  }

  private completeFilePath(line: string): CompleterResult {
    let dirPath: string;
    let filePrefix: string;

    if (line.startsWith('~/')) {
      dirPath = join(homedir(), dirname(line.slice(2)));
      filePrefix = basename(line);
    } else if (line.startsWith('/')) {
      dirPath = dirname(line);
      filePrefix = basename(line);
    } else if (line.startsWith('./')) {
      dirPath = join(this.cwd, dirname(line.slice(2)));
      filePrefix = basename(line);
    } else {
      dirPath = this.cwd;
      filePrefix = line;
    }

    try {
      if (!existsSync(dirPath)) return [[], line];
      const entries = readdirSync(dirPath);
      const matches = entries
        .filter(e => e.toLowerCase().startsWith(filePrefix.toLowerCase()))
        .map(e => {
          const fullPath = join(dirPath, e);
          try {
            const stat = statSync(fullPath);
            return stat.isDirectory() ? e + '/' : e;
          } catch {
            return e;
          }
        });

      return [matches, line];
    } catch {
      return [[], line];
    }
  }

  private completeSessionId(partial: string, line: string): CompleterResult {
    // Session IDs are long - just suggest "latest" and let user type
    const suggestions = ['latest'];
    if (partial) {
      // Could list actual session IDs from ~/.neuro/sessions/
      try {
        const sessionDir = join(homedir(), '.neuro', 'sessions');
        if (existsSync(sessionDir)) {
          const files = readdirSync(sessionDir)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''))
            .filter(f => f.startsWith(partial));
          suggestions.push(...files.slice(0, 5));
        }
      } catch {}
    }
    return [suggestions.filter(s => s.startsWith(partial)), line];
  }

  private looksLikeFilePath(line: string): boolean {
    return line.startsWith('./') || line.startsWith('/') || line.startsWith('~/') ||
           (line.includes('/') && !line.startsWith('/'));
  }

  /**
   * Display completion suggestions nicely
   */
  static displaySuggestions(suggestions: string[]): void {
    if (suggestions.length === 0) return;
    if (suggestions.length === 1) return; // Let readline handle it

    console.log();
    const cols = Math.min(process.stdout.columns || 80, 100);
    const maxLen = Math.max(...suggestions.map(s => s.length)) + 2;
    const perRow = Math.floor(cols / maxLen) || 1;

    let row = '';
    for (let i = 0; i < suggestions.length; i++) {
      row += suggestions[i].padEnd(maxLen);
      if ((i + 1) % perRow === 0) {
        console.log(row);
        row = '';
      }
    }
    if (row) console.log(row);
  }
}
