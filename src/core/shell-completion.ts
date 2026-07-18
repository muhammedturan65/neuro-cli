// ============================================================
// NeuroCLI - Shell Completion Script Generator
// Generates completion scripts for bash, zsh, and fish
// Includes CLI commands, slash commands, models, themes,
// permission modes, agent names, and dynamic session IDs
// ============================================================

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ShellType = 'bash' | 'zsh' | 'fish';

export interface CompletionOptions {
  commands: Array<{
    name: string;
    description: string;
    options: Array<{ flags: string; description: string }>;
    subcommands?: Array<{ name: string; description: string }>;
  }>;
  models: string[];
  themes: string[];
  permissionModes: string[];
  agents: string[];
  slashCommands: string[];
}

// ---------------------------------------------------------------------------
// ShellCompletionGenerator
// ---------------------------------------------------------------------------

export class ShellCompletionGenerator {
  private options: CompletionOptions;

  constructor(options: CompletionOptions) {
    this.options = options;
  }

  /**
   * Generate a completion script for the given shell type.
   */
  generate(shell: ShellType): string {
    switch (shell) {
      case 'bash':
        return this.generateBash();
      case 'zsh':
        return this.generateZsh();
      case 'fish':
        return this.generateFish();
      default:
        throw new Error(`Unsupported shell type: ${shell}`);
    }
  }

  // =========================================================================
  // Bash completion
  // =========================================================================

  generateBash(): string {
    const cmdNames = this.options.commands.map(c => c.name);
    const slashCmdNames = this.options.slashCommands.map(s =>
      s.startsWith('/') ? s : '/' + s
    );

    const lines: string[] = [
      '#!/usr/bin/env bash',
      '# ------------------------------------------------------------------',
      '# NeuroCLI bash completion',
      '# Install: source this file or place in /etc/bash_completion.d/',
      '#   neuro completion bash > ~/.neuro/completion/neuro.bash',
      '#   echo "source ~/.neuro/completion/neuro.bash" >> ~/.bashrc',
      '# ------------------------------------------------------------------',
      '',
      '_neuro_completion() {',
      '  local cur prev opts cmd',
      '  COMPREPLY=()',
      '  cur="${COMP_WORDS[COMP_CWORD]}"',
      '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
      '',
    ];

    // -- Determine the active subcommand ---------------------------------
    lines.push('  # Determine the active subcommand');
    lines.push('  cmd=""');
    lines.push('  for ((i=1; i<COMP_CWORD; i++)); do');
    lines.push('    case "${COMP_WORDS[i]}" in');
    for (const name of cmdNames) {
      lines.push(`      ${this.bashEscape(name)})`);
      lines.push(`        cmd="${this.bashEscape(name)}"`);
      lines.push('        break;;');
    }
    lines.push('    esac');
    lines.push('  done');
    lines.push('');

    // -- Main command completion ------------------------------------------
    lines.push('  # Main command completion');
    lines.push('  if [[ -z "$cmd" ]]; then');
    lines.push(`    opts="${cmdNames.map(n => this.bashEscape(n)).join(' ')}"`);
    lines.push('    # Global options');
    lines.push('    opts="${opts} --help --version -h -V"');
    lines.push('    opts="${opts} -k --api-key -m --model -t --theme --no-streaming --auto-approve"');
    lines.push('    opts="${opts} -c --continue -r --resume --fork --permission-mode --diff-preview --no-diff-preview"');
    lines.push('');
    lines.push('    # Complete option values that need it');
    lines.push('    case "$prev" in');
    lines.push('      -m|--model)');
    lines.push(`        COMPREPLY=( $(compgen -W "${this.options.models.map(m => this.bashEscape(m)).join(' ')}" -- "$cur") )`);
    lines.push('        return 0;;');
    lines.push('      -t|--theme)');
    lines.push(`        COMPREPLY=( $(compgen -W "${this.options.themes.map(t => this.bashEscape(t)).join(' ')}" -- "$cur") )`);
    lines.push('        return 0;;');
    lines.push('      --permission-mode)');
    lines.push(`        COMPREPLY=( $(compgen -W "${this.options.permissionModes.join(' ')}" -- "$cur") )`);
    lines.push('        return 0;;');
    lines.push('      -r|--resume)');
    lines.push('        COMPREPLY=( $(compgen -W "$(neuro sessions --list-ids 2>/dev/null || echo latest)" -- "$cur") )');
    lines.push('        return 0;;');
    lines.push('      -k|--api-key)');
    lines.push('        return 0;;');
    lines.push('    esac');
    lines.push('');
    lines.push('    COMPREPLY=( $(compgen -W "$opts" -- "$cur") )');
    lines.push('    return 0');
    lines.push('  fi');
    lines.push('');

    // -- Per-command option completion ------------------------------------
    lines.push('  # Per-command option completion');
    lines.push('  case "$cmd" in');

    for (const command of this.options.commands) {
      lines.push(`    ${this.bashEscape(command.name)})`);

      // Build the option list for this command
      const flagList = command.options
        .map(o => o.flags.split(/[\s,|]+/).filter(Boolean))
        .flat()
        .map(f => this.bashEscape(f))
        .join(' ');

      lines.push(`      local cmd_opts="${flagList}"`);

      // Options that require dynamic values
      for (const opt of command.options) {
        const flags = opt.flags.split(/[\s,|]+/).filter(Boolean);
        const takesModel = /model/i.test(opt.flags) || /model/i.test(opt.description);
        const takesAgent = /agent/i.test(opt.flags) || /agent/i.test(opt.description);
        const takesTheme = /theme/i.test(opt.flags) || /theme/i.test(opt.description);
        const takesPermission = /permission/i.test(opt.flags) || /permission/i.test(opt.description);
        const takesFormat = /format/i.test(opt.flags) || /format/i.test(opt.description);
        const takesTransport = /transport/i.test(opt.flags) || /transport/i.test(opt.description);
        const takesSession = /continue|session/i.test(opt.flags);

        if (takesModel || takesAgent || takesTheme || takesPermission || takesFormat || takesTransport || takesSession) {
          for (const flag of flags) {
            lines.push(`      ${flag})`);
            if (takesModel) {
              lines.push(`        COMPREPLY=( $(compgen -W "${this.options.models.map(m => this.bashEscape(m)).join(' ')}" -- "$cur") )`);
            } else if (takesAgent) {
              lines.push(`        COMPREPLY=( $(compgen -W "${this.options.agents.map(a => this.bashEscape(a)).join(' ')}" -- "$cur") )`);
            } else if (takesTheme) {
              lines.push(`        COMPREPLY=( $(compgen -W "${this.options.themes.join(' ')}" -- "$cur") )`);
            } else if (takesPermission) {
              lines.push(`        COMPREPLY=( $(compgen -W "${this.options.permissionModes.join(' ')}" -- "$cur") )`);
            } else if (takesFormat) {
              lines.push('        COMPREPLY=( $(compgen -W "text json stream-json" -- "$cur") )');
            } else if (takesTransport) {
              lines.push('        COMPREPLY=( $(compgen -W "stdio sse http" -- "$cur") )');
            } else if (takesSession) {
              lines.push('        COMPREPLY=( $(compgen -W "$(neuro sessions --list-ids 2>/dev/null || echo latest)" -- "$cur") )');
            }
            lines.push('        return 0;;');
          }
        }
      }

      // Subcommand completion
      if (command.subcommands && command.subcommands.length > 0) {
        const subNames = command.subcommands.map(s => this.bashEscape(s.name)).join(' ');
        lines.push(`      local subcmds="${subNames}"`);
        lines.push('      # If previous word is the command itself, complete subcommands');
        lines.push(`      if [[ "$prev" == "${this.bashEscape(command.name)}" ]]; then`);
        lines.push('        COMPREPLY=( $(compgen -W "$subcmds" -- "$cur") )');
        lines.push('        return 0');
        lines.push('      fi');
        lines.push('      COMPREPLY=( $(compgen -W "$cmd_opts $subcmds" -- "$cur") )');
      } else {
        lines.push('      COMPREPLY=( $(compgen -W "$cmd_opts" -- "$cur") )');
      }

      lines.push('      return 0;;');
    }

    lines.push('  esac');
    lines.push('');

    // -- Slash command completion (inside interactive) --------------------
    lines.push('  # Slash command completion (for interactive mode arguments)');
    lines.push('  # These are provided for reference; interactive readline uses CompletionEngine');
    lines.push(`  local slash_cmds="${slashCmdNames.map(s => this.bashEscape(s)).join(' ')}"`);
    lines.push('');

    lines.push('}');
    lines.push('');
    lines.push('complete -F _neuro_completion neuro');
    lines.push('');

    return lines.join('\n');
  }

  // =========================================================================
  // Zsh completion
  // =========================================================================

  generateZsh(): string {
    const lines: string[] = [
      '#compdef neuro',
      '# ------------------------------------------------------------------',
      '# NeuroCLI zsh completion',
      '# Install:',
      '#   neuro completion zsh > ~/.zfunc/_neuro',
      '#   fpath=(~/.zfunc $fpath) && autoload -Uz compinit && compinit',
      '# ------------------------------------------------------------------',
      '',
    ];

    // -- Dynamic completion helper functions -------------------------------
    lines.push('# Dynamic completion helpers');
    lines.push('(( $+functions[_neuro_models] )) ||');
    lines.push('_neuro_models() {');
    lines.push('  local models; models=(');
    for (const model of this.options.models) {
      lines.push(`    '${this.zshEscape(model)}:${this.zshEscape(model)}'`);
    }
    lines.push('  )');
    lines.push('  _describe -t models "model" models');
    lines.push('}');
    lines.push('');

    lines.push('(( $+functions[_neuro_themes] )) ||');
    lines.push('_neuro_themes() {');
    lines.push('  local themes; themes=(');
    for (const theme of this.options.themes) {
      lines.push(`    '${this.zshEscape(theme)}:${this.zshEscape(theme)} theme'`);
    }
    lines.push('  )');
    lines.push('  _describe -t themes "theme" themes');
    lines.push('}');
    lines.push('');

    lines.push('(( $+functions[_neuro_permission_modes] )) ||');
    lines.push('_neuro_permission_modes() {');
    lines.push('  local modes; modes=(');
    for (const mode of this.options.permissionModes) {
      lines.push(`    '${mode}:${mode} mode'`);
    }
    lines.push('  )');
    lines.push('  _describe -t modes "permission mode" modes');
    lines.push('}');
    lines.push('');

    lines.push('(( $+functions[_neuro_agents] )) ||');
    lines.push('_neuro_agents() {');
    lines.push('  local agents; agents=(');
    for (const agent of this.options.agents) {
      lines.push(`    '${this.zshEscape(agent)}:${this.zshEscape(agent)} agent'`);
    }
    lines.push('  )');
    lines.push('  _describe -t agents "agent" agents');
    lines.push('}');
    lines.push('');

    lines.push('(( $+functions[_neuro_session_ids] )) ||');
    lines.push('_neuro_session_ids() {');
    lines.push('  local ids; ids=(${(f)"$(neuro sessions --list-ids 2>/dev/null)"} latest)');
    lines.push('  _describe -t sessionids "session id" ids');
    lines.push('}');
    lines.push('');

    lines.push('(( $+functions[_neuro_slash_commands] )) ||');
    lines.push('_neuro_slash_commands() {');
    lines.push('  local cmds; cmds=(');
    for (const sc of this.options.slashCommands) {
      const name = sc.startsWith('/') ? sc : '/' + sc;
      lines.push(`    '${this.zshEscape(name)}:${this.zshEscape(name)}'`);
    }
    lines.push('  )');
    lines.push('  _describe -t slashcmds "slash command" cmds');
    lines.push('}');
    lines.push('');

    // -- Main completion function -----------------------------------------
    lines.push('_neuro() {');
    lines.push('  local curcontext="$curcontext" state line ret=1');
    lines.push('  typeset -A opt_args');
    lines.push('');
    lines.push('  # Global options');
    lines.push('  local global_opts=(');
    lines.push('    \'-k[API key]:api-key:\'');
    lines.push('    \'-m[Model to use]:model:_neuro_models\'');
    lines.push('    \'-t[UI theme]:theme:_neuro_themes\'');
    lines.push('    \'--no-streaming[Disable streaming output]\'');
    lines.push('    \'--auto-approve[Auto-approve all tool calls]\'');
    lines.push('    \'-c[Continue most recent session]\'');
    lines.push('    \'-r[Resume specific session]:session:_neuro_session_ids\'');
    lines.push('    \'--fork[Fork the resumed session]\'');
    lines.push('    \'--permission-mode[Permission mode]:mode:_neuro_permission_modes\'');
    lines.push('    \'--diff-preview[Enable diff preview]\'');
    lines.push('    \'--no-diff-preview[Disable diff preview]\'');
    lines.push('    \'--help[Show help]\'');
    lines.push('    \'--version[Show version]\'');
    lines.push('  )');
    lines.push('');

    // -- Subcommands with descriptions and options ------------------------
    lines.push('  local -a subcommands');
    lines.push('  subcommands=(');

    for (const command of this.options.commands) {
      lines.push(`    '${this.zshEscape(command.name)}:${this.zshEscape(command.description)}'`);
    }

    lines.push('  )');
    lines.push('');

    lines.push('  _arguments -C \\');
    lines.push('    "$global_opts[@]" \\');
    lines.push(`    '1":command:->command" \\`);
    lines.push(`    "*::arg:->args" \\`);
    lines.push('    && ret=0');
    lines.push('');

    // -- State: command ---------------------------------------------------
    lines.push('  case $state in');
    lines.push('    command)');
    lines.push('      _describe -t commands "neuro command" subcommands && ret=0');
    lines.push('      ;;');
    lines.push('    args)');
    lines.push('      case $words[1] in');

    for (const command of this.options.commands) {
      lines.push(`        ${this.zshEscape(command.name)})`);

      const cmdOpts: string[] = [];
      for (const opt of command.options) {
        const parts = opt.flags.split(/[\s,|]+/).filter(Boolean);
        const takesModel = /model/i.test(opt.flags) || /model/i.test(opt.description);
        const takesAgent = /agent/i.test(opt.flags) || /agent/i.test(opt.description);
        const takesTheme = /theme/i.test(opt.flags) || /theme/i.test(opt.description);
        const takesPermission = /permission/i.test(opt.flags) || /permission/i.test(opt.description);
        const takesFormat = /format/i.test(opt.flags) || /format/i.test(opt.description);
        const takesTransport = /transport/i.test(opt.flags) || /transport/i.test(opt.description);
        const takesSession = /continue|session/i.test(opt.flags);

        let valueAction = '';
        if (takesModel) valueAction = ':model:_neuro_models';
        else if (takesAgent) valueAction = ':agent:_neuro_agents';
        else if (takesTheme) valueAction = ':theme:_neuro_themes';
        else if (takesPermission) valueAction = ':mode:_neuro_permission_modes';
        else if (takesFormat) valueAction = ':format:(text json stream-json)';
        else if (takesTransport) valueAction = ':transport:(stdio sse http)';
        else if (takesSession) valueAction = ':session:_neuro_session_ids';

        for (const part of parts) {
          const escaped = this.zshEscape(part);
          const desc = this.zshEscape(opt.description);
          if (valueAction) {
            cmdOpts.push(`'${escaped}[${desc}]${valueAction}'`);
          } else {
            cmdOpts.push(`'${escaped}[${desc}]'`);
          }
        }
      }

      if (command.subcommands && command.subcommands.length > 0) {
        lines.push('          local -a subcmds');
        lines.push('          subcmds=(');
        for (const sub of command.subcommands) {
          lines.push(`            '${this.zshEscape(sub.name)}:${this.zshEscape(sub.description)}'`);
        }
        lines.push('          )');

        if (cmdOpts.length > 0) {
          lines.push('          _arguments \\');
          for (let i = 0; i < cmdOpts.length; i++) {
            lines.push(`            ${cmdOpts[i]} \\`);
          }
          lines.push('            "1:subcommand:->subcmd" && ret=0');
        } else {
          lines.push('          _describe -t subcmds "subcommand" subcmds && ret=0');
        }

        lines.push('          case $state in');
        lines.push('            subcmd)');
        lines.push('              _describe -t subcmds "subcommand" subcmds && ret=0');
        lines.push('              ;;');
        lines.push('          esac');
      } else if (cmdOpts.length > 0) {
        lines.push('          _arguments \\');
        for (let i = 0; i < cmdOpts.length; i++) {
          lines.push(`            ${cmdOpts[i]}${i < cmdOpts.length - 1 ? ' \\' : ''}`);
        }
        lines.push('          && ret=0');
      }

      lines.push('          ;;');
    }

    lines.push('      esac');
    lines.push('      ;;');
    lines.push('  esac');
    lines.push('');
    lines.push('  return ret');
    lines.push('}');
    lines.push('');
    lines.push('_neuro "$@"');
    lines.push('');

    return lines.join('\n');
  }

  // =========================================================================
  // Fish completion
  // =========================================================================

  generateFish(): string {
    const lines: string[] = [
      '# ------------------------------------------------------------------',
      '# NeuroCLI fish completion',
      '# Install:',
      '#   neuro completion fish > ~/.config/fish/completions/neuro.fish',
      '# ------------------------------------------------------------------',
      '',
    ];

    // -- Disable file completions -----------------------------------------
    lines.push('complete -c neuro -f');
    lines.push('');

    // -- Helper: model completions ----------------------------------------
    lines.push('# Models');
    for (const model of this.options.models) {
      lines.push(`complete -c neuro -n '__fish_use_subcommand' -l model -d '${this.fishEscape(model)}'`);
    }
    lines.push('');

    // -- Global options ---------------------------------------------------
    lines.push('# Global options');
    lines.push("complete -c neuro -n '__fish_use_subcommand' -s k -l api-key -d 'OpenRouter API key' -r");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -s m -l model -d 'Model to use' -r");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -s t -l theme -d 'UI theme' -r");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -l no-streaming -d 'Disable streaming output'");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -l auto-approve -d 'Auto-approve all tool calls'");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -s c -l continue -d 'Continue most recent session'");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -s r -l resume -d 'Resume specific session' -r");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -l fork -d 'Fork the resumed session'");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -l permission-mode -d 'Permission mode' -r");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -l diff-preview -d 'Enable diff preview'");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -l no-diff-preview -d 'Disable diff preview'");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -s h -l help -d 'Show help'");
    lines.push("complete -c neuro -n '__fish_use_subcommand' -s V -l version -d 'Show version'");
    lines.push('');

    // -- Condition function: only complete for a specific subcommand ------
    // Build a helper that checks if a given subcommand is the active one
    const cmdNames = this.options.commands.map(c => c.name);
    const allCmdsExcept = (exclude: string): string =>
      cmdNames.filter(n => n !== exclude).map(n => this.fishEscape(n)).join(' ');

    // -- Subcommands ------------------------------------------------------
    lines.push('# Subcommands');
    for (const command of this.options.commands) {
      lines.push(`complete -c neuro -n '__fish_use_subcommand' -a '${this.fishEscape(command.name)}' -d '${this.fishEscape(command.description)}'`);
    }
    lines.push('');

    // -- Per-command options ----------------------------------------------
    lines.push('# Per-command options');
    for (const command of this.options.commands) {
      const condition = `__fish_seen_subcommand_from ${this.fishEscape(command.name)}`;

      for (const opt of command.options) {
        const flags = opt.flags.split(/[\s,|]+/).filter(Boolean);
        const takesModel = /model/i.test(opt.flags) || /model/i.test(opt.description);
        const takesAgent = /agent/i.test(opt.flags) || /agent/i.test(opt.description);
        const takesTheme = /theme/i.test(opt.flags) || /theme/i.test(opt.description);
        const takesPermission = /permission/i.test(opt.flags) || /permission/i.test(opt.description);
        const takesFormat = /format/i.test(opt.flags) || /format/i.test(opt.description);
        const takesTransport = /transport/i.test(opt.flags) || /transport/i.test(opt.description);
        const takesSession = /continue|session/i.test(opt.flags);

        // Determine if the option takes a required argument
        const takesArg = takesModel || takesAgent || takesTheme || takesPermission || takesFormat || takesTransport || takesSession;
        const requireFlag = takesArg ? ' -r' : '';

        for (const flag of flags) {
          const escaped = this.fishEscape(flag);
          const desc = this.fishEscape(opt.description);

          let argCompletions = '';
          if (takesModel) {
            argCompletions = ` -a '${this.options.models.map(m => this.fishEscape(m)).join(' ')}'`;
          } else if (takesAgent) {
            argCompletions = ` -a '${this.options.agents.map(a => this.fishEscape(a)).join(' ')}'`;
          } else if (takesTheme) {
            argCompletions = ` -a '${this.options.themes.join(' ')}'`;
          } else if (takesPermission) {
            argCompletions = ` -a '${this.options.permissionModes.join(' ')}'`;
          } else if (takesFormat) {
            argCompletions = " -a 'text json stream-json'";
          } else if (takesTransport) {
            argCompletions = " -a 'stdio sse http'";
          } else if (takesSession) {
            argCompletions = " -a '(neuro sessions --list-ids 2>/dev/null; echo latest)'";
          }

          lines.push(`complete -c neuro -n '${condition}'${flag.length === 1 ? ` -s ${escaped}` : ` -l ${escaped.replace(/^-+/, '')}`}${requireFlag} -d '${desc}'${argCompletions}`);
        }
      }

      // Subcommands of this command
      if (command.subcommands && command.subcommands.length > 0) {
        for (const sub of command.subcommands) {
          lines.push(`complete -c neuro -n '${condition}' -a '${this.fishEscape(sub.name)}' -d '${this.fishEscape(sub.description)}'`);
        }
      }
    }
    lines.push('');

    // -- Slash commands (informational) -----------------------------------
    lines.push('# Slash commands (for interactive mode reference)');
    for (const sc of this.options.slashCommands) {
      const name = sc.startsWith('/') ? sc : '/' + sc;
      lines.push(`# ${this.fishEscape(name)}`);
    }
    lines.push('');

    return lines.join('\n');
  }

  // =========================================================================
  // Write to file
  // =========================================================================

  writeToFile(shell: ShellType, filePath: string): void {
    const content = this.generate(shell);
    const dir = dirname(filePath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory may already exist
    }
    writeFileSync(filePath, content, 'utf-8');
  }

  // =========================================================================
  // Default options -- mirrors the real NeuroCLI configuration
  // =========================================================================

  static getDefaultOptions(): CompletionOptions {
    return {
      commands: [
        {
          name: 'run',
          description: 'Run a task in headless/CI mode',
          options: [
            { flags: '-m, --model', description: 'Model to use' },
            { flags: '-a, --agent', description: 'Agent to use' },
            { flags: '--max-turns', description: 'Max agent iterations' },
            { flags: '--allowed-tools', description: 'Comma-separated list of allowed tools' },
            { flags: '-f, --format', description: 'Output format: text, json, stream-json' },
            { flags: '--auto', description: 'Auto-approve all tool calls' },
            { flags: '--continue', description: 'Continue a specific session' },
          ],
        },
        {
          name: 'ask',
          description: 'Ask a single question and exit',
          options: [
            { flags: '-m, --model', description: 'Model to use' },
            { flags: '-a, --agent', description: 'Agent to use' },
            { flags: '-f, --format', description: 'Output format: text, json' },
          ],
        },
        {
          name: 'models',
          description: 'List available models',
          options: [],
        },
        {
          name: 'agents',
          description: 'List available agents',
          options: [],
        },
        {
          name: 'config',
          description: 'Show or modify configuration',
          options: [
            { flags: '--set-key', description: 'Set API key' },
            { flags: '--set-model', description: 'Set default model' },
            { flags: '--set-theme', description: 'Set UI theme' },
            { flags: '--set-permission', description: 'Set permission mode (manual, auto, plan, yolo)' },
            { flags: '--show', description: 'Show current config' },
          ],
        },
        {
          name: 'sessions',
          description: 'List or manage sessions',
          options: [
            { flags: '--clear', description: 'Clear all sessions' },
          ],
        },
        {
          name: 'mcp',
          description: 'Manage MCP (Model Context Protocol) servers',
          options: [
            { flags: '-t, --transport', description: 'Transport type: stdio, sse, http' },
            { flags: '--headers', description: 'HTTP headers as JSON string' },
          ],
          subcommands: [
            { name: 'add', description: 'Add an MCP server' },
            { name: 'list', description: 'List configured MCP servers' },
            { name: 'remove', description: 'Remove an MCP server' },
            { name: 'connect', description: 'Connect to an MCP server' },
            { name: 'disconnect', description: 'Disconnect from an MCP server' },
            { name: 'health', description: 'Check MCP server health' },
          ],
        },
      ],
      models: [
        'qwen/qwen3-coder:free',
        'qwen/qwen3-next-80b-a3b-instruct:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        'nvidia/nemotron-3-nano-30b-a3b:free',
        'nvidia/nemotron-nano-12b-v2-vl:free',
        'nvidia/nemotron-nano-9b-v2:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'meta-llama/llama-3.2-3b-instruct:free',
        'google/gemma-4-31b-it:free',
        'google/gemma-4-26b-a4b-it:free',
        'poolside/laguna-m.1:free',
        'poolside/laguna-xs-2.1:free',
        'cohere/north-mini-code:free',
        'openai/gpt-oss-20b:free',
        'nousresearch/hermes-3-llama-3.1-405b:free',
        'tencent/hy3:free',
        'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
        'openrouter/free',
        'anthropic/claude-sonnet-4',
        'anthropic/claude-opus-4',
        'anthropic/claude-3.5-haiku',
        'google/gemini-2.5-pro',
        'google/gemini-2.5-flash',
        'openai/gpt-4o',
        'openai/gpt-4o-mini',
        'openai/o3',
        'openai/o4-mini',
        'meta-llama/llama-4-maverick',
        'deepseek/deepseek-r1',
        'deepseek/deepseek-chat',
        'qwen/qwen3-235b-a22b',
        'mistralai/mistral-large-2411',
      ],
      themes: ['dracula', 'dark', 'nord', 'light'],
      permissionModes: ['manual', 'auto', 'plan', 'yolo'],
      agents: ['Planner', 'Coder', 'Reviewer', 'Researcher', 'Tester', 'Debugger', 'Architect', 'DevOps'],
      slashCommands: [
        '/help',
        '/model',
        '/agent',
        '/auto',
        '/orchestrate',
        '/plan',
        '/direct',
        '/plan-mode',
        '/stats',
        '/theme',
        '/clear',
        '/exit',
        '/quit',
        '/resume',
        '/compact',
        '/undo',
        '/redo',
        '/mcp',
        '/fork',
        '/init',
        '/permission',
        '/perm',
        '/doctor',
        '/export',
        '/import',
        '/sandbox',
        '/whitelist',
        '/blacklist',
      ],
    };
  }

  // =========================================================================
  // Escaping helpers
  // =========================================================================

  /**
   * Escape a string for safe embedding in a bash double-quoted context.
   * Escapes: backslash, double-quote, dollar, backtick, and exclamation.
   */
  private bashEscape(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`')
      .replace(/!/g, '\\!');
  }

  /**
   * Escape a string for safe embedding in a zsh single-quoted context.
   * Inside single quotes only the single quote itself needs escaping;
   * zsh uses '\'' (end quote, escaped quote, reopen quote).
   */
  private zshEscape(str: string): string {
    return str.replace(/'/g, "'\\''");
  }

  /**
   * Escape a string for safe embedding in a fish completion description
   * or argument. Fish uses single quotes; escape single quotes and
   * backslashes.
   */
  private fishEscape(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }
}
