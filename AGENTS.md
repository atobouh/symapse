# AGENTS.md

## DO NOT READ FILES. USE SYMAPSE TOOLS INSTEAD.

Symapse is an architectural awareness MCP server. It indexes the codebase and gives you instant answers that would normally require dozens of file reads. Using Symapse tools cuts token usage by 70-80%.

## RULE 1: First action in every session — symapse_clarify

Before ANYTHING else — before reading files, before answering, before coding:

```
symapse_clarify "<the user's request>"
```

If it returns questions, STOP and ASK the user those questions. Do not guess. Do not proceed until ambiguity is resolved.

## RULE 2: Never read files for architecture questions

| Instead of... | Use... |
|---|---|
| Reading files to understand repo | `symapse_architecture` |
| Grepping for symbols | `symapse_search` |
| Manually tracing callers | `symapse_impact` |
| Guessing where code belongs | `symapse_where` |
| Wondering if something is unused | `symapse_deadcode` |
| Worrying about duplicates | `symapse_overlap` |
| Guessing naming patterns | `symapse_conventions` |
| Checking what changed | `symapse_changes` |
| After editing | `symapse_refresh` |

## RULE 3: Verify before and after changes

- **Before modifying a function**: `symapse_impact <name>`
- **Before creating new code**: `symapse_where <description>` + `symapse_overlap`
- **After changes**: `symapse_refresh` + `symapse_deadcode`

## RULE 4: The context workflow — read the RIGHT files, not ALL files

When planning or implementing a feature, follow this sequence:

1. `symapse_clarify` — detect ambiguity, ask questions
2. `symapse_architecture` — understand repo structure
3. `symapse_where` — find the right module
4. **`symapse_context`** — identify the 3-5 MUST-READ files
5. Read ONLY those files — they contain the implementation details
6. Plan and implement

## Architecture
```
packages/engine/ — core parser, call graph, analysis engines
packages/db/     — SQLite persistence  
packages/mcp/    — MCP server
apps/cli/        — CLI
apps/api/        — HTTP API + web dashboard
```
