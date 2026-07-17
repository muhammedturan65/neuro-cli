// ============================================================
// NeuroCLI - Custom Slash Commands
// (Like Gemini CLI + OpenCode custom commands)
// ============================================================

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  args?: string[];
  model?: string;
  tools?: string[];
  autoApprove?: boolean;
  subagent?: boolean;
}

export class CommandSystem {
  private commands: Map<string, CustomCommand> = new Map();
  private workingDirectory: string;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
  }

  /**
   * Discover and load custom commands
   */
  discover(): CustomCommand[] {
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
  get(name: string): CustomCommand | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all commands
   */
  getAll(): CustomCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Parse a slash command input
   */
  parse(input: string): { command: CustomCommand; args: string } | null {
    if (!input.startsWith('/')) return null;

    const parts = input.slice(1).split(' ');
    const cmdName = parts[0];
    const args = parts.slice(1).join(' ');

    const cmd = this.commands.get(cmdName);
    if (!cmd) return null;

    return { command: cmd, args };
  }

  /**
   * Build the final prompt from a command template and args
   */
  buildPrompt(command: CustomCommand, args: string): string {
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

  private discoverFromDirectory(dir: string): void {
    if (!existsSync(dir)) return;

    try {
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.md')) {
          const cmd = this.parseCommandFile(join(dir, file));
          if (cmd) this.commands.set(cmd.name, cmd);
        }
      }
    } catch {}
  }

  private parseCommandFile(filePath: string): CustomCommand | null {
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
        name: frontmatter.name as string || name,
        description: frontmatter.description as string || '',
        prompt: fmMatch[2],
        model: frontmatter.model as string | undefined,
        tools: frontmatter.tools as string[] | undefined,
        autoApprove: frontmatter.auto_approve as boolean | undefined,
        subagent: frontmatter.subagent as boolean | undefined,
      };
    } catch {
      return null;
    }
  }

  private parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const line of yaml.split('\n')) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        result[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    }
    return result;
  }

  private loadBundledCommands(): void {
    const bundled: CustomCommand[] = [
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
    ];

    for (const cmd of bundled) {
      if (!this.commands.has(cmd.name)) {
        this.commands.set(cmd.name, cmd);
      }
    }
  }
}
