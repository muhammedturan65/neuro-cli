#!/usr/bin/env node
// ============================================================
// NeuroCLI - Advanced AI Terminal Coding Assistant
// Main Entry Point
// ============================================================
import { Command } from 'commander';
import { createInterface } from 'readline';
import { NeuroEngine } from './core/engine.js';
import { initConfig, saveConfig } from './config/config.js';
import { MODELS } from './api/models.js';
import { TerminalUI } from './ui/renderer.js';
import { getTheme } from './ui/theme.js';
import chalk from 'chalk';
const VERSION = '1.0.0';
// ---- CLI Setup ----
const program = new Command();
program
    .name('neuro')
    .description('🧠 NeuroCLI - Advanced AI Terminal Coding Assistant')
    .version(VERSION)
    .option('-k, --api-key <key>', 'OpenRouter API key')
    .option('-m, --model <model>', 'Default model to use')
    .option('-t, --theme <theme>', 'UI theme (dracula, dark, nord, light)')
    .option('--no-streaming', 'Disable streaming output')
    .option('--auto-approve', 'Auto-approve all tool calls')
    .action(async (options) => {
    await startInteractive(options);
});
// ---- Non-interactive commands ----
program
    .command('ask <prompt>')
    .description('Ask a single question and exit')
    .option('-m, --model <model>', 'Model to use')
    .option('-a, --agent <agent>', 'Agent to use')
    .action(async (prompt, opts) => {
    const config = initConfig();
    if (opts.model)
        config.defaultModel = opts.model;
    const engine = new NeuroEngine(config);
    const result = await engine.processMessage(prompt, 'direct', opts.agent || 'Coder');
    console.log(result.content);
    process.exit(0);
});
program
    .command('models')
    .description('List available models')
    .action(() => {
    const config = initConfig();
    const ui = new TerminalUI(config.ui.theme);
    ui.modelList(config.defaultModel);
});
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
program
    .command('config')
    .description('Show or modify configuration')
    .option('--set-key <key>', 'Set API key')
    .option('--set-model <model>', 'Set default model')
    .option('--set-theme <theme>', 'Set UI theme')
    .option('--show', 'Show current config')
    .action(async (opts) => {
    const config = initConfig();
    const theme = getTheme(config.ui.theme);
    if (opts.setKey) {
        config.apiKey = opts.setKey;
        saveConfig(config);
        console.log(chalk.green('✓ API key updated'));
    }
    if (opts.setModel) {
        if (!MODELS[opts.setModel]) {
            console.log(chalk.red(`Unknown model: ${opts.setModel}`));
            process.exit(1);
        }
        config.defaultModel = opts.setModel;
        saveConfig(config);
        console.log(chalk.green(`✓ Default model set to ${MODELS[opts.setModel].name}`));
    }
    if (opts.setTheme) {
        config.ui.theme = opts.setTheme;
        saveConfig(config);
        console.log(chalk.green(`✓ Theme set to ${opts.setTheme}`));
    }
    if (opts.show || (!opts.setKey && !opts.setModel && !opts.setTheme)) {
        console.log(chalk.bold('\n📋 Current Configuration:\n'));
        console.log(`  API Key: ${config.apiKey ? chalk.green('● configured') : chalk.red('○ not set')}`);
        console.log(`  Base URL: ${config.baseUrl}`);
        console.log(`  Default Model: ${config.defaultModel}`);
        console.log(`  Theme: ${config.ui.theme}`);
        console.log(`  Streaming: ${config.ui.streaming ? 'enabled' : 'disabled'}`);
        console.log(`  Show Tokens: ${config.ui.showTokenCount ? 'enabled' : 'disabled'}`);
        console.log(`  Show Cost: ${config.ui.showCost ? 'enabled' : 'disabled'}`);
        console.log(`  Auto-approve: [${config.tools.autoApprove.join(', ')}]`);
        console.log();
    }
});
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
    console.log(chalk.bold('\n📂 Sessions:\n'));
    for (const session of sessions.slice(0, 20)) {
        const date = new Date(session.createdAt).toLocaleString();
        console.log(`  ${chalk.cyan(session.id.slice(0, 20))}  ${chalk.gray(date)}  ${chalk.gray(`${session.messageCount} msgs`)}  ${chalk.gray(`$${session.cost.toFixed(4)}`)}`);
    }
    console.log();
});
// ---- Interactive Mode ----
async function startInteractive(options) {
    // Initialize configuration
    const config = initConfig(options.apiKey);
    if (options.model)
        config.defaultModel = options.model;
    if (options.theme)
        config.ui.theme = options.theme;
    if (options.noStreaming)
        config.ui.streaming = false;
    if (options.autoApprove) {
        config.tools.autoApprove = [...config.tools.autoApprove, ...config.tools.requireApproval];
        config.tools.requireApproval = [];
    }
    // Check API key
    if (!config.apiKey) {
        console.log(chalk.red('\n✗ OpenRouter API key not configured!'));
        console.log(chalk.yellow('\nSet it with:'));
        console.log(`  ${chalk.cyan('neuro config --set-key YOUR_API_KEY')}`);
        console.log(`  ${chalk.cyan('export OPENROUTER_API_KEY=YOUR_API_KEY')}`);
        console.log(`  ${chalk.cyan('neuro -k YOUR_API_KEY')}`);
        console.log(chalk.gray('\nGet your key at: https://openrouter.ai/keys\n'));
        process.exit(1);
    }
    // Initialize engine
    const engine = new NeuroEngine(config);
    // Print banner
    engine.ui.banner();
    const theme = engine.ui.theme;
    console.log(theme.muted(`  Model: ${MODELS[config.defaultModel]?.name || config.defaultModel}`));
    console.log(theme.muted(`  Working Dir: ${process.cwd()}`));
    console.log(theme.muted(`  Type /help for commands, Ctrl+C to exit\n`));
    // Create readline interface
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.cyan('❯ '),
        historySize: 100,
    });
    rl.prompt();
    let currentMode = 'auto';
    let currentAgent;
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
        // Handle commands
        if (input.startsWith('/')) {
            const [cmd, ...args] = input.slice(1).split(' ');
            switch (cmd) {
                case 'help':
                    printHelp(engine);
                    break;
                case 'model':
                    if (args[0]) {
                        engine.switchModel(args[0]);
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
                        const agents = Array.from(engine.agents.entries()).map(([name, agent]) => ({
                            name,
                            description: agent.description,
                            model: config.defaultModel,
                        }));
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
                        const themeName = args[0];
                        config.ui.theme = themeName;
                        engine.ui = new TerminalUI(themeName, config.ui.showTokenCount, config.ui.showCost);
                        engine.ui.success(`Theme: ${themeName}`);
                    }
                    else {
                        console.log('Available themes: dracula, dark, nord, light');
                    }
                    break;
                case 'exit':
                case 'quit':
                case 'q':
                    engine.ui.info('Goodbye! 👋');
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
        }
        catch (error) {
            engine.ui.error(error instanceof Error ? error.message : String(error));
        }
        rl.prompt();
    });
    rl.on('close', () => {
        engine.ui.info('Goodbye! 👋');
        process.exit(0);
    });
}
function printHelp(engine) {
    const t = engine.ui.theme;
    console.log(`\n  ${t.bold('🧠 NeuroCLI Commands:')}\n`);
    console.log(`  ${t.tool('/help')}          Show this help message`);
    console.log(`  ${t.tool('/model [id]')}    Switch or list models`);
    console.log(`  ${t.tool('/agent [name]')}  Switch or list agents`);
    console.log(`  ${t.tool('/auto')}          Auto mode (smart orchestration)`);
    console.log(`  ${t.tool('/orchestrate')}   Multi-agent orchestration mode`);
    console.log(`  ${t.tool('/direct')}        Direct agent mode`);
    console.log(`  ${t.tool('/stats')}         Show session statistics`);
    console.log(`  ${t.tool('/theme [name]')}  Switch UI theme`);
    console.log(`  ${t.tool('/clear')}         Clear terminal`);
    console.log(`  ${t.tool('/exit')}          Exit NeuroCLI`);
    console.log();
    console.log(`  ${t.muted('Just type your message to interact with the AI.')}`);
    console.log(`  ${t.muted('Examples:')}`);
    console.log(`  ${t.muted('  "Create a REST API with Express"')}`);
    console.log(`  ${t.muted('  "Fix the bug in auth.ts"')}`);
    console.log(`  ${t.muted('  "Explain how this codebase works"')}`);
    console.log();
}
// Parse and execute
program.parse(process.argv);
//# sourceMappingURL=index.js.map