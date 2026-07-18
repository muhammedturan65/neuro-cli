export interface DoomLoopConfig {
    maxConsecutiveErrors: number;
    maxRepetitiveActions: number;
    similarityThreshold: number;
    cooldownMs: number;
    autoBreak: boolean;
}
export interface DoomLoopState {
    consecutiveErrors: number;
    lastActions: Array<{
        tool: string;
        args: string;
        result: string;
        timestamp: number;
    }>;
    isPaused: boolean;
    pauseReason?: string;
    totalLoopsDetected: number;
}
export declare class DoomLoopProtection {
    private config;
    private state;
    private onLoopDetected?;
    constructor(config?: Partial<DoomLoopConfig>, onLoopDetected?: (reason: string, state: DoomLoopState) => Promise<boolean>);
    /**
     * Record a tool execution and check for doom loops
     * Returns true if the action should proceed, false if blocked
     */
    recordAction(toolName: string, args: Record<string, unknown>, result: string, isError: boolean): Promise<boolean>;
    /**
     * Reset the state (e.g., after user intervention)
     */
    reset(): void;
    /**
     * Unpause after user intervention
     */
    unpause(): void;
    /**
     * Get current state
     */
    getState(): DoomLoopState;
    /**
     * Check if currently paused
     */
    isPaused(): boolean;
    private handleLoop;
    private countRepetitiveActions;
    private calculateErrorSimilarity;
    private summarizeArgs;
}
//# sourceMappingURL=doom-loop.d.ts.map