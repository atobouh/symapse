# Symapse: How It Works

## What problem does it solve?

AI coding agents write code fast. But they have no memory. 

An AI changes a function and has no idea it just broke three other systems. An AI builds a new feature and doesn't know someone already built the same thing six months ago. Over time, codebases become archaeological layers of duplicated intent — not because anyone is careless, but because **nobody — human or AI — can see the whole picture at once.**

Symapse is that picture.

---

## How it works

### Step 1 — Index

Symapse reads every source file in the repository and extracts:

- **Every function, class, and method** — where it lives, what it's called, whether it's exported
- **Every call** — function A calls function B, function C imports module D
- **Every relationship** — which files depend on which other files

All of this goes into a lightweight local database (SQLite). This happens once, then incrementally on changes.

### Step 2 — Graph

The extracted information forms a map — a **deterministic call graph**. Every function is a node. Every call is a directed edge. If `login()` calls `validatePassword()`, there's an edge connecting them. If `validatePassword()` is called by 14 different functions, that tells you something about how critical it is.

### Step 3 — Expose

This graph is exposed through three interfaces:

- **CLI** — for developers to query from the terminal
- **REST API** — for tools and automation
- **MCP protocol** — so AI coding agents can query Symapse directly during a session

---

## What it answers

Rather than giving you a graph to explore, Symapse answers seven specific questions:

| Question | Tool | Example |
|---|---|---|
| Where is this thing? | Search | "Find all functions called `auth`" |
| What breaks if I change this? | Impact | "If I edit `login()`, what else is affected?" |
| What can I safely delete? | Dead code | "Show me functions nobody calls anymore" |
| Did we already build this? | Overlap | "Is there already a notification parser?" |
| Where should this new thing go? | Where | "I'm adding payments — which module?" |
| Explain this repo to me | Architecture | "How is this system organized?" |
| What changed since yesterday? | Changes | "What did Friday's PR actually touch?" |

---

## Design principles

### Local-first

Nothing leaves your machine. No cloud, no telemetry, no API keys. The index lives in `.symapse/state.db` inside your project. This matters for security-sensitive codebases and for companies that can't ship source code off-premises.

### Token-efficient

AI agents pay by the token. Reading a 50-function file might cost 8,000 tokens; asking Symapse `impact` costs perhaps 500. The tool answers questions the agent would otherwise answer by reading dozens of files manually. A 70% token reduction was measured on the first real use.

### Deterministic

The call graph is computed from source code, not inferred from behavior or embeddings. If `login()` calls `validatePassword()`, that edge exists. No probability, no hallucination. This matters when the answer determines whether you deploy or revert.

### AI-first, not human-first

Symapse is not a developer-facing graph visualization tool. It doesn't draw pretty node diagrams. Its primary consumer is AI coding agents, who receive compressed, structured answers through MCP tools. The web dashboard and CLI exist for debugging and manual inspection.

---

## The architecture in 30 seconds

```
Source code (JS, TS, Python)
    ↓
Regex parser → extracts functions, calls, imports
    ↓
Call graph (nodes = functions, edges = calls)
    ↓
SQLite persistence (.symapse/state.db)
    ↓
┌──────────┼──────────┐
↓          ↓          ↓
CLI       REST API    MCP server
          (port 4580) (stdio)
                      ↓
                AI coding agents
```

---

## What it doesn't do

- **Doesn't replace LSPs or IDEs** — it's not a code intelligence tool for humans
- **Doesn't generate code** — it analyzes existing code, it doesn't write new code
- **Doesn't require access to your LLM** — it's a sidecar process, not middleware
- **Doesn't need a server** — runs entirely on the developer's machine

---

## What it costs

- **Computational**: indexing takes seconds, impact queries take milliseconds
- **Storage**: the SQLite database is ~1MB per 10,000 symbols
- **Integration**: one config file (`opencode.json`) with three lines to connect an agent

---

## Why it matters

Right now AI coding feels like:

> A brilliant engineer with total amnesia.

They write fast, refactor boldly, and have no idea what they just broke or what they just duplicated.

Symapse gives that engineer a memory. A deterministic, local, token-efficient understanding of the codebase — so they stop breaking systems and start evolving them.
