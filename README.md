# Symapse

> Architectural awareness engine for AI coding agents

<p align="center">
  <img alt="npm version" src="https://img.shields.io/npm/v/symapse?color=blue">
  <img alt="license" src="https://img.shields.io/npm/l/symapse">
  <img alt="node" src="https://img.shields.io/node/v/symapse">
</p>

## Install

```bash
npm install -g symapse
```

Requires **Node.js 22+**. No dependencies. Zero config.

---

## Quick Start

```bash
# Index your project
symapse index /path/to/repo

# Start the MCP server (for OpenCode/Cursor/Claude integration)
symapse mcp /path/to/repo

# Query from the terminal
symapse_ask "add notification system"
symapse_find login
symapse_map "direct login after payment"
symapse_audit 10
symapse_health

# Live coding awareness — start watching for collisions, breaks, and dead code
symapse_health --watch
```

---

## OpenCode Integration

Install Symapse first:
```bash
npm install -g symapse
```

Add to your project's `opencode.json`:

```json
{
  "mcp": {
    "symapse": {
      "type": "local",
      "command": ["npx", "symapse", "mcp", "."],
      "enabled": true
    }
  }
}
```

Create an `AGENTS.md` in your project root with:

```markdown
## RULE 1: Always check Symapse first

| Instead of... | Use... |
|---|---|
| Reading files for architecture | `symapse_map` |
| Grepping for symbols | `symapse_find` |
| Guessing where code goes | `symapse_ask` |
| Finding dead code or duplicates | `symapse_audit` |
| Re-indexing or checking status | `symapse_health` |

First action every session: `symapse_ask "<request>"`. If it returns questions, ASK them.
If Symapse doesn't answer your question, read files.
```

---

## Tools

| Tool | Question it answers |
|---|---|
| `symapse_ask` | What should I know before working on X? |
| `symapse_find` | Where is X and what does it touch? |
| `symapse_map` | Show me the shape of this repo / feature |
| `symapse_audit` | What's wrong, unused, or duplicated? |
| `symapse_diff` | After changes: what did I affect? What did watch detect? |
| `symapse_health` | What's the state of the index? Watch mode |

**Temporal workflow:**
- Before coding: `symapse_ask` → `symapse_map` → `symapse_find`
- During coding: `symapse_health --watch`
- After each edit: `symapse_diff`
- Maintenance: `symapse_audit` | `symapse_health`

---

## Supported Languages

JavaScript, TypeScript, Python, Go, Rust, C#, PHP, Ruby, Lua, and C.

---

## How It Works

1. **Index** — walks the repo, extracts functions/classes/methods with regex parsers, builds call and import edges
2. **Store** — normalized SQLite schema, incremental by mtime + engine version
3. **Expose** — CLI, REST API, and MCP over stdio. All share the same engine.

---

## Self-Improving

Symapse learns from agent behavior across sessions without any user involvement:

- **Session coherence** — biases context toward the subsystem the agent is already exploring
- **Usage signals** — logs which symbols agents actually drill into
- **Workflow memory** — auto-detects repeated symbol sequences across sessions
- **Intent classification** — routes config/docs questions away from source code exploration

---

## Architecture

```
packages/
  engine/   — regex-based parser, call graph, all analysis tools
  db/       — SQLite persistence with incremental indexing
  mcp/      — MCP protocol server (JSON-RPC over stdio)
apps/
  cli/      — command-line entry point
  api/      — HTTP API server + web dashboard
  web/      — terminal-style web UI
```

---

## License

AGPL-3.0
