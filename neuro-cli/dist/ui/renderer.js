// ============================================================
// NeuroCLI - Terminal UI Renderer
// Beautiful terminal output with streaming support
// ============================================================
import { getTheme } from './theme.js';
import { MODELS } from '../api/models.js';
export class TerminalUI {
    theme;
    showTokens;
    showCost;
    constructor(themeName = 'dracula', showTokens = true, showCost = true) {
        this.theme = getTheme(themeName);
        this.showTokens = showTokens;
        this.showCost = showCost;
    }
    /**
     * Print the banner / splash screen
     */
    banner() {
        const banner = `
${this.theme.primary('  ╔══════════════════════════════════════════╗')}
${this.theme.primary('  ║')}  ${this.theme.accent.bold('🧠 NeuroCLI')} ${this.theme.muted('v1.0.0')}                    ${this.theme.primary('║')}
${this.theme.primary('  ║')}  ${this.theme.secondary('Advanced AI Terminal Coding Assistant')}     ${this.theme.primary('║')}
${this.theme.primary('  ╠══════════════════════════════════════════╣')}
${this.theme.primary('  ║')}  ${this.theme.muted('OpenRouter')} ${this.theme.success('●')}  ${this.theme.muted('Multi-Agent')} ${this.theme.success('●')}  ${this.theme.muted('Streaming')} ${this.theme.success('●')}  ${this.theme.primary('║')}
${this.theme.primary('  ╚══════════════════════════════════════════╝')}
`;
        console.log(banner);
    }
    /**
     * Print user message
     */
    userMessage(content) {
        console.log(`\n${this.theme.user('❯')} ${this.theme.user.bold('You')}`);
        console.log(`  ${content}\n`);
    }
    /**
     * Print assistant message with markdown-like formatting
     */
    assistantMessage(content) {
        console.log(`${this.theme.accent('◈')} ${this.theme.bold('Neuro')}`);
        // Simple markdown rendering
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.startsWith('```')) {
                continue; // Code block markers handled separately
            }
            else if (line.startsWith('# ')) {
                console.log(`  ${this.theme.bold(line)}`);
            }
            else if (line.startsWith('## ')) {
                console.log(`  ${this.theme.primary(line)}`);
            }
            else if (line.startsWith('### ')) {
                console.log(`  ${this.theme.accent(line)}`);
            }
            else if (line.startsWith('- ') || line.startsWith('* ')) {
                console.log(`  ${this.theme.muted('•')} ${line.slice(2)}`);
            }
            else if (line.startsWith('> ')) {
                console.log(`  ${this.theme.thinking(line)}`);
            }
            else {
                console.log(`  ${line}`);
            }
        }
        console.log();
    }
    /**
     * Print streaming token
     */
    streamingToken(token) {
        process.stdout.write(token);
    }
    /**
     * Start streaming block
     */
    startStreaming() {
        process.stdout.write(`${this.theme.accent('◈')} ${this.theme.bold('Neuro')} `);
    }
    /**
     * End streaming block
     */
    endStreaming() {
        console.log('\n');
    }
    /**
     * Print thinking indicator
     */
    thinking(message) {
        console.log(`${this.theme.thinking('  ○')} ${this.theme.thinking(message)}`);
    }
    /**
     * Print tool call
     */
    toolCall(name, args) {
        const argsStr = Object.entries(args)
            .map(([k, v]) => {
            const val = typeof v === 'string' && v.length > 60
                ? `"${v.slice(0, 60)}..."`
                : JSON.stringify(v);
            return `${this.theme.muted(k)}=${val}`;
        })
            .join(' ');
        console.log(`  ${this.theme.tool('⚡')} ${this.theme.tool.bold(name)} ${this.theme.muted(argsStr)}`);
    }
    /**
     * Print tool result
     */
    toolResult(name, result, isError) {
        if (isError) {
            console.log(`  ${this.theme.error('✗')} ${this.theme.error(name)}: ${this.theme.error(result.slice(0, 200))}`);
        }
        else {
            const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
            console.log(`  ${this.theme.success('✓')} ${this.theme.muted(name)}: ${this.theme.muted(preview)}`);
        }
    }
    /**
     * Print approval request
     */
    approvalRequest(toolName, args, risk) {
        const riskColors = {
            low: this.theme.success,
            medium: this.theme.warning,
            high: this.theme.error,
        };
        const riskIcons = { low: '🟢', medium: '🟡', high: '🔴' };
        console.log(`\n  ${riskIcons[risk]} ${riskColors[risk].bold(`Approval needed [${risk} risk]`)}`);
        console.log(`  Tool: ${this.theme.tool(toolName)}`);
        console.log(`  Args: ${this.theme.muted(JSON.stringify(args, null, 2).slice(0, 300))}`);
        return true;
    }
    /**
     * Print token usage
     */
    tokenUsage(usage, modelId) {
        if (!this.showTokens && !this.showCost)
            return;
        const parts = [];
        if (this.showTokens) {
            parts.push(`in: ${usage.inputTokens.toLocaleString()}`);
            parts.push(`out: ${usage.outputTokens.toLocaleString()}`);
        }
        if (this.showCost) {
            parts.push(`cost: $${usage.cost.toFixed(4)}`);
        }
        const model = MODELS[modelId];
        const modelName = model?.name || modelId;
        console.log(`  ${this.theme.muted(`📊 ${modelName} | ${parts.join(' | ')}`)}`);
    }
    /**
     * Print session stats
     */
    sessionStats(totalInput, totalOutput, totalCost) {
        console.log(`\n  ${this.theme.muted('━━━ Session Stats ━━━')}`);
        console.log(`  ${this.theme.muted(`Total tokens: ${totalInput.toLocaleString()} in + ${totalOutput.toLocaleString()} out`)}`);
        console.log(`  ${this.theme.muted(`Total cost: $${totalCost.toFixed(4)}`)}`);
    }
    /**
     * Print agent activity
     */
    agentActivity(agentName, status) {
        const icons = {
            starting: '🚀',
            working: '⚙️',
            done: '✅',
            error: '❌',
        };
        const colors = {
            starting: this.theme.primary,
            working: this.theme.warning,
            done: this.theme.success,
            error: this.theme.error,
        };
        console.log(`  ${icons[status]} ${colors[status](`${agentName}: ${status}`)}`);
    }
    /**
     * Print error
     */
    error(message) {
        console.error(`\n  ${this.theme.error('✗ Error:')} ${this.theme.error(message)}\n`);
    }
    /**
     * Print info
     */
    info(message) {
        console.log(`  ${this.theme.primary('ℹ')} ${this.theme.primary(message)}`);
    }
    /**
     * Print success
     */
    success(message) {
        console.log(`  ${this.theme.success('✓')} ${this.theme.success(message)}`);
    }
    /**
     * Print warning
     */
    warning(message) {
        console.log(`  ${this.theme.warning('⚠')} ${this.theme.warning(message)}`);
    }
    /**
     * Print separator
     */
    separator() {
        console.log(`  ${this.theme.dim('─'.repeat(50))}`);
    }
    /**
     * Print code block
     */
    codeBlock(code, language) {
        const header = language ? ` ${language} ` : '';
        console.log(`  ${this.theme.dim('┌' + '─'.repeat(48) + '┐')}`);
        if (header) {
            console.log(`  ${this.theme.dim('│')} ${this.theme.keyword(header)}${' '.repeat(47 - header.length)}${this.theme.dim('│')}`);
        }
        for (const line of code.split('\n')) {
            const truncated = line.length > 46 ? line.slice(0, 46) + '…' : line;
            console.log(`  ${this.theme.dim('│')} ${this.theme.code(truncated)}${' '.repeat(Math.max(0, 47 - truncated.length))}${this.theme.dim('│')}`);
        }
        console.log(`  ${this.theme.dim('└' + '─'.repeat(48) + '┘')}`);
    }
    /**
     * Print model selection menu
     */
    modelList(selectedModel) {
        console.log(`\n  ${this.theme.bold('Available Models:')}\n`);
        const categories = {
            'Flagship': ['anthropic/claude-opus-4', 'openai/o3', 'google/gemini-2.5-pro'],
            'Balanced': ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'deepseek/deepseek-r1'],
            'Fast & Cheap': ['anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
            'Open Source': ['meta-llama/llama-4-maverick', 'qwen/qwen3-235b-a22b'],
        };
        for (const [category, models] of Object.entries(categories)) {
            console.log(`  ${this.theme.primary.bold(category)}`);
            for (const modelId of models) {
                const model = MODELS[modelId];
                if (!model)
                    continue;
                const selected = modelId === selectedModel ? this.theme.accent(' ◀ current') : '';
                const price = `$${model.inputPrice}/${model.outputPrice}`;
                console.log(`    ${this.theme.muted('•')} ${this.theme.tool(model.name.padEnd(20))} ${this.theme.muted(price.padEnd(12))} ${this.theme.muted(`${(model.contextWindow / 1000).toFixed(0)}K ctx`)}${selected}`);
            }
            console.log();
        }
    }
    /**
     * Print agent list
     */
    agentList(agents) {
        console.log(`\n  ${this.theme.bold('Available Agents:')}\n`);
        for (const agent of agents) {
            const model = MODELS[agent.model];
            console.log(`  ${this.theme.tool('◆')} ${this.theme.bold(agent.name.padEnd(12))} ${this.theme.muted('- ' + agent.description)}`);
            console.log(`    ${this.theme.muted(`Model: ${model?.name || agent.model}`)}`);
        }
        console.log();
    }
}
//# sourceMappingURL=renderer.js.map