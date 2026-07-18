#!/usr/bin/env node
// ============================================================
// NeuroCLI - Advanced AI Terminal Coding Assistant
// Main Entry Point - v2.0.0 with all new features
// ============================================================

import { Command } from 'commander';
import { createInterface } from 'readline';
import { NeuroEngine } from './core/engine.js';
import { initConfig, saveConfig } from './config/config.js';
import { MODELS } from './api/models.js';
import { TerminalUI } from './ui/renderer.js';
import { getTheme } from './ui/theme.js';
import { CompletionEngine } from './core/completion.js';
import { HeadlessMode } from './core/headless.js';
import chalk from 'chalk';

const VERSION = '2.0.0';

// ---- CLI Setup ----
const program = new Command();

program
  .name('neuro')
  .description('NeuroCLI - Advanced AI Terminal Coding Assistant')
  .version(VERSION)
  .option('-k, --api-key <key>', 'OpenRouter API key')
  .option('-m, --model <model>', 'Default model to use')
  .option('-t, --theme <theme>', 'UI theme (dracula, dark, nord, light)')
  .option('--no-streaming', 'Disable streaming output')
  .option('--auto-approve', 'Auto-approve all tool calls')
  .option('-c, --continue', 'Continue most recent session')
  .option('-r, --resume <sessionId>', 'Resume specific session')
  .option('--fork', 'Fork the resumed session instead of continuing it')
  .option('--permission-mode <mode>', 'Permission mode: manual, auto, plan, yolo')
  .option('--diff-preview', 'Enable diff preview before applying changes')
  .option('--no-diff-preview', 'Disable diff preview')
  .action(async (options) => {
    await startInteractive(options);
  });

// ---- Headless/CI Mode ----
program
  .command('run <prompt>')
  .description('Run a task in headless/CI mode')
  .option('-m, --model <model>', 'Model to use')
  .option('-a, --agent <agent>', 'Agent to use')
  .option('--max-turns <n>', 'Max agent iterations', parseInt)
  .option('--allowed-tools <tools>', 'Comma-separated list of allowed tools')
  .option('-f, --format <format>', 'Output format: text, json, stream-json')
  .option('--auto', 'Auto-approve all tool calls')
  .option('--continue <sessionId>', 'Continue a specific session')
  .action(async (prompt, opts) => {
    const result = await HeadlessMode.run({
      prompt,
      model: opts.model,
      agent: opts.agent,
      maxTurns: opts.maxTurns,
      allowedTools: opts.allowedTools?.split(','),
      outputFormat: opts.format || 'text',
      autoApprove: opts.auto ?? true,
      continueSession: opts.continue,
    });
    process.exit(result.exitCode);
  });

// ---- Non-interactive ask ----
program
  .command('ask <prompt>')
  .description('Ask a single question and exit')
  .option('-m, --model <model>', 'Model to use')
  .option('-a, --agent <agent>', 'Agent to use')
  .option('-f, --format <format>', 'Output format: text, json')
  .action(async (prompt, opts) => {
    const config = initConfig();
    if (opts.model) config.defaultModel = opts.model;
    const engine = new NeuroEngine(config);
    const result = await engine.processMessage(prompt, 'direct', opts.agent || 'Coder');
    if (opts.format === 'json') {
      console.log(JSON.stringify({ content: result.content, usage: result.usage }, null, 2));
    } else {
      console.log(result.content);
    }
    process.exit(0);
  });

// ---- Models list ----
program
  .command('models')
  .description('List available models')
  .action(() => {
    const config = initConfig();
    const ui = new TerminalUI(config.ui.theme);
    ui.modelList(config.defaultModel);
  });

// ---- Agents list ----
program
  .command('agents')
  .description('List available agents')
  .action(() => {
    const config = initConfig();
    const ui = new TerminalUI(config.ui.theme);
    const agents = Object.values(config.agents).map(a => ({
      name: a.name,
      description: a.description,
      model: a.model || config.defaultModel,
    }));
    ui.agentList(agents);
  });

// ---- Config ----
program
  .command('config')
  .description('Show or modify configuration')
  .option('--set-key <key>', 'Set API key')
  .option('--set-model <model>', 'Set default model')
  .option('--set-theme <theme>', 'Set UI theme')
  .option('--set-permission <mode>', 'Set permission mode (manual, auto, plan, yolo)')
  .option('--show', 'Show current config')
  .action(async (opts) => {
    const config = initConfig();
    const theme = getTheme(config.ui.theme);

    if (opts.setKey) { config.apiKey = opts.setKey; saveConfig(config); console.log(chalk.green('API key updated')); }
    if (opts.setModel) { if (!MODELS[opts.setModel]) { console.log(chalk.red(`Unknown model: ${opts.setModel}`)); process.exit(1); } config.defaultModel = opts.setModel; saveConfig(config); console.log(chalk.green(`Default model set to ${MODELS[opts.setModel].name}`)); }
    if (opts.setTheme) { config.ui.theme = opts.setTheme; saveConfig(config); console.log(chalk.green(`Theme set to ${opts.setTheme}`)); }
    if (opts.setPermission) { config.permissionMode = opts.setPermission; saveConfig(config); console.log(chalk.green(`Permission mode set to ${opts.setPermission}`)); }
    if (opts.show || (!opts.setKey && !opts.setModel && !opts.setTheme && !opts.setPermission)) {
      console.log(chalk.bold('\nCurrent Configuration:\n'));
      console.log(`  API Key: ${config.apiKey ? chalk.green('configured') : chalk.red('not set')}`);
      console.log(`  Base URL: ${config.baseUrl}`);
      console.log(`  Default Model: ${config.defaultModel}`);
      console.log(`  Theme: ${config.ui.theme}`);
      console.log(`  Permission Mode: ${config.permissionMode}`);
      console.log(`  Diff Preview: ${config.diffPreview ? 'enabled' : 'disabled'}`);
      console.log(`  Fallback Chain: ${config.fallbackChain.models.join(' -> ')}`);
      console.log(`  Doom Loop Protection: ${config.doomLoop.autoBreak ? 'enabled' : 'disabled'}`);
      console.log(`  MCP Auto-Connect: ${config.mcp.autoConnect ? 'enabled' : 'disabled'}`);
      console.log(`  Streaming: ${config.ui.streaming ? 'enabled' : 'disabled'}`);
      console.log();
    }
  });

// ---- Sessions ----
program
  .command('sessions')
  .description('List or manage sessions')
  .option('--clear', 'Clear all sessions')
  .action(async (opts) => {
    const { SessionManager } = await import('./core/session.js');
    const sm = new SessionManager();

    if (opts.clear) { console.log(chalk.yellow('Clearing all sessions...')); return; }
    const sessions = sm.list();
    if (sessions.length === 0) { console.log(chalk.gray('No sessions found.')); return; }
    console.log(chalk.bold('\nSessions:\n'));
    for (const session of sessions.slice(0, 20)) {
      const date = new Date(session.createdAt).toLocaleString();
      console.log(`  ${chalk.cyan(session.id.slice(0, 20))}  ${chalk.gray(date)}  ${chalk.gray(`${session.messageCount} msgs`)}  ${chalk.gray(`$${session.cost.toFixed(4)}`)}`);
    }
    console.log();
  });

// ---- MCP Management ----
program
  .command('mcp')
  .description('Manage MCP (Model Context Protocol) servers')
  .addCommand(
    new Command('add')
      .description('Add an MCP server')
      .argument('<name>', 'Server name')
      .argument('<command>', 'Command to run (for stdio) or URL (for http/sse)')
      .option('-t, --transport <type>', 'Transport type: stdio, sse, http', 'stdio')
      .option('--headers <json>', 'HTTP headers as JSON string')
      .action(async (name, command, opts) => {
        const { MCPClient } = await import('./mcp/client.js');
        const client = new MCPClient();
        const isUrl = command.startsWith('http://') || command.startsWith('https://');
        const transport = isUrl ? (opts.transport === 'http' ? 'http' : 'sse') : 'stdio';
        
        client.addServer(name, {
          name,
          transport: transport as 'stdio' | 'sse' | 'http',
          command: transport === 'stdio' ? command : undefined,
          url: isUrl ? command : undefined,
          headers: opts.headers ? JSON.parse(opts.headers) : undefined,
        });
        console.log(chalk.green(`MCP server "${name}" added (${transport})`));
      })
  )
  .addCommand(
    new Command('list').description('List configured MCP servers').action(async () => {
      const { MCPClient } = await import('./mcp/client.js');
      const client = new MCPClient();
      const servers = client.listServers();
      if (servers.length === 0) { console.log(chalk.gray('No MCP servers configured.')); return; }
      console.log(chalk.bold('\nMCP Servers:\n'));
      for (const s of servers) {
        const status = s.connected ? chalk.green('connected') : chalk.gray('disconnected');
        console.log(`  ${chalk.cyan(s.name)}  ${status}  ${chalk.gray(`${s.toolCount} tools`)}  ${chalk.gray(s.config.transport)}`);
      }
      console.log();
    })
  )
  .addCommand(
    new Command('remove').description('Remove an MCP server').argument('<name>').action(async (name) => {
      const { MCPClient } = await import('./mcp/client.js');
      const client = new MCPClient();
      if (client.removeServer(name)) console.log(chalk.green(`MCP server "${name}" removed`));
      else console.log(chalk.red(`MCP server "${name}" not found`));
    })
  );

// ---- Interactive Mode ----
async function startInteractive(options: any) {
  const config = initConfig(options.apiKey);
  if (options.model) config.defaultModel = options.model;
  if (options.theme) config.ui.theme = options.theme as 'dark' | 'light' | 'dracula' | 'nord';
  if (options.noStreaming) config.ui.streaming = false;
  if (options.permissionMode) config.permissionMode = options.permissionMode;
  if (options.diffPreview === true) config.diffPreview = true;
  if (options.diffPreview === false) config.diffPreview = false;
  if (options.autoApprove) {
    config.tools.autoApprove = [...config.tools.autoApprove, ...config.tools.requireApproval];
    config.tools.requireApproval = [];
    config.permissionMode = 'yolo';
  }

  // Check API key
  if (!config.apiKey) {
    console.log(chalk.red('\nOpenRouter API key not configured!'));
    console.log(chalk.yellow('\nSet it with:'));
    console.log(`  ${chalk.cyan('neuro config --set-key YOUR_API_KEY')}`);
    console.log(`  ${chalk.cyan('export OPENROUTER_API_KEY=YOUR_API_KEY')}`);
    console.log(`  ${chalk.cyan('neuro -k YOUR_API_KEY')}`);
    console.log(chalk.gray('\nGet your key at: https://openrouter.ai/keys\n'));
    process.exit(1);
  }

  // Initialize engine
  const engine = new NeuroEngine(config);

  // Resume session if requested
  if (options.resume) {
    const session = engine.sessionManager.load(options.resume);
    if (session) {
      engine.ui.success(`Resumed session: ${session.id.slice(0, 20)}...`);
    } else {
      engine.ui.error(`Session not found: ${options.resume}`);
    }
  } else if (options.continue) {
    const sessions = engine.sessionManager.list();
    if (sessions.length > 0) {
      const session = engine.sessionManager.load(sessions[0].id);
      if (session) {
        engine.ui.success(`Continued session: ${session.id.slice(0, 20)}...`);
      }
    } else {
      engine.ui.warning('No sessions found to continue');
    }
  }

  // Print banner
  engine.ui.banner();
  const theme = engine.ui.theme;
  const permMode = engine.approval.getMode();
  const permIcon = engine.approval.getModeIcon();
  console.log(theme.muted(`  Model: ${MODELS[config.defaultModel]?.name || config.defaultModel}`));
  console.log(theme.muted(`  Permission: ${permIcon} ${permMode}`));
  console.log(theme.muted(`  Working Dir: ${process.cwd()}`));
  console.log(theme.muted(`  Type /help for commands, Tab for completion, Ctrl+C to exit\n`));

  // Create readline with tab completion
  const completionEngine = new CompletionEngine(process.cwd());
  completionEngine.setAgentNames(Array.from(engine.agents.keys()));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('❯ '),
    historySize: 100,
    completer: completionEngine.complete,
  });

  rl.prompt();

  let currentMode: 'auto' | 'agent' | 'direct' = 'auto';
  let currentAgent: string | undefined;

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // Handle slash commands
    if (input.startsWith('/')) {
      const [cmd, ...args] = input.slice(1).split(' ');

      switch (cmd) {
        case 'help':
          printHelp(engine);
          break;

        case 'model':
          if (args[0]) {
            engine.switchModel(args[0]);
            // Update fallback chain to put new model first
            engine.fallback.addFallbackModel(config.defaultModel);
          } else {
            engine.ui.modelList(config.defaultModel);
          }
          break;

        case 'agent':
          if (args[0]) {
            const agentNames = Array.from(engine.agents.keys());
            const found = agentNames.find(n => n.toLowerCase() === args[0].toLowerCase());
            if (found) { currentAgent = found; currentMode = 'direct'; engine.ui.success(`Switched to agent: ${found}`); }
            else { engine.ui.error(`Agent not found. Available: ${agentNames.join(', ')}`); }
          } else {
            const agents = Array.from(engine.agents.entries()).map(([name]) => ({ name, description: '', model: config.defaultModel }));
            engine.ui.agentList(agents);
          }
          break;

        case 'auto':
          currentMode = 'auto'; currentAgent = undefined;
          engine.ui.success('Mode: Auto (smart orchestration)');
          break;

        case 'orchestrate':
        case 'plan':
          currentMode = 'agent'; currentAgent = undefined;
          engine.ui.success('Mode: Multi-agent orchestration');
          break;

        case 'direct':
          currentMode = 'direct';
          engine.ui.success('Mode: Direct (single agent)');
          break;

        case 'plan-mode':
          engine.approval.setMode('plan');
          engine.ui.success(`${engine.approval.getModeIcon()} Permission: plan (read-only)`);
          break;

        case 'stats':
          const stats = engine.getSessionStats();
          engine.ui.sessionStats(stats.inputTokens, stats.outputTokens, stats.cost);
          break;

        case 'clear':
          console.clear(); engine.ui.banner();
          break;

        case 'theme':
          if (args[0]) {
            config.ui.theme = args[0] as 'dark' | 'light' | 'dracula' | 'nord';
            engine.ui = new TerminalUI(config.ui.theme, config.ui.showTokenCount, config.ui.showCost);
            engine.ui.success(`Theme: ${args[0]}`);
          } else { console.log('Available themes: dracula, dark, nord, light'); }
          break;

        case 'resume':
          if (args[0]) {
            const sessionId = args[0] === 'latest' ? engine.sessionManager.list()[0]?.id : args[0];
            if (sessionId) {
              const session = engine.sessionManager.load(sessionId);
              if (session) engine.ui.success(`Resumed session: ${sessionId.slice(0, 20)}...`);
              else engine.ui.error(`Session not found: ${sessionId}`);
            } else { engine.ui.error('No sessions found'); }
          } else {
            const sessions = engine.sessionManager.list();
            if (sessions.length === 0) { engine.ui.info('No sessions found'); break; }
            console.log(chalk.bold('\nRecent sessions:\n'));
            for (const s of sessions.slice(0, 10)) {
              const date = new Date(s.createdAt).toLocaleString();
              console.log(`  ${chalk.cyan(s.id.slice(0, 20))}  ${chalk.gray(date)}  ${chalk.gray(`${s.messageCount} msgs`)}`);
            }
            console.log(chalk.gray('\nUse /resume <id> to resume a session'));
          }
          break;

        case 'compact':
          engine.ui.info('Compacting conversation context...');
          // Trigger context compaction
          engine.contextManager.manage(engine.sessionManager.getCurrent()?.messages || []);
          engine.ui.success('Context compacted');
          break;

        case 'undo':
          engine.ui.info('Undoing last change...');
          try {
            const { GitCheckpointSystem } = await import('./context/git-checkpoint.js');
            const cps = new GitCheckpointSystem(process.cwd());
            await cps.undo();
            engine.ui.success('Last change undone');
          } catch (e) {
            engine.ui.error('Could not undo: ' + (e instanceof Error ? e.message : String(e)));
          }
          break;

        case 'redo':
          engine.ui.info('Redo not yet implemented (requires undo stack)');
          break;

        case 'fork':
          engine.ui.info('Forking current session...');
          const currentSession = engine.sessionManager.getCurrent();
          if (currentSession) {
            const forked = engine.sessionManager.create(process.cwd(), config.defaultModel);
            forked.messages = [...currentSession.messages];
            engine.sessionManager.save();
            engine.ui.success(`Forked to new session: ${forked.id.slice(0, 20)}...`);
          } else {
            engine.ui.error('No active session to fork');
          }
          break;

        case 'mcp':
          const mcpSub = args[0];
          if (mcpSub === 'list') {
            const servers = engine.mcpClient.listServers();
            if (servers.length === 0) { engine.ui.info('No MCP servers configured'); break; }
            console.log(chalk.bold('\nMCP Servers:\n'));
            for (const s of servers) {
              const status = s.connected ? chalk.green('● connected') : chalk.gray('○ disconnected');
              console.log(`  ${chalk.cyan(s.name.padEnd(20))} ${status}  ${chalk.gray(`${s.toolCount} tools`)}  ${chalk.gray(s.config.transport)}`);
            }
          } else if (mcpSub === 'connect' && args[1]) {
            try {
              const cfg = engine.mcpClient.loadConfig();
              if (cfg.mcpServers[args[1]]) {
                await engine.mcpClient.connect(args[1], cfg.mcpServers[args[1]]);
                engine.ui.success(`Connected to MCP server: ${args[1]}`);
              } else { engine.ui.error(`MCP server "${args[1]}" not found`); }
            } catch (e) { engine.ui.error(`Failed to connect: ${e instanceof Error ? e.message : String(e)}`); }
          } else if (mcpSub === 'disconnect' && args[1]) {
            await engine.mcpClient.disconnect(args[1]);
            engine.ui.success(`Disconnected from ${args[1]}`);
          } else if (mcpSub === 'health') {
            engine.mcpClient.healthReport();
          } else {
            console.log(chalk.bold('\nMCP Commands:\n'));
            console.log('  /mcp list              List MCP servers');
            console.log('  /mcp connect <name>    Connect to a server');
            console.log('  /mcp disconnect <name> Disconnect from a server');
            console.log('  /mcp health            Show MCP health report');
            console.log('  neuro mcp add <name> <cmd>  Add server (CLI)');
            console.log('  neuro mcp list               List servers (CLI)');
          }
          break;

        case 'permission':
        case 'perm':
          if (args[0]) {
            const validModes = ['manual', 'auto', 'plan', 'yolo'];
            if (validModes.includes(args[0])) {
              engine.approval.setMode(args[0] as any);
              engine.ui.success(`${engine.approval.getModeIcon()} Permission: ${args[0]} (${engine.approval.getModeDescription()})`);
            } else { engine.ui.error(`Invalid mode. Use: ${validModes.join(', ')}`); }
          } else {
            const newMode = engine.approval.cycleMode();
            engine.ui.success(`${engine.approval.getModeIcon()} Permission: ${newMode} (${engine.approval.getModeDescription()})`);
          }
          break;

        case 'init':
          engine.ui.info('Initializing NEURO.md for this project...');
          try {
            const { NeuroMdSystem } = await import('./context/neuro-md.js');
            const nmd = new NeuroMdSystem();
            await nmd.autoGenerate(process.cwd());
            engine.ui.success('NEURO.md created');
          } catch (e) { engine.ui.error('Could not create NEURO.md: ' + (e instanceof Error ? e.message : String(e))); }
          break;

        case 'unpause':
          engine.doomLoop.unpause();
          break;

        case 'sandbox':
          if (args[0] === 'on' || args[0] === 'enable') {
            engine.sandbox.enable();
            engine.ui.success('🔒 Sandbox mode enabled');
          } else if (args[0] === 'off' || args[0] === 'disable') {
            engine.sandbox.disable();
            engine.ui.success('🔓 Sandbox mode disabled');
          } else if (args[0] === 'status') {
            engine.sandbox.printStatus();
          } else if (args[0] === 'undo') {
            const undone = engine.sandbox.undoAll();
            engine.ui.success(`Undone ${undone} file modifications`);
          } else {
            const enabled = engine.sandbox.toggle();
            engine.ui.success(enabled ? '🔒 Sandbox mode enabled' : '🔓 Sandbox mode disabled');
          }
          break;

        case 'plugins':
        case 'plugin':
          const pluginSub = args[0];
          if (pluginSub === 'list') {
            const plugins = engine.pluginManager.listPlugins();
            if (plugins.length === 0) { engine.ui.info('No plugins loaded'); break; }
            console.log(chalk.bold('\nPlugins:\n'));
            for (const p of plugins) {
              console.log(`  ${chalk.cyan(p.name)} v${p.version} - ${chalk.gray(p.description)} ${chalk.green(`${p.toolCount} tools`)}`);
            }
          } else if (pluginSub === 'load' && args[1]) {
            try {
              await engine.pluginManager.loadByName(args[1]);
              engine.ui.success(`Plugin "${args[1]}" loaded`);
            } catch (e) { engine.ui.error(`Failed to load plugin: ${e instanceof Error ? e.message : String(e)}`); }
          } else {
            console.log(chalk.bold('\nPlugin Commands:\n'));
            console.log('  /plugins list           List loaded plugins');
            console.log('  /plugins load <name>    Load a plugin');
          }
          break;

        case 'whitelist':
          if (args[0] === 'add' && args[1]) {
            engine.approval.addToWhitelist(args[1]);
            engine.ui.success(`Added "${args[1]}" to whitelist`);
          } else if (args[0] === 'remove' && args[1]) {
            engine.approval.removeFromWhitelist(args[1]);
            engine.ui.success(`Removed "${args[1]}" from whitelist`);
          } else if (args[0] === 'list') {
            const wl = engine.approval.getWhitelist();
            console.log(chalk.bold('\nWhitelisted tools:\n'));
            for (const t of wl) console.log(`  ${chalk.green('✓')} ${t}`);
          } else {
            console.log('Usage: /whitelist add|remove|list <tool>');
          }
          break;

        case 'blacklist':
          if (args[0] === 'add' && args[1]) {
            engine.approval.addToBlacklist(args[1]);
            engine.ui.success(`Added "${args[1]}" to blacklist`);
          } else if (args[0] === 'remove' && args[1]) {
            engine.approval.removeFromBlacklist(args[1]);
            engine.ui.success(`Removed "${args[1]}" from blacklist`);
          } else if (args[0] === 'list') {
            const bl = engine.approval.getBlacklist();
            console.log(chalk.bold('\nBlacklisted tools:\n'));
            for (const t of bl) console.log(`  ${chalk.red('✗')} ${t}`);
          } else {
            console.log('Usage: /blacklist add|remove|list <tool>');
          }
          break;

        case 'doctor':
          console.log(chalk.bold('\nNeuroCLI Health Check:\n'));
          console.log(`  API Key: ${config.apiKey ? chalk.green('configured') : chalk.red('MISSING')}`);
          console.log(`  Default Model: ${chalk.cyan(config.defaultModel)} ${MODELS[config.defaultModel] ? chalk.green('valid') : chalk.red('INVALID')}`);
          console.log(`  MCP Servers: ${chalk.cyan(String(engine.mcpClient.listServers().length))}`);
          console.log(`  Permission Mode: ${chalk.cyan(engine.approval.getMode())}`);
          console.log(`  Diff Preview: ${config.diffPreview ? chalk.green('enabled') : chalk.gray('disabled')}`);
          console.log(`  Fallback Chain: ${config.fallbackChain.models.length > 0 ? chalk.green(config.fallbackChain.models.length + ' models') : chalk.yellow('none')}`);
          console.log(`  Doom Loop Protection: ${config.doomLoop.autoBreak ? chalk.green('enabled') : chalk.yellow('disabled')}`);
          console.log(`  Sandbox: ${engine.sandbox.isEnabled() ? chalk.green('enabled') : chalk.gray('disabled')}`);
          console.log(`  Plugins: ${chalk.cyan(String(engine.pluginManager.listPlugins().length))}`);
          console.log(`  Sessions: ${chalk.cyan(String(engine.sessionManager.list().length))}`);
          console.log(`  Spending Limit: ${config.spendingLimit > 0 ? chalk.cyan('$' + config.spendingLimit.toFixed(2)) : chalk.gray('unlimited')}`);
          console.log();
          break;

        case 'export':
          const exportSession = engine.sessionManager.getCurrent();
          if (exportSession) {
            const json = JSON.stringify(exportSession, null, 2);
            console.log(json);
          } else { engine.ui.warning('No active session to export'); }
          break;

        case 'exit':
        case 'quit':
        case 'q':
          engine.mcpClient.disconnectAll().catch(() => {});
          engine.approval.close();
          engine.ui.info('Goodbye!');
          process.exit(0);
          break;

        default:
          engine.ui.error(`Unknown command: /${cmd}. Type /help for available commands.`);
      }

      rl.prompt();
      return;
    }

    // Process message with the engine
    try {
      await engine.processMessage(input, currentMode, currentAgent);
    } catch (error) {
      engine.ui.error(error instanceof Error ? error.message : String(error));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    engine.mcpClient.disconnectAll().catch(() => {});
    engine.approval.close();
    engine.ui.info('Goodbye!');
    process.exit(0);
  });
}

function printHelp(engine: NeuroEngine): void {
  const t = engine.ui.theme;
  console.log(`\n  ${t.bold('NeuroCLI Commands:')}\n`);
  console.log(`  ${t.tool('/help')}            Show this help message`);
  console.log(`  ${t.tool('/model [id]')}      Switch or list models`);
  console.log(`  ${t.tool('/agent [name]')}    Switch or list agents`);
  console.log(`  ${t.tool('/auto')}            Auto mode (smart orchestration)`);
  console.log(`  ${t.tool('/orchestrate')}     Multi-agent orchestration mode`);
  console.log(`  ${t.tool('/direct')}          Direct agent mode`);
  console.log(`  ${t.tool('/plan-mode')}       Plan mode (read-only, no modifications)`);
  console.log(`  ${t.tool('/permission [m]')}  Cycle or set permission mode`);
  console.log(`  ${t.tool('/resume [id]')}     Resume a previous session`);
  console.log(`  ${t.tool('/fork')}            Fork current session`);
  console.log(`  ${t.tool('/compact')}         Compact conversation context`);
  console.log(`  ${t.tool('/undo')}            Undo last change`);
  console.log(`  ${t.tool('/mcp [cmd]')}       Manage MCP servers`);
  console.log(`  ${t.tool('/init')}            Initialize NEURO.md`);
  console.log(`  ${t.tool('/sandbox')}         Toggle sandbox mode`);
  console.log(`  ${t.tool('/plugins')}         Manage plugins`);
  console.log(`  ${t.tool('/whitelist')}       Manage tool whitelist`);
  console.log(`  ${t.tool('/blacklist')}       Manage tool blacklist`);
  console.log(`  ${t.tool('/doctor')}          Health check`);
  console.log(`  ${t.tool('/export')}          Export current session as JSON`);
  console.log(`  ${t.tool('/stats')}           Show session statistics`);
  console.log(`  ${t.tool('/theme [name]')}    Switch UI theme`);
  console.log(`  ${t.tool('/clear')}           Clear terminal`);
  console.log(`  ${t.tool('/exit')}            Exit NeuroCLI`);
  console.log();
  console.log(`  ${t.muted('Tab: auto-complete commands, models, files')}`);
  console.log(`  ${t.muted('Shift+Tab: cycle permission modes')}`);
  console.log();
  console.log(`  ${t.muted('Examples:')}`);
  console.log(`  ${t.muted('  "Create a REST API with Express"')}`);
  console.log(`  ${t.muted('  "Fix the bug in auth.ts"')}`);
  console.log(`  ${t.muted('  "Explain how this codebase works"')}`);
  console.log();
}

// Parse and execute
program.parse(process.argv);
