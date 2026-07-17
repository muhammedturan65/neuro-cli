# 🧠 NeuroCLI

**Advanced AI Terminal Coding Assistant** — Multi-agent architecture, 23 free models, MCP support, and deep context management.

## Features

### 🆓 23 Free Models via OpenRouter
- **Qwen3 Coder** (1M context) — best for coding
- **NVIDIA Nemotron 3** (120B/550B) — powerful reasoning
- **Google Gemma 4** (31B) — multimodal + tools
- **Cohere North Mini Code** — fast code generation
- $0 cost per developer per day

### 🤖 8 Specialized Agents
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

### 🔌 MCP (Model Context Protocol)
Full MCP support with stdio, SSE, and HTTP transports:
```bash
neuro mcp add myserver "npx -y @modelcontextprotocol/server-everything"
neuro mcp list
/mcp connect myserver    # in interactive mode
```

### 🛡️ Permission System
4 permission modes with interactive approval:
- **Manual** — Ask for every action
- **Auto** — Auto-approve safe operations, ask for dangerous ones
- **Plan** — Read-only mode (no modifications)
- **Yolo** — Auto-approve everything (dangerous)

### 🔄 Doom Loop Protection
Detects and prevents agent stuck loops with:
- Consecutive error tracking
- Repetitive action detection
- Similar error pattern analysis
- Auto-pause with `/unpause` to resume

### ⛓️ Fallback Model Chain
Automatic model fallback on failure:
```json
{
  "fallbackChain": {
    "models": ["qwen/qwen3-coder:free", "nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"]
  }
}
```

### 📋 Diff Preview
Preview file changes before applying them with color-coded diff display.

### 🖥️ Headless/CI Mode
```bash
neuro run "Fix the auth bug" --max-turns 10 --format json --auto
neuro run "Create a REST API" --agent Coder --allowed-tools "read_file,write_file,edit_file"
```

### 📝 5-Layer Context Compaction
Progressive context management:
1. **Tool Budget** — Truncate tool outputs to 5K tokens
2. **Snip** — Remove old turns, keep last 40 messages
3. **Micro** — Compress each message to essential content
4. **Session Memory** — LLM-based key fact extraction
5. **Full Collapse** — LLM summarizes entire conversation

### 🗺️ Repository Map
Automatic code map with definition extraction for TypeScript, Python, Go, Rust, and Java.

### 🧠 Advisor System
Second-model consultation during tasks with 6 trigger types including recurring error detection.

### 🔍 LSP Integration
Language Server Protocol support for TypeScript, Python, Go, and Rust — go-to-definition, references, diagnostics.

### 🪝 20 Lifecycle Hooks
8 categories of hook events: Session, Agent, Model, Tool, Permission, User, Context, Environment.

## Installation

```bash
# Clone and install
git clone https://github.com/your-username/neuro-cli.git
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
neuro --permission-mode auto   # Set permission mode
```

### One-Shot Mode
```bash
neuro ask "Explain this codebase"
neuro ask "Fix the bug in auth.ts" -m qwen/qwen3-coder:free
```

### Headless/CI Mode
```bash
neuro run "Create a REST API" --format json --auto
neuro run "Run tests" --max-turns 5 --allowed-tools "run_command,read_file"
```

### MCP Management
```bash
neuro mcp add filesystem "npx -y @modelcontextprotocol/server-filesystem /path"
neuro mcp add github "https://mcp.github.com/sse" -t sse
neuro mcp list
neuro mcp remove filesystem
```

### Interactive Commands
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
| `/mcp [cmd]` | Manage MCP servers |
| `/init` | Initialize NEURO.md |
| `/doctor` | Health check |
| `/export` | Export session as JSON |
| `/stats` | Session statistics |

## Project Context

Create a `NEURO.md` file in your project root to give NeuroCLI persistent context:

```markdown
# Project Context

## Tech Stack
- TypeScript + Node.js
- Express for API
- PostgreSQL database

## Conventions
- Use camelCase for variables
- All API endpoints prefixed with /api/v1
- Tests in __tests__/ directory
```

## Configuration

Config stored at `~/.neuro/config.json`:

```json
{
  "apiKey": "...",
  "defaultModel": "qwen/qwen3-coder:free",
  "permissionMode": "auto",
  "diffPreview": true,
  "fallbackChain": {
    "models": ["qwen/qwen3-coder:free", "nvidia/nemotron-3-super-120b-a12b:free"]
  },
  "doomLoop": {
    "maxConsecutiveErrors": 3,
    "autoBreak": true
  }
}
```

## Architecture

```
src/
├── index.ts              CLI entry point
├── core/
│   ├── types.ts          Shared interfaces
│   ├── engine.ts         Main NeuroEngine
│   ├── approval.ts       Permission & approval system
│   ├── completion.ts     Tab completion engine
│   ├── diff-preview.ts   Diff preview UI
│   ├── doom-loop.ts      Doom loop protection
│   ├── fallback.ts       Fallback model chain
│   ├── headless.ts       Headless/CI mode
│   ├── context.ts        Context window manager
│   └── session.ts        Session persistence
├── api/
│   ├── models.ts         36 model registry (23 free)
│   └── openrouter.ts     OpenRouter client + streaming
├── mcp/
│   └── client.ts         MCP protocol client
├── agents/
│   ├── base.ts           BaseAgent (tool loop)
│   ├── orchestrator.ts   Multi-agent orchestrator
│   └── team.ts           Inter-agent messaging
├── tools/                18 built-in tools
├── config/               Configuration system
├── ui/                   Terminal UI + 4 themes
├── commands/             14+ slash commands
├── context/              Compaction, checkpoints, repo map, NEURO.md
├── hooks/                20 lifecycle events
├── lsp/                  LSP integration
└── advisor/              Second-model advisor
```

## License

MIT
