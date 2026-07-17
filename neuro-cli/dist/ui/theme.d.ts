import { ChalkInstance } from 'chalk';
export interface Theme {
    name: string;
    primary: ChalkInstance;
    secondary: ChalkInstance;
    accent: ChalkInstance;
    success: ChalkInstance;
    warning: ChalkInstance;
    error: ChalkInstance;
    muted: ChalkInstance;
    dim: ChalkInstance;
    bold: ChalkInstance;
    user: ChalkInstance;
    assistant: ChalkInstance;
    system: ChalkInstance;
    tool: ChalkInstance;
    thinking: ChalkInstance;
    code: ChalkInstance;
    number: ChalkInstance;
    string: ChalkInstance;
    keyword: ChalkInstance;
    comment: ChalkInstance;
    border: ChalkInstance;
}
export declare function getTheme(name: string): Theme;
export declare function listThemes(): string[];
//# sourceMappingURL=theme.d.ts.map