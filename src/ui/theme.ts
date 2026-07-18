// ============================================================
// NeuroCLI - Terminal UI Theme
// Inspired by Claude Code's minimal, professional aesthetic
// Clean color palettes with warm accent tones
// ============================================================

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
  // Extended for Claude Code-style
  diffAdd: typeof chalk;
  diffRemove: typeof chalk;
  diffContext: typeof chalk;
  label: typeof chalk;
  path: typeof chalk;
}

const themes: Record<string, Theme> = {
  // Claude Code-inspired warm minimal theme (default)
  claude: {
    name: 'claude',
    primary: chalk.hex('#e5e5e5'),
    secondary: chalk.hex('#888888'),
    accent: chalk.hex('#d97706'),       // amber-600 (Claude's signature warm orange)
    success: chalk.hex('#22c55e'),
    warning: chalk.hex('#eab308'),
    error: chalk.hex('#ef4444'),
    muted: chalk.hex('#737373'),
    dim: chalk.hex('#525252'),
    bold: chalk.bold.hex('#fafafa'),
    user: chalk.hex('#d97706'),         // amber for user input
    assistant: chalk.hex('#e5e5e5'),    // clean white for assistant
    system: chalk.hex('#737373'),
    tool: chalk.hex('#60a5fa'),         // blue-400 for tool indicators
    thinking: chalk.hex('#737373').italic,
    code: chalk.hex('#a3e635'),         // lime for code
    number: chalk.hex('#c084fc'),       // purple for numbers
    string: chalk.hex('#86efac'),       // green for strings
    keyword: chalk.hex('#f472b6'),      // pink for keywords
    comment: chalk.hex('#737373').italic,
    border: chalk.hex('#404040'),
    diffAdd: chalk.hex('#4ade80'),
    diffRemove: chalk.hex('#f87171'),
    diffContext: chalk.hex('#737373'),
    label: chalk.hex('#a3a3a3'),
    path: chalk.hex('#93c5fd'),
  },
  // Retained dracula theme (classic)
  dracula: {
    name: 'dracula',
    primary: chalk.hex('#bd93f9'),
    secondary: chalk.hex('#6272a4'),
    accent: chalk.hex('#ff79c6'),
    success: chalk.hex('#50fa7b'),
    warning: chalk.hex('#f1fa8c'),
    error: chalk.hex('#ff5555'),
    muted: chalk.hex('#6272a4'),
    dim: chalk.hex('#44475a'),
    bold: chalk.bold.hex('#f8f8f2'),
    user: chalk.hex('#8be9fd'),
    assistant: chalk.hex('#f8f8f2'),
    system: chalk.hex('#6272a4'),
    tool: chalk.hex('#ffb86c'),
    thinking: chalk.hex('#6272a4').italic,
    code: chalk.hex('#f1fa8c'),
    number: chalk.hex('#bd93f9'),
    string: chalk.hex('#f1fa8c'),
    keyword: chalk.hex('#ff79c6'),
    comment: chalk.hex('#6272a4').italic,
    border: chalk.hex('#44475a'),
    diffAdd: chalk.hex('#50fa7b'),
    diffRemove: chalk.hex('#ff5555'),
    diffContext: chalk.hex('#6272a4'),
    label: chalk.hex('#6272a4'),
    path: chalk.hex('#8be9fd'),
  },
  // Retained nord theme
  nord: {
    name: 'nord',
    primary: chalk.hex('#88c0d0'),
    secondary: chalk.hex('#4c566a'),
    accent: chalk.hex('#81a1c1'),
    success: chalk.hex('#a3be8c'),
    warning: chalk.hex('#ebcb8b'),
    error: chalk.hex('#bf616a'),
    muted: chalk.hex('#4c566a'),
    dim: chalk.hex('#3b4252'),
    bold: chalk.bold.hex('#eceff4'),
    user: chalk.hex('#88c0d0'),
    assistant: chalk.hex('#eceff4'),
    system: chalk.hex('#4c566a'),
    tool: chalk.hex('#ebcb8b'),
    thinking: chalk.hex('#4c566a').italic,
    code: chalk.hex('#a3be8c'),
    number: chalk.hex('#b48ead'),
    string: chalk.hex('#a3be8c'),
    keyword: chalk.hex('#81a1c1'),
    comment: chalk.hex('#4c566a').italic,
    border: chalk.hex('#3b4252'),
    diffAdd: chalk.hex('#a3be8c'),
    diffRemove: chalk.hex('#bf616a'),
    diffContext: chalk.hex('#4c566a'),
    label: chalk.hex('#4c566a'),
    path: chalk.hex('#88c0d0'),
  },
  // Dark minimal (Claude Code variant - cooler tones)
  dark: {
    name: 'dark',
    primary: chalk.hex('#d4d4d4'),
    secondary: chalk.hex('#737373'),
    accent: chalk.hex('#3b82f6'),       // blue accent for dark
    success: chalk.hex('#22c55e'),
    warning: chalk.hex('#eab308'),
    error: chalk.hex('#ef4444'),
    muted: chalk.hex('#737373'),
    dim: chalk.hex('#525252'),
    bold: chalk.bold.hex('#fafafa'),
    user: chalk.hex('#3b82f6'),
    assistant: chalk.hex('#d4d4d4'),
    system: chalk.hex('#737373'),
    tool: chalk.hex('#a78bfa'),
    thinking: chalk.hex('#737373').italic,
    code: chalk.hex('#4ade80'),
    number: chalk.hex('#c084fc'),
    string: chalk.hex('#86efac'),
    keyword: chalk.hex('#f472b6'),
    comment: chalk.hex('#737373').italic,
    border: chalk.hex('#404040'),
    diffAdd: chalk.hex('#4ade80'),
    diffRemove: chalk.hex('#f87171'),
    diffContext: chalk.hex('#737373'),
    label: chalk.hex('#a3a3a3'),
    path: chalk.hex('#93c5fd'),
  },
  // Light theme
  light: {
    name: 'light',
    primary: chalk.hex('#171717'),
    secondary: chalk.hex('#737373'),
    accent: chalk.hex('#d97706'),
    success: chalk.hex('#16a34a'),
    warning: chalk.hex('#ca8a04'),
    error: chalk.hex('#dc2626'),
    muted: chalk.hex('#737373'),
    dim: chalk.hex('#a3a3a3'),
    bold: chalk.bold.hex('#0a0a0a'),
    user: chalk.hex('#d97706'),
    assistant: chalk.hex('#171717'),
    system: chalk.hex('#737373'),
    tool: chalk.hex('#2563eb'),
    thinking: chalk.hex('#737373').italic,
    code: chalk.hex('#16a34a'),
    number: chalk.hex('#9333ea'),
    string: chalk.hex('#16a34a'),
    keyword: chalk.hex('#db2777'),
    comment: chalk.hex('#737373').italic,
    border: chalk.hex('#d4d4d4'),
    diffAdd: chalk.hex('#16a34a'),
    diffRemove: chalk.hex('#dc2626'),
    diffContext: chalk.hex('#737373'),
    label: chalk.hex('#525252'),
    path: chalk.hex('#2563eb'),
  },
};

export function getTheme(name: string): Theme {
  return themes[name] || themes.claude;
}

export function listThemes(): string[] {
  return Object.keys(themes);
}
