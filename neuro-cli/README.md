# NeuroCLI v3.0

**Advanced AI Terminal Coding Assistant** — Multi-agent architecture, MCP protocol, 23+ free models, skill system, model routing, Ollama support, and deep context management.

## What's New in v3.0

| System | Description |
|--------|-------------|
| Undo/Redo | Full file change tracking with undo/redo stacks |
| Prompt Cache | SHA-256 based cache with similarity matching |
| Model Router | Auto-routing based on task complexity + effort levels |
| Output Styles | 8 styles: concise, explanatory, learning, narrative, etc. |
| Extended Thinking | 4 modes: none, brief, full, ultrathink |
| Spending Monitor | Daily/session limits, warnings, model breakdown |
| Skill System | 8 built-in skills with auto-activation |
| Custom Agents | Load from .neuro/agents/ with YAML frontmatter |
| Custom Tools | Load from .neuro/tools/ with JS sandboxing |
| NeuroIgnore | .neuroignore with gitignore-style patterns |
| Ollama Provider | Local model support via Ollama API |
| Shell Completion | bash/zsh/fish completion script generator |

## Features

### 23 Free Models via OpenRouter
- **Qwen3 Coder** (1M context) - best for coding
- **NVIDIA Nemotron 3** (120B/550B) - powerful reasoning
- **Google Gemma 4** (31B) - multimodal + tools
- **Cohere North Mini Code** - fast code generation
- $0 cost per developer per day

### 8+ Specialized Agents
| Agent | Specialty |
|-------|-----------|
| Planner | Task decomposition |
| Coder | Code generation & modification |
| Reviewer | Code quality & security |
| Researcher | Information gathering |
| Tester | Test generation & execution |
| Debugger | Bug investigation & fixing |
| Architect | System design |
| DevOps | Deployment & infrastructure |
| **Custom** | Define your own in .neuro/agents/ |

### MCP Protocol (stdio/SSE/HTTP)
```bash
neuro mcp add myserver "npx -y @modelcontextprotocol/server-everything"
neuro mcp add remote "https://mcp.example.com/sse" -t sse
/mcp list /mcp health /mcp connect myserver
```

### 4 Permission Modes
- **Manual** - Ask for every action
- **Auto** - Auto-approve safe operations
- **Plan** - Read-only mode
- **Yolo** - Auto-approve everything

### Model Router
Automatically selects the best model based on task complexity:
- Simple tasks -> fast model (Gemma 4)
- Complex tasks -> powerful model (Nemotron Ultra)
- Effort levels: low, medium, high, ultrathink
```bash
/effort high        # Use high-effort model
/effort ultrathink  # Maximum reasoning power
```

### Output Styles
8 built-in styles to control response formatting:
```bash
/style concise      # Brief, to-the-point responses
/style explanatory  # Detailed with examples and context
/style learning     # Tutorial-style with step-by-step
/style technical    # Formal API documentation style
/style review       # Code review with severity levels
/style debug        # Systematic investigation format
```

### Extended Thinking
```bash
/thinking full      # Show reasoning process
/thinking ultrathink # Maximum thinking budget (16K tokens)
/thinking none      # Disable thinking blocks
```

### Skill System
8 built-in skills with auto-activation:
- security, react, testing, api-design, database, performance, devops, debugging
```bash
/skills list              # List all available skills
/skills activate react    # Manually activate a skill
/skills clear             # Deactivate all skills
```

### Prompt Cache
```bash
/cache on       # Enable prompt caching
/cache stats    # Show cache hit rate and savings
/cache clear    # Clear cache
```

### Spending Monitor
```bash
/spending               # Show daily/session spending report
/cost                   # Show spending + cache savings
neuro --spending-limit 1.00  # Set daily limit
```

### Custom Agents (.neuro/agents/)
Create `.neuro/agents/reviewer.md`:
```markdown
---
name: security-reviewer
description: Security-focused code reviewer
tools: read_file, search_files, run_command
priority: 90
---
You are a security-focused code reviewer. Check for OWASP Top 10 vulnerabilities...
```

### Custom Tools (.neuro/tools/)
Create `.neuro/tools/deploy.json`:
```json
{
  "name": "deploy",
  "description": "Deploy to staging",
  "parameters": { "type": "object", "properties": { "env": { "type": "string", "description": "Target environment" } }, "required": ["env"] },
  "command": "npm run deploy:{{env}}",
  "risk": "high"
}
```

### Ollama Local Models
```bash
neuro --ollama            # Use Ollama instead of OpenRouter
/ollama                   # List available local models
neuro models --ollama     # List Ollama models from CLI
```

### Shell Completion
```bash
neuro completion bash > ~/.neuro/completion.bash
neuro completion zsh > ~/.neuro/completion.zsh
neuro completion fish > ~/.neuro/completion.fish
```

### All Other Features
- Sandbox mode with file isolation
- Plugin SDK for custom extensions
- Doom loop protection
- Fallback model chain
- Diff preview before changes
- 5-layer context compaction
- Git auto-commit & checkpointing
- Headless/CI mode
- 20+ lifecycle hooks
- LSP integration
- Second-model advisor
- .neuroignore support

## Installation

```bash
git clone https://github.com/muhammedturan65/neuro-cli.git
cd neuro-cli
npm install
npm run build
npm link

# Configure API key
neuro config --set-key YOUR_OPENROUTER_API_KEY

# Or use environment variable
export OPENROUTER_API_KEY=YOUR_KEY
```

## Usage

### Interactive Mode
```bash
neuro                          # Start interactive session
neuro -c                       # Continue last session
neuro -r session_abc123        # Resume specific session
neuro --effort high            # High-effort model routing
neuro --style explanatory      # Detailed explanations
neuro --thinking               # Enable extended thinking
neuro --cache                  # Enable prompt caching
neuro --sandbox                # Start with sandbox enabled
neuro --ollama                 # Use local Ollama models
```

### Headless/CI Mode
```bash
neuro run "Create a REST API" --format json --auto
neuro run "Run tests" --max-turns 5 --allowed-tools "run_command,read_file"
```

### All Slash Commands
| Command | Description |
|---------|-------------|
| `/help` | Show help message |
| `/model [id]` | Switch or list models |
| `/agent [name]` | Switch or list agents |
| `/permission [mode]` | Set/cycle permission mode |
| `/resume [id]` | Resume previous session |
| `/fork` | Fork current session |
| `/compact` | Compact context |
| `/undo` | Undo last change |
| `/redo` | Redo undone change |
| `/rewind [n]` | Rewind n changes |
| `/mcp [cmd]` | Manage MCP servers |
| `/init` | Initialize NEURO.md |
| `/sandbox` | Toggle sandbox mode |
| `/style [name]` | Switch output style |
| `/thinking [mode]` | Toggle thinking mode |
| `/effort [level]` | Set effort level |
| `/skills [cmd]` | Manage skills |
| `/cache [cmd]` | Manage prompt cache |
| `/spending` | Show spending report |
| `/cost` | Show cost + cache savings |
| `/ignore [cmd]` | Manage .neuroignore |
| `/ollama` | List local Ollama models |
| `/commit-push-pr` | Commit + push + create PR |
| `/code-review` | Multi-agent code review |
| `/doctor` | Health check |
| `/export [path]` | Export session as JSON |
| `/import <path>` | Import session from JSON |
| `/stats` | Session statistics |

## Project Structure

```
src/
├── index.ts              CLI entry point (v3.0)
├── core/
│   ├── types.ts          Shared interfaces
│   ├── engine.ts         NeuroEngine v3.0 (all systems)
│   ├── approval.ts       Interactive approval + diff preview
│   ├── completion.ts     Tab completion (35+ commands)
│   ├── undo-redo.ts      Undo/Redo system
│   ├── prompt-cache.ts   SHA-256 prompt caching
│   ├── model-router.ts   Auto model routing + effort levels
│   ├── output-styles.ts  8 output style presets
│   ├── extended-thinking.ts  Thinking mode support
│   ├── spending-warnings.ts  Spending monitor + limits
│   ├── shell-completion.ts   bash/zsh/fish completion
│   ├── diff-preview.ts   Diff preview UI
│   ├── doom-loop.ts      Doom loop protection
│   ├── fallback.ts       Fallback model chain
│   ├── headless.ts       Headless/CI mode
│   ├── context.ts        Context window manager
│   ├── session.ts        Session persistence + fork/import/export
│   ├── sandbox.ts        Sandbox mode
│   └── plugin-sdk.ts     Plugin/custom tools SDK
├── api/
│   ├── models.ts         36 model registry (23 free)
│   ├── openrouter.ts     OpenRouter client + streaming
│   └── ollama.ts         Ollama local model provider
├── mcp/
│   └── client.ts         Enhanced MCP client (stdio/SSE/HTTP)
├── agents/
│   ├── base.ts           BaseAgent (tool loop)
│   ├── orchestrator.ts   Multi-agent orchestrator
│   └── team.ts           Inter-agent messaging
├── tools/                18 built-in tools
├── config/               Configuration system
├── ui/                   Terminal UI + 4 themes
├── commands/             Custom slash commands
├── context/
│   ├── compaction.ts     5-layer context compaction
│   ├── git-checkpoint.ts Auto-commit & checkpointing
│   ├── repo-map.ts       Code map generator
│   ├── neuro-md.ts       NEURO.md project context
│   ├── skill-system.ts   Skill auto-activation
│   ├── custom-agents.ts  .neuro/agents/ loader
│   ├── custom-tools.ts   .neuro/tools/ loader
│   └── neuroignore.ts    .neuroignore support
├── hooks/                20 lifecycle events
├── lsp/                  LSP integration
└── advisor/              Second-model advisor
```

## License

MIT
