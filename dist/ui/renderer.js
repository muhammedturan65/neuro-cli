// ============================================================
// NeuroCLI - Terminal UI Renderer v2
// Claude Code-inspired minimal, professional terminal output
// Clean lines, subtle colors, compact information display
// ============================================================
import { getTheme } from './theme.js';
import { MODELS } from '../api/models.js';
export class TerminalUI {
    theme;
    showTokens;
    showCost;
    isStreaming = false;
    version = '4.3.0';
    constructor(themeName = 'claude', showTokens = true, showCost = true) {
        this.theme = getTheme(themeName);
        this.showTokens = showTokens;
        this.showCost = showCost;
    }
    setVersion(v) {
        this.version = v;
    }
    // ── Banner ──────────────────────────────────────────────
    banner() {
        // Claude Code style: clean, minimal, no box art
        // Version is injected from index.ts via setVersion()
        console.log();
        console.log(`  ${this.theme.bold('NeuroCLI')} ${this.theme.muted(`v${this.version}`)}`);
        console.log(`  ${this.theme.dim('─'.repeat(40))}`);
    }
    // ── User Messages ───────────────────────────────────────
    userMessage(content) {
        console.log();
        console.log(`  ${this.theme.accent('>')} ${content}`);
        console.log();
    }
    // ── Assistant Messages ──────────────────────────────────
    assistantMessage(content) {
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.startsWith('```')) {
                continue;
            }
            else if (line.startsWith('# ')) {
                console.log(`  ${this.theme.bold(line.slice(2))}`);
            }
            else if (line.startsWith('## ')) {
                console.log(`  ${this.theme.bold(line.slice(3))}`);
            }
            else if (line.startsWith('### ')) {
                console.log(`  ${this.theme.primary(line.slice(4))}`);
            }
            else if (line.startsWith('- ') || line.startsWith('* ')) {
                console.log(`  ${this.theme.muted('·')} ${line.slice(2)}`);
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
    // ── Streaming ───────────────────────────────────────────
    streamingToken(token) {
        process.stdout.write(token);
    }
    startStreaming() {
        this.isStreaming = true;
    }
    endStreaming() {
        this.isStreaming = false;
        console.log('\n');
    }
    // ── Thinking / Status ───────────────────────────────────
    thinking(message) {
        // Claude Code: dim italic, compact
        console.log(`  ${this.theme.thinking(message)}`);
    }
    // ── Tool Calls (Claude Code style: compact one-liners) ──
    toolCall(name, args) {
        // Build compact argument summary
        const summary = this.formatToolArgs(name, args);
        console.log(`  ${this.theme.tool('→')} ${this.theme.tool(name)}${summary}`);
    }
    formatToolArgs(name, args) {
        switch (name) {
            case 'read_file':
                return ` ${this.theme.path(String(args.path || ''))}`;
            case 'write_file':
                return ` ${this.theme.path(String(args.path || ''))} ${this.theme.muted(`(${this.byteSize(String(args.content || ''))})`)}`;
            case 'edit_file':
                return ` ${this.theme.path(String(args.path || ''))}`;
            case 'search_files':
                return ` ${this.theme.muted(`"${args.query || ''}"`)} ${this.theme.path(String(args.path || '.'))}`;
            case 'list_directory':
                return ` ${this.theme.path(String(args.path || args.directory || '.'))}`;
            case 'run_command':
                return ` ${this.theme.muted(this.truncate(String(args.command || ''), 60))}`;
            case 'apply_diff':
                return ` ${this.theme.path(String(args.path || ''))}`;
            case 'delete_file':
                return ` ${this.theme.path(String(args.path || ''))}`;
            case 'web_search':
                return ` ${this.theme.muted(`"${args.query || ''}"`)}`;
            case 'web_fetch':
                return ` ${this.theme.muted(this.truncate(String(args.url || ''), 60))}`;
            default: {
                const entries = Object.entries(args);
                if (entries.length === 0)
                    return '';
                const first = entries[0];
                const val = typeof first[1] === 'string' ? this.truncate(first[1], 50) : JSON.stringify(first[1]);
                return ` ${this.theme.muted(`${first[0]}: ${val}`)}`;
            }
        }
    }
    // ── Tool Results (compact status line) ──────────────────
    toolResult(name, result, isError) {
        if (isError) {
            const preview = this.truncate(result.replace(/\n/g, ' '), 80);
            console.log(`  ${this.theme.error('✗')} ${this.theme.error(preview)}`);
        }
        else {
            // Show brief success indicator with key info
            const preview = this.truncate(result.replace(/\n/g, ' '), 80);
            if (preview.length > 0 && !preview.startsWith('{') && !preview.startsWith('[')) {
                console.log(`  ${this.theme.dim(preview)}`);
            }
        }
    }
    // ── Approval Prompts (minimal, clear) ───────────────────
    approvalRequest(toolName, args, risk) {
        const riskLabel = {
            low: this.theme.success('low'),
            medium: this.theme.warning('med'),
            high: this.theme.error('high'),
        };
        const summary = this.formatToolArgs(toolName, args);
        console.log();
        console.log(`  ${this.theme.muted('┌─')} ${this.theme.bold(toolName)} ${riskLabel[risk]} risk`);
        console.log(`  ${this.theme.muted('└─')}${summary}`);
        return true;
    }
    // ── Token Usage (compact footer) ────────────────────────
    tokenUsage(usage, modelId) {
        if (!this.showTokens && !this.showCost)
            return;
        const parts = [];
        if (this.showTokens) {
            parts.push(`${usage.inputTokens.toLocaleString()}in`);
            parts.push(`${usage.outputTokens.toLocaleString()}out`);
        }
        if (this.showCost) {
            parts.push(`$${usage.cost.toFixed(4)}`);
        }
        const model = MODELS[modelId];
        const modelName = model?.name || modelId;
        // Claude Code style: dim compact line
        console.log(`  ${this.theme.dim(`${modelName} · ${parts.join(' · ')}`)}`);
    }
    // ── Session Stats ───────────────────────────────────────
    sessionStats(totalInput, totalOutput, totalCost) {
        console.log();
        console.log(`  ${this.theme.muted('Session:')}`, this.theme.dim(`${totalInput.toLocaleString()} in · ${totalOutput.toLocaleString()} out · $${totalCost.toFixed(4)}`));
    }
    // ── Agent Activity (subtle indicator) ───────────────────
    agentActivity(agentName, status, detail) {
        const indicators = {
            starting: this.theme.muted('○'),
            working: this.theme.accent('◎'),
            done: this.theme.success('●'),
            error: this.theme.error('●'),
        };
        const statusText = {
            starting: 'starting',
            working: 'working...',
            done: 'done',
            error: 'failed',
        };
        const detailStr = detail ? ` ${this.theme.dim(detail)}` : '';
        console.log(`  ${indicators[status]} ${this.theme.muted(agentName)} ${this.theme.dim(statusText[status])}${detailStr}`);
    }
    // ── Status Messages (minimal) ───────────────────────────
    error(message) {
        console.error(`  ${this.theme.error('✗')} ${message}`);
    }
    info(message) {
        console.log(`  ${this.theme.muted('→')} ${this.theme.muted(message)}`);
    }
    success(message) {
        console.log(`  ${this.theme.success('✓')} ${message}`);
    }
    warning(message) {
        console.log(`  ${this.theme.warning('!')} ${message}`);
    }
    // ── Separator ───────────────────────────────────────────
    separator() {
        console.log(`  ${this.theme.dim('─'.repeat(50))}`);
    }
    // ── Code Block (clean frame) ────────────────────────────
    codeBlock(code, language) {
        const header = language ? ` ${language} ` : '';
        const width = 60;
        console.log(`  ${this.theme.dim('┌' + '─'.repeat(width - 2) + '┐')}`);
        if (header) {
            console.log(`  ${this.theme.dim('│')} ${this.theme.keyword(header)}${' '.repeat(width - 3 - header.length)}${this.theme.dim('│')}`);
        }
        for (const line of code.split('\n').slice(0, 30)) {
            const truncated = line.length > width - 4 ? line.slice(0, width - 5) + '…' : line;
            console.log(`  ${this.theme.dim('│')} ${this.theme.code(truncated)}${' '.repeat(Math.max(0, width - 3 - truncated.length))}${this.theme.dim('│')}`);
        }
        console.log(`  ${this.theme.dim('└' + '─'.repeat(width - 2) + '┘')}`);
    }
    // ── Model List ──────────────────────────────────────────
    modelList(selectedModel) {
        console.log();
        console.log(`  ${this.theme.bold('Models')}`);
        console.log(`  ${this.theme.dim('─'.repeat(50))}`);
        const categories = {
            'Free · Coding': [
                'qwen/qwen3-coder:free',
                'nvidia/nemotron-3-super-120b-a12b:free',
                'cohere/north-mini-code:free',
            ],
            'Free · Large Context': [
                'nvidia/nemotron-3-ultra-550b-a55b:free',
                'meta-llama/llama-3.3-70b-instruct:free',
                'tencent/hy3:free',
            ],
            'Free · Vision': [
                'google/gemma-4-31b-it:free',
                'nvidia/nemotron-nano-12b-v2-vl:free',
            ],
            'Premium · Flagship': ['anthropic/claude-opus-4', 'openai/o3', 'google/gemini-2.5-pro'],
            'Premium · Balanced': ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'deepseek/deepseek-r1'],
            'Premium · Fast': ['anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
        };
        for (const [category, models] of Object.entries(categories)) {
            console.log(`  ${this.theme.label(category)}`);
            for (const modelId of models) {
                const model = MODELS[modelId];
                if (!model)
                    continue;
                const isCurrent = modelId === selectedModel;
                const marker = isCurrent ? this.theme.accent('●') : this.theme.dim('○');
                const name = isCurrent ? this.theme.bold(model.name) : this.theme.muted(model.name);
                const isFree = model.inputPrice === 0 && model.outputPrice === 0;
                const price = isFree ? this.theme.success('free') : this.theme.muted(`$${model.inputPrice}/${model.outputPrice}`);
                const ctx = this.theme.dim(`${(model.contextWindow / 1000).toFixed(0)}K`);
                console.log(`    ${marker} ${name.padEnd(36)} ${price.padEnd(14)} ${ctx}`);
            }
            console.log();
        }
    }
    // ── Agent List ──────────────────────────────────────────
    agentList(agents) {
        console.log();
        console.log(`  ${this.theme.bold('Agents')}`);
        console.log(`  ${this.theme.dim('─'.repeat(50))}`);
        for (const agent of agents) {
            console.log(`  ${this.theme.accent('●')} ${this.theme.bold(agent.name.padEnd(12))} ${this.theme.muted(agent.description)}`);
        }
        console.log();
    }
    // ── Diff Display (Claude Code style: + and - lines) ─────
    diffAdd(line) {
        console.log(`  ${this.theme.diffAdd('+')} ${this.theme.diffAdd(line)}`);
    }
    diffRemove(line) {
        console.log(`  ${this.theme.diffRemove('-')} ${this.theme.diffRemove(line)}`);
    }
    diffContext(line) {
        console.log(`  ${this.theme.diffContext(' ')} ${this.theme.diffContext(line)}`);
    }
    diffHeader(file) {
        console.log();
        console.log(`  ${this.theme.dim('───')} ${this.theme.path(file)} ${this.theme.dim('───')}`);
    }
    // ── Helpers ─────────────────────────────────────────────
    truncate(str, maxLen) {
        if (str.length <= maxLen)
            return str;
        return str.slice(0, maxLen - 1) + '…';
    }
    byteSize(content) {
        const bytes = Buffer.byteLength(content, 'utf-8');
        if (bytes < 1024)
            return `${bytes}B`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
}
//# sourceMappingURL=renderer.js.map