// ============================================================
// NeuroCLI - Terminal UI Theme
// Beautiful color themes for the terminal
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
}

const themes: Record<string, Theme> = {
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
  },
  dark: {
    name: 'dark',
    primary: chalk.blue,
    secondary: chalk.gray,
    accent: chalk.cyan,
    success: chalk.green,
    warning: chalk.yellow,
    error: chalk.red,
    muted: chalk.gray,
    dim: chalk.dim,
    bold: chalk.bold.white,
    user: chalk.cyan,
    assistant: chalk.white,
    system: chalk.gray,
    tool: chalk.yellow,
    thinking: chalk.gray.italic,
    code: chalk.green,
    number: chalk.magenta,
    string: chalk.green,
    keyword: chalk.blue,
    comment: chalk.gray.italic,
    border: chalk.dim,
  },
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
  },
  light: {
    name: 'light',
    primary: chalk.blue,
    secondary: chalk.gray,
    accent: chalk.cyan,
    success: chalk.green,
    warning: chalk.yellow,
    error: chalk.red,
    muted: chalk.gray,
    dim: chalk.dim,
    bold: chalk.bold.black,
    user: chalk.blue,
    assistant: chalk.black,
    system: chalk.gray,
    tool: chalk.yellow,
    thinking: chalk.gray.italic,
    code: chalk.green,
    number: chalk.magenta,
    string: chalk.green,
    keyword: chalk.blue,
    comment: chalk.gray.italic,
    border: chalk.gray,
  },
};

export function getTheme(name: string): Theme {
  return themes[name] || themes.dracula;
}

export function listThemes(): string[] {
  return Object.keys(themes);
}
