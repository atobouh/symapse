# Symapse

> Architectural awareness engine for AI coding agents

<p align="center">
  <img alt="npm version" src="https://img.shields.io/npm/v/symapse?color=blue">
  <img alt="license" src="https://img.shields.io/npm/l/symapse">
  <img alt="node" src="https://img.shields.io/node/v/symapse">
</p>

Symapse indexes a codebase, builds a deterministic call graph, and gives AI agents instant answers that would normally require dozens of file reads. **50% average token reduction** measured across 8 real-world codebases.

---

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
symapse architecture
symapse impact "login"
symapse deadcode 10
symapse where "add notification system"
symapse context "direct login after payment"
```

---

## OpenCode Integration

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
## DO NOT READ FILES. USE SYMAPSE TOOLS INSTEAD.

First action every session: `symapse_clarify "<request>"`. If it returns questions, ASK them.

| Instead of... | Use... |
|---|---|
| Reading files for architecture | `symapse_architecture` |
| Grepping for symbols | `symapse_search` |
| Tracing callers | `symapse_impact` |
| Guessing where code goes | `symapse_where` |
| Checking for duplicates | `symapse_overlap` |
| Finding dead code | `symapse_deadcode` |
| Finding must-read files | `symapse_context` |
```

---

## Tools

| Tool | Question it answers |
|---|---|
| `symapse_architecture` | Explain this repo |
| `symapse_clarify` | What am I assuming? |
| `symapse_search` | Where does this thing live? |
| `symapse_impact` | What breaks if I change this? |
| `symapse_deadcode` | What can I safely delete? |
| `symapse_overlap` | Did we build this already? |
| `symapse_where` | Where should this new thing go? |
| `symapse_context` | Which files must I read? |
| `symapse_conventions` | What patterns should I follow? |
| `symapse_changes` | What changed? |

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
