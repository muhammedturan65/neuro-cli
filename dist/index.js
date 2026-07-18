#!/usr/bin/env node
// ============================================================
// NeuroCLI - Advanced AI Terminal Coding Assistant
// Main Entry Point - v4.1.2 with cross-platform path fix
// ============================================================
import { Command } from 'commander';
import { createInterface } from 'readline';
import { writeFileSync, readFileSync } from 'fs';
import { NeuroEngine } from './core/engine.js';
import { initConfig, saveConfig } from './config/config.js';
import { MODELS } from './api/models.js';
import { TerminalUI } from './ui/renderer.js';
import { getTheme } from './ui/theme.js';
import { CompletionEngine } from './core/completion.js';
import { HeadlessMode } from './core/headless.js';
import { ShellCompletionGenerator } from './core/shell-completion.js';
import chalk from 'chalk';
import { AutoUpdater } from './core/updater.js';
const VERSION = '4.1.2';
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
    .option('--effort <level>', 'Effort level: low, medium, high, ultrathink')
    .option('--style <style>', 'Output style: concise, explanatory, learning, etc.')
    .option('--thinking', 'Enable extended thinking display')
    .option('--cache', 'Enable prompt caching')
    .option('--no-cache', 'Disable prompt caching')
    .option('--sandbox', 'Enable sandbox mode')
    .option('--spending-limit <usd>', 'Set daily spending limit in USD', parseFloat)
    .option('--ollama', 'Use Ollama local models instead of OpenRouter')
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
    if (opts.model)
        config.defaultModel = opts.model;
    const engine = new NeuroEngine(config);
    const result = await engine.processMessage(prompt, 'direct', opts.agent || 'Coder');
    if (opts.format === 'json') {
        console.log(JSON.stringify({ content: result.content, usage: result.usage }, null, 2));
    }
    else {
        console.log(result.content);
    }
    process.exit(0);
});
// ---- Models list ----
program
    .command('models')
    .description('List available models')
    .option('--ollama', 'List Ollama local models')
    .action(async (opts) => {
    if (opts.ollama) {
        const { OllamaProvider } = await import('./api/ollama.js');
        const provider = new OllamaProvider();
        try {
            const models = await provider.listModels();
            if (models.length === 0) {
                console.log(chalk.yellow('No local models found. Is Ollama running?'));
                return;
            }
            console.log(chalk.bold('\nOllama Local Models:\n'));
            for (const m of models) {
                console.log(`  ${chalk.cyan(m.name.padEnd(40))} ${chalk.gray(m.details.parameter_size || '')} ${chalk.gray(m.details.quantization_level || '')}`);
            }
        }
        catch {
            console.log(chalk.red('Could not connect to Ollama. Is it running?'));
        }
        return;
    }
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
    .option('--set-spending-limit <usd>', 'Set daily spending limit in USD', parseFloat)
    .option('--show', 'Show current config')
    .action(async (opts) => {
    const config = initConfig();
    const theme = getTheme(config.ui.theme);
    if (opts.setKey) {
        config.apiKey = opts.setKey;
        saveConfig(config);
        console.log(chalk.green('API key updated'));
    }
    if (opts.setModel) {
        if (!MODELS[opts.setModel]) {
            console.log(chalk.red(`Unknown model: ${opts.setModel}`));
            process.exit(1);
        }
        config.defaultModel = opts.setModel;
        saveConfig(config);
        console.log(chalk.green(`Default model set to ${MODELS[opts.setModel].name}`));
    }
    if (opts.setTheme) {
        config.ui.theme = opts.setTheme;
        saveConfig(config);
        console.log(chalk.green(`Theme set to ${opts.setTheme}`));
    }
    if (opts.setPermission) {
        config.permissionMode = opts.setPermission;
        saveConfig(config);
        console.log(chalk.green(`Permission mode set to ${opts.setPermission}`));
    }
    if (opts.setSpendingLimit !== undefined) {
        config.spendingLimit = opts.setSpendingLimit;
        saveConfig(config);
        console.log(chalk.green(`Spending limit set to $${opts.setSpendingLimit}`));
    }
    if (opts.show || (!opts.setKey && !opts.setModel && !opts.setTheme && !opts.setPermission && opts.setSpendingLimit === undefined)) {
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
        console.log(`  Prompt Cache: ${config.promptCache.enabled ? 'enabled' : 'disabled'}`);
        console.log(`  Spending Limit: ${config.spendingLimit > 0 ? '$' + config.spendingLimit.toFixed(2) : 'unlimited'}`);
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
    if (opts.clear) {
        console.log(chalk.yellow('Clearing all sessions...'));
        return;
    }
    const sessions = sm.list();
    if (sessions.length === 0) {
        console.log(chalk.gray('No sessions found.'));
        return;
    }
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
    .addCommand(new Command('add')
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
        transport: transport,
        command: transport === 'stdio' ? command : undefined,
        url: isUrl ? command : undefined,
        headers: opts.headers ? JSON.parse(opts.headers) : undefined,
    });
    console.log(chalk.green(`MCP server "${name}" added (${transport})`));
}))
    .addCommand(new Command('list').description('List configured MCP servers').action(async () => {
    const { MCPClient } = await import('./mcp/client.js');
    const client = new MCPClient();
    const servers = client.listServers();
    if (servers.length === 0) {
        console.log(chalk.gray('No MCP servers configured.'));
        return;
    }
    console.log(chalk.bold('\nMCP Servers:\n'));
    for (const s of servers) {
        const status = s.connected ? chalk.green('connected') : chalk.gray('disconnected');
        console.log(`  ${chalk.cyan(s.name)}  ${status}  ${chalk.gray(`${s.toolCount} tools`)}  ${chalk.gray(s.config.transport)}`);
    }
    console.log();
}))
    .addCommand(new Command('remove').description('Remove an MCP server').argument('<name>').action(async (name) => {
    const { MCPClient } = await import('./mcp/client.js');
    const client = new MCPClient();
    if (client.removeServer(name))
        console.log(chalk.green(`MCP server "${name}" removed`));
    else
        console.log(chalk.red(`MCP server "${name}" not found`));
}));
// ---- Update Command ----
program
    .command('update')
    .description('Check for updates and optionally self-update')
    .option('--force', 'Force check even if recently checked')
    .option('--auto', 'Auto-update without prompting')
    .option('--check-only', 'Only check, do not update')
    .option('--dismiss', 'Dismiss the current available update')
    .action(async (opts) => {
    const updater = new AutoUpdater({ currentVersion: VERSION });
    if (opts.dismiss) {
        const result = await updater.checkForUpdate(true);
        if (result.hasUpdate) {
            updater.dismissVersion(result.latestVersion);
            console.log(chalk.gray(`Dismissed update notification for v${result.latestVersion}`));
        }
        else {
            console.log(chalk.gray('No update to dismiss'));
        }
        return;
    }
    if (opts.auto) {
        updater.setAutoUpdate(true);
    }
    if (opts.checkOnly) {
        console.log(chalk.cyan('Checking for updates...'));
        const result = await updater.checkForUpdate(opts.force);
        if (result.hasUpdate) {
            updater.showUpdateDetails(result);
        }
        else {
            updater.showUpToDate();
        }
        return;
    }
    // Interactive update flow
    await updater.interactiveUpdate();
});
// ---- Shell Completion ----
program
    .command('completion <shell>')
    .description('Generate shell completion script (bash, zsh, fish)')
    .action((shell) => {
    const generator = new ShellCompletionGenerator(ShellCompletionGenerator.getDefaultOptions());
    const script = generator.generate(shell);
    console.log(script);
});
// ---- Interactive Mode ----
async function startInteractive(options) {
    const config = initConfig(options.apiKey);
    if (options.model)
        config.defaultModel = options.model;
    if (options.theme)
        config.ui.theme = options.theme;
    if (options.noStreaming)
        config.ui.streaming = false;
    if (options.permissionMode)
        config.permissionMode = options.permissionMode;
    if (options.diffPreview === true)
        config.diffPreview = true;
    if (options.diffPreview === false)
        config.diffPreview = false;
    if (options.cache === true)
        config.promptCache.enabled = true;
    if (options.cache === false)
        config.promptCache.enabled = false;
    if (options.spendingLimit)
        config.spendingLimit = options.spendingLimit;
    if (options.autoApprove) {
        config.tools.autoApprove = [...config.tools.autoApprove, ...config.tools.requireApproval];
        config.tools.requireApproval = [];
        config.permissionMode = 'yolo';
    }
    // Check API key
    if (!config.apiKey && !options.ollama) {
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
    // Set effort level if specified
    if (options.effort) {
        engine.modelRouter.setEffort(options.effort);
    }
    // Set output style if specified
    if (options.style) {
        engine.styleManager.setStyle(options.style);
    }
    // Enable thinking if specified
    if (options.thinking) {
        engine.extendedThinking.setMode('full');
        engine.extendedThinking.toggleDisplay();
    }
    // Enable sandbox if specified
    if (options.sandbox) {
        engine.sandbox.enable();
    }
    // Enable prompt cache if specified
    if (options.cache) {
        config.promptCache.enabled = true;
    }
    // Resume session if requested
    if (options.resume) {
        const session = engine.sessionManager.load(options.resume);
        if (session) {
            engine.ui.success(`Resumed session: ${session.id.slice(0, 20)}...`);
            if (options.fork) {
                const forked = engine.sessionManager.create(process.cwd(), config.defaultModel);
                forked.messages = [...session.messages];
                engine.sessionManager.save();
                engine.ui.success(`Forked to new session: ${forked.id.slice(0, 20)}...`);
            }
        }
        else {
            engine.ui.error(`Session not found: ${options.resume}`);
        }
    }
    else if (options.continue) {
        const sessions = engine.sessionManager.list();
        if (sessions.length > 0) {
            const session = engine.sessionManager.load(sessions[0].id);
            if (session) {
                engine.ui.success(`Continued session: ${session.id.slice(0, 20)}...`);
            }
        }
        else {
            engine.ui.warning('No sessions found to continue');
        }
    }
    // Initialize auto-updater and check for updates in background
    const updater = new AutoUpdater({ currentVersion: VERSION });
    const updateCheck = updater.checkOnStartup(); // Fire and forget — don't block startup
    // Print banner
    engine.ui.banner();
    const theme = engine.ui.theme;
    const permMode = engine.approval.getMode();
    const permIcon = engine.approval.getModeIcon();
    const activeStyle = engine.styleManager.getStyle();
    console.log(theme.muted(`  Model: ${MODELS[config.defaultModel]?.name || config.defaultModel}`));
    console.log(theme.muted(`  Permission: ${permIcon} ${permMode}`));
    console.log(theme.muted(`  Style: ${activeStyle.name}`));
    console.log(theme.muted(`  Thinking: ${engine.extendedThinking.getMode()}`));
    console.log(theme.muted(`  Cache: ${config.promptCache.enabled ? 'on' : 'off'}`));
    console.log(theme.muted(`  Working Dir: ${process.cwd()}`));
    console.log(theme.muted(`  Type /help for commands, Tab for completion, Ctrl+C to exit\n`));
    // Show update notification if available (after banner)
    updateCheck.then((result) => {
        if (result && result.hasUpdate) {
            updater.showUpdateNotification(result);
        }
    }).catch(() => { });
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
    // Wire the main readline to the approval system to prevent dual-readline bug
    // (double character input when approval prompt and main rl both read stdin)
    engine.approval.setMainReadline(rl);
    let currentMode = 'auto';
    let currentAgent;
    let isProcessing = false;
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
        // Prevent input while processing (approval prompt may be active)
        if (isProcessing) {
            return;
        }
        // Add to history
        completionEngine.addHistory(input);
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
                        engine.fallback.addFallbackModel(config.defaultModel);
                    }
                    else {
                        engine.ui.modelList(config.defaultModel);
                    }
                    break;
                case 'agent':
                    if (args[0]) {
                        const agentNames = Array.from(engine.agents.keys());
                        const found = agentNames.find(n => n.toLowerCase() === args[0].toLowerCase());
                        if (found) {
                            currentAgent = found;
                            currentMode = 'direct';
                            engine.ui.success(`Switched to agent: ${found}`);
                        }
                        else {
                            engine.ui.error(`Agent not found. Available: ${agentNames.join(', ')}`);
                        }
                    }
                    else {
                        const agents = Array.from(engine.agents.entries()).map(([name]) => ({ name, description: '', model: config.defaultModel }));
                        engine.ui.agentList(agents);
                    }
                    break;
                case 'auto':
                    currentMode = 'auto';
                    currentAgent = undefined;
                    engine.ui.success('Mode: Auto (smart orchestration)');
                    break;
                case 'orchestrate':
                case 'plan':
                    currentMode = 'agent';
                    currentAgent = undefined;
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
                    console.clear();
                    engine.ui.banner();
                    break;
                case 'theme':
                    if (args[0]) {
                        config.ui.theme = args[0];
                        engine.ui = new TerminalUI(config.ui.theme, config.ui.showTokenCount, config.ui.showCost);
                        engine.ui.success(`Theme: ${args[0]}`);
                    }
                    else {
                        console.log('Available themes: dracula, dark, nord, light');
                    }
                    break;
                case 'resume':
                    if (args[0]) {
                        const sessionId = args[0] === 'latest' ? engine.sessionManager.list()[0]?.id : args[0];
                        if (sessionId) {
                            const session = engine.sessionManager.load(sessionId);
                            if (session)
                                engine.ui.success(`Resumed session: ${sessionId.slice(0, 20)}...`);
                            else
                                engine.ui.error(`Session not found: ${sessionId}`);
                        }
                        else {
                            engine.ui.error('No sessions found');
                        }
                    }
                    else {
                        const sessions = engine.sessionManager.list();
                        if (sessions.length === 0) {
                            engine.ui.info('No sessions found');
                            break;
                        }
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
                    engine.contextManager.manage(engine.sessionManager.getCurrent()?.messages || []);
                    engine.ui.success('Context compacted');
                    break;
                case 'undo':
                    engine.ui.info('Undoing last change...');
                    const undoAction = engine.undoRedo.undo();
                    if (undoAction) {
                        engine.ui.success(`Undone: ${undoAction.description}`);
                    }
                    else {
                        engine.ui.warning('Nothing to undo');
                    }
                    break;
                case 'redo':
                    engine.ui.info('Redoing...');
                    const redoAction = engine.undoRedo.redo();
                    if (redoAction) {
                        engine.ui.success(`Redone: ${redoAction.description}`);
                    }
                    else {
                        engine.ui.warning('Nothing to redo');
                    }
                    break;
                case 'rewind':
                    const rewindN = args[0] ? parseInt(args[0]) : 1;
                    if (isNaN(rewindN) || rewindN < 1) {
                        engine.ui.error('Usage: /rewind <n>');
                        break;
                    }
                    const undone = engine.undoRedo.undoN(rewindN);
                    engine.ui.success(`Rewound ${undone.length} action(s)`);
                    break;
                case 'fork':
                    engine.ui.info('Forking current session...');
                    const currentSession = engine.sessionManager.getCurrent();
                    if (currentSession) {
                        const forked = engine.sessionManager.create(process.cwd(), config.defaultModel);
                        forked.messages = [...currentSession.messages];
                        forked.forkedFrom = currentSession.id;
                        engine.sessionManager.save();
                        engine.ui.success(`Forked to new session: ${forked.id.slice(0, 20)}...`);
                    }
                    else {
                        engine.ui.error('No active session to fork');
                    }
                    break;
                case 'mcp':
                    const mcpSub = args[0];
                    if (mcpSub === 'list') {
                        const servers = engine.mcpClient.listServers();
                        if (servers.length === 0) {
                            engine.ui.info('No MCP servers configured');
                            break;
                        }
                        console.log(chalk.bold('\nMCP Servers:\n'));
                        for (const s of servers) {
                            const status = s.connected ? chalk.green('connected') : chalk.gray('disconnected');
                            console.log(`  ${chalk.cyan(s.name.padEnd(20))} ${status}  ${chalk.gray(`${s.toolCount} tools`)}  ${chalk.gray(s.config.transport)}`);
                        }
                    }
                    else if (mcpSub === 'connect' && args[1]) {
                        try {
                            const cfg = engine.mcpClient.loadConfig();
                            if (cfg.mcpServers[args[1]]) {
                                await engine.mcpClient.connect(args[1], cfg.mcpServers[args[1]]);
                                engine.ui.success(`Connected to MCP server: ${args[1]}`);
                            }
                            else {
                                engine.ui.error(`MCP server "${args[1]}" not found`);
                            }
                        }
                        catch (e) {
                            engine.ui.error(`Failed to connect: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                    else if (mcpSub === 'disconnect' && args[1]) {
                        await engine.mcpClient.disconnect(args[1]);
                        engine.ui.success(`Disconnected from ${args[1]}`);
                    }
                    else if (mcpSub === 'health') {
                        engine.mcpClient.healthReport();
                    }
                    else {
                        console.log(chalk.bold('\nMCP Commands:\n'));
                        console.log('  /mcp list              List MCP servers');
                        console.log('  /mcp connect <name>    Connect to a server');
                        console.log('  /mcp disconnect <name> Disconnect from a server');
                        console.log('  /mcp health            Show MCP health report');
                    }
                    break;
                case 'permission':
                case 'perm':
                    if (args[0]) {
                        const validModes = ['manual', 'auto', 'plan', 'yolo'];
                        if (validModes.includes(args[0])) {
                            engine.approval.setMode(args[0]);
                            engine.ui.success(`${engine.approval.getModeIcon()} Permission: ${args[0]} (${engine.approval.getModeDescription()})`);
                        }
                        else {
                            engine.ui.error(`Invalid mode. Use: ${validModes.join(', ')}`);
                        }
                    }
                    else {
                        const newMode = engine.approval.cycleMode();
                        engine.ui.success(`${engine.approval.getModeIcon()} Permission: ${newMode} (${engine.approval.getModeDescription()})`);
                    }
                    break;
                case 'init':
                    engine.ui.info('Initializing NEURO.md for this project...');
                    try {
                        const { NeuroMdSystem } = await import('./context/neuro-md.js');
                        const nmd = new NeuroMdSystem(process.cwd());
                        nmd.load();
                        const content = `# Project Context\n\nThis file provides persistent context for NeuroCLI.\n\n## Tech Stack\n- [Detected automatically]\n\n## Conventions\n- Follow existing code patterns\n- Use TypeScript for all new files\n\n## Notes\n- This file is auto-generated by /init\n`;
                        const { writeFileSync } = await import('fs');
                        const { join } = await import('path');
                        writeFileSync(join(process.cwd(), 'NEURO.md'), content, 'utf-8');
                        engine.ui.success('NEURO.md created');
                    }
                    catch (e) {
                        engine.ui.error('Could not create NEURO.md: ' + (e instanceof Error ? e.message : String(e)));
                    }
                    break;
                case 'unpause':
                    engine.doomLoop.unpause();
                    break;
                case 'sandbox':
                    if (args[0] === 'on' || args[0] === 'enable') {
                        engine.sandbox.enable();
                        engine.ui.success('Sandbox mode enabled');
                    }
                    else if (args[0] === 'off' || args[0] === 'disable') {
                        engine.sandbox.disable();
                        engine.ui.success('Sandbox mode disabled');
                    }
                    else if (args[0] === 'status') {
                        engine.sandbox.printStatus();
                    }
                    else if (args[0] === 'undo') {
                        const undone = engine.sandbox.undoAll();
                        engine.ui.success(`Undone ${undone} file modifications`);
                    }
                    else {
                        const enabled = engine.sandbox.toggle();
                        engine.ui.success(enabled ? 'Sandbox mode enabled' : 'Sandbox mode disabled');
                    }
                    break;
                case 'plugins':
                case 'plugin':
                    const pluginSub = args[0];
                    if (pluginSub === 'list') {
                        const plugins = engine.pluginManager.listPlugins();
                        if (plugins.length === 0) {
                            engine.ui.info('No plugins loaded');
                            break;
                        }
                        console.log(chalk.bold('\nPlugins:\n'));
                        for (const p of plugins) {
                            console.log(`  ${chalk.cyan(p.name)} v${p.version} - ${chalk.gray(p.description)} ${chalk.green(`${p.toolCount} tools`)}`);
                        }
                    }
                    else if (pluginSub === 'load' && args[1]) {
                        try {
                            await engine.pluginManager.loadByName(args[1]);
                            engine.ui.success(`Plugin "${args[1]}" loaded`);
                        }
                        catch (e) {
                            engine.ui.error(`Failed to load plugin: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                    else {
                        console.log(chalk.bold('\nPlugin Commands:\n'));
                        console.log('  /plugins list           List loaded plugins');
                        console.log('  /plugins load <name>    Load a plugin');
                    }
                    break;
                case 'whitelist':
                    if (args[0] === 'add' && args[1]) {
                        engine.approval.addToWhitelist(args[1]);
                        engine.ui.success(`Added "${args[1]}" to whitelist`);
                    }
                    else if (args[0] === 'remove' && args[1]) {
                        engine.approval.removeFromWhitelist(args[1]);
                        engine.ui.success(`Removed "${args[1]}" from whitelist`);
                    }
                    else if (args[0] === 'list') {
                        const wl = engine.approval.getWhitelist();
                        console.log(chalk.bold('\nWhitelisted tools:\n'));
                        for (const t of wl)
                            console.log(`  ${chalk.green('+')} ${t}`);
                    }
                    else {
                        console.log('Usage: /whitelist add|remove|list <tool>');
                    }
                    break;
                case 'blacklist':
                    if (args[0] === 'add' && args[1]) {
                        engine.approval.addToBlacklist(args[1]);
                        engine.ui.success(`Added "${args[1]}" to blacklist`);
                    }
                    else if (args[0] === 'remove' && args[1]) {
                        engine.approval.removeFromBlacklist(args[1]);
                        engine.ui.success(`Removed "${args[1]}" from blacklist`);
                    }
                    else if (args[0] === 'list') {
                        const bl = engine.approval.getBlacklist();
                        console.log(chalk.bold('\nBlacklisted tools:\n'));
                        for (const t of bl)
                            console.log(`  ${chalk.red('-')} ${t}`);
                    }
                    else {
                        console.log('Usage: /blacklist add|remove|list <tool>');
                    }
                    break;
                // --- v3.0 New Commands ---
                case 'style':
                    if (args[0]) {
                        if (engine.styleManager.setStyle(args[0])) {
                            engine.ui.success(`Output style: ${args[0]}`);
                        }
                        else {
                            engine.ui.error(`Unknown style. Available: ${engine.styleManager.listStyles().map(s => s.name).join(', ')}`);
                        }
                    }
                    else {
                        engine.styleManager.printStyles();
                    }
                    break;
                case 'thinking':
                    if (args[0]) {
                        const modes = ['none', 'brief', 'full', 'ultrathink'];
                        if (modes.includes(args[0])) {
                            engine.extendedThinking.setMode(args[0]);
                            if (args[0] !== 'none' && !engine.extendedThinking.isDisplayEnabled()) {
                                engine.extendedThinking.toggleDisplay();
                            }
                            engine.ui.success(`Thinking mode: ${args[0]}`);
                        }
                        else {
                            engine.ui.error(`Invalid mode. Use: ${modes.join(', ')}`);
                        }
                    }
                    else {
                        const currentMode = engine.extendedThinking.getMode();
                        const showing = engine.extendedThinking.isDisplayEnabled() ? 'visible' : 'hidden';
                        console.log(chalk.bold(`\nThinking Mode: ${chalk.cyan(currentMode)} (display: ${showing})`));
                        console.log(chalk.gray('  Toggle display: /thinking toggle'));
                        console.log(chalk.gray('  Set mode: /thinking none|brief|full|ultrathink'));
                        console.log();
                    }
                    break;
                case 'skills':
                    const skillSub = args[0];
                    if (skillSub === 'list') {
                        engine.skillSystem.listSkills();
                    }
                    else if (skillSub === 'activate' && args[1]) {
                        const activated = engine.skillSystem.activate(args[1]);
                        if (activated) {
                            engine.ui.success(`Skill activated: ${args[1]}`);
                        }
                        else {
                            engine.ui.error(`Skill not found: ${args[1]}`);
                        }
                    }
                    else if (skillSub === 'deactivate' && args[1]) {
                        if (engine.skillSystem.deactivate(args[1])) {
                            engine.ui.success(`Skill deactivated: ${args[1]}`);
                        }
                        else {
                            engine.ui.error(`Skill not active: ${args[1]}`);
                        }
                    }
                    else if (skillSub === 'clear') {
                        engine.skillSystem.deactivateAll();
                        engine.ui.success('All skills deactivated');
                    }
                    else {
                        console.log(chalk.bold('\nSkill Commands:\n'));
                        console.log('  /skills list              List all skills');
                        console.log('  /skills activate <name>   Activate a skill');
                        console.log('  /skills deactivate <name> Deactivate a skill');
                        console.log('  /skills clear             Deactivate all skills');
                    }
                    break;
                case 'effort':
                    if (args[0]) {
                        const levels = ['low', 'medium', 'high', 'ultrathink'];
                        if (levels.includes(args[0])) {
                            engine.modelRouter.setEffort(args[0]);
                            engine.ui.success(`Effort level: ${args[0]}`);
                        }
                        else {
                            engine.ui.error(`Invalid level. Use: ${levels.join(', ')}`);
                        }
                    }
                    else {
                        console.log(chalk.bold(`\nEffort Level: ${chalk.cyan(engine.modelRouter.getEffort())}`));
                        console.log(chalk.gray('  Set level: /effort low|medium|high|ultrathink'));
                        console.log();
                    }
                    break;
                case 'cache':
                    const cacheSub = args[0];
                    if (cacheSub === 'on') {
                        config.promptCache.enabled = true;
                        engine.ui.success('Prompt cache enabled');
                    }
                    else if (cacheSub === 'off') {
                        config.promptCache.enabled = false;
                        engine.ui.success('Prompt cache disabled');
                    }
                    else if (cacheSub === 'clear') {
                        engine.promptCache.clear();
                        engine.ui.success('Cache cleared');
                    }
                    else if (cacheSub === 'stats') {
                        engine.promptCache.printStats();
                    }
                    else {
                        const status = config.promptCache.enabled ? chalk.green('enabled') : chalk.gray('disabled');
                        console.log(chalk.bold(`\nPrompt Cache: ${status}`));
                        console.log(chalk.gray('  /cache on|off|clear|stats'));
                        console.log();
                    }
                    break;
                case 'spending':
                    engine.spendingMonitor.printReport();
                    break;
                case 'ignore':
                    if (args[0] === 'list') {
                        engine.neuroIgnore.printRules();
                    }
                    else if (args[0] === 'add' && args[1]) {
                        engine.neuroIgnore.addRule(args[1], 'manual');
                        engine.ui.success(`Added ignore rule: ${args[1]}`);
                    }
                    else if (args[0] === 'check' && args[1]) {
                        const ignored = engine.neuroIgnore.isIgnored(args[1]);
                        console.log(`  ${args[1]}: ${ignored ? chalk.red('ignored') : chalk.green('allowed')}`);
                    }
                    else {
                        console.log(chalk.bold('\nIgnore Commands:\n'));
                        console.log('  /ignore list             List ignore rules');
                        console.log('  /ignore add <pattern>    Add an ignore pattern');
                        console.log('  /ignore check <path>     Check if a path is ignored');
                    }
                    break;
                case 'ollama':
                    try {
                        const available = await engine.ollamaProvider.isAvailable();
                        if (!available) {
                            engine.ui.error('Ollama is not running. Start it with: ollama serve');
                            break;
                        }
                        const models = await engine.ollamaProvider.listModels();
                        console.log(chalk.bold('\nOllama Local Models:\n'));
                        for (const m of models) {
                            const isActive = config.defaultModel === m.name;
                            console.log(`  ${isActive ? chalk.green('*') : ' '} ${chalk.cyan(m.name.padEnd(40))} ${chalk.gray(m.details?.parameter_size || '')} ${chalk.gray(m.details?.quantization_level || '')}`);
                        }
                        console.log(chalk.gray('\nSwitch model: /model <name>'));
                    }
                    catch (e) {
                        engine.ui.error('Could not connect to Ollama');
                    }
                    break;
                case 'doctor':
                    console.log(chalk.bold('\nNeuroCLI v4.1.2 Health Check:\n'));
                    console.log(`  API Key: ${config.apiKey ? chalk.green('configured') : chalk.red('MISSING')}`);
                    console.log(`  Default Model: ${chalk.cyan(config.defaultModel)} ${MODELS[config.defaultModel] ? chalk.green('valid') : chalk.red('INVALID')}`);
                    console.log(`  MCP Servers: ${chalk.cyan(String(engine.mcpClient.listServers().length))}`);
                    console.log(`  Permission Mode: ${chalk.cyan(engine.approval.getMode())}`);
                    console.log(`  Diff Preview: ${config.diffPreview ? chalk.green('enabled') : chalk.gray('disabled')}`);
                    console.log(`  Fallback Chain: ${config.fallbackChain.models.length > 0 ? chalk.green(config.fallbackChain.models.length + ' models') : chalk.yellow('none')}`);
                    console.log(`  Doom Loop Protection: ${config.doomLoop.autoBreak ? chalk.green('enabled') : chalk.yellow('disabled')}`);
                    console.log(`  Sandbox: ${engine.sandbox.isEnabled() ? chalk.green('enabled') : chalk.gray('disabled')}`);
                    console.log(`  Plugins: ${chalk.cyan(String(engine.pluginManager.listPlugins().length))}`);
                    console.log(`  Custom Agents: ${chalk.cyan(String(engine.customAgentLoader.getAll().length))}`);
                    console.log(`  Custom Tools: ${chalk.cyan(String(engine.customToolLoader.getAll().length))}`);
                    console.log(`  Skills: ${chalk.cyan(String(engine.skillSystem.getAllSkills().length))} (${chalk.cyan(String(engine.skillSystem.getActiveSkills().length))} active)`);
                    console.log(`  Prompt Cache: ${config.promptCache.enabled ? chalk.green('enabled') : chalk.gray('disabled')}`);
                    console.log(`  Output Style: ${chalk.cyan(engine.styleManager.getStyle().name)}`);
                    console.log(`  Thinking Mode: ${chalk.cyan(engine.extendedThinking.getMode())}`);
                    console.log(`  Effort Level: ${chalk.cyan(engine.modelRouter.getEffort())}`);
                    console.log(`  Sessions: ${chalk.cyan(String(engine.sessionManager.list().length))}`);
                    console.log(`  Spending Limit: ${config.spendingLimit > 0 ? chalk.cyan('$' + config.spendingLimit.toFixed(2)) : chalk.gray('unlimited')}`);
                    console.log(`  Ignore Rules: ${chalk.cyan(String(engine.neuroIgnore.getRules().length))}`);
                    // Check Ollama availability
                    const ollamaAvail = await engine.ollamaProvider.isAvailable().catch(() => false);
                    console.log(`  Ollama: ${ollamaAvail ? chalk.green('available') : chalk.gray('not running')}`);
                    // Update check status
                    const lastUpdateCheck = updater.getLastCheck();
                    const updateStatus = lastUpdateCheck?.hasUpdate ? chalk.yellow(`update available (v${lastUpdateCheck.latestVersion})`) : chalk.green('up to date');
                    console.log(`  Auto-Update: ${updateStatus}`);
                    const nextCheck = updater.timeUntilNextCheck();
                    const nextCheckStr = nextCheck > 0 ? ` (next check in ${Math.floor(nextCheck / 3600000)}h)` : '';
                    console.log(`  Update Check: ${chalk.gray('enabled' + nextCheckStr)}`);
                    console.log();
                    break;
                case 'export':
                    const exportSession = engine.sessionManager.getCurrent();
                    if (exportSession) {
                        const exportPath = args[0] || 'neuro-session-export.json';
                        const exportData = {
                            version: VERSION,
                            exportedAt: Date.now(),
                            session: exportSession,
                            neuroVersion: VERSION,
                        };
                        try {
                            writeFileSync(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');
                            engine.ui.success(`Session exported to ${exportPath}`);
                        }
                        catch (e) {
                            console.log(JSON.stringify(exportSession, null, 2));
                        }
                    }
                    else {
                        engine.ui.warning('No active session to export');
                    }
                    break;
                case 'import':
                    const importPath = args[0];
                    if (!importPath) {
                        engine.ui.error('Usage: /import <path-to-json-file>');
                        break;
                    }
                    try {
                        const importData = JSON.parse(readFileSync(importPath, 'utf-8'));
                        const sessionData = importData.session || importData;
                        const newSession = engine.sessionManager.create(process.cwd(), sessionData.model || config.defaultModel);
                        if (sessionData.messages)
                            newSession.messages = sessionData.messages;
                        if (sessionData.totalInputTokens)
                            newSession.totalInputTokens = sessionData.totalInputTokens;
                        if (sessionData.totalOutputTokens)
                            newSession.totalOutputTokens = sessionData.totalOutputTokens;
                        if (sessionData.totalCost)
                            newSession.totalCost = sessionData.totalCost;
                        engine.sessionManager.save();
                        engine.ui.success(`Session imported: ${newSession.id.slice(0, 20)}... (${newSession.messages.length} messages)`);
                    }
                    catch (e) {
                        engine.ui.error(`Failed to import: ${e instanceof Error ? e.message : String(e)}`);
                    }
                    break;
                case 'commit-push-pr':
                    engine.ui.info('Running commit + push + PR workflow...');
                    try {
                        const { execSync } = await import('child_process');
                        // Stage all
                        execSync('git add -A', { cwd: process.cwd(), encoding: 'utf-8' });
                        // Commit
                        const commitMsg = args.join(' ') || 'Update from NeuroCLI';
                        execSync(`git commit -m "${commitMsg}" --no-gpg-sign`, { cwd: process.cwd(), encoding: 'utf-8' });
                        // Push
                        execSync('git push', { cwd: process.cwd(), encoding: 'utf-8' });
                        engine.ui.success('Changes committed and pushed');
                        // Try to create PR with gh CLI
                        try {
                            const prResult = execSync(`gh pr create --title "${commitMsg}" --body "Auto-generated by NeuroCLI"`, { cwd: process.cwd(), encoding: 'utf-8' });
                            engine.ui.success(`PR created: ${prResult.trim()}`);
                        }
                        catch {
                            engine.ui.info('Could not create PR (gh CLI not available or not a GitHub repo)');
                        }
                    }
                    catch (e) {
                        engine.ui.error(`Git operation failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                    break;
                case 'code-review':
                    engine.ui.info('Starting multi-agent code review...');
                    try {
                        const reviewResult = await engine.processMessage('Perform a thorough code review of all recent changes in this repository. Check for: bugs, security issues, performance problems, code style, test coverage. Provide findings with severity levels (CRITICAL, WARNING, INFO).', 'agent');
                    }
                    catch (e) {
                        engine.ui.error(`Code review failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                    break;
                case 'feedback':
                    console.log(chalk.bold('\nFeedback:\n'));
                    console.log('  Report issues: https://github.com/neuro-cli/neuro/issues');
                    console.log('  Discussions:   https://github.com/neuro-cli/neuro/discussions');
                    console.log(chalk.gray('\n  Your feedback helps make NeuroCLI better!'));
                    console.log();
                    break;
                case 'cost':
                    engine.spendingMonitor.printReport();
                    if (engine.promptCache) {
                        console.log(chalk.bold('\nCache Savings:'));
                        engine.promptCache.printStats();
                    }
                    break;
                case 'update':
                case 'upgrade':
                    const updateSub = args[0];
                    if (updateSub === 'now') {
                        engine.ui.info('Updating NeuroCLI...');
                        const updateResult = await updater.performUpdate();
                        if (updateResult.success) {
                            engine.ui.success(updateResult.message);
                            console.log(chalk.yellow('  Please restart NeuroCLI to use the new version.'));
                        }
                        else {
                            engine.ui.error(updateResult.message);
                        }
                    }
                    else if (updateSub === 'check') {
                        engine.ui.info('Checking for updates...');
                        const checkResult = await updater.checkForUpdate(true);
                        if (checkResult.hasUpdate) {
                            updater.showUpdateDetails(checkResult);
                            updater.showUpdateNotification(checkResult);
                        }
                        else {
                            updater.showUpToDate();
                        }
                    }
                    else if (updateSub === 'dismiss') {
                        const checkResult = await updater.checkForUpdate(true);
                        if (checkResult.hasUpdate) {
                            updater.dismissVersion(checkResult.latestVersion);
                            engine.ui.success(`Dismissed update notification for v${checkResult.latestVersion}`);
                        }
                        else {
                            engine.ui.info('No update to dismiss');
                        }
                    }
                    else if (updateSub === 'auto') {
                        const enableAuto = args[1] !== 'off';
                        updater.setAutoUpdate(enableAuto);
                        engine.ui.success(`Auto-update: ${enableAuto ? 'enabled' : 'disabled'}`);
                    }
                    else if (updateSub === 'interval') {
                        const hours = args[1] ? parseFloat(args[1]) : 24;
                        if (isNaN(hours) || hours < 1) {
                            engine.ui.error('Interval must be at least 1 hour');
                        }
                        else {
                            updater.setCheckInterval(hours);
                            engine.ui.success(`Update check interval set to ${hours} hours`);
                        }
                    }
                    else if (updateSub === 'reset') {
                        updater.resetDismissed();
                        updater.forceNextCheck();
                        engine.ui.success('Update preferences reset');
                    }
                    else {
                        // Default: interactive update flow
                        await updater.interactiveUpdate();
                    }
                    break;
                case 'exit':
                case 'quit':
                case 'q':
                    engine.mcpClient.disconnectAll().catch(() => { });
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
            isProcessing = true;
            await engine.processMessage(input, currentMode, currentAgent);
        }
        catch (error) {
            engine.ui.error(error instanceof Error ? error.message : String(error));
        }
        finally {
            isProcessing = false;
        }
        rl.prompt();
    });
    rl.on('close', () => {
        engine.mcpClient.disconnectAll().catch(() => { });
        engine.approval.close();
        engine.ui.info('Goodbye!');
        process.exit(0);
    });
}
function printHelp(engine) {
    const t = engine.ui.theme;
    console.log(`\n  ${t.bold('NeuroCLI v4.1.2 Commands:')}\n`);
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
    console.log(`  ${t.tool('/redo')}            Redo undone change`);
    console.log(`  ${t.tool('/rewind [n]')}      Rewind n changes`);
    console.log(`  ${t.tool('/mcp [cmd]')}       Manage MCP servers`);
    console.log(`  ${t.tool('/init')}            Initialize NEURO.md`);
    console.log(`  ${t.tool('/sandbox')}         Toggle sandbox mode`);
    console.log(`  ${t.tool('/plugins')}         Manage plugins`);
    console.log(`  ${t.tool('/whitelist')}       Manage tool whitelist`);
    console.log(`  ${t.tool('/blacklist')}       Manage tool blacklist`);
    console.log(`  ${t.tool('/doctor')}          Health check`);
    console.log(`  ${t.tool('/export [path]')}   Export session as JSON`);
    console.log(`  ${t.tool('/import <path>')}   Import a session from JSON`);
    console.log(`  ${t.tool('/cost')}            Show spending and cache report`);
    console.log(`  ${t.tool('/spending')}        Show detailed spending report`);
    console.log(`  ${t.tool('/stats')}           Show session statistics`);
    console.log(`  ${t.tool('/theme [name]')}    Switch UI theme`);
    console.log();
    console.log(`  ${t.bold('v3.0 New Commands:')}\n`);
    console.log(`  ${t.tool('/style [name]')}    Switch output style`);
    console.log(`  ${t.tool('/thinking [mode]')} Toggle thinking mode (none|brief|full|ultrathink)`);
    console.log(`  ${t.tool('/effort [level]')}  Set effort level (low|medium|high|ultrathink)`);
    console.log(`  ${t.tool('/skills [cmd]')}    Manage skills (list|activate|deactivate|clear)`);
    console.log(`  ${t.tool('/cache [cmd]')}     Manage prompt cache (on|off|clear|stats)`);
    console.log(`  ${t.tool('/ignore [cmd]')}    Manage .neuroignore rules`);
    console.log(`  ${t.tool('/ollama')}          List Ollama local models`);
    console.log(`  ${t.tool('/commit-push-pr')}  Commit + push + create PR`);
    console.log(`  ${t.tool('/code-review')}     Multi-agent code review`);
    console.log(`  ${t.tool('/update [cmd]')}    Check/update NeuroCLI (now|check|dismiss|auto|interval|reset)`);
    console.log(`  ${t.tool('/feedback')}        Give feedback`);
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
//# sourceMappingURL=index.js.map