export interface HeadlessOptions {
    prompt: string;
    model?: string;
    agent?: string;
    maxTurns?: number;
    allowedTools?: string[];
    deniedTools?: string[];
    outputFormat?: 'text' | 'json' | 'stream-json';
    autoApprove?: boolean;
    workingDirectory?: string;
    continueSession?: string;
}
export interface HeadlessResult {
    content: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    exitCode: number;
    sessionId: string;
    duration: number;
    toolCallsCount: number;
}
export declare class HeadlessMode {
    /**
     * Run a single headless task and return structured result
     */
    static run(options: HeadlessOptions): Promise<HeadlessResult>;
}
//# sourceMappingURL=headless.d.ts.map