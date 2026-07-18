import ora from 'ora';
import { MCPClient } from './client.js';
export interface MCPStyle {
    width?: string;
    height?: string;
    theme?: 'light' | 'dark';
    accent?: string;
}
export interface MCPAction {
    id: string;
    label: string;
    type: 'submit' | 'cancel' | 'navigate' | 'tool-call';
    toolCall?: {
        tool: string;
        args: Record<string, any>;
    };
}
export interface MCPAppComponent {
    type: 'form' | 'table' | 'chart' | 'button-group' | 'progress' | 'diff' | 'custom';
    id: string;
    title?: string;
    data: any;
    actions?: MCPAction[];
    style?: MCPStyle;
}
export interface MCPAppResult {
    text: string;
    components: MCPAppComponent[];
    metadata?: Record<string, any>;
}
export interface AppInfo {
    serverName: string;
    toolName: string;
    description: string;
    componentTypes: string[];
    hasActions: boolean;
}
export type ComponentRenderer = (component: MCPAppComponent, theme: MCPStyle) => Promise<string>;
export declare class MCPAppManager {
    private mcpClient;
    private renderers;
    private stateStore;
    private knownApps;
    private currentStyle;
    constructor(mcpClient: MCPClient);
    registerComponentType(type: string, renderer: ComponentRenderer): void;
    private registerBuiltinRenderers;
    setStyle(style: MCPStyle): void;
    getStyle(): MCPStyle;
    renderComponent(component: MCPAppComponent): Promise<string>;
    renderAppResult(appResult: MCPAppResult): Promise<string>;
    handleAction(action: MCPAction): Promise<MCPAppResult>;
    parseAppResult(rawResult: any): MCPAppResult;
    private parseComponent;
    private parseAction;
    listAvailableApps(): Promise<AppInfo[]>;
    private detectAppCapability;
    private detectComponentTypes;
    private detectActions;
    renderInteractivePrompt(component: MCPAppComponent): Promise<MCPAction | null>;
    createProgressSpinner(component: MCPAppComponent): ReturnType<typeof ora>;
    updateProgressSpinner(spinner: ReturnType<typeof ora>, component: MCPAppComponent): Promise<void>;
    getComponentState(componentId: string): Map<string, any>;
    setComponentState(componentId: string, key: string, value: any): void;
    clearComponentState(componentId: string): void;
    clearAllState(): void;
    executeApp(serverName: string, toolName: string, args: Record<string, any>): Promise<string>;
    executeAppInteractive(serverName: string, toolName: string, args: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=mcp-apps.d.ts.map