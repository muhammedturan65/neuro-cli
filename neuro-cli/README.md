# 🧠 NeuroCLI v2.0

**Advanced AI Terminal Coding Assistant** — Multi-agent architecture, 23 free models, MCP support, sandbox mode, plugin SDK, and deep context management.

## Features

### 🆓 23 Free Models via OpenRouter
- **Qwen3 Coder** (1M context) — best for coding
- **NVIDIA Nemotron 3** (120B/550B) — powerful reasoning
- **Google Gemma 4** (31B) — multimodal + tools
- **Cohere North Mini Code** — fast code generation
- **Llama 3.3 70B**, **Hermes 3 405B**, **Tencent Hy3**, **Poolside Laguna**, **OpenAI gpt-oss-20b**
- $0 cost per developer per day

### 🤖 8+ Specialized Agents
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
| **Custom** | Define your own agents! |

### 🔌 MCP (Model Context Protocol) — Enhanced
Full MCP support with **stdio, SSE, and HTTP** transports:
- Auto-reconnect with exponential backoff
- Health check monitoring
- Resource & Prompt support
- Connection state tracking
```bash
neuro mcp add myserver "npx -y @modelcontextprotocol/server-everything"
neuro mcp add remote "https://mcp.example.com/sse" -t sse
neuro mcp list
/mcp connect myserver    # in interactive mode
/mcp health              # show connection health report
```

### 🛡️ Enhanced Permission System
4 permission modes with **interactive approval + diff preview**:
- **Manual** — Ask for every action
- **Auto** — Auto-approve safe operations, ask for dangerous ones
- **Plan** — Read-only mode (no modifications)
- **Yolo** — Auto-approve everything (dangerous)

New features:
- **Whitelist/Blacklist** — Persist tool approvals/denials across sessions
- **Batch Approval** — Group similar operations and approve/deny together
- **Diff Preview** — See file changes before approving modifications
- **"Always" mode** — Persist approval decisions (`A` key)
- **Approval Statistics** — Track which tools you approve/deny most
- **Edit args** — Modify tool arguments before execution (`e` key)

```bash
/whitelist add write_file     # Always allow file writes
/blacklist add run_command    # Never allow command execution
/whitelist list               # Show whitelisted tools
/blacklist list               # Show blacklisted tools
```

### 🔒 Sandbox Mode
Protect your filesystem with configurable sandbox:
- Restrict file modifications to project directory
- Deny access to sensitive files (.env, .pem, .key)
- Block dangerous commands (rm -rf /, sudo, mkfs)
- Auto-backup files before modification
- Undo all sandbox changes with one command
```bash
/sandbox              # Toggle sandbox mode
/sandbox on           # Enable sandbox
/sandbox status       # Show sandbox configuration
/sandbox undo         # Undo all modifications made in sandbox
```

### 🧩 Plugin SDK
Extend NeuroCLI with custom tools:
```javascript
// ~/.neuro/plugins/my-plugin/index.js
import { createPlugin } from 'neuro-cli';

export default createPlugin({
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom tools',
  tools: [{
    name: 'my_tool',
    description: 'Does something custom',
    parameters: { type: 'object', properties: { input: { type: 'string', description: 'Input' } }, required: ['input'] },
    risk: 'low',
    execute: async (args, ctx) => `Result: ${args.input}`,
  }],
});
```

```bash
/plugins list          # List loaded plugins
/plugins load my-plugin  # Load a plugin
```

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
- Automatic diff preview on file modifications (with approval)
- LCS-based diff algorithm
- Summary view for multiple changes
- Interactive confirmation

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

### 💰 Spending Limit
Set a maximum spending limit per session:
```bash
neuro config --set-spending-limit 1.00   # $1 max per session
```

### 🔍 Enhanced Tab Completion
- Slash commands with descriptions
- Model names and categories (`/model free` shows free models)
- File path completion (./, ~/, absolute paths)
- Session ID completion
- Agent name completion (@-mentions)
- Command history with search
- Context-aware suggestions

## Installation

```bash
# Clone and install
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
neuro --permission-mode auto   # Set permission mode
neuro --sandbox                # Start with sandbox enabled
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
| `/mcp health` | Show MCP health report |
| `/init` | Initialize NEURO.md |
| `/sandbox` | Toggle sandbox mode |
| `/plugins` | Manage plugins |
| `/whitelist` | Manage tool whitelist |
| `/blacklist` | Manage tool blacklist |
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
  "sandbox": {
    "enabled": false,
    "rootDir": "/path/to/project",
    "deniedDirs": ["node_modules", ".git"],
    "deniedPatterns": ["**/.env", "**/*.pem"],
    "allowCommands": true,
    "backupOnModify": true
  },
  "spendingLimit": 0,
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
│   ├── approval.ts       Enhanced permission & approval system
│   ├── completion.ts     Enhanced tab completion
│   ├── diff-preview.ts   Diff preview UI
│   ├── doom-loop.ts      Doom loop protection
│   ├── fallback.ts       Fallback model chain
│   ├── headless.ts       Headless/CI mode
│   ├── context.ts        Context window manager
│   ├── session.ts        Session persistence
│   ├── sandbox.ts        Sandbox mode (file isolation)
│   └── plugin-sdk.ts     Plugin/custom tools SDK
├── api/
│   ├── models.ts         36 model registry (23 free)
│   └── openrouter.ts     OpenRouter client + streaming
├── mcp/
│   └── client.ts         Enhanced MCP client (stdio/SSE/HTTP)
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
