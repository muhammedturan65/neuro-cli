import { ToolExecutor } from './registry.js';
export interface BrowserConfig {
    headless: boolean;
    defaultTimeout: number;
    defaultViewport: {
        width: number;
        height: number;
    };
    userAgent?: string;
    blockImages: boolean;
    blockCSS: boolean;
    stealth: boolean;
    proxy?: string;
    cookies?: Record<string, string>;
}
export interface BrowserAction {
    type: 'navigate' | 'click' | 'type' | 'select' | 'wait' | 'evaluate' | 'screenshot' | 'scroll' | 'download';
    target?: string;
    value?: string;
    timestamp: number;
    duration?: number;
    result?: 'success' | 'error';
    error?: string;
}
export interface BrowserSession {
    id: string;
    startedAt: number;
    currentUrl: string;
    title: string;
    statusCode: number;
    viewport: {
        width: number;
        height: number;
    };
    actions: BrowserAction[];
    cookies: Record<string, string>;
    history: string[];
    historyIndex: number;
}
export declare class BrowserTool {
    private config;
    private browserProcess;
    private cdp;
    private sessionId;
    private session;
    private chromePath;
    private debugPort;
    private useCurlFallback;
    private screenshotDir;
    constructor(config?: Partial<BrowserConfig>);
    launch(options?: Partial<BrowserConfig>): Promise<string>;
    close(): Promise<string>;
    navigate(url: string): Promise<string>;
    goBack(): Promise<string>;
    goForward(): Promise<string>;
    screenshot(selector?: string): Promise<string>;
    click(selector: string): Promise<string>;
    type(selector: string, text: string): Promise<string>;
    select(selector: string, value: string): Promise<string>;
    wait(selector: string, timeout?: number): Promise<string>;
    evaluate(script: string): Promise<string>;
    getContent(selector?: string): Promise<string>;
    getLinks(): Promise<string>;
    getForms(): Promise<string>;
    fillForm(selector: string, data: Record<string, string>): Promise<string>;
    download(url: string, outputPath: string): Promise<string>;
    scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<string>;
    getPageInfo(): Promise<string>;
    setViewport(width: number, height: number): Promise<string>;
    emulateDevice(device: string): Promise<string>;
    getSession(): BrowserSession;
    getActionHistory(): BrowserAction[];
    isUsingFallback(): boolean;
    private findChrome;
    private findFreePort;
    private connectCDP;
    private ensureConnected;
    private delay;
    private curlNavigate;
    private curlGetContent;
    private curlGetLinks;
}
export declare const browserNavigateTool: ToolExecutor;
export declare const browserScreenshotTool: ToolExecutor;
export declare const browserClickTool: ToolExecutor;
export declare const browserTypeTool: ToolExecutor;
export declare const browserEvaluateTool: ToolExecutor;
export declare const browserGetContentTool: ToolExecutor;
export declare const browserGetLinksTool: ToolExecutor;
export declare const browserDownloadTool: ToolExecutor;
export declare const browserTools: ToolExecutor[];
//# sourceMappingURL=browser.d.ts.map