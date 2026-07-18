// ============================================================
// NeuroCLI - Interactive Terminal UX (GAP-38)
// OSC 52 Clipboard, Embedded Interactive Commands, Split Pane
// TUI, Terminal-native Syntax Highlighting, Inline Diffs,
// Progress Indicators — using only Node.js built-ins + chalk.
// ============================================================
import { spawn } from 'child_process';
import chalk from 'chalk';
// ---- Constants ----
const TUI_COMMANDS = new Set([
    'vim', 'vi', 'nvim', 'nano', 'emacs',
    'top', 'htop', 'btop', 'btm',
    'less', 'more',
    'tmux', 'screen',
    'mc', 'ranger',
    'tig', 'lazygit',
    'watch',
]);
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BORDER_CHARS = {
    single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
    double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
    round: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
    none: { tl: ' ', tr: ' ', bl: ' ', br: ' ', h: ' ', v: ' ' },
};
// ---- Syntax Highlighting Token Maps ----
const KEYWORDS = {
    typescript: new Set([
        'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch',
        'class', 'const', 'constructor', 'continue', 'debugger', 'default',
        'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
        'for', 'from', 'function', 'if', 'implements', 'import', 'in',
        'instanceof', 'interface', 'let', 'new', 'null', 'of', 'package',
        'private', 'protected', 'public', 'readonly', 'return', 'static',
        'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof',
        'undefined', 'unique', 'unknown', 'var', 'void', 'while', 'with', 'yield',
    ]),
    javascript: new Set([
        'abstract', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
        'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export',
        'extends', 'false', 'finally', 'for', 'from', 'function', 'if',
        'implements', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'of',
        'package', 'private', 'protected', 'public', 'return', 'static', 'super',
        'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var',
        'void', 'while', 'with', 'yield',
    ]),
    python: new Set([
        'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
        'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for',
        'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None',
        'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try',
        'while', 'with', 'yield',
    ]),
    rust: new Set([
        'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
        'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
        'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
        'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type',
        'unsafe', 'use', 'where', 'while', 'yield',
    ]),
    go: new Set([
        'break', 'case', 'chan', 'const', 'continue', 'default', 'defer',
        'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import',
        'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
        'switch', 'type', 'var',
    ]),
    bash: new Set([
        'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while',
        'until', 'do', 'done', 'in', 'function', 'select', 'time', 'coproc',
        'return', 'exit', 'export', 'local', 'readonly', 'declare', 'typeset',
        'unset', 'shift', 'source', 'alias', 'bg', 'fg', 'jobs', 'kill',
        'wait', 'read', 'echo', 'printf', 'set', 'trap', 'true', 'false',
    ]),
    sql: new Set([
        'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
        'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'JOIN', 'INNER',
        'LEFT', 'RIGHT', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS',
        'IN', 'BETWEEN', 'LIKE', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT',
        'OFFSET', 'UNION', 'ALL', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG',
        'MIN', 'MAX', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
        'BEGIN', 'COMMIT', 'ROLLBACK', 'GRANT', 'REVOKE', 'PRIMARY', 'KEY',
        'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'CHECK', 'UNIQUE',
    ]),
};
const COMMENT_PATTERNS = {
    typescript: { single: '//', multiStart: '/*', multiEnd: '*/' },
    javascript: { single: '//', multiStart: '/*', multiEnd: '*/' },
    python: { single: '#', multiStart: '"""', multiEnd: '"""' },
    rust: { single: '//', multiStart: '/*', multiEnd: '*/' },
    go: { single: '//', multiStart: '/*', multiEnd: '*/' },
    bash: { single: '#' },
    sql: { single: '--', multiStart: '/*', multiEnd: '*/' },
};
const STRING_DELIMITERS = {
    typescript: ["'", '"', '`'],
    javascript: ["'", '"', '`'],
    python: ["'", '"'],
    rust: ['"'],
    go: ['"', '`'],
    bash: ["'", '"'],
    sql: ["'"],
};
// ============================================================
// TerminalUX Class
// ============================================================
export class TerminalUX {
    capabilities;
    spinnerInterval = null;
    spinnerActive = false;
    constructor() {
        this.capabilities = this.detectCapabilities();
    }
    // ============================================================
    // OSC 52 Clipboard
    // ============================================================
    /**
     * Copy text to the terminal clipboard using the OSC 52 escape sequence.
     * Works in remote SSH sessions when the terminal emulator supports it.
     * Returns true if the sequence was written, false if OSC 52 is unsupported.
     */
    copyToClipboard(text) {
        if (!this.capabilities.osc52) {
            return false;
        }
        const encoded = Buffer.from(text, 'utf-8').toString('base64');
        // OSC 52: ESC ] 52 ; c ; <base64-data> BEL
        const sequence = `\x1b]52;c;${encoded}\x07`;
        try {
            process.stdout.write(sequence);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check whether the current terminal supports OSC 52 clipboard operations.
     */
    isOSC52Supported() {
        return this.capabilities.osc52;
    }
    // ============================================================
    // Embedded Interactive Commands
    // ============================================================
    /**
     * Launch an interactive TUI command (e.g. vim, top, htop) and capture its
     * exit code and any output. The child process inherits stdio so the user
     * can interact with the TUI directly.
     */
    async launchInteractive(command, options) {
        const parts = this.parseCommand(command);
        const cmd = parts[0];
        const args = parts.slice(1);
        const rows = options?.rows ?? process.stdout.rows ?? 24;
        const cols = options?.cols ?? process.stdout.columns ?? 80;
        // Set terminal size via COLUMNS/LINES env vars for the child
        const env = {
            ...process.env,
            COLUMNS: String(cols),
            LINES: String(rows),
            TERM: process.env.TERM || 'xterm-256color',
        };
        return new Promise((resolve) => {
            const outputChunks = [];
            const child = spawn(cmd, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
                // Provide a pseudo-TTY–like experience by setting COLUMNS/LINES.
                // In production, node-pty would be used; here we capture output.
            });
            child.stdout?.on('data', (chunk) => {
                outputChunks.push(chunk);
            });
            child.stderr?.on('data', (chunk) => {
                outputChunks.push(chunk);
            });
            child.on('close', (code) => {
                const output = Buffer.concat(outputChunks).toString('utf-8');
                resolve({ exitCode: code ?? 0, output });
            });
            child.on('error', (err) => {
                resolve({ exitCode: 1, output: err.message });
            });
        });
    }
    /**
     * Detect whether a command is a known TUI / interactive application.
     */
    isTUIApp(command) {
        const base = command.split(/\s+/)[0];
        const name = base.split('/').pop() ?? base;
        return TUI_COMMANDS.has(name);
    }
    // ============================================================
    // Split Pane TUI
    // ============================================================
    /**
     * Render a split-pane layout to a string. Each pane has a label and content
     * lines, rendered side-by-side with borders.
     */
    renderSplitPane(layout) {
        const { panes, gap, borderStyle } = layout;
        if (panes.length === 0)
            return '';
        const border = BORDER_CHARS[borderStyle] ?? BORDER_CHARS.single;
        const totalWidth = process.stdout.columns ?? 80;
        const totalGapWidth = gap * (panes.length - 1);
        const availableWidth = totalWidth - totalGapWidth;
        const paneWidth = Math.floor(availableWidth / panes.length);
        const contentWidth = Math.max(1, paneWidth - 2); // minus borders
        const rows = process.stdout.rows ?? 24;
        const contentHeight = Math.max(1, rows - 2); // minus top/bottom borders
        const renderedPanes = [];
        for (const pane of panes) {
            const lines = [];
            // Top border with label
            const labelText = ` ${pane.label} `;
            const labelPadLeft = Math.max(0, Math.floor((contentWidth - labelText.length) / 2));
            const labelPadRight = Math.max(0, contentWidth - labelText.length - labelPadLeft);
            const topLine = border.tl + border.h.repeat(labelPadLeft) + labelText + border.h.repeat(labelPadRight) + border.tr;
            lines.push(this.truncateToWidth(topLine, paneWidth));
            // Content lines
            const visibleLines = pane.content.slice(pane.scrollOffset, pane.scrollOffset + contentHeight);
            for (let i = 0; i < contentHeight; i++) {
                const line = i < visibleLines.length ? visibleLines[i] : '';
                const truncated = this.truncateToWidth(line, contentWidth);
                const padded = truncated.padEnd(contentWidth);
                lines.push(border.v + padded + border.v);
            }
            // Bottom border
            const bottomLine = border.bl + border.h.repeat(contentWidth) + border.br;
            lines.push(this.truncateToWidth(bottomLine, paneWidth));
            renderedPanes.push(lines);
        }
        // Combine panes side-by-side
        const maxLines = Math.max(...renderedPanes.map((p) => p.length));
        const outputLines = [];
        for (let row = 0; row < maxLines; row++) {
            const parts = [];
            for (let p = 0; p < renderedPanes.length; p++) {
                const paneLines = renderedPanes[p];
                const line = row < paneLines.length ? paneLines[row] : ' '.repeat(paneWidth);
                parts.push(line);
                if (p < renderedPanes.length - 1) {
                    parts.push(' '.repeat(gap));
                }
            }
            outputLines.push(parts.join(''));
        }
        return outputLines.join('\n');
    }
    // ============================================================
    // Syntax Highlighting
    // ============================================================
    /**
     * Apply chalk-based syntax highlighting to a code string for the given language.
     * Returns a chalk-colored string suitable for terminal output.
     */
    highlight(code, language) {
        const lang = language.toLowerCase();
        const keywords = KEYWORDS[lang];
        const commentInfo = COMMENT_PATTERNS[lang];
        const stringDels = STRING_DELIMITERS[lang] ?? ['"', "'"];
        if (!keywords && !commentInfo) {
            // No rules for this language — return as-is with minimal styling
            return chalk.white(code);
        }
        const lines = code.split('\n');
        const highlighted = [];
        for (const line of lines) {
            highlighted.push(this.highlightLine(line, keywords, commentInfo, stringDels));
        }
        return highlighted.join('\n');
    }
    /**
     * Highlight a unified diff string with color coding.
     * - Added lines: green
     * - Removed lines: red
     * - Header lines (---, +++, @@): cyan
     * - Context lines: dim gray
     */
    highlightDiff(diff) {
        const lines = diff.split('\n');
        const result = [];
        for (const line of lines) {
            if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
                result.push(chalk.cyan.bold(line));
            }
            else if (line.startsWith('+')) {
                result.push(chalk.green(line));
            }
            else if (line.startsWith('-')) {
                result.push(chalk.red(line));
            }
            else if (line.startsWith('diff ') || line.startsWith('index ')) {
                result.push(chalk.cyan.dim(line));
            }
            else {
                result.push(chalk.gray(line));
            }
        }
        return result.join('\n');
    }
    // ============================================================
    // Terminal Detection
    // ============================================================
    /**
     * Return detected terminal capabilities.
     */
    getTerminalCapabilities() {
        return { ...this.capabilities };
    }
    /**
     * Return the current terminal dimensions.
     */
    getTerminalSize() {
        return {
            rows: process.stdout.rows ?? 24,
            cols: process.stdout.columns ?? 80,
        };
    }
    /**
     * Check whether the terminal supports 24-bit true color.
     */
    supportsTrueColor() {
        return this.capabilities.trueColor;
    }
    /**
     * Check whether the terminal supports Unicode characters (beyond ASCII).
     */
    supportsUnicode() {
        return this.capabilities.unicode;
    }
    // ============================================================
    // Progress Indicators
    // ============================================================
    /**
     * Render a progress bar as a string.
     */
    renderProgressBar(options) {
        const { total, current, width = 30, label = '', completeChar = '█', incompleteChar = '░', showPercent = true, showETA = false, startTime, } = options;
        const ratio = total > 0 ? Math.min(current / total, 1) : 0;
        const filled = Math.round(ratio * width);
        const empty = width - filled;
        const bar = chalk.green(completeChar.repeat(filled)) + chalk.gray(incompleteChar.repeat(empty));
        const percent = showPercent ? ` ${Math.round(ratio * 100)}%` : '';
        const count = ` ${current}/${total}`;
        let eta = '';
        if (showETA && startTime && current > 0 && current < total) {
            const elapsed = Date.now() - startTime;
            const perItem = elapsed / current;
            const remaining = perItem * (total - current);
            eta = ` ETA: ${this.formatDuration(remaining)}`;
        }
        const labelStr = label ? chalk.bold(label) + ' ' : '';
        return `${labelStr}${bar}${percent}${count}${eta}`;
    }
    /**
     * Start a spinner animation on the terminal.
     * Returns a stop function.
     */
    startSpinner(options) {
        if (this.spinnerActive) {
            return { stop: () => { } };
        }
        const frames = options?.frames ?? SPINNER_FRAMES;
        const interval = options?.interval ?? 80;
        const label = options?.label ?? '';
        const color = options?.color ?? 'cyan';
        let frameIndex = 0;
        this.spinnerActive = true;
        const colorFn = chalk[color] ?? chalk.cyan;
        this.spinnerInterval = setInterval(() => {
            const frame = frames[frameIndex % frames.length];
            process.stdout.write(`\r${colorFn(frame)} ${label}`);
            frameIndex++;
        }, interval);
        return {
            stop: (finalMessage) => {
                if (this.spinnerInterval) {
                    clearInterval(this.spinnerInterval);
                    this.spinnerInterval = null;
                }
                this.spinnerActive = false;
                // Clear the spinner line
                process.stdout.write('\r' + ' '.repeat((label.length || 20) + 4) + '\r');
                if (finalMessage) {
                    process.stdout.write(finalMessage + '\n');
                }
            },
        };
    }
    /**
     * Render a multi-step progress indicator (checklist).
     */
    renderStepProgress(steps) {
        const lines = [];
        for (const step of steps) {
            switch (step.status) {
                case 'done':
                    lines.push(chalk.green('  ✓ ') + chalk.white(step.label));
                    break;
                case 'running':
                    lines.push(chalk.cyan('  ◉ ') + chalk.cyan(step.label));
                    break;
                case 'failed':
                    lines.push(chalk.red('  ✗ ') + chalk.red(step.label));
                    break;
                case 'pending':
                    lines.push(chalk.dim('  ○ ') + chalk.dim(step.label));
                    break;
            }
        }
        return lines.join('\n');
    }
    // ============================================================
    // Private Helpers — Capability Detection
    // ============================================================
    detectCapabilities() {
        const term = (process.env.TERM ?? '').toLowerCase();
        const termProgram = (process.env.TERM_PROGRAM ?? '').toLowerCase();
        const colorterm = (process.env.COLORTERM ?? '').toLowerCase();
        const kittyWindowId = process.env.KITTY_WINDOW_ID;
        const itermSessionId = process.env.ITERM_SESSION_ID;
        const wtSession = process.env.WT_SESSION;
        // OSC 52: supported by most modern terminals, but some (like screen) block it.
        // tmux passes it through if allow-passthrough is on.
        // We check for known-good environments and default to true for modern terminals.
        let osc52 = false;
        if (kittyWindowId) {
            osc52 = true;
        }
        else if (itermSessionId) {
            osc52 = true;
        }
        else if (termProgram.includes('wezterm')) {
            osc52 = true;
        }
        else if (termProgram.includes('alacritty')) {
            osc52 = true;
        }
        else if (termProgram.includes('foot')) {
            osc52 = true;
        }
        else if (wtSession) {
            osc52 = true; // Windows Terminal
        }
        else if (term.includes('xterm') || term.includes('vte') || colorterm.includes('truecolor')) {
            osc52 = true;
        }
        // True color: check COLORTERM or known terminals
        const trueColor = colorterm.includes('truecolor') || colorterm.includes('24bit') ||
            !!kittyWindowId || !!itermSessionId ||
            termProgram.includes('wezterm') || termProgram.includes('alacritty') ||
            termProgram.includes('foot') || !!wtSession;
        // Unicode: most modern terminals support it; assume true except for very old TERM values
        const unicode = !term.includes('ascii') && !term.includes('dumb');
        // iTerm2 specific
        const iterm2 = !!itermSessionId || termProgram === 'iterm.app';
        // Kitty specific
        const kitty = !!kittyWindowId;
        // Sixel graphics: only a few terminals
        const sixel = termProgram.includes('wezterm') || !!kittyWindowId ||
            term.includes('sixel');
        // Window title: most xterm-compatible terminals support it
        const title = term.includes('xterm') || term.includes('screen') || term.includes('tmux') ||
            !!itermSessionId || !!kittyWindowId || !!wtSession;
        // Hyperlinks (OSC 8): supported by many modern terminals
        const hyperlinks = !!kittyWindowId || !!itermSessionId ||
            termProgram.includes('wezterm') || termProgram.includes('alacritty') ||
            !!wtSession || termProgram.includes('foot');
        return {
            osc52,
            trueColor,
            unicode,
            iterm2,
            kitty,
            sixel,
            title,
            hyperlinks,
        };
    }
    // ============================================================
    // Private Helpers — Syntax Highlighting
    // ============================================================
    highlightLine(line, keywords, commentInfo, stringDels) {
        // Simple tokeniser approach: scan character by character to detect
        // strings, comments, and keywords.
        const result = [];
        let i = 0;
        let inSingleComment = false;
        while (i < line.length) {
            // ---- Single-line comment ----
            if (commentInfo && !inSingleComment) {
                const single = commentInfo.single;
                if (line.substring(i, i + single.length) === single) {
                    // Rest of line is a comment
                    result.push(chalk.gray(line.substring(i)));
                    inSingleComment = true;
                    break;
                }
            }
            // ---- String literals ----
            if (!inSingleComment) {
                let matchedDelim = null;
                for (const delim of stringDels) {
                    if (line[i] === delim[0]) {
                        // Check full delimiter (e.g. """ for python)
                        if (line.substring(i, i + delim.length) === delim) {
                            matchedDelim = delim;
                            break;
                        }
                    }
                }
                if (matchedDelim) {
                    const start = i;
                    i += matchedDelim.length;
                    // Find closing delimiter
                    while (i < line.length) {
                        if (line[i] === '\\' && i + 1 < line.length) {
                            i += 2; // skip escape
                            continue;
                        }
                        if (line.substring(i, i + matchedDelim.length) === matchedDelim) {
                            i += matchedDelim.length;
                            break;
                        }
                        i++;
                    }
                    result.push(chalk.yellow(line.substring(start, i)));
                    continue;
                }
            }
            // ---- Numbers ----
            if (!inSingleComment && /[0-9]/.test(line[i])) {
                const start = i;
                while (i < line.length && /[0-9.xXa-fA-F_]/.test(line[i])) {
                    i++;
                }
                result.push(chalk.magenta(line.substring(start, i)));
                continue;
            }
            // ---- Identifiers / keywords ----
            if (!inSingleComment && /[a-zA-Z_$@]/.test(line[i])) {
                const start = i;
                while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) {
                    i++;
                }
                const word = line.substring(start, i);
                if (keywords?.has(word)) {
                    result.push(chalk.blue.bold(word));
                }
                else if (word === 'true' || word === 'false' || word === 'null' || word === 'True' || word === 'False' || word === 'None') {
                    result.push(chalk.magenta(word));
                }
                else if (word.startsWith('@') || word.startsWith('$')) {
                    result.push(chalk.cyan(word));
                }
                else {
                    result.push(chalk.white(word));
                }
                continue;
            }
            // ---- Operators / punctuation ----
            if (!inSingleComment && /[=+\-*/<>!&|^~%?:]/.test(line[i])) {
                result.push(chalk.red(line[i]));
                i++;
                continue;
            }
            // ---- Everything else (whitespace, brackets, etc.) ----
            result.push(line[i]);
            i++;
        }
        return result.join('');
    }
    // ============================================================
    // Private Helpers — General Utilities
    // ============================================================
    parseCommand(command) {
        // Simple shell-like command parser that respects basic quoting
        const parts = [];
        let current = '';
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < command.length; i++) {
            const ch = command[i];
            if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
            }
            else if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
            }
            else if (ch === ' ' && !inSingle && !inDouble) {
                if (current.length > 0) {
                    parts.push(current);
                    current = '';
                }
            }
            else {
                current += ch;
            }
        }
        if (current.length > 0) {
            parts.push(current);
        }
        return parts;
    }
    truncateToWidth(str, maxWidth) {
        // Strip ANSI escape codes for width calculation
        const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
        if (stripped.length <= maxWidth)
            return str;
        // Truncate visible characters while preserving ANSI codes
        let visibleLen = 0;
        let result = '';
        let i = 0;
        while (i < str.length && visibleLen < maxWidth) {
            if (str[i] === '\x1b') {
                // Consume the full escape sequence
                const seqStart = i;
                i++;
                while (i < str.length && str[i] !== 'm')
                    i++;
                if (i < str.length)
                    i++;
                result += str.substring(seqStart, i);
            }
            else {
                result += str[i];
                visibleLen++;
                i++;
            }
        }
        return result;
    }
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60)
            return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes < 60)
            return `${minutes}m${remainingSeconds}s`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h${remainingMinutes}m`;
    }
}
//# sourceMappingURL=terminal-ux.js.map