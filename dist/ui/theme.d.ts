import chalk from 'chalk';
export interface Theme {
    name: string;
    primary: typeof chalk;
    secondary: typeof chalk;
    accent: typeof chalk;
    success: typeof chalk;
    warning: typeof chalk;
    error: typeof chalk;
    muted: typeof chalk;
    dim: typeof chalk;
    bold: typeof chalk;
    user: typeof chalk;
    assistant: typeof chalk;
    system: typeof chalk;
    tool: typeof chalk;
    thinking: typeof chalk;
    code: typeof chalk;
    number: typeof chalk;
    string: typeof chalk;
    keyword: typeof chalk;
    comment: typeof chalk;
    border: typeof chalk;
    diffAdd: typeof chalk;
    diffRemove: typeof chalk;
    diffContext: typeof chalk;
    label: typeof chalk;
    path: typeof chalk;
}
export declare function getTheme(name: string): Theme;
export declare function listThemes(): string[];
//# sourceMappingURL=theme.d.ts.map