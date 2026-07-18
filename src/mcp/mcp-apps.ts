// ============================================================
// NeuroCLI - MCP Apps: Interactive Tool UI Extensions
// GAP-32: Allow MCP tools to return interactive HTML/JS
// UI components, rendered as rich terminal output in CLI.
// ============================================================

import chalk from 'chalk';
// @ts-ignore
import ora from 'ora';
import { MCPClient } from './client.js';

// ---- MCP App Type Definitions ----

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

// ---- Component Renderer Interface ----

export type ComponentRenderer = (component: MCPAppComponent, theme: MCPStyle) => Promise<string>;

// ---- Form Field Types ----

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'toggle' | 'password';
  placeholder?: string;
  default?: any;
  options?: Array<{ label: string; value: any }>;
  required?: boolean;
  validation?: string;
}

// ---- Table Data Types ----

interface TableData {
  headers: string[];
  rows: Array<Record<string, any>>;
  colWidths?: number[];
  colAlign?: Array<'left' | 'center' | 'right'>;
  showRowNumbers?: boolean;
}

// ---- Chart Data Types ----

interface ChartData {
  chartType: 'bar' | 'horizontal-bar' | 'sparkline' | 'pie';
  labels: string[];
  values: number[];
  maxValue?: number;
  unit?: string;
  showValues?: boolean;
}

// ---- Progress Data Types ----

interface ProgressData {
  percent: number;
  current?: number;
  total?: number;
  label?: string;
  status?: 'active' | 'succeeded' | 'failed' | 'paused' | 'indeterminate';
  showSpinner?: boolean;
  eta?: string;
}

// ---- Diff Data Types ----

interface DiffData {
  fileName: string;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
  }>;
  additions: number;
  deletions: number;
  isBinary?: boolean;
}

// ---- Button Group Data Types ----

interface ButtonGroupData {
  buttons: Array<{
    id: string;
    label: string;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    icon?: string;
    disabled?: boolean;
  }>;
  layout?: 'horizontal' | 'vertical';
  description?: string;
}

// ---- State Store for Components ----

class ComponentStateStore {
  private states: Map<string, Map<string, any>> = new Map();

  getState(componentId: string): Map<string, any> {
    if (!this.states.has(componentId)) {
      this.states.set(componentId, new Map());
    }
    return this.states.get(componentId)!;
  }

  setState(componentId: string, key: string, value: any): void {
    const state = this.getState(componentId);
    state.set(key, value);
  }

  clearState(componentId: string): void {
    this.states.delete(componentId);
  }

  clearAll(): void {
    this.states.clear();
  }

  hasState(componentId: string): boolean {
    return this.states.has(componentId);
  }
}

// ============================================================
// Terminal Renderers
// ============================================================

// ---- Form Renderer ----

async function renderForm(component: MCPAppComponent, style: MCPStyle): Promise<string> {
  const fields: FormField[] = Array.isArray(component.data?.fields)
    ? component.data.fields
    : [];
  const lines: string[] = [];

  if (component.title) {
    lines.push(chalk.bold.cyan(`  ${component.title}`));
    lines.push(chalk.dim('  ' + '─'.repeat(Math.min(component.title.length + 2, 50))));
  }

  if (fields.length === 0) {
    lines.push(chalk.dim('  (empty form)'));
    return lines.join('\n');
  }

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const num = chalk.cyan(`  ${i + 1}.`);
    const required = field.required ? chalk.red(' *') : '';
    const label = chalk.white(`${field.label}${required}`);

    lines.push(`${num} ${label}`);

    if (field.type === 'select' && field.options) {
      for (const opt of field.options) {
        const marker = field.default === opt.value ? chalk.green(' ◉') : chalk.dim(' ○');
        lines.push(`     ${marker} ${chalk.gray(opt.label)}${field.default === opt.value ? chalk.green(' (default)') : ''}`);
      }
    } else if (field.type === 'checkbox' && field.options) {
      const defaults: any[] = Array.isArray(field.default) ? field.default : (field.default ? [field.default] : []);
      for (const opt of field.options) {
        const checked = defaults.includes(opt.value);
        const marker = checked ? chalk.green(' ☑') : chalk.dim(' ☐');
        lines.push(`     ${marker} ${chalk.gray(opt.label)}`);
      }
    } else if (field.type === 'toggle') {
      const val = field.default ?? false;
      lines.push(`     ${val ? chalk.green('● ON') : chalk.red('● OFF')}`);
    } else {
      const displayDefault = field.default !== undefined
        ? chalk.gray(` [${String(field.default)}]`)
        : '';
      const placeholder = field.placeholder
        ? chalk.dim(` (${field.placeholder})`)
        : '';
      lines.push(`     ${chalk.gray(field.type)}${displayDefault}${placeholder}`);
    }

    if (field.validation) {
      lines.push(`     ${chalk.dim(`validation: ${field.validation}`)}`);
    }
  }

  if (component.actions && component.actions.length > 0) {
    lines.push('');
    lines.push(chalk.dim('  Actions:'));
    for (const action of component.actions) {
      const icon = action.type === 'submit' ? '↵' : action.type === 'cancel' ? '✕' : '→';
      lines.push(`    ${chalk.yellow(icon)} ${chalk.white(action.label)} ${chalk.dim(`[${action.type}]`)}`);
    }
  }

  return lines.join('\n');
}

// ---- Table Renderer ----

async function renderTable(component: MCPAppComponent, style: MCPStyle): Promise<string> {
  const data: TableData = component.data || {};
  const headers: string[] = data.headers || [];
  const rows: Array<Record<string, any>> = data.rows || [];
  const showRowNumbers = data.showRowNumbers ?? false;
  const lines: string[] = [];

  if (component.title) {
    lines.push(chalk.bold.cyan(`  ${component.title}`));
  }

  if (headers.length === 0 && rows.length === 0) {
    lines.push(chalk.dim('  (empty table)'));
    return lines.join('\n');
  }

  const colCount = headers.length || (rows.length > 0 ? Object.keys(rows[0]).length : 0);
  if (colCount === 0) {
    lines.push(chalk.dim('  (no columns)'));
    return lines.join('\n');
  }

  const effectiveHeaders = headers.length > 0 ? headers : Object.keys(rows[0] || {});

  const colWidths = data.colWidths || effectiveHeaders.map((h) => {
    let max = h.length;
    for (const row of rows) {
      const val = String(row[h] ?? '');
      max = Math.max(max, val.length);
    }
    return Math.min(max + 2, 40);
  });

  const colAlign: Array<'left' | 'center' | 'right'> = data.colAlign || effectiveHeaders.map(() => 'left');
  const rowNumWidth = showRowNumbers ? String(rows.length).length + 2 : 0;

  const padCell = (text: string, width: number, align: 'left' | 'center' | 'right'): string => {
    const str = String(text);
    if (str.length >= width) return str.slice(0, width - 1) + '…';
    const gap = width - str.length;
    if (align === 'right') return ' '.repeat(gap) + str;
    if (align === 'center') {
      const left = Math.floor(gap / 2);
      return ' '.repeat(left) + str + ' '.repeat(gap - left);
    }
    return str + ' '.repeat(gap);
  };

  const horizontalLine = (left: string, mid: string, right: string, fill: string): string => {
    const parts = colWidths.map((w) => fill.repeat(w + 2));
    const prefix = showRowNumbers ? left + fill.repeat(rowNumWidth + 2) + mid : '';
    return chalk.dim(prefix + parts.join(mid) + right);
  };

  lines.push(horizontalLine('┌', '┬', '┐', '─'));

  const headerCells = effectiveHeaders.map((h, i) =>
    chalk.bold(padCell(h, colWidths[i], colAlign[i]))
  );
  const headerPrefix = showRowNumbers ? chalk.dim('│ ') + ' '.repeat(rowNumWidth) + chalk.dim(' │') : '';
  lines.push(`${chalk.dim('│')} ${headerCells.join(chalk.dim(' │ '))} ${chalk.dim('│')}`.replace(/^│/, headerPrefix ? headerPrefix : chalk.dim('│')));

  lines.push(horizontalLine('├', '┼', '┤', '─'));

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cells = effectiveHeaders.map((h, i) => {
      const val = row[h];
      const str = val === null ? chalk.dim('null') : val === undefined ? chalk.dim('—') : String(val);
      return padCell(str, colWidths[i], colAlign[i]);
    });
    const rowPrefix = showRowNumbers
      ? chalk.dim('│ ') + chalk.cyan(padCell(String(r + 1), rowNumWidth, 'right')) + chalk.dim(' │')
      : '';
    const rowLine = rowPrefix
      ? `${rowPrefix} ${cells.join(chalk.dim(' │ '))} ${chalk.dim('│')}`
      : `${chalk.dim('│')} ${cells.join(chalk.dim(' │ '))} ${chalk.dim('│')}`;
    lines.push(rowLine);
  }

  lines.push(horizontalLine('└', '┴', '┘', '─'));

  if (rows.length > 0) {
    lines.push(chalk.dim(`  ${rows.length} row${rows.length !== 1 ? 's' : ''}`));
  }

  if (component.actions && component.actions.length > 0) {
    lines.push('');
    for (const action of component.actions) {
      lines.push(`  ${chalk.yellow('→')} ${chalk.white(action.label)} ${chalk.dim(`[${action.type}]`)}`);
    }
  }

  return lines.join('\n');
}

// ---- Chart Renderer ----

async function renderChart(component: MCPAppComponent, style: MCPStyle): Promise<string> {
  const data: ChartData = component.data || {};
  const chartType = data.chartType || 'bar';
  const labels: string[] = data.labels || [];
  const values: number[] = data.values || [];
  const maxValue = data.maxValue ?? Math.max(...values, 1);
  const unit = data.unit || '';
  const showValues = data.showValues ?? true;
  const lines: string[] = [];

  if (component.title) {
    lines.push(chalk.bold.cyan(`  ${component.title}`));
  }

  if (labels.length === 0 || values.length === 0) {
    lines.push(chalk.dim('  (no chart data)'));
    return lines.join('\n');
  }

  const maxBarWidth = 30;
  const maxLabelLen = Math.max(...labels.map((l) => l.length), 5);

  if (chartType === 'bar' || chartType === 'horizontal-bar') {
    for (let i = 0; i < labels.length; i++) {
      const ratio = values[i] / maxValue;
      const barWidth = Math.round(ratio * maxBarWidth);
      const bar = '█'.repeat(Math.max(barWidth, 1));
      const valueStr = showValues ? ` ${values[i]}${unit}` : '';
      const colorFn = ratio > 0.75 ? chalk.green : ratio > 0.5 ? chalk.cyan : ratio > 0.25 ? chalk.yellow : chalk.red;

      lines.push(
        `  ${chalk.white(padRight(labels[i], maxLabelLen))} ${colorFn(bar)}${chalk.gray(valueStr)}`
      );
    }

    const scaleLine = chalk.dim(`  ${' '.repeat(maxLabelLen)} 0${' '.repeat(maxBarWidth - 4)}${maxValue}${unit}`);
    lines.push(scaleLine);

  } else if (chartType === 'sparkline') {
    const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const normalizedValues = values.map((v) => {
      const ratio = v / maxValue;
      const idx = Math.min(Math.floor(ratio * (sparkChars.length - 1)), sparkChars.length - 1);
      return Math.max(idx, 0);
    });

    const sparkline = normalizedValues.map((idx) => {
      const colorFn = idx > 5 ? chalk.green : idx > 3 ? chalk.cyan : idx > 1 ? chalk.yellow : chalk.red;
      return colorFn(sparkChars[idx]);
    }).join('');

    lines.push(`  ${sparkline}`);
    if (showValues && labels.length > 0) {
      lines.push(`  ${chalk.dim(labels[0])} → ${chalk.dim(labels[labels.length - 1])}  ${chalk.gray(`min:${Math.min(...values)} max:${Math.max(...values)}${unit}`)}`);
    }

  } else if (chartType === 'pie') {
    const total = values.reduce((a, b) => a + b, 0);
    if (total === 0) {
      lines.push(chalk.dim('  (no data for pie chart)'));
      return lines.join('\n');
    }

    const pieColors = [chalk.cyan, chalk.green, chalk.yellow, chalk.magenta, chalk.red, chalk.blue, chalk.white];
    const segments: string[] = [];

    for (let i = 0; i < values.length; i++) {
      const pct = ((values[i] / total) * 100).toFixed(1);
      const colorFn = pieColors[i % pieColors.length];
      const filled = Math.round((values[i] / total) * 20);
      const bar = '●'.repeat(Math.max(filled, 1));
      segments.push(`  ${colorFn(bar)} ${chalk.white(labels[i])} ${chalk.gray(`${pct}%`)} ${chalk.dim(`(${values[i]}${unit})`)}`);
    }

    lines.push(...segments);
    lines.push(`  ${chalk.dim(`Total: ${total}${unit}`)}`);
  }

  if (component.actions && component.actions.length > 0) {
    lines.push('');
    for (const action of component.actions) {
      lines.push(`  ${chalk.yellow('→')} ${chalk.white(action.label)} ${chalk.dim(`[${action.type}]`)}`);
    }
  }

  return lines.join('\n');
}

// ---- Button Group Renderer ----

async function renderButtonGroup(component: MCPAppComponent, style: MCPStyle): Promise<string> {
  const data: ButtonGroupData = component.data || {};
  const buttons = data.buttons || [];
  const layout = data.layout || 'horizontal';
  const lines: string[] = [];

  if (component.title) {
    lines.push(chalk.bold.cyan(`  ${component.title}`));
  }

  if (data.description) {
    lines.push(chalk.dim(`  ${data.description}`));
  }

  if (buttons.length === 0) {
    lines.push(chalk.dim('  (no actions available)'));
    return lines.join('\n');
  }

  const variantStyles: Record<string, (text: string) => string> = {
    primary: (t) => chalk.bgCyan.black(` ${t} `),
    secondary: (t) => chalk.bgGray.white(` ${t} `),
    danger: (t) => chalk.bgRed.white(` ${t} `),
    ghost: (t) => chalk.dim(`[ ${t} ]`),
  };

  if (layout === 'vertical') {
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const num = chalk.cyan(`${i + 1}.`);
      const styleFn = variantStyles[btn.variant || 'primary'] || variantStyles.primary;
      const icon = btn.icon ? `${btn.icon} ` : '';
      const disabled = btn.disabled ? chalk.dim(' (disabled)') : '';
      lines.push(`  ${num} ${styleFn(`${icon}${btn.label}`)}${disabled}`);
    }
  } else {
    const parts: string[] = [];
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const num = chalk.cyan(`[${i + 1}]`);
      const styleFn = variantStyles[btn.variant || 'primary'] || variantStyles.primary;
      const icon = btn.icon ? `${btn.icon} ` : '';
      const disabled = btn.disabled ? chalk.dim('(disabled)') : '';
      parts.push(`${num} ${styleFn(`${icon}${btn.label}`)} ${disabled}`);
    }
    lines.push(`  ${parts.join('  ')}`);
  }

  if (component.actions && component.actions.length > 0) {
    lines.push('');
    for (const action of component.actions) {
      lines.push(`  ${chalk.yellow('→')} ${chalk.white(action.label)} ${chalk.dim(`[${action.type}]`)}`);
    }
  }

  return lines.join('\n');
}

// ---- Progress Renderer ----

async function renderProgress(component: MCPAppComponent, style: MCPStyle): Promise<string> {
  const data: ProgressData = component.data || {};
  const percent = Math.max(0, Math.min(100, data.percent ?? 0));
  const current = data.current;
  const total = data.total;
  const label = data.label || '';
  const status = data.status || 'active';
  const eta = data.eta;
  const lines: string[] = [];

  if (component.title) {
    lines.push(chalk.bold.cyan(`  ${component.title}`));
  }

  const barWidth = 30;
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;

  const statusIcons: Record<string, string> = {
    active: chalk.cyan('◉'),
    succeeded: chalk.green('✓'),
    failed: chalk.red('✕'),
    paused: chalk.yellow('ǁ'),
    indeterminate: chalk.blue('◎'),
  };

  const barColors: Record<string, (bar: string) => string> = {
    active: (b) => chalk.cyan(b),
    succeeded: (b) => chalk.green(b),
    failed: (b) => chalk.red(b),
    paused: (b) => chalk.yellow(b),
    indeterminate: (b) => chalk.blue(b),
  };

  const colorFn = barColors[status] || barColors.active;
  const icon = statusIcons[status] || statusIcons.active;

  if (status === 'indeterminate') {
    const animBar = '≋'.repeat(barWidth);
    lines.push(`  ${icon} ${label} ${chalk.blue(animBar)}`);
  } else {
    const filledBar = colorFn('█'.repeat(filled));
    const emptyBar = chalk.dim('░'.repeat(empty));
    const pctStr = `${percent.toFixed(1)}%`.padStart(7);

    let detail = '';
    if (current !== undefined && total !== undefined) {
      detail = chalk.gray(` (${current}/${total})`);
    }
    let etaStr = '';
    if (eta) {
      etaStr = chalk.gray(` ETA: ${eta}`);
    }

    lines.push(`  ${icon} ${chalk.white(label.padEnd(20))} ${filledBar}${emptyBar} ${chalk.bold(pctStr)}${detail}${etaStr}`);
  }

  if (component.actions && component.actions.length > 0) {
    lines.push('');
    for (const action of component.actions) {
      lines.push(`  ${chalk.yellow('→')} ${chalk.white(action.label)} ${chalk.dim(`[${action.type}]`)}`);
    }
  }

  return lines.join('\n');
}

// ---- Diff Renderer ----

async function renderDiff(component: MCPAppComponent, style: MCPStyle): Promise<string> {
  const data: DiffData = component.data || {};
  const fileName = data.fileName || 'unknown';
  const hunks = data.hunks || [];
  const additions = data.additions || 0;
  const deletions = data.deletions || 0;
  const lines: string[] = [];

  const fileLabel = chalk.bold.white(fileName);
  const addLabel = chalk.green(`+${additions}`);
  const delLabel = chalk.red(`-${deletions}`);
  lines.push(`  ${fileLabel} ${addLabel} ${delLabel}`);

  if (data.isBinary) {
    lines.push(chalk.dim('  (binary file)'));
    return lines.join('\n');
  }

  for (const hunk of hunks) {
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    lines.push(chalk.magenta(`  ${header}`));

    const contentLines = hunk.content.split('\n');
    for (const line of contentLines) {
      if (line.startsWith('+')) {
        lines.push(chalk.green(`  ${line}`));
      } else if (line.startsWith('-')) {
        lines.push(chalk.red(`  ${line}`));
      } else if (line.startsWith('@@')) {
        lines.push(chalk.magenta(`  ${line}`));
      } else {
        lines.push(chalk.dim(`  ${line}`));
      }
    }
  }

  if (component.actions && component.actions.length > 0) {
    lines.push('');
    for (const action of component.actions) {
      const icon = action.type === 'submit' ? '✓' : action.type === 'cancel' ? '✕' : '→';
      lines.push(`  ${chalk.yellow(icon)} ${chalk.white(action.label)} ${chalk.dim(`[${action.type}]`)}`);
    }
  }

  return lines.join('\n');
}

// ---- Custom Renderer (fallback) ----

async function renderCustom(component: MCPAppComponent, style: MCPStyle): Promise<string> {
  const lines: string[] = [];

  if (component.title) {
    lines.push(chalk.bold.cyan(`  ${component.title}`));
  }

  if (typeof component.data === 'string') {
    lines.push(`  ${component.data}`);
  } else if (component.data && typeof component.data === 'object') {
    const json = JSON.stringify(component.data, null, 2);
    const indented = json.split('\n').map((l) => `  ${l}`).join('\n');
    lines.push(chalk.dim(indented));
  } else {
    lines.push(chalk.dim('  (custom component)'));
  }

  if (component.actions && component.actions.length > 0) {
    lines.push('');
    for (const action of component.actions) {
      lines.push(`  ${chalk.yellow('→')} ${chalk.white(action.label)} ${chalk.dim(`[${action.type}]`)}`);
    }
  }

  return lines.join('\n');
}

// ---- Utility Functions ----

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

function resolveStyle(accent: string | undefined, fallback: string): (text: string) => string {
  if (!accent) return chalk.hex(fallback);
  try {
    return chalk.hex(accent);
  } catch {
    return chalk.hex(fallback);
  }
}

// ============================================================
// MCPAppManager - Main Manager Class
// ============================================================

export class MCPAppManager {
  private mcpClient: MCPClient;
  private renderers: Map<string, ComponentRenderer> = new Map();
  private stateStore: ComponentStateStore = new ComponentStateStore();
  private knownApps: Map<string, AppInfo> = new Map();
  private currentStyle: MCPStyle;

  constructor(mcpClient: MCPClient) {
    this.mcpClient = mcpClient;
    this.currentStyle = { theme: 'dark' };

    this.registerBuiltinRenderers();
  }

  // ---- Renderer Registration ----

  registerComponentType(type: string, renderer: ComponentRenderer): void {
    this.renderers.set(type, renderer);
  }

  private registerBuiltinRenderers(): void {
    this.renderers.set('form', renderForm);
    this.renderers.set('table', renderTable);
    this.renderers.set('chart', renderChart);
    this.renderers.set('button-group', renderButtonGroup);
    this.renderers.set('progress', renderProgress);
    this.renderers.set('diff', renderDiff);
    this.renderers.set('custom', renderCustom);
  }

  // ---- Style Configuration ----

  setStyle(style: MCPStyle): void {
    this.currentStyle = { ...this.currentStyle, ...style };
  }

  getStyle(): MCPStyle {
    return { ...this.currentStyle };
  }

  // ---- Component Rendering ----

  async renderComponent(component: MCPAppComponent): Promise<string> {
    const renderer = this.renderers.get(component.type);
    const mergedStyle: MCPStyle = {
      ...this.currentStyle,
      ...component.style,
    };

    if (!renderer) {
      return renderCustom(component, mergedStyle);
    }

    try {
      const rendered = await renderer(component, mergedStyle);
      return rendered;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const fallback = [
        chalk.red(`  ⚠ Failed to render ${component.type} component (${component.id}): ${errMsg}`),
        '',
        await renderCustom(component, mergedStyle),
      ].join('\n');
      return fallback;
    }
  }

  async renderAppResult(appResult: MCPAppResult): Promise<string> {
    const parts: string[] = [];

    if (appResult.text) {
      parts.push(appResult.text);
    }

    if (appResult.components.length > 0) {
      if (appResult.text) {
        parts.push('');
      }

      for (let i = 0; i < appResult.components.length; i++) {
        const component = appResult.components[i];
        const rendered = await this.renderComponent(component);

        if (rendered.trim()) {
          parts.push(rendered);
          if (i < appResult.components.length - 1) {
            parts.push('');
          }
        }
      }
    }

    if (appResult.metadata && Object.keys(appResult.metadata).length > 0) {
      parts.push('');
      const metaEntries = Object.entries(appResult.metadata);
      for (const [key, value] of metaEntries) {
        parts.push(chalk.dim(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`));
      }
    }

    return parts.join('\n');
  }

  // ---- Action Handling ----

  async handleAction(action: MCPAction): Promise<MCPAppResult> {
    switch (action.type) {
      case 'tool-call': {
        if (!action.toolCall) {
          return {
            text: `Action "${action.label}" has no tool call defined.`,
            components: [],
          };
        }
        const { tool, args } = action.toolCall;
        const parsed = this.mcpClient.parseMCPToolName(tool);
        if (!parsed) {
          return {
            text: `Invalid MCP tool name: "${tool}". Expected format: mcp_<server>__<tool>`,
            components: [],
            metadata: { error: true, actionId: action.id },
          };
        }
        try {
          const result = await this.mcpClient.callTool(parsed.serverName, parsed.toolName, args);
          return this.parseAppResult(result);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return {
            text: `Tool call failed: ${errMsg}`,
            components: [],
            metadata: { error: true, actionId: action.id, tool, args },
          };
        }
      }

      case 'submit': {
        return {
          text: `Submitted: ${action.label}`,
          components: [],
          metadata: { actionId: action.id, actionType: 'submit' },
        };
      }

      case 'cancel': {
        return {
          text: `Cancelled: ${action.label}`,
          components: [],
          metadata: { actionId: action.id, actionType: 'cancel' },
        };
      }

      case 'navigate': {
        return {
          text: `Navigate: ${action.label}`,
          components: [],
          metadata: { actionId: action.id, actionType: 'navigate' },
        };
      }

      default: {
        return {
          text: `Unknown action type: ${action.type}`,
          components: [],
          metadata: { actionId: action.id },
        };
      }
    }
  }

  // ---- Result Parsing ----

  parseAppResult(rawResult: any): MCPAppResult {
    if (!rawResult) {
      return { text: '(no result)', components: [] };
    }

    if (typeof rawResult === 'string') {
      try {
        const parsed = JSON.parse(rawResult);
        return this.parseAppResult(parsed);
      } catch {
        return { text: rawResult, components: [] };
      }
    }

    if (typeof rawResult === 'object') {
      const content = rawResult.content;
      if (Array.isArray(content)) {
        const textParts: string[] = [];
        const components: MCPAppComponent[] = [];

        for (const item of content) {
          if (item.type === 'text') {
            textParts.push(item.text || '');
          } else if (item.type === 'resource') {
            const resource = item.resource;
            if (resource) {
              textParts.push(resource.text || resource.uri || '');
            }
          } else if (item.type === 'mcp-app' || item.type === 'component' || item.type === 'ui-component') {
            const component = this.parseComponent(item);
            if (component) {
              components.push(component);
            }
          } else if (item.type === 'image') {
            textParts.push(chalk.dim(`[Image: ${item.mimeType || 'unknown'}]`));
          }
        }

        const metadata = rawResult.meta || rawResult.metadata;
        return {
          text: textParts.join('\n'),
          components,
          metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
        };
      }

      if (rawResult.text !== undefined || rawResult.components !== undefined) {
        const components: MCPAppComponent[] = Array.isArray(rawResult.components)
          ? rawResult.components.map((c: any) => this.parseComponent(c)).filter(Boolean) as MCPAppComponent[]
          : [];
        return {
          text: rawResult.text || '',
          components,
          metadata: rawResult.metadata || rawResult.meta,
        };
      }

      if (rawResult.type && rawResult.id) {
        const component = this.parseComponent(rawResult);
        if (component) {
          return {
            text: component.title || component.type,
            components: [component],
          };
        }
      }

      try {
        return { text: JSON.stringify(rawResult, null, 2), components: [] };
      } catch {
        return { text: String(rawResult), components: [] };
      }
    }

    return { text: String(rawResult), components: [] };
  }

  private parseComponent(raw: any): MCPAppComponent | null {
    if (!raw || typeof raw !== 'object') return null;

    const validTypes: MCPAppComponent['type'][] = ['form', 'table', 'chart', 'button-group', 'progress', 'diff', 'custom'];
    const type = validTypes.includes(raw.type) ? raw.type : 'custom';

    const component: MCPAppComponent = {
      type,
      id: raw.id || `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      data: raw.data || raw.fields || raw.rows || raw.content || {},
    };

    if (raw.title) component.title = raw.title;
    if (raw.actions && Array.isArray(raw.actions)) {
      component.actions = raw.actions.map((a: any) => this.parseAction(a)).filter(Boolean) as MCPAction[];
    }
    if (raw.style) component.style = raw.style;

    return component;
  }

  private parseAction(raw: any): MCPAction | null {
    if (!raw || typeof raw !== 'object') return null;

    const validTypes: MCPAction['type'][] = ['submit', 'cancel', 'navigate', 'tool-call'];
    const type = validTypes.includes(raw.type) ? raw.type : 'submit';

    const action: MCPAction = {
      id: raw.id || `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: raw.label || 'Action',
      type,
    };

    if (raw.toolCall && typeof raw.toolCall === 'object') {
      action.toolCall = {
        tool: raw.toolCall.tool || '',
        args: raw.toolCall.args || {},
      };
    } else if (raw.tool_call && typeof raw.tool_call === 'object') {
      action.toolCall = {
        tool: raw.tool_call.tool || '',
        args: raw.tool_call.args || {},
      };
    } else if (raw.tool && typeof raw.tool === 'string') {
      action.toolCall = {
        tool: raw.tool,
        args: raw.args || raw.arguments || {},
      };
    }

    return action;
  }

  // ---- App Discovery ----

  async listAvailableApps(): Promise<AppInfo[]> {
    const tools = this.mcpClient.getAllTools();
    const apps: AppInfo[] = [];

    for (const { serverName, tool } of tools) {
      const description = tool.description || '';
      const isApp = this.detectAppCapability(tool);

      if (isApp) {
        const info: AppInfo = {
          serverName,
          toolName: tool.name,
          description,
          componentTypes: this.detectComponentTypes(tool),
          hasActions: this.detectActions(tool),
        };
        apps.push(info);
        this.knownApps.set(`${serverName}__${tool.name}`, info);
      }
    }

    return apps;
  }

  private detectAppCapability(tool: any): boolean {
    const desc = (tool.description || '').toLowerCase();
    const appKeywords = ['interactive', 'ui', 'form', 'table', 'chart', 'component', 'app', 'widget', 'dashboard', 'visual'];
    if (appKeywords.some((kw) => desc.includes(kw))) return true;

    const schema = tool.inputSchema || tool.parameters;
    if (schema && schema.properties) {
      const props = Object.keys(schema.properties);
      if (props.includes('componentType') || props.includes('ui_type') || props.includes('format')) {
        return true;
      }
      const hasComponentType = props.some((p) => {
        const prop = schema.properties[p];
        return prop && prop.enum && Array.isArray(prop.enum) &&
          prop.enum.some((v: string) => ['form', 'table', 'chart', 'html', 'component'].includes(v));
      });
      if (hasComponentType) return true;
    }

    if (tool.annotations && typeof tool.annotations === 'object') {
      if (tool.annotations.mcpApp === true || tool.annotations.ui === true) return true;
    }

    return false;
  }

  private detectComponentTypes(tool: any): string[] {
    const types: string[] = [];
    const schema = tool.inputSchema || tool.parameters;
    if (schema && schema.properties) {
      const componentTypeProp = schema.properties.componentType || schema.properties.ui_type || schema.properties.format;
      if (componentTypeProp && componentTypeProp.enum) {
        types.push(...componentTypeProp.enum);
      }
    }
    const desc = (tool.description || '').toLowerCase();
    const knownTypes = ['form', 'table', 'chart', 'button-group', 'progress', 'diff', 'custom'];
    for (const t of knownTypes) {
      if (desc.includes(t) && !types.includes(t)) types.push(t);
    }
    return types.length > 0 ? types : ['custom'];
  }

  private detectActions(tool: any): boolean {
    const desc = (tool.description || '').toLowerCase();
    if (desc.includes('action') || desc.includes('submit') || desc.includes('button')) return true;
    const schema = tool.inputSchema || tool.parameters;
    if (schema && schema.properties) {
      return 'action' in schema.properties || 'actions' in schema.properties;
    }
    return false;
  }

  // ---- Interactive Prompt Rendering ----

  async renderInteractivePrompt(component: MCPAppComponent): Promise<MCPAction | null> {
    const rendered = await this.renderComponent(component);
    console.log(rendered);

    const actions = component.actions;
    if (!actions || actions.length === 0) return null;

    if (component.type === 'button-group') {
      const data: ButtonGroupData = component.data || {};
      const buttons = data.buttons || [];
      if (buttons.length > 0) {
        const choices = buttons.map((btn, i) => ({
          name: `${i + 1}. ${btn.label}${btn.disabled ? ' (disabled)' : ''}`,
          value: btn.id,
          disabled: btn.disabled || false,
        }));
        try {
          // @ts-ignore
          const { default: inquirer } = await import('inquirer');
          const answer = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'Choose an action:',
            choices,
          }]);
          const selectedBtn = buttons.find((b) => b.id === answer.action);
          if (selectedBtn) {
            const matchingAction = actions.find((a) => a.label === selectedBtn.label) || actions[0];
            if (matchingAction && matchingAction.type === 'tool-call' && matchingAction.toolCall) {
              return matchingAction;
            }
            return {
              id: selectedBtn.id,
              label: selectedBtn.label,
              type: 'submit',
              toolCall: matchingAction?.toolCall,
            };
          }
        } catch {
          return null;
        }
      }
    }

    if (component.type === 'form') {
      const fields: FormField[] = component.data?.fields || [];
      if (fields.length > 0) {
        try {
          // @ts-ignore
          const { default: inquirer } = await import('inquirer');
          const questions = fields.map((field) => {
            const base: any = {
              name: field.name,
              message: field.label,
              default: field.default,
            };
            if (field.type === 'select' && field.options) {
              base.type = 'list';
              base.choices = field.options.map((o) => ({ name: o.label, value: o.value }));
            } else if (field.type === 'checkbox' && field.options) {
              base.type = 'checkbox';
              base.choices = field.options.map((o) => ({ name: o.label, value: o.value }));
            } else if (field.type === 'toggle') {
              base.type = 'confirm';
            } else if (field.type === 'password') {
              base.type = 'password';
            } else {
              base.type = 'input';
            }
            return base;
          });
          const answers = await inquirer.prompt(questions);
          const submitAction = actions.find((a) => a.type === 'submit') || actions[0];
          if (submitAction) {
            if (submitAction.toolCall) {
              return {
                ...submitAction,
                toolCall: {
                  tool: submitAction.toolCall.tool,
                  args: { ...submitAction.toolCall.args, ...answers },
                },
              };
            }
            return submitAction;
          }
        } catch {
          return null;
        }
      }
    }

    if (actions.length > 0) {
      const choices = actions.map((a) => ({
        name: `${a.label} [${a.type}]`,
        value: a.id,
      }));
      try {
        // @ts-ignore
        const { default: inquirer } = await import('inquirer');
        const answer = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: 'Choose an action:',
          choices,
        }]);
        return actions.find((a) => a.id === answer.action) || null;
      } catch {
        return null;
      }
    }

    return null;
  }

  // ---- Progress Spinner ----

  createProgressSpinner(component: MCPAppComponent): ReturnType<typeof ora> {
    const data: ProgressData = component.data || {};
    const label = data.label || component.title || 'Loading...';
    const spinner = ora({
      text: label,
      spinner: 'dots',
    });
    return spinner;
  }

  async updateProgressSpinner(
    spinner: ReturnType<typeof ora>,
    component: MCPAppComponent,
  ): Promise<void> {
    const data: ProgressData = component.data || {};
    const label = data.label || component.title || '';
    const percent = data.percent ?? 0;
    const status = data.status || 'active';

    switch (status) {
      case 'succeeded':
        spinner.succeed(`${label} - Complete (${percent.toFixed(1)}%)`);
        break;
      case 'failed':
        spinner.fail(`${label} - Failed`);
        break;
      case 'paused':
        spinner.warn(`${label} - Paused (${percent.toFixed(1)}%)`);
        break;
      case 'indeterminate':
        spinner.start(label);
        break;
      default: {
        const current = data.current !== undefined ? ` (${data.current}/${data.total})` : '';
        spinner.text = `${label} ${percent.toFixed(1)}%${current}`;
        if (!spinner.isSpinning) spinner.start();
        break;
      }
    }
  }

  // ---- State Management ----

  getComponentState(componentId: string): Map<string, any> {
    return this.stateStore.getState(componentId);
  }

  setComponentState(componentId: string, key: string, value: any): void {
    this.stateStore.setState(componentId, key, value);
  }

  clearComponentState(componentId: string): void {
    this.stateStore.clearState(componentId);
  }

  clearAllState(): void {
    this.stateStore.clearAll();
  }

  // ---- App Execution ----

  async executeApp(
    serverName: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<string> {
    try {
      const rawResult = await this.mcpClient.callTool(serverName, toolName, args);
      const appResult = this.parseAppResult(rawResult);
      const rendered = await this.renderAppResult(appResult);
      return rendered;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return chalk.red(`  ⚠ MCP App execution failed: ${errMsg}`);
    }
  }

  async executeAppInteractive(
    serverName: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<void> {
    let rawResult: any;
    try {
      rawResult = await this.mcpClient.callTool(serverName, toolName, args);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`  ⚠ MCP App execution failed: ${errMsg}`));
      return;
    }

    const appResult = this.parseAppResult(rawResult);

    if (appResult.text) {
      console.log(appResult.text);
    }

    for (const component of appResult.components) {
      const hasInteractiveActions = component.actions && component.actions.length > 0;

      if (hasInteractiveActions) {
        const action = await this.renderInteractivePrompt(component);
        if (action) {
          const actionResult = await this.handleAction(action);
          if (actionResult.text) {
            console.log(actionResult.text);
          }
          if (actionResult.components.length > 0) {
            for (const subComponent of actionResult.components) {
              const rendered = await this.renderComponent(subComponent);
              console.log(rendered);
            }
          }
        }
      } else {
        const rendered = await this.renderComponent(component);
        console.log(rendered);
      }
    }
  }
}
