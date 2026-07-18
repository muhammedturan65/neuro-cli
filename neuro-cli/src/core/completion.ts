// ============================================================
// NeuroCLI - Enhanced Tab Completion System
// Slash commands, file paths, model names, agent names,
// command history, context-aware suggestions
// ============================================================

import { CompleterResult } from 'readline';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, basename, dirname, extname } from 'path';
import { homedir } from 'os';
import { MODELS } from '../api/models.js';

export class CompletionEngine {
  private slashCommands: Map<string, string> = new Map();
  private modelIds: string[] = [];
  private agentNames: string[] = [];
  private cwd: string;
  private commandHistory: string[] = [];
  private maxHistory: number = 500;
  private historyPath: string;
  private permissionModes: string[] = ['manual', 'auto', 'plan', 'yolo'];
  private themes: string[] = ['dracula', 'dark', 'nord', 'light'];
  private mcpSubcommands: string[] = ['list', 'add', 'remove', 'connect', 'disconnect', 'health'];
  private skillSubcommands: string[] = ['list', 'activate', 'deactivate', 'clear'];
  private cacheSubcommands: string[] = ['on', 'off', 'clear', 'stats'];
  private ignoreSubcommands: string[] = ['list', 'add', 'check'];
  private styleNames: string[] = ['default', 'concise', 'explanatory', 'learning', 'narrative', 'technical', 'review', 'debug'];
  private thinkingModes: string[] = ['none', 'brief', 'full', 'ultrathink'];
  private effortLevels: string[] = ['low', 'medium', 'high', 'ultrathink'];
  private fileExtensions: Map<string, string[]> = new Map([
    ['typescript', ['.ts', '.tsx', '.d.ts']],
    ['javascript', ['.js', '.jsx', '.mjs', '.cjs']],
    ['python', ['.py', '.pyi', '.pyw']],
    ['rust', ['.rs']],
    ['go', ['.go']],
    ['java', ['.java']],
    ['config', ['.json', '.yaml', '.yml', '.toml', '.env']],
    ['web', ['.html', '.css', '.scss', '.vue', '.svelte']],
    ['docs', ['.md', '.txt', '.rst']],
  ]);

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
    this.modelIds = Object.keys(MODELS);
    this.historyPath = join(homedir(), '.neuro', 'history');

    // Built-in slash commands with descriptions (v3.0 expanded)
    const commands: [string, string][] = [
      ['help', 'Show help message'],
      ['model', 'Switch or list models'],
      ['agent', 'Switch or list agents'],
      ['auto', 'Auto mode (smart orchestration)'],
      ['orchestrate', 'Multi-agent orchestration mode'],
      ['plan', 'Plan mode (read-only)'],
      ['direct', 'Direct agent mode'],
      ['plan-mode', 'Plan mode (read-only, no modifications)'],
      ['stats', 'Show session statistics'],
      ['theme', 'Switch UI theme'],
      ['clear', 'Clear terminal'],
      ['exit', 'Exit NeuroCLI'],
      ['quit', 'Exit NeuroCLI'],
      ['resume', 'Resume a previous session'],
      ['compact', 'Compact conversation context'],
      ['undo', 'Undo last change'],
      ['redo', 'Redo undone change'],
      ['rewind', 'Rewind n changes'],
      ['mcp', 'Manage MCP servers'],
      ['fork', 'Fork current session'],
      ['init', 'Initialize NEURO.md for this project'],
      ['permission', 'Cycle or set permission mode'],
      ['perm', 'Alias for /permission'],
      ['doctor', 'Health check'],
      ['export', 'Export current session as JSON'],
      ['import', 'Import a session from JSON file'],
      ['sandbox', 'Toggle sandbox mode'],
      ['whitelist', 'Manage tool whitelist'],
      ['blacklist', 'Manage tool blacklist'],
      // v3.0 new commands
      ['style', 'Switch output style (concise, explanatory, learning, etc.)'],
      ['thinking', 'Toggle thinking mode (none|brief|full|ultrathink)'],
      ['effort', 'Set effort level (low|medium|high|ultrathink)'],
      ['skills', 'Manage skills (list|activate|deactivate|clear)'],
      ['cache', 'Manage prompt cache (on|off|clear|stats)'],
      ['spending', 'Show detailed spending report'],
      ['ignore', 'Manage .neuroignore rules'],
      ['ollama', 'List Ollama local models'],
      ['cost', 'Show spending and cache report'],
      ['commit-push-pr', 'Commit + push + create PR'],
      ['code-review', 'Multi-agent code review'],
      ['feedback', 'Give feedback'],
    ];
    for (const [cmd, desc] of commands) {
      this.slashCommands.set(cmd, desc);
    }

    this.loadHistory();
  }

  setAgentNames(names: string[]): void {
    this.agentNames = names;
  }

  // --- Command History ---

  addHistory(command: string): void {
    if (!command.trim()) return;
    // Don't add duplicates at the end
    if (this.commandHistory.length > 0 && this.commandHistory[this.commandHistory.length - 1] === command) return;
    this.commandHistory.push(command);
    if (this.commandHistory.length > this.maxHistory) {
      this.commandHistory = this.commandHistory.slice(-this.maxHistory);
    }
    this.saveHistory();
  }

  private loadHistory(): void {
    try {
      if (existsSync(this.historyPath)) {
        const data = readFileSync(this.historyPath, 'utf-8');
        this.commandHistory = data.split('\n').filter(Boolean).slice(-this.maxHistory);
      }
    } catch { /* Ignore */ }
  }

  private saveHistory(): void {
    try {
      const dir = dirname(this.historyPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.historyPath, this.commandHistory.join('\n'), 'utf-8');
    } catch { /* Ignore */ }
  }

  getHistory(): string[] {
    return [...this.commandHistory];
  }

  searchHistory(prefix: string): string[] {
    return this.commandHistory.filter(cmd => cmd.startsWith(prefix)).slice(-10);
  }

  // --- Main Completion Handler ---

  complete = (line: string): CompleterResult => {
    // Slash command completion
    if (line.startsWith('/')) {
      return this.completeSlashCommand(line);
    }

    // File path completion (for paths starting with ./ or / or ~)
    if (this.looksLikeFilePath(line)) {
      return this.completeFilePath(line);
    }

    // @-mention for agents
    if (line.startsWith('@')) {
      return this.completeAgent(line);
    }

    // History-based completion (if not empty)
    if (line.length > 0) {
      const historyMatches = this.searchHistory(line);
      if (historyMatches.length > 0) {
        return [historyMatches, line];
      }
    }

    // Default: try slash commands
    return this.completeSlashCommand('/' + line);
  };

  private completeSlashCommand(line: string): CompleterResult {
    const partial = line.slice(1).toLowerCase();
    const parts = partial.split(/\s+/);

    // First part: command name
    if (parts.length === 1) {
      const matches = Array.from(this.slashCommands.keys())
        .filter(cmd => cmd.startsWith(partial))
        .map(cmd => '/' + cmd + ' ');

      if (matches.length === 1) {
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
        return this.completeModel(argPartial, line);

      case 'agent':
        return [this.agentNames.filter(a => a.toLowerCase().startsWith(argPartial.toLowerCase())), line];

      case 'theme':
        return [this.themes.filter(t => t.startsWith(argPartial)), line];

      case 'resume':
        return this.completeSessionId(argPartial, line);

      case 'mcp':
        if (parts.length === 2) {
          return [this.mcpSubcommands.filter(c => c.startsWith(argPartial)), line];
        }
        return [[], line];

      case 'permission':
      case 'perm':
        return [this.permissionModes.filter(m => m.startsWith(argPartial)), line];

      case 'whitelist':
      case 'blacklist':
        return [[], line]; // TODO: complete tool names

      case 'import':
        return this.completeFilePath(argPartial || './');

      // v3.0 new command completions
      case 'style':
        return [this.styleNames.filter(s => s.startsWith(argPartial)), line];

      case 'thinking':
        if (argPartial === 'toggle') return [['toggle'], line];
        return [this.thinkingModes.filter(m => m.startsWith(argPartial)), line];

      case 'effort':
        return [this.effortLevels.filter(l => l.startsWith(argPartial)), line];

      case 'skills':
        if (parts.length === 2) {
          return [this.skillSubcommands.filter(c => c.startsWith(argPartial)), line];
        }
        return [[], line];

      case 'cache':
        if (parts.length === 2) {
          return [this.cacheSubcommands.filter(c => c.startsWith(argPartial)), line];
        }
        return [[], line];

      case 'ignore':
        if (parts.length === 2) {
          return [this.ignoreSubcommands.filter(c => c.startsWith(argPartial)), line];
        }
        return [[], line];

      default:
        return [[], line];
    }
  }

  private completeModel(partial: string, line: string): CompleterResult {
    // Match by ID or name
    const matches = this.modelIds.filter(m =>
      m.startsWith(partial) ||
      MODELS[m]?.name.toLowerCase().includes(partial.toLowerCase()) ||
      m.split('/')[1]?.split(':')[0].startsWith(partial)
    );

    // Also categorize
    if (partial === 'free' || partial === 'free-') {
      const freeMatches = this.modelIds.filter(m => m.includes(':free'));
      return [freeMatches, line];
    }

    return [matches.length > 0 ? matches : this.modelIds, line];
  }

  private completeAgent(line: string): CompleterResult {
    const partial = line.slice(1).toLowerCase();
    return [this.agentNames.filter(a => a.toLowerCase().startsWith(partial)), line];
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
    const suggestions = ['latest'];
    if (partial) {
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
    if (suggestions.length === 1) return;

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

  /**
   * Get contextual help for a partial command
   */
  getContextualHelp(partial: string): string | null {
    if (!partial.startsWith('/')) return null;
    const cmd = partial.slice(1).split(' ')[0];
    return this.slashCommands.get(cmd) || null;
  }
}

// Import required for saveHistory
import { writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from 'fs';
import { dirname } from 'path';
