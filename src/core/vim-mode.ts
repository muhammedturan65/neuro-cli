// ============================================================
// NeuroCLI - Vim Keybindings Mode
// Vim-like input mode (normal/insert/visual) with hjkl
// navigation, dd, yy, p, command mode (:), mode indicator
// Integration with readline
// ============================================================

import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Interface as ReadLineInterface } from 'readline';

// -----------------------------------------------------------
// Public interfaces
// -----------------------------------------------------------

export type VimMode = 'normal' | 'insert' | 'visual' | 'command';

export interface VimModeConfig {
  /** Whether vim mode is enabled */
  enabled: boolean;
  /** Show mode indicator in prompt */
  showModeIndicator: boolean;
  /** Custom key mappings */
  keyMappings: Record<string, string>;
  /** Bell on invalid key in normal mode */
  bellOnError: boolean;
}

export interface VimKeyAction {
  mode: VimMode;
  key: string;
  action: string;
  description: string;
}

export interface VimRegister {
  name: string;
  content: string;
  type: 'line' | 'char' | 'block';
}

export interface VimCommand {
  name: string;
  pattern: RegExp;
  handler: (args: string, vimMode: VimModeManager) => void;
  description: string;
}

// -----------------------------------------------------------
// Default config
// -----------------------------------------------------------

const VIM_CONFIG_PATH = join(homedir(), '.neuro', 'vim-config.json');

function defaultConfig(): VimModeConfig {
  return {
    enabled: false,
    showModeIndicator: true,
    keyMappings: {},
    bellOnError: true,
  };
}

// -----------------------------------------------------------
// VimModeManager
// -----------------------------------------------------------

export class VimModeManager {
  private config: VimModeConfig;
  private mode: VimMode = 'insert'; // Start in insert mode (user-friendly)
  private registers: Map<string, VimRegister> = new Map();
  private commandBuffer: string = '';
  private normalBuffer: string = '';
  private visualStart: number = 0;
  private cursorPosition: number = 0;
  private lineBuffer: string = '';
  private lastAction: string = '';
  private repeatCount: number = 0;
  private commandHistory: string[] = [];
  private commandHistoryIndex: number = -1;
  private rl: ReadLineInterface | null = null;
  private keyHandlerAttached: boolean = false;

  constructor(config?: Partial<VimModeConfig>) {
    this.config = { ...defaultConfig(), ...config };
    this.loadConfig();
    if (this.config.enabled) {
      this.mode = 'insert'; // Start in insert for better UX
    }
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Check if vim mode is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable vim mode
   */
  enable(): void {
    this.config.enabled = true;
    this.mode = 'insert';
    this.saveConfig();
    console.log(chalk.green('Vim mode enabled. Press Esc to enter normal mode.'));
  }

  /**
   * Disable vim mode
   */
  disable(): void {
    this.config.enabled = false;
    this.mode = 'insert';
    this.saveConfig();
    console.log(chalk.gray('Vim mode disabled. Standard readline bindings active.'));
  }

  /**
   * Toggle vim mode
   */
  toggle(): boolean {
    if (this.config.enabled) this.disable();
    else this.enable();
    return this.config.enabled;
  }

  /**
   * Get current mode
   */
  getMode(): VimMode {
    return this.mode;
  }

  /**
   * Set current mode
   */
  setMode(mode: VimMode): void {
    this.mode = mode;
    this.commandBuffer = '';
    this.normalBuffer = '';
    this.repeatCount = 0;
  }

  /**
   * Get mode indicator string for the prompt
   */
  getModeIndicator(): string {
    if (!this.config.enabled || !this.config.showModeIndicator) return '';

    switch (this.mode) {
      case 'normal':
        return chalk.bgBlue.white.bold(' NORMAL ');
      case 'insert':
        return chalk.bgGreen.white.bold(' INSERT ');
      case 'visual':
        return chalk.bgMagenta.white.bold(' VISUAL ');
      case 'command':
        return chalk.bgYellow.black.bold(' CMD ');
      default:
        return '';
    }
  }

  /**
   * Get the modified prompt with mode indicator
   */
  getModifiedPrompt(basePrompt: string): string {
    if (!this.config.enabled) return basePrompt;
    const indicator = this.getModeIndicator();
    return indicator ? `${indicator} ${basePrompt}` : basePrompt;
  }

  /**
   * Attach to a readline interface for key handling
   */
  attachToReadline(rl: ReadLineInterface): void {
    if (!this.config.enabled) return;
    this.rl = rl;

    if (!this.keyHandlerAttached && typeof process.stdin.setRawMode === 'function') {
      // We handle vim keys at a higher level via processKey
      this.keyHandlerAttached = true;
    }
  }

  /**
   * Detach from readline interface
   */
  detachFromReadline(): void {
    this.rl = null;
    this.keyHandlerAttached = false;
  }

  /**
   * Process a key press and return the action to take
   */
  processKey(key: string): VimKeyAction | null {
    if (!this.config.enabled) return null;

    // Handle escape first
    if (key === '\x1b' || key === 'Escape') {
      return this.handleEscape();
    }

    switch (this.mode) {
      case 'normal':
        return this.handleNormalKey(key);
      case 'insert':
        return this.handleInsertKey(key);
      case 'visual':
        return this.handleVisualKey(key);
      case 'command':
        return this.handleCommandKey(key);
      default:
        return null;
    }
  }

  /**
   * Get all yanked text from a register
   */
  getRegister(name: string): string {
    const reg = this.registers.get(name);
    return reg ? reg.content : '';
  }

  /**
   * Set register content
   */
  setRegister(name: string, content: string, type: 'line' | 'char' | 'block' = 'line'): void {
    this.registers.set(name, { name, content, type });
  }

  /**
   * Get current line buffer
   */
  getLineBuffer(): string {
    return this.lineBuffer;
  }

  /**
   * Set current line buffer
   */
  setLineBuffer(buffer: string): void {
    this.lineBuffer = buffer;
  }

  /**
   * Get cursor position
   */
  getCursorPosition(): number {
    return this.cursorPosition;
  }

  /**
   * Set cursor position
   */
  setCursorPosition(pos: number): void {
    this.cursorPosition = Math.max(0, Math.min(pos, this.lineBuffer.length));
  }

  /**
   * Execute a vim command (e.g. :w, :q, :set)
   */
  executeCommand(cmd: string): void {
    const trimmed = cmd.trim();

    // Built-in commands
    const commands: VimCommand[] = [
      {
        name: 'set',
        pattern: /^set\s+/,
        handler: (args) => this.handleSetCommand(args),
        description: 'Set vim options',
      },
      {
        name: 'w',
        pattern: /^w$/,
        handler: () => console.log(chalk.gray('Session auto-saved.')),
        description: 'Write/save (auto-saved in NeuroCLI)',
      },
      {
        name: 'q',
        pattern: /^q(!)?$/,
        handler: (args) => {
          if (args.includes('!')) {
            process.exit(0);
          } else {
            console.log(chalk.yellow('Use :q! to force quit.'));
          }
        },
        description: 'Quit',
      },
      {
        name: 'help',
        pattern: /^help$/,
        handler: () => this.printHelp(),
        description: 'Show vim mode help',
      },
      {
        name: 'registers',
        pattern: /^registers$/,
        handler: () => this.printRegisters(),
        description: 'Show register contents',
      },
      {
        name: 'mode',
        pattern: /^mode$/,
        handler: () => console.log(`Current mode: ${chalk.cyan(this.mode)}`),
        description: 'Show current mode',
      },
      {
        name: 'history',
        pattern: /^history$/,
        handler: () => this.printCommandHistory(),
        description: 'Show command history',
      },
    ];

    for (const command of commands) {
      if (command.pattern.test(trimmed)) {
        const args = trimmed.replace(command.pattern, '');
        command.handler(args, this);
        this.commandHistory.push(trimmed);
        return;
      }
    }

    console.log(chalk.yellow(`Unknown command: :${trimmed}. Type :help for vim mode help.`));
    this.commandHistory.push(trimmed);
  }

  /**
   * Print vim mode help
   */
  printHelp(): void {
    console.log('');
    console.log(chalk.bold('--- NeuroCLI Vim Mode Help ---'));
    console.log('');
    console.log(chalk.cyan('  Mode Switching:'));
    console.log('    Esc          - Switch to Normal mode');
    console.log('    i            - Enter Insert mode');
    console.log('    a            - Enter Insert mode (after cursor)');
    console.log('    v            - Enter Visual mode');
    console.log('    :            - Enter Command mode');
    console.log('');
    console.log(chalk.cyan('  Normal Mode Navigation:'));
    console.log('    h            - Move cursor left');
    console.log('    j            - Next history entry');
    console.log('    k            - Previous history entry');
    console.log('    l            - Move cursor right');
    console.log('    0            - Move to start of line');
    console.log('    $            - Move to end of line');
    console.log('    w            - Move to next word');
    console.log('    b            - Move to previous word');
    console.log('');
    console.log(chalk.cyan('  Normal Mode Editing:'));
    console.log('    dd           - Delete entire line');
    console.log('    dw           - Delete word');
    console.log('    x            - Delete character under cursor');
    console.log('    yy           - Yank (copy) entire line');
    console.log('    yw           - Yank word');
    console.log('    p            - Paste after cursor');
    console.log('    P            - Paste before cursor');
    console.log('    u            - Undo');
    console.log('    Ctrl+r       - Redo');
    console.log('');
    console.log(chalk.cyan('  Command Mode:'));
    console.log('    :help        - Show this help');
    console.log('    :w           - Save session');
    console.log('    :q!          - Force quit');
    console.log('    :set <opt>   - Set option');
    console.log('    :registers   - Show registers');
    console.log('    :mode        - Show current mode');
    console.log('');
    console.log(chalk.bold('-------------------------------'));
    console.log('');
  }

  /**
   * Print register contents
   */
  printRegisters(): void {
    console.log('');
    console.log(chalk.bold('--- Vim Registers ---'));
    for (const [name, reg] of this.registers) {
      const preview = reg.content.length > 40 ? reg.content.slice(0, 40) + '...' : reg.content;
      console.log(`  "${name}: ${chalk.cyan(preview)} (${reg.type})`);
    }
    if (this.registers.size === 0) {
      console.log(chalk.gray('  (no registers set)'));
    }
    console.log('');
  }

  /**
   * Get config
   */
  getConfig(): VimModeConfig {
    return { ...this.config };
  }

  // ----------------------------------------------------------
  // Private key handlers
  // ----------------------------------------------------------

  private handleEscape(): VimKeyAction {
    if (this.mode === 'insert' || this.mode === 'visual') {
      this.mode = 'normal';
      this.normalBuffer = '';
      this.repeatCount = 0;
      return { mode: 'normal', key: '\x1b', action: 'switch_mode', description: 'Switch to normal mode' };
    }
    if (this.mode === 'command') {
      this.mode = 'normal';
      this.commandBuffer = '';
      return { mode: 'normal', key: '\x1b', action: 'switch_mode', description: 'Cancel command mode' };
    }
    return { mode: 'normal', key: '\x1b', action: 'no_op', description: 'Already in normal mode' };
  }

  private handleNormalKey(key: string): VimKeyAction {
    // Accumulate repeat count
    if (/^[1-9]$/.test(key) && this.normalBuffer === '') {
      this.repeatCount = this.repeatCount * 10 + parseInt(key);
      return { mode: 'normal', key, action: 'repeat_count', description: `Repeat count: ${this.repeatCount}` };
    }

    this.normalBuffer += key;

    // Check for two-character commands
    if (this.normalBuffer.length === 1) {
      // Single-character commands
      switch (key) {
        case 'i':
          this.mode = 'insert';
          this.normalBuffer = '';
          return { mode: 'insert', key, action: 'switch_mode', description: 'Enter insert mode' };
        case 'a':
          this.mode = 'insert';
          this.cursorPosition++;
          this.normalBuffer = '';
          return { mode: 'insert', key, action: 'append', description: 'Append (insert after cursor)' };
        case 'A':
          this.mode = 'insert';
          this.cursorPosition = this.lineBuffer.length;
          this.normalBuffer = '';
          return { mode: 'insert', key, action: 'append_end', description: 'Append at end of line' };
        case 'I':
          this.mode = 'insert';
          this.cursorPosition = 0;
          this.normalBuffer = '';
          return { mode: 'insert', key, action: 'insert_start', description: 'Insert at start of line' };
        case 'v':
          this.mode = 'visual';
          this.visualStart = this.cursorPosition;
          this.normalBuffer = '';
          return { mode: 'visual', key, action: 'switch_mode', description: 'Enter visual mode' };
        case ':':
          this.mode = 'command';
          this.commandBuffer = '';
          this.normalBuffer = '';
          return { mode: 'command', key, action: 'switch_mode', description: 'Enter command mode' };
        case 'h':
          this.cursorPosition = Math.max(0, this.cursorPosition - 1);
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'cursor_left', description: 'Move cursor left' };
        case 'l':
          this.cursorPosition = Math.min(this.lineBuffer.length, this.cursorPosition + 1);
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'cursor_right', description: 'Move cursor right' };
        case 'j':
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'history_next', description: 'Next history entry' };
        case 'k':
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'history_prev', description: 'Previous history entry' };
        case '0':
          if (this.repeatCount === 0) {
            this.cursorPosition = 0;
            this.normalBuffer = '';
            return { mode: 'normal', key, action: 'cursor_start', description: 'Move to start of line' };
          }
          break;
        case '$':
          this.cursorPosition = this.lineBuffer.length;
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'cursor_end', description: 'Move to end of line' };
        case 'w':
          this.moveWordForward();
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'word_forward', description: 'Move to next word' };
        case 'b':
          this.moveWordBackward();
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'word_backward', description: 'Move to previous word' };
        case 'x':
          this.deleteCharAtCursor();
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'delete_char', description: 'Delete character under cursor' };
        case 'p':
          this.pasteAfter();
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'paste_after', description: 'Paste after cursor' };
        case 'P':
          this.pasteBefore();
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'paste_before', description: 'Paste before cursor' };
        case 'u':
          this.normalBuffer = '';
          return { mode: 'normal', key, action: 'undo', description: 'Undo' };
        case 'r':
          // Waiting for next key (replace char)
          return { mode: 'normal', key, action: 'waiting', description: 'Waiting for replace target' };
        case 'o':
          this.mode = 'insert';
          this.lineBuffer = '';
          this.cursorPosition = 0;
          this.normalBuffer = '';
          return { mode: 'insert', key, action: 'open_line_below', description: 'Open new line below' };
        case 'O':
          this.mode = 'insert';
          this.lineBuffer = '';
          this.cursorPosition = 0;
          this.normalBuffer = '';
          return { mode: 'insert', key, action: 'open_line_above', description: 'Open new line above' };
      }
    }

    // Two-character commands
    if (this.normalBuffer.length === 2) {
      const cmd = this.normalBuffer;
      this.normalBuffer = '';

      switch (cmd) {
        case 'dd':
          this.setRegister('', this.lineBuffer, 'line');
          this.lineBuffer = '';
          this.cursorPosition = 0;
          this.repeatCount = 0;
          return { mode: 'normal', key: cmd, action: 'delete_line', description: 'Delete entire line' };
        case 'yy':
          this.setRegister('', this.lineBuffer, 'line');
          this.repeatCount = 0;
          return { mode: 'normal', key: cmd, action: 'yank_line', description: 'Yank (copy) line' };
        case 'dw':
          this.deleteWordForward();
          this.repeatCount = 0;
          return { mode: 'normal', key: cmd, action: 'delete_word', description: 'Delete word' };
        case 'yw':
          this.yankWordForward();
          this.repeatCount = 0;
          return { mode: 'normal', key: cmd, action: 'yank_word', description: 'Yank word' };
        case 'cc':
          this.setRegister('', this.lineBuffer, 'line');
          this.lineBuffer = '';
          this.cursorPosition = 0;
          this.mode = 'insert';
          this.repeatCount = 0;
          return { mode: 'insert', key: cmd, action: 'change_line', description: 'Change entire line' };
        case 'cw':
          this.changeWordForward();
          this.mode = 'insert';
          this.repeatCount = 0;
          return { mode: 'insert', key: cmd, action: 'change_word', description: 'Change word' };
        default:
          // Handle replace char (r followed by char)
          if (cmd[0] === 'r' && cmd.length === 2) {
            this.replaceCharAtCursor(cmd[1]);
            this.repeatCount = 0;
            return { mode: 'normal', key: cmd, action: 'replace_char', description: `Replace char with '${cmd[1]}'` };
          }
          if (this.config.bellOnError) {
            return { mode: 'normal', key: cmd, action: 'bell', description: `Unknown command: ${cmd}` };
          }
          return { mode: 'normal', key: cmd, action: 'no_op', description: `Unknown command: ${cmd}` };
      }
    }

    return { mode: 'normal', key, action: 'waiting', description: 'Waiting for next key' };
  }

  private handleInsertKey(key: string): VimKeyAction {
    // In insert mode, most keys are passed through to readline
    // We only intercept special keys
    if (key === '\x1b' || key === 'Escape') {
      return this.handleEscape();
    }
    // Ctrl+C in insert mode goes to normal mode
    if (key === '\x03') {
      this.mode = 'normal';
      return { mode: 'normal', key, action: 'switch_mode', description: 'Ctrl+C: switch to normal mode' };
    }
    // Pass through to readline
    return { mode: 'insert', key, action: 'passthrough', description: 'Insert mode passthrough' };
  }

  private handleVisualKey(key: string): VimKeyAction {
    switch (key) {
      case '\x1b':
      case 'Escape':
        this.mode = 'normal';
        return { mode: 'normal', key, action: 'switch_mode', description: 'Exit visual mode' };
      case 'h':
        this.cursorPosition = Math.max(0, this.cursorPosition - 1);
        return { mode: 'visual', key, action: 'cursor_left', description: 'Move selection left' };
      case 'l':
        this.cursorPosition = Math.min(this.lineBuffer.length, this.cursorPosition + 1);
        return { mode: 'visual', key, action: 'cursor_right', description: 'Move selection right' };
      case 'y':
        this.yankVisualSelection();
        this.mode = 'normal';
        return { mode: 'normal', key, action: 'yank_selection', description: 'Yank visual selection' };
      case 'd':
      case 'x':
        this.deleteVisualSelection();
        this.mode = 'normal';
        return { mode: 'normal', key, action: 'delete_selection', description: 'Delete visual selection' };
      default:
        return { mode: 'visual', key, action: 'no_op', description: `Unknown visual key: ${key}` };
    }
  }

  private handleCommandKey(key: string): VimKeyAction {
    // Enter executes command
    if (key === '\r' || key === '\n') {
      const cmd = this.commandBuffer;
      this.commandBuffer = '';
      this.mode = 'normal';
      this.executeCommand(cmd);
      return { mode: 'normal', key, action: 'execute_command', description: `Execute: :${cmd}` };
    }

    // Backspace
    if (key === '\x7f' || key === 'Backspace') {
      this.commandBuffer = this.commandBuffer.slice(0, -1);
      if (this.commandBuffer === '') {
        this.mode = 'normal';
        return { mode: 'normal', key, action: 'switch_mode', description: 'Cancel command' };
      }
      return { mode: 'command', key, action: 'backspace', description: 'Command backspace' };
    }

    // Escape cancels
    if (key === '\x1b' || key === 'Escape') {
      this.commandBuffer = '';
      this.mode = 'normal';
      return { mode: 'normal', key, action: 'switch_mode', description: 'Cancel command' };
    }

    // Up/Down for command history
    if (key === '\x1b[A' || key === 'ArrowUp') {
      if (this.commandHistory.length > 0) {
        this.commandHistoryIndex = Math.min(this.commandHistoryIndex + 1, this.commandHistory.length - 1);
        this.commandBuffer = this.commandHistory[this.commandHistory.length - 1 - this.commandHistoryIndex];
      }
      return { mode: 'command', key, action: 'history_prev', description: 'Previous command' };
    }
    if (key === '\x1b[B' || key === 'ArrowDown') {
      this.commandHistoryIndex = Math.max(this.commandHistoryIndex - 1, -1);
      if (this.commandHistoryIndex === -1) {
        this.commandBuffer = '';
      } else {
        this.commandBuffer = this.commandHistory[this.commandHistory.length - 1 - this.commandHistoryIndex];
      }
      return { mode: 'command', key, action: 'history_next', description: 'Next command' };
    }

    // Regular character
    if (key.length === 1 && key.charCodeAt(0) >= 32) {
      this.commandBuffer += key;
      return { mode: 'command', key, action: 'type', description: `Command: :${this.commandBuffer}` };
    }

    return { mode: 'command', key, action: 'no_op', description: 'Ignored key in command mode' };
  }

  // ----------------------------------------------------------
  // Private text manipulation helpers
  // ----------------------------------------------------------

  private moveWordForward(): void {
    const text = this.lineBuffer;
    let pos = this.cursorPosition;
    // Skip current word
    while (pos < text.length && /\w/.test(text[pos])) pos++;
    // Skip whitespace
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    this.cursorPosition = pos;
  }

  private moveWordBackward(): void {
    const text = this.lineBuffer;
    let pos = this.cursorPosition - 1;
    // Skip whitespace
    while (pos > 0 && /\s/.test(text[pos])) pos--;
    // Skip current word
    while (pos > 0 && /\w/.test(text[pos - 1])) pos--;
    this.cursorPosition = Math.max(0, pos);
  }

  private deleteCharAtCursor(): void {
    if (this.cursorPosition < this.lineBuffer.length) {
      const deleted = this.lineBuffer[this.cursorPosition];
      this.lineBuffer = this.lineBuffer.slice(0, this.cursorPosition) + this.lineBuffer.slice(this.cursorPosition + 1);
      this.setRegister('', deleted, 'char');
    }
  }

  private replaceCharAtCursor(char: string): void {
    if (this.cursorPosition < this.lineBuffer.length) {
      this.lineBuffer = this.lineBuffer.slice(0, this.cursorPosition) + char + this.lineBuffer.slice(this.cursorPosition + 1);
    }
  }

  private deleteWordForward(): void {
    const start = this.cursorPosition;
    const text = this.lineBuffer;
    let end = start;
    while (end < text.length && /\w/.test(text[end])) end++;
    while (end < text.length && /\s/.test(text[end])) end++;
    const deleted = text.slice(start, end);
    this.setRegister('', deleted, 'char');
    this.lineBuffer = text.slice(0, start) + text.slice(end);
  }

  private yankWordForward(): void {
    const start = this.cursorPosition;
    const text = this.lineBuffer;
    let end = start;
    while (end < text.length && /\w/.test(text[end])) end++;
    const yanked = text.slice(start, end);
    this.setRegister('', yanked, 'char');
  }

  private changeWordForward(): void {
    const start = this.cursorPosition;
    const text = this.lineBuffer;
    let end = start;
    while (end < text.length && /\w/.test(text[end])) end++;
    const deleted = text.slice(start, end);
    this.setRegister('', deleted, 'char');
    this.lineBuffer = text.slice(0, start) + text.slice(end);
    this.cursorPosition = start;
  }

  private pasteAfter(): void {
    const reg = this.registers.get('');
    if (!reg) return;
    if (reg.type === 'line') {
      this.lineBuffer += reg.content;
      this.cursorPosition = this.lineBuffer.length;
    } else {
      const pos = this.cursorPosition + 1;
      this.lineBuffer = this.lineBuffer.slice(0, pos) + reg.content + this.lineBuffer.slice(pos);
      this.cursorPosition = pos + reg.content.length;
    }
  }

  private pasteBefore(): void {
    const reg = this.registers.get('');
    if (!reg) return;
    if (reg.type === 'line') {
      this.lineBuffer = reg.content + this.lineBuffer;
      this.cursorPosition = 0;
    } else {
      this.lineBuffer = this.lineBuffer.slice(0, this.cursorPosition) + reg.content + this.lineBuffer.slice(this.cursorPosition);
      this.cursorPosition += reg.content.length;
    }
  }

  private yankVisualSelection(): void {
    const start = Math.min(this.visualStart, this.cursorPosition);
    const end = Math.max(this.visualStart, this.cursorPosition);
    const yanked = this.lineBuffer.slice(start, end);
    this.setRegister('', yanked, 'char');
  }

  private deleteVisualSelection(): void {
    const start = Math.min(this.visualStart, this.cursorPosition);
    const end = Math.max(this.visualStart, this.cursorPosition);
    const deleted = this.lineBuffer.slice(start, end);
    this.setRegister('', deleted, 'char');
    this.lineBuffer = this.lineBuffer.slice(0, start) + this.lineBuffer.slice(end);
    this.cursorPosition = start;
  }

  private handleSetCommand(args: string): void {
    const parts = args.trim().split(/\s+/);
    if (parts.length === 0) return;

    switch (parts[0]) {
      case 'number':
      case 'nu':
        this.config.showModeIndicator = true;
        console.log(chalk.gray('Mode indicator enabled.'));
        break;
      case 'nonumber':
      case 'nonu':
        this.config.showModeIndicator = false;
        console.log(chalk.gray('Mode indicator disabled.'));
        break;
      case 'bell':
        this.config.bellOnError = true;
        console.log(chalk.gray('Bell on error enabled.'));
        break;
      case 'nobell':
        this.config.bellOnError = false;
        console.log(chalk.gray('Bell on error disabled.'));
        break;
      default:
        console.log(chalk.yellow(`Unknown option: ${parts[0]}`));
    }
    this.saveConfig();
  }

  private printCommandHistory(): void {
    console.log('');
    console.log(chalk.bold('--- Command History ---'));
    for (let i = this.commandHistory.length - 1; i >= Math.max(0, this.commandHistory.length - 20); i--) {
      console.log(`  :${this.commandHistory[i]}`);
    }
    if (this.commandHistory.length === 0) {
      console.log(chalk.gray('  (no commands in history)'));
    }
    console.log('');
  }

  private saveConfig(): void {
    try {
      const dir = join(VIM_CONFIG_PATH, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(VIM_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch { /* Silently fail */ }
  }

  private loadConfig(): void {
    try {
      if (existsSync(VIM_CONFIG_PATH)) {
        const raw = readFileSync(VIM_CONFIG_PATH, 'utf-8');
        const saved = JSON.parse(raw) as Partial<VimModeConfig>;
        this.config = { ...this.config, ...saved };
      }
    } catch { /* Silently fail */ }
  }
}
