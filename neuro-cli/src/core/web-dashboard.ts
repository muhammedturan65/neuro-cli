// ============================================================
// NeuroCLI - Web Dashboard
// Local web server serving a dashboard page
// Session history, token usage charts, model performance
// Real-time session monitoring
// ============================================================

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// -----------------------------------------------------------
// Public interfaces
// -----------------------------------------------------------

export interface DashboardConfig {
  /** Host to bind to */
  host: string;
  /** Port for the dashboard server */
  port: number;
  /** Whether to auto-open browser */
  autoOpen: boolean;
  /** Refresh interval for real-time updates in ms */
  refreshInterval: number;
  /** Whether to enable the dashboard */
  enabled: boolean;
}

export interface DashboardData {
  sessions: SessionSummary[];
  tokenUsage: TokenUsageChart;
  modelPerformance: ModelPerfData[];
  spending: SpendingData;
  systemInfo: SystemInfoData;
}

export interface SessionSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
  totalCost: number;
  description?: string;
  tags: string[];
}

export interface TokenUsageChart {
  labels: string[];
  inputTokens: number[];
  outputTokens: number[];
  costs: number[];
}

export interface ModelPerfData {
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number;
}

export interface SpendingData {
  todayTotal: number;
  todayByModel: Record<string, number>;
  sessionTotal: number;
  sessionByModel: Record<string, number>;
  dailyLimit: number;
  estimatedDailySpend: number;
}

export interface SystemInfoData {
  version: string;
  uptime: number;
  platform: string;
  nodeVersion: string;
  modelsAvailable: number;
  toolsAvailable: number;
  agentsAvailable: number;
  currentModel: string;
}

// -----------------------------------------------------------
// Default config
// -----------------------------------------------------------

const DASHBOARD_CONFIG_PATH = join(homedir(), '.neuro', 'dashboard-config.json');

function defaultConfig(): DashboardConfig {
  return {
    host: '127.0.0.1',
    port: 3142,
    autoOpen: true,
    refreshInterval: 5000,
    enabled: false,
  };
}

// -----------------------------------------------------------
// Dashboard HTML Generator
// Uses string concatenation to avoid nested template literal issues
// -----------------------------------------------------------

function generateDashboardHTML(data: DashboardData, config: DashboardConfig): string {
  const CSS = [
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; min-height: 100vh; }',
    '.header { background: linear-gradient(135deg, #161b22, #21262d); padding: 20px 30px; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between; }',
    '.header h1 { font-size: 24px; color: #58a6ff; }',
    '.header .version { color: #8b949e; font-size: 14px; }',
    '.header .status { display: flex; align-items: center; gap: 8px; }',
    '.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; animation: pulse 2s ease-in-out infinite; }',
    '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }',
    '.container { max-width: 1400px; margin: 0 auto; padding: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }',
    '.card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 20px; }',
    '.card h2 { color: #58a6ff; font-size: 16px; margin-bottom: 16px; }',
    '.stat-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #21262d; }',
    '.stat-row:last-child { border-bottom: none; }',
    '.stat-label { color: #8b949e; }',
    '.stat-value { color: #f0f6fc; font-weight: 600; }',
    '.stat-value.green { color: #3fb950; }',
    '.stat-value.yellow { color: #d29922; }',
    '.stat-value.cyan { color: #58a6ff; }',
    '.model-row { display: flex; justify-content: space-between; align-items: center; padding: 10px; margin: 4px 0; background: #0d1117; border-radius: 8px; }',
    '.model-name { color: #79c0ff; font-size: 13px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }',
    '.model-stats { display: flex; gap: 16px; font-size: 12px; }',
    '.session-item { padding: 10px; margin: 4px 0; background: #0d1117; border-radius: 8px; cursor: pointer; }',
    '.session-item:hover { background: #21262d; }',
    '.session-id { color: #79c0ff; font-size: 13px; }',
    '.session-meta { color: #8b949e; font-size: 12px; margin-top: 4px; }',
    '.full-width { grid-column: 1 / -1; }',
    '.refresh-info { color: #8b949e; font-size: 12px; text-align: center; padding: 10px; }',
    '.empty-state { color: #8b949e; text-align: center; padding: 20px; }',
  ].join('\n    ');

  // Build model performance section
  const modelRows = data.modelPerformance.length > 0
    ? data.modelPerformance.map(m =>
        '<div class="model-row">' +
        '<span class="model-name">' + m.model + '</span>' +
        '<div class="model-stats">' +
        '<span>' + m.requestCount + ' reqs</span>' +
        '<span>' + m.totalTokens.toLocaleString() + ' tokens</span>' +
        '<span>$' + m.totalCost.toFixed(4) + '</span>' +
        '<span>' + m.avgLatencyMs + 'ms avg</span>' +
        '</div></div>'
      ).join('\n        ')
    : '<div class="empty-state">No model performance data yet</div>';

  // Build session list
  const sessionItems = data.sessions.length > 0
    ? data.sessions.slice(0, 10).map(s =>
        '<div class="session-item">' +
        '<div class="session-id">' + s.id.slice(0, 8) + '...</div>' +
        '<div class="session-meta">' +
        s.messageCount + ' messages | ' + (s.model.split('/').pop() || s.model) + ' | $' + s.totalCost.toFixed(4) + ' | ' +
        new Date(s.updatedAt).toLocaleString() +
        '</div></div>'
      ).join('\n        ')
    : '<div class="empty-state">No sessions yet</div>';

  // Build token usage section
  const totalInput = data.tokenUsage.inputTokens.reduce((a, b) => a + b, 0);
  const totalOutput = data.tokenUsage.outputTokens.reduce((a, b) => a + b, 0);
  const totalCost = data.tokenUsage.costs.reduce((a, b) => a + b, 0);

  const chartSection = data.tokenUsage.labels.length > 0
    ? '<div class="bar-chart">' +
      data.tokenUsage.inputTokens.map((val, i) => {
        const maxVal = Math.max(...data.tokenUsage.inputTokens, ...data.tokenUsage.outputTokens, 1);
        const height = Math.max(5, (val / maxVal) * 100);
        return '<div class="bar" style="height: ' + height + '%">' +
               '<div class="bar-label">' + data.tokenUsage.labels[i] + '</div>' +
               '</div>';
      }).join('') +
      '</div>'
    : '<div class="empty-state">No token usage data yet</div>';

  const dailyLimitStr = data.spending.dailyLimit > 0
    ? '$' + data.spending.dailyLimit.toFixed(2)
    : 'Unlimited';

  const refreshSec = String(config.refreshInterval / 1000);

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>NeuroCLI Dashboard</title>',
    '<style>',
    '  ' + CSS,
    '</style>',
    '</head>',
    '<body>',
    '  <div class="header">',
    '    <div>',
    '      <h1>NeuroCLI Dashboard</h1>',
    '      <div class="version">v' + data.systemInfo.version + ' | ' + data.systemInfo.platform + ' | Node ' + data.systemInfo.nodeVersion + '</div>',
    '    </div>',
    '    <div class="status">',
    '      <div class="status-dot"></div>',
    '      <span>Live</span>',
    '    </div>',
    '  </div>',
    '',
    '  <div class="container">',
    '    <!-- System Overview -->',
    '    <div class="card">',
    '      <h2>&#9881; System Overview</h2>',
    '      <div class="stat-row"><span class="stat-label">Current Model</span><span class="stat-value cyan">' + (data.systemInfo.currentModel || 'default') + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Models Available</span><span class="stat-value">' + data.systemInfo.modelsAvailable + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Tools Available</span><span class="stat-value">' + data.systemInfo.toolsAvailable + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Agents Available</span><span class="stat-value">' + data.systemInfo.agentsAvailable + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Uptime</span><span class="stat-value">' + Math.round(data.systemInfo.uptime / 1000) + 's</span></div>',
    '    </div>',
    '',
    '    <!-- Spending -->',
    '    <div class="card">',
    '      <h2>&#128176; Spending</h2>',
    '      <div class="stat-row"><span class="stat-label">Today\'s Total</span><span class="stat-value green">$' + data.spending.todayTotal.toFixed(4) + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Session Total</span><span class="stat-value cyan">$' + data.spending.sessionTotal.toFixed(4) + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Daily Limit</span><span class="stat-value">' + dailyLimitStr + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Est. Daily Spend</span><span class="stat-value yellow">$' + data.spending.estimatedDailySpend.toFixed(4) + '</span></div>',
    '    </div>',
    '',
    '    <!-- Token Usage -->',
    '    <div class="card full-width">',
    '      <h2>&#128200; Token Usage</h2>',
    '      ' + chartSection,
    '      <div class="stat-row"><span class="stat-label">Total Input Tokens</span><span class="stat-value">' + totalInput.toLocaleString() + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Total Output Tokens</span><span class="stat-value">' + totalOutput.toLocaleString() + '</span></div>',
    '      <div class="stat-row"><span class="stat-label">Total Cost</span><span class="stat-value green">$' + totalCost.toFixed(4) + '</span></div>',
    '    </div>',
    '',
    '    <!-- Model Performance -->',
    '    <div class="card">',
    '      <h2>&#9889; Model Performance</h2>',
    '      ' + modelRows,
    '    </div>',
    '',
    '    <!-- Session History -->',
    '    <div class="card">',
    '      <h2>&#128193; Session History</h2>',
    '      ' + sessionItems,
    '    </div>',
    '  </div>',
    '',
    '  <div class="refresh-info">',
    '    Auto-refreshing every ' + refreshSec + 's |',
    '    <a href="/api/data" style="color: #58a6ff;">API Endpoint</a> |',
    '    <a href="/api/docs" style="color: #58a6ff;">API Docs</a>',
    '  </div>',
    '',
    '  <script>',
    '    setTimeout(function() { location.reload(); }, ' + config.refreshInterval + ');',
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n');
}

// -----------------------------------------------------------
// WebDashboard
// -----------------------------------------------------------

export class WebDashboard {
  private config: DashboardConfig;
  private server: HttpServer | null = null;
  private isRunning: boolean = false;
  private startTime: number = 0;
  private engineRef: unknown = null;

  constructor(config?: Partial<DashboardConfig>) {
    this.config = { ...defaultConfig(), ...config };
    this.loadConfig();
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Set the engine reference for fetching data
   */
  setEngine(engine: unknown): void {
    this.engineRef = engine;
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(chalk.yellow('Dashboard is already running.'));
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        await this.handleRequest(req, res);
      });

      this.server.on('error', (err: Error) => {
        console.log(chalk.red('Dashboard error: ' + err.message));
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.isRunning = true;
        this.startTime = Date.now();
        const url = 'http://' + this.config.host + ':' + this.config.port;
        console.log(chalk.green('Dashboard running at ' + url));

        // Auto-open browser
        if (this.config.autoOpen) {
          try {
            import('open').then(mod => {
              mod.default(url).catch(() => {});
            }).catch(() => {
              console.log(chalk.gray('Open ' + url + ' in your browser to view the dashboard.'));
            });
          } catch {
            console.log(chalk.gray('Open ' + url + ' in your browser to view the dashboard.'));
          }
        }

        resolve();
      });
    });
  }

  /**
   * Stop the dashboard server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        this.server = null;
        console.log(chalk.gray('Dashboard stopped.'));
        resolve();
      });
    });
  }

  /**
   * Check if dashboard is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get dashboard URL
   */
  getUrl(): string {
    return 'http://' + this.config.host + ':' + this.config.port;
  }

  /**
   * Gather dashboard data
   */
  gatherData(): DashboardData {
    const sessions = this.getSessionSummaries();
    const tokenUsage = this.getTokenUsageData(sessions);
    const modelPerformance = this.getModelPerformanceData();
    const spending = this.getSpendingData();
    const systemInfo = this.getSystemInfo();

    return {
      sessions,
      tokenUsage,
      modelPerformance,
      spending,
      systemInfo,
    };
  }

  /**
   * Get config
   */
  getConfig(): DashboardConfig {
    return { ...this.config };
  }

  /**
   * Print dashboard status
   */
  printStatus(): void {
    console.log('');
    console.log(chalk.bold('--- NeuroCLI Web Dashboard ---'));
    console.log('  Running: ' + (this.isRunning ? chalk.green('yes') : chalk.gray('no')));
    if (this.isRunning) {
      console.log('  URL: ' + chalk.cyan(this.getUrl()));
      console.log('  Uptime: ' + Math.round((Date.now() - this.startTime) / 1000) + 's');
    }
    console.log('  Auto-open: ' + (this.config.autoOpen ? chalk.green('yes') : chalk.gray('no')));
    console.log('  Refresh interval: ' + (this.config.refreshInterval / 1000) + 's');
    console.log('');
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');

    switch (url) {
      case '/':
      case '/dashboard': {
        const data = this.gatherData();
        const html = generateDashboardHTML(data, this.config);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        break;
      }

      case '/api/data': {
        const data = this.gatherData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        break;
      }

      case '/api/sessions': {
        const sessions = this.getSessionSummaries();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessions }));
        break;
      }

      case '/api/docs': {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          endpoints: [
            { method: 'GET', path: '/', description: 'Dashboard HTML page' },
            { method: 'GET', path: '/api/data', description: 'All dashboard data' },
            { method: 'GET', path: '/api/sessions', description: 'Session summaries' },
            { method: 'GET', path: '/api/docs', description: 'This documentation' },
          ],
        }));
        break;
      }

      default: {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    }
  }

  private getSessionSummaries(): SessionSummary[] {
    const sessionDir = join(homedir(), '.neuro', 'sessions');
    const sessions: SessionSummary[] = [];

    try {
      if (!existsSync(sessionDir)) return sessions;

      const files = readdirSync(sessionDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(sessionDir, file), 'utf-8');
          const data = JSON.parse(raw) as {
            id: string; createdAt: number; updatedAt: number;
            messages: unknown[]; model: string; totalCost: number;
            description?: string; tags: string[];
          };
          sessions.push({
            id: data.id || file.replace('.json', ''),
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || 0,
            messageCount: data.messages?.length || 0,
            model: data.model || 'unknown',
            totalCost: data.totalCost || 0,
            description: data.description,
            tags: data.tags || [],
          });
        } catch { /* skip invalid */ }
      }

      // Sort by updatedAt descending
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch { /* ignore */ }

    return sessions;
  }

  private getTokenUsageData(sessions: SessionSummary[]): TokenUsageChart {
    const byDate: Record<string, { input: number; output: number; cost: number }> = {};

    for (const session of sessions) {
      const date = new Date(session.updatedAt).toLocaleDateString();
      if (!byDate[date]) byDate[date] = { input: 0, output: 0, cost: 0 };
      byDate[date].cost += session.totalCost;
    }

    const labels = Object.keys(byDate).slice(-7);
    return {
      labels,
      inputTokens: labels.map(l => byDate[l]?.input || 0),
      outputTokens: labels.map(l => byDate[l]?.output || 0),
      costs: labels.map(l => byDate[l]?.cost || 0),
    };
  }

  private getModelPerformanceData(): ModelPerfData[] {
    const telemetryPath = join(homedir(), '.neuro', 'telemetry', 'models.json');
    try {
      if (existsSync(telemetryPath)) {
        const raw = readFileSync(telemetryPath, 'utf-8');
        const items = JSON.parse(raw) as Array<{
          key: string; requests: number; inputTokens: number;
          outputTokens: number; cost: number; latencies: number[];
        }>;

        return items.map(item => ({
          model: item.key,
          requestCount: item.requests,
          totalTokens: item.inputTokens + item.outputTokens,
          totalCost: item.cost,
          avgLatencyMs: item.latencies.length > 0
            ? Math.round(item.latencies.reduce((a, b) => a + b, 0) / item.latencies.length)
            : 0,
        }));
      }
    } catch { /* ignore */ }

    return [];
  }

  private getSpendingData(): SpendingData {
    const spendingPath = join(homedir(), '.neuro', 'spending');
    const today = new Date();
    const dateStr = today.getFullYear() + '-' +
      (today.getMonth() + 1).toString().padStart(2, '0') + '-' +
      today.getDate().toString().padStart(2, '0');

    try {
      const filePath = join(spendingPath, dateStr + '.json');
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const entries = JSON.parse(raw) as Array<{ model: string; cost: number }>;

        let todayTotal = 0;
        const todayByModel: Record<string, number> = {};
        for (const entry of entries) {
          todayTotal += entry.cost;
          todayByModel[entry.model] = (todayByModel[entry.model] || 0) + entry.cost;
        }

        return {
          todayTotal,
          todayByModel,
          sessionTotal: todayTotal,
          sessionByModel: todayByModel,
          dailyLimit: 0,
          estimatedDailySpend: todayTotal,
        };
      }
    } catch { /* ignore */ }

    return {
      todayTotal: 0,
      todayByModel: {},
      sessionTotal: 0,
      sessionByModel: {},
      dailyLimit: 0,
      estimatedDailySpend: 0,
    };
  }

  private getSystemInfo(): SystemInfoData {
    return {
      version: '3.0.0',
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      platform: process.platform,
      nodeVersion: process.version,
      modelsAvailable: 23,
      toolsAvailable: 10,
      agentsAvailable: 8,
      currentModel: 'default',
    };
  }

  private saveConfig(): void {
    try {
      const dir = join(DASHBOARD_CONFIG_PATH, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(DASHBOARD_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch { /* Silently fail */ }
  }

  private loadConfig(): void {
    try {
      if (existsSync(DASHBOARD_CONFIG_PATH)) {
        const raw = readFileSync(DASHBOARD_CONFIG_PATH, 'utf-8');
        const saved = JSON.parse(raw) as Partial<DashboardConfig>;
        this.config = { ...this.config, ...saved };
      }
    } catch { /* Silently fail */ }
  }
}
