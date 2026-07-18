// ============================================================
// NeuroCLI - Custom Slash Commands
// (Like Gemini CLI + OpenCode custom commands)
// ============================================================
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
export class CommandSystem {
    commands = new Map();
    workingDirectory;
    constructor(workingDirectory) {
        this.workingDirectory = workingDirectory;
    }
    /**
     * Discover and load custom commands
     */
    discover() {
        this.commands.clear();
        // Global commands: ~/.neuro/commands/
        this.discoverFromDirectory(join(homedir(), '.neuro', 'commands'));
        // Project commands: .neuro/commands/
        this.discoverFromDirectory(join(this.workingDirectory, '.neuro', 'commands'));
        // Load bundled commands
        this.loadBundledCommands();
        return Array.from(this.commands.values());
    }
    /**
     * Get a command by name
     */
    get(name) {
        return this.commands.get(name);
    }
    /**
     * Get all commands
     */
    getAll() {
        return Array.from(this.commands.values());
    }
    /**
     * Parse a slash command input
     */
    parse(input) {
        if (!input.startsWith('/'))
            return null;
        const parts = input.slice(1).split(' ');
        const cmdName = parts[0];
        const args = parts.slice(1).join(' ');
        const cmd = this.commands.get(cmdName);
        if (!cmd)
            return null;
        return { command: cmd, args };
    }
    /**
     * Build the final prompt from a command template and args
     */
    buildPrompt(command, args) {
        let prompt = command.prompt;
        // Replace {args} placeholder
        prompt = prompt.replace(/\{args\}/g, args);
        // Replace {cwd} placeholder
        prompt = prompt.replace(/\{cwd\}/g, this.workingDirectory);
        // Replace {date} placeholder
        prompt = prompt.replace(/\{date\}/g, new Date().toISOString().split('T')[0]);
        // If no args placeholder but args provided, append them
        if (args && !command.prompt.includes('{args}')) {
            prompt += `\n\nUser input: ${args}`;
        }
        return prompt;
    }
    // ---- Private ----
    discoverFromDirectory(dir) {
        if (!existsSync(dir))
            return;
        try {
            for (const file of readdirSync(dir)) {
                if (file.endsWith('.md')) {
                    const cmd = this.parseCommandFile(join(dir, file));
                    if (cmd)
                        this.commands.set(cmd.name, cmd);
                }
            }
        }
        catch { }
    }
    parseCommandFile(filePath) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            const name = filePath.split('/').pop()?.replace('.md', '') || 'unknown';
            // Parse frontmatter
            const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            if (!fmMatch) {
                return {
                    name,
                    description: '',
                    prompt: content,
                };
            }
            const frontmatter = this.parseSimpleYaml(fmMatch[1]);
            return {
                name: frontmatter.name || name,
                description: frontmatter.description || '',
                prompt: fmMatch[2],
                model: frontmatter.model,
                tools: frontmatter.tools,
                autoApprove: frontmatter.auto_approve,
                subagent: frontmatter.subagent,
            };
        }
        catch {
            return null;
        }
    }
    parseSimpleYaml(yaml) {
        const result = {};
        for (const line of yaml.split('\n')) {
            const match = line.match(/^(\w+):\s*(.*)$/);
            if (match) {
                result[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
            }
        }
        return result;
    }
    loadBundledCommands() {
        const bundled = [
            {
                name: 'init',
                description: 'Initialize NEURO.md project context',
                prompt: 'Analyze the current project and create a NEURO.md file with tech stack, conventions, and project structure. Use the project_context tool first.',
            },
            {
                name: 'memory',
                description: 'Show loaded context and saved memories',
                prompt: 'Show me all loaded context (NEURO.md files) and saved memories. Use recall_memory to check.',
            },
            {
                name: 'compact',
                description: 'Compress conversation context',
                prompt: 'Compress the current conversation context. Summarize key information and remove redundancy.',
            },
            {
                name: 'review',
                description: 'Code review workflow',
                prompt: 'Perform a thorough code review of the recent changes. Check for bugs, security issues, performance problems, and style issues.',
                tools: ['read_file', 'search_files', 'run_command'],
            },
            {
                name: 'debug',
                description: 'Systematic debugging workflow',
                prompt: 'I need to debug an issue. Help me systematically investigate and fix it. Start by understanding the error, then form hypotheses, investigate, and fix.',
                tools: ['read_file', 'search_files', 'run_command', 'edit_file'],
            },
            {
                name: 'verify',
                description: 'Build and verify changes',
                prompt: 'Verify the recent code changes by building the project and running tests. Report any issues found.',
                tools: ['read_file', 'run_command', 'search_files'],
            },
            {
                name: 'test',
                description: 'Generate and run tests',
                prompt: 'Generate comprehensive tests for the current codebase. Focus on unit tests and edge cases. Run the tests and fix any failures.',
                tools: ['read_file', 'write_file', 'run_command', 'search_files'],
            },
            {
                name: 'refactor',
                description: 'Refactor code with safety',
                prompt: 'Refactor the specified code. Make changes incrementally, run tests after each change, and ensure nothing breaks. {args}',
                tools: ['read_file', 'edit_file', 'run_command', 'search_files'],
                autoApprove: false,
            },
            {
                name: 'explain',
                description: 'Explain code in detail',
                prompt: 'Explain the following code in detail. Cover the architecture, data flow, key algorithms, and any non-obvious patterns. {args}',
            },
            {
                name: 'security',
                description: 'Security audit',
                prompt: 'Perform a security audit of the codebase. Check for common vulnerabilities: SQL injection, XSS, CSRF, insecure deserialization, hardcoded secrets, improper error handling, and missing authentication checks.',
                tools: ['read_file', 'search_files', 'run_command'],
            },
            {
                name: 'perf',
                description: 'Performance analysis',
                prompt: 'Analyze the codebase for performance issues. Look for: N+1 queries, memory leaks, inefficient algorithms, unnecessary re-renders, large bundle sizes, and slow database queries.',
                tools: ['read_file', 'search_files', 'run_command'],
            },
            {
                name: 'migrate',
                description: 'Migrate code or dependencies',
                prompt: 'Help me migrate the following. Make changes carefully, update all references, run tests to verify, and document any breaking changes. {args}',
                tools: ['read_file', 'edit_file', 'write_file', 'run_command', 'search_files'],
            },
            {
                name: 'doctor',
                description: 'Diagnose environment issues',
                prompt: 'Run a diagnostic check of the development environment. Check: required tools, dependencies, configuration, environment variables, and build system. Report status for each and suggest fixes.',
                tools: ['run_command', 'read_file', 'search_files'],
            },
            {
                name: 'stats',
                description: 'Show session statistics',
                prompt: 'Show current session statistics including: tokens used, cost, number of messages, tools called, and duration.',
            },
            // --- v4.0 New Commands ---
            {
                name: 'auto',
                description: 'Toggle autonomous mode (skip approvals)',
                prompt: 'Toggle auto mode. When enabled, I will execute without asking for approval on each step. Use safety checks instead. {args}',
                autoApprove: true,
            },
            {
                name: 'goal',
                description: 'Set a high-level goal for autonomous execution',
                prompt: 'Set a goal for me to work towards autonomously. I will break it down into steps and execute them. {args}',
                autoApprove: false,
            },
            {
                name: 'routine',
                description: 'Save and replay command sequences',
                prompt: 'Manage routines. List, create, or execute saved command sequences. {args}',
            },
            {
                name: 'loop',
                description: 'Schedule a recurring task',
                prompt: 'Schedule a recurring task. Usage: /loop <interval> <prompt> where interval is like 5m, 1h, 1d. {args}',
            },
            {
                name: 'bg',
                description: 'Run a task in the background',
                prompt: 'Start this task in the background. I will work on it independently and you can check status later. {args}',
            },
            {
                name: 'skills',
                description: 'Manage SKILL.md skills (install/search/list)',
                prompt: 'Manage skills. Use: /skills list, /skills install <name>, /skills search <query>, /skills activate <name>. {args}',
            },
            {
                name: 'parallel',
                description: 'Spawn parallel agents for concurrent work',
                prompt: 'Spawn parallel agents to work on multiple tasks concurrently. {args}',
            },
            {
                name: 'repomap',
                description: 'Build and show repository map (tree-sitter)',
                prompt: 'Analyze the repository structure and build a map of all symbols, classes, functions, and their relationships. Show the repo map. {args}',
            },
            {
                name: 'lint',
                description: 'Run linters on the project',
                prompt: 'Run configured linters on the project. Auto-detect ESLint, Prettier, Ruff, etc. {args}',
                tools: ['run_command', 'read_file'],
            },
            {
                name: 'test',
                description: 'Run tests with auto-detection',
                prompt: 'Detect and run the test framework. Support Jest, Vitest, pytest, Go test, cargo test. {args}',
                tools: ['run_command', 'read_file'],
            },
            {
                name: 'review',
                description: 'Code review with security/performance checks',
                prompt: 'Perform a thorough code review checking for security vulnerabilities, performance issues, code style, and correctness. {args}',
                tools: ['read_file', 'search_files', 'run_command'],
            },
            {
                name: 'scan',
                description: 'Security vulnerability scan',
                prompt: 'Scan the codebase for security vulnerabilities: hardcoded secrets, injection risks, weak crypto, and more. {args}',
                tools: ['read_file', 'search_files'],
            },
            {
                name: 'bundle',
                description: 'Manage plugin bundles (install/create/publish)',
                prompt: 'Manage plugin bundles. Use: /bundle install <source>, /bundle list, /bundle create <name>, /bundle publish. {args}',
            },
            {
                name: 'pr',
                description: 'GitHub PR operations',
                prompt: 'Create or manage GitHub pull requests. {args}',
                tools: ['run_command', 'read_file'],
            },
            {
                name: 'issue',
                description: 'GitHub issue operations',
                prompt: 'Create or manage GitHub issues. {args}',
                tools: ['run_command'],
            },
            {
                name: 'ci',
                description: 'CI/CD pipeline operations',
                prompt: 'Run, monitor, or manage CI/CD pipelines. {args}',
                tools: ['run_command'],
            },
            {
                name: 'browser',
                description: 'Browser automation (navigate/screenshot/click)',
                prompt: 'Use the browser to navigate, take screenshots, click elements, or extract content from web pages. {args}',
            },
        ];
        for (const cmd of bundled) {
            if (!this.commands.has(cmd.name)) {
                this.commands.set(cmd.name, cmd);
            }
        }
    }
}
//# sourceMappingURL=commands.js.map