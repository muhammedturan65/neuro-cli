export interface TerminalCapabilities {
    osc52: boolean;
    trueColor: boolean;
    unicode: boolean;
    iterm2: boolean;
    kitty: boolean;
    sixel: boolean;
    title: boolean;
    hyperlinks: boolean;
}
export interface TerminalSize {
    rows: number;
    cols: number;
}
export interface SplitPane {
    id: string;
    label: string;
    content: string[];
    width: number;
    height: number;
    scrollOffset: number;
}
export interface SplitPaneLayout {
    panes: SplitPane[];
    gap: number;
    borderStyle: 'single' | 'double' | 'round' | 'none';
}
export interface ProgressBarOptions {
    total: number;
    current: number;
    width?: number;
    label?: string;
    completeChar?: string;
    incompleteChar?: string;
    showPercent?: boolean;
    showETA?: boolean;
    startTime?: number;
}
export interface SpinnerOptions {
    frames?: string[];
    interval?: number;
    label?: string;
    color?: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta' | 'blue';
}
export declare class TerminalUX {
    private capabilities;
    private spinnerInterval;
    private spinnerActive;
    constructor();
    /**
     * Copy text to the terminal clipboard using the OSC 52 escape sequence.
     * Works in remote SSH sessions when the terminal emulator supports it.
     * Returns true if the sequence was written, false if OSC 52 is unsupported.
     */
    copyToClipboard(text: string): boolean;
    /**
     * Check whether the current terminal supports OSC 52 clipboard operations.
     */
    isOSC52Supported(): boolean;
    /**
     * Launch an interactive TUI command (e.g. vim, top, htop) and capture its
     * exit code and any output. The child process inherits stdio so the user
     * can interact with the TUI directly.
     */
    launchInteractive(command: string, options?: {
        rows?: number;
        cols?: number;
    }): Promise<{
        exitCode: number;
        output: string;
    }>;
    /**
     * Detect whether a command is a known TUI / interactive application.
     */
    isTUIApp(command: string): boolean;
    /**
     * Render a split-pane layout to a string. Each pane has a label and content
     * lines, rendered side-by-side with borders.
     */
    renderSplitPane(layout: SplitPaneLayout): string;
    /**
     * Apply chalk-based syntax highlighting to a code string for the given language.
     * Returns a chalk-colored string suitable for terminal output.
     */
    highlight(code: string, language: string): string;
    /**
     * Highlight a unified diff string with color coding.
     * - Added lines: green
     * - Removed lines: red
     * - Header lines (---, +++, @@): cyan
     * - Context lines: dim gray
     */
    highlightDiff(diff: string): string;
    /**
     * Return detected terminal capabilities.
     */
    getTerminalCapabilities(): TerminalCapabilities;
    /**
     * Return the current terminal dimensions.
     */
    getTerminalSize(): TerminalSize;
    /**
     * Check whether the terminal supports 24-bit true color.
     */
    supportsTrueColor(): boolean;
    /**
     * Check whether the terminal supports Unicode characters (beyond ASCII).
     */
    supportsUnicode(): boolean;
    /**
     * Render a progress bar as a string.
     */
    renderProgressBar(options: ProgressBarOptions): string;
    /**
     * Start a spinner animation on the terminal.
     * Returns a stop function.
     */
    startSpinner(options?: SpinnerOptions): {
        stop: (finalMessage?: string) => void;
    };
    /**
     * Render a multi-step progress indicator (checklist).
     */
    renderStepProgress(steps: Array<{
        label: string;
        status: 'pending' | 'running' | 'done' | 'failed';
    }>): string;
    private detectCapabilities;
    private highlightLine;
    private parseCommand;
    private truncateToWidth;
    private formatDuration;
}
//# sourceMappingURL=terminal-ux.d.ts.map