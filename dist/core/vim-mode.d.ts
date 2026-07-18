import { Interface as ReadLineInterface } from 'readline';
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
export declare class VimModeManager {
    private config;
    private mode;
    private registers;
    private commandBuffer;
    private normalBuffer;
    private visualStart;
    private cursorPosition;
    private lineBuffer;
    private lastAction;
    private repeatCount;
    private commandHistory;
    private commandHistoryIndex;
    private rl;
    private keyHandlerAttached;
    constructor(config?: Partial<VimModeConfig>);
    /**
     * Check if vim mode is enabled
     */
    isEnabled(): boolean;
    /**
     * Enable vim mode
     */
    enable(): void;
    /**
     * Disable vim mode
     */
    disable(): void;
    /**
     * Toggle vim mode
     */
    toggle(): boolean;
    /**
     * Get current mode
     */
    getMode(): VimMode;
    /**
     * Set current mode
     */
    setMode(mode: VimMode): void;
    /**
     * Get mode indicator string for the prompt
     */
    getModeIndicator(): string;
    /**
     * Get the modified prompt with mode indicator
     */
    getModifiedPrompt(basePrompt: string): string;
    /**
     * Attach to a readline interface for key handling
     */
    attachToReadline(rl: ReadLineInterface): void;
    /**
     * Detach from readline interface
     */
    detachFromReadline(): void;
    /**
     * Process a key press and return the action to take
     */
    processKey(key: string): VimKeyAction | null;
    /**
     * Get all yanked text from a register
     */
    getRegister(name: string): string;
    /**
     * Set register content
     */
    setRegister(name: string, content: string, type?: 'line' | 'char' | 'block'): void;
    /**
     * Get current line buffer
     */
    getLineBuffer(): string;
    /**
     * Set current line buffer
     */
    setLineBuffer(buffer: string): void;
    /**
     * Get cursor position
     */
    getCursorPosition(): number;
    /**
     * Set cursor position
     */
    setCursorPosition(pos: number): void;
    /**
     * Execute a vim command (e.g. :w, :q, :set)
     */
    executeCommand(cmd: string): void;
    /**
     * Print vim mode help
     */
    printHelp(): void;
    /**
     * Print register contents
     */
    printRegisters(): void;
    /**
     * Get config
     */
    getConfig(): VimModeConfig;
    private handleEscape;
    private handleNormalKey;
    private handleInsertKey;
    private handleVisualKey;
    private handleCommandKey;
    private moveWordForward;
    private moveWordBackward;
    private deleteCharAtCursor;
    private replaceCharAtCursor;
    private deleteWordForward;
    private yankWordForward;
    private changeWordForward;
    private pasteAfter;
    private pasteBefore;
    private yankVisualSelection;
    private deleteVisualSelection;
    private handleSetCommand;
    private printCommandHistory;
    private saveConfig;
    private loadConfig;
}
//# sourceMappingURL=vim-mode.d.ts.map