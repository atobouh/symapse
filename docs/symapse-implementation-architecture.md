# Symapse: Implementation Architecture

## Project structure

```
symapse/
  packages/
    engine/       — Core: parser, call graph, impact, dead code, overlap, architecture
    db/           — SQLite-backed state persistence (store.js)
    mcp/          — MCP protocol server (JSON-RPC over stdio)
    shared/       — Shared TypeScript types (stub, not active)
    parser-ts/    — Future Tree-sitter parser (stub, not active)
  apps/
    cli/          — CLI entry point: index, search, impact, deadcode, overlap, where, architecture
    api/          — HTTP API server (port 4580) + SSE events + web terminal dashboard
    web/          — Web server serving the terminal-style dashboard UI
  scripts/
    dev.mjs       — Dev startup: launches API + web servers
  .lsmcp/         — MCP tool manifest cache
  .symapse/       — Index data (state.db, config)
  opencode.json   — OpenCode MCP integration config (3 lines)
```

## Core engine (`packages/engine/src/index.js`)

This is the entire engine. Single-file, ~2,500 lines. No framework dependencies. Everything is in one module so it can be consumed by the CLI, API, and MCP server without build steps.

### Pipeline: index flow

```
1. Walk repo directory tree
   ├── Recursively find source files (JS, TS, JSX, TSX, PY)
   ├── Ignore .git, node_modules, dist, .symapse
   └── For each file:
        2. Read source text → hash with SHA-1
        3. Detect language (JS/TS or Python) from extension
        4. Parse
           ├── JS/TS: regex-based extraction
           │   ├── function declarations
           │   ├── arrow functions (const name = (...) => { ... })
           │   ├── class declarations → methods extracted separately
           │   ├── import statements (ESM + require())
           │   └── export statements
           └── Python: regex-based extraction
               ├── def declarations (indentation-scoped bodies)
               ├── class declarations
               ├── import statements (with as aliases)
               └── lambda assignments
        5. Body extraction
           ├── function keyword → brace-matched body between { and }
           ├── arrow function → brace-matched or single-expression
           ├── Python → indentation-delimited block
           └── Regex literal aware: tracks /.../ patterns to avoid brace confusion
        6. Build relations per file
           ├── Import relations: file→file edges (import + require)
           ├── Call relations: symbol→symbol edges
           │   ├── Scans function body for all known symbol names
           │   ├── Matches patterns: name(, this.name(, obj.name(, name.method(
           │   ├── Resolves import aliases (import { foo as bar } → bar() links to foo)
           │   └── Filters 35 common builtins (push, map, filter, etc.)
           └── Self-reference deduplication
    7. Git change detection
       └── Compare current file hashes vs previous index state
    8. Write state to SQLite
       └── symbols, relations, summary, change log
```

### Key data structures

**Symbol** (what the parser produces):
```javascript
{
  id: "sha1-hash",        // deterministic ID from kind+file+name+parent
  name: "createSymbol",
  qualifiedName: "createSymbol",     // or "ClassName.methodName"
  kind: "function" | "method" | "class" | "module",
  filePath: "packages/engine/src/index.js",
  startLine: 488,
  endLine: 510,
  exported: false,
  isDefault: false,
  parentName: "",                    // class name if this is a method
  body: "const qualifiedName = ...", // source between braces
  bodyHash: "sha1-hash-of-body"      // for change detection
}
```

**Relation** (edges in the call graph):
```javascript
{
  kind: "call" | "import",
  label: "targetQualifiedName",
  sourceFilePath: "...",
  sourceId: "sha1-of-source",
  sourceKind: "function",
  sourceName: "sourceQualifiedName",
  targetFilePath: "...",
  targetId: "sha1-of-target",
  targetKind: "function",
  targetName: "targetQualifiedName"
}
```

**State** (what SQLite stores):
```javascript
{
  repoRoot: "/path/to/repo",
  storageRoot: "/path/to/.symapse",
  symbols: [...],          // all symbols
  relations: [...],        // all edges
  changedFunctions: [...], // symbols changed since last index
  removedFunctions: [...], // symbols removed since last index
  summary: {               // aggregated counts
    fileCount, functionCount, classCount, methodCount,
    moduleCount, symbolCount, edgeCount,
    changedCount, removedCount, initialIndex
  }
}
```

### Parser design decisions

**Why regex instead of Tree-sitter for V1?**
- Zero dependencies. No native binaries. Works everywhere Node runs.
- Fast enough for V1 scale (~150 symbols in ~30 files parses in under a second).
- Tree-sitter adds complexity (platform-specific binaries, grammar management) that isn't yet warranted.
- Tradeoff: misses edge cases (renamed imports via destructuring, complex patterns like `const { foo } = require('bar')` inside functions, dynamic `obj[key]()` calls). These are documented limitations.

**Why single-file engine?**
- The engine is consumed by three different apps (CLI, API, MCP). Having it as a single ESM module means no build tooling, no bundling, no TypeScript compilation. Just `import { ... } from "../../engine/src/index.js"`.
- The file is long (~2,500 lines) but organized into clear sections with the pipeline flowing top-to-bottom.

### Scoring engines

**Dead code scoring** (score 0–100, higher = more suspicious):

| Signal | Points |
|---|---|
| No inbound references | +70 |
| No outbound references | +15 |
| ≤2 outbound references | +8 |
| Not exported | +10 |
| Function kind | +5 |
| Method kind | +3 |
| Class kind | +2 |

Penalties (reduce suspicion):
| Signal | Points |
|---|---|
| Test file path | −40 |
| Test function name | −35 |
| Entry point name | −35 |
| Lifecycle method | −25 |
| Handler callback | −20 |
| `module` / `exports` name | −30 |

**Semantic overlap scoring** (0–100, weighted composite):

| Signal | Weight | Method |
|---|---|---|
| Callee overlap | 10–30% | Jaccard similarity of called functions (noise-filtered) |
| Structural similarity | 15–25% | Word bigram overlap of body tokens |
| Signature similarity | 5–15% | Length ratio + return/await/throw pattern match |
| Import overlap | 5–15% | Jaccard of shared module imports |
| Behavioral similarity | 10–30% | Composite of skeleton + literal + char trigram |
| └ Skeleton similarity | (40%) | Structural keyword bigrams (if/for/return/const etc.) |
| └ Literal similarity | (30%) | Jaccard of string/number literals in body |
| └ Char trigram | (30%) | Character-level fuzzy body matching |

Weights are dynamic: when behavioral signals are strong (skeleton ≥ 0.70 + composite ≥ 0.50), they take priority over structural signals.

**Where-to-integrate ranking:**

1. Tokenize query → score every symbol by keyword match (name, path, body)
2. For top matches, group by module directory (package-aware: `packages/engine/src`, `apps/api/src`)
3. Per module: count co-located symbols, extract conventions (async/sync ratio, export ratio)
4. Check overlap risk: any existing symbol in the module with ≥70% keyword match?
5. Sort candidates by risk (low first), then match score

**Architecture summary:**

1. Group all executable symbols by module → domain definitions
2. Count inter-module import edges → dependency flows
3. Compute fan-in/fan-out per symbol → critical nodes
4. Filter for high-fan-in + high-fan-out → hub functions
5. Filter for exported + high fan-in + fan-out → entry points
6. Format as compact text summary fit for a single agent response

---

## Database layer (`packages/db/src/store.js`)

Uses Node.js built-in `node:sqlite` (experimental in Node 22). No external database driver.

**Tables:**

- `index_state` — JSON blob of all symbols, relations, change log, summary
- `runtime_info` — transient data (connection state, client IDs for SSE)

Single-file design. Schema-less (JSON columns). Simple key-value with a running info table.

---

## MCP server (`packages/mcp/src/index.js`)

Implements the Model Context Protocol directly — no SDK dependency. JSON-RPC 2.0 over stdio.

**Message flow:**

```
Client → initialize       → Server returns capabilities (tools: {})
Client → notifications/initialized → (silent, no response)
Client → tools/list       → Server returns 7 tool definitions
Client → tools/call       → Server executes tool, returns result
Client → shutdown         → Server terminates
```

**Buffering:** stdin data arrives in chunks. A persistent buffer accumulates lines, parses complete JSON messages, and queues them. `readStdin()` returns the next message from the queue, or waits via a promise if empty.

**Index caching:** State is cached for 30 seconds to avoid re-reading SQLite on every tool call.

**7 exposed tools:**

| Tool | Engine function called |
|---|---|
| `symapse_search` | `listFunctions()` |
| `symapse_impact` | `getImpact()` |
| `symapse_deadcode` | `getDeadCodeCandidates()` |
| `symapse_overlap` | `findSemanticOverlaps()` |
| `symapse_where` | `findWhereToIntegrate()` |
| `symapse_architecture` | `getArchitectureSummary()` |
| `symapse_changes` | Reads `changedFunctions` from state |
| `symapse_refresh` | `indexRepository()` — full re-index |
| `symapse_status` | `getStatus()` |
| `symapse_tree` | `getRepoTree()` |

---

## API server (`apps/api/src/index.js`)

Plain Node.js HTTP server. No Express, no Koa. Uses `http.createServer`.

**Features:**
- SSE (Server-Sent Events) for real-time push to web dashboard
- All engine endpoints exposed as REST routes
- Web command processor: simulates CLI commands via HTTP, returns structured JSON + SSE events
- JSON body parsing for POST requests
- Query parameter support for GET requests

**Routes:**

| Route | Returns |
|---|---|
| `GET /health` | `{ ok: true }` |
| `GET /status` | Full index status |
| `GET /impact/<name>` | Impact analysis for named symbol |
| `GET /search?q=<query>` | Symbol search results |
| `GET /deadcode?limit=<n>` | Dead code candidates |
| `GET /overlap?limit=<n>&minScore=<n>` | Semantic overlap pairs |
| `GET /where?q=<description>` | Integration point recommendations |
| `GET /architecture` | Architectural summary |
| `GET /changed` | Change log since last index |
| `GET /tree` | Repo directory tree |
| `POST /command` | Execute CLI-style command via HTTP |

---

## CLI (`apps/cli/src/index.js`)

Thin wrapper. 150 lines. Each command calls the corresponding engine function and prints JSON to stdout.

**Commands:**

```
index [repo]      — Full re-index
changed           — Show recent changes
impact <name>     — Impact analysis
search <query>    — Symbol search
deadcode [n]      — Dead code candidates
overlap [n]       — Semantic overlaps
where <desc>      — Integration recommendations
architecture      — Architecture summary
status            — Index stats
```

Progress is shown with a spinner during indexing.

---

## Extension points

### Adding a new language

1. Add language detection in `getFileLanguage()` — returns `"python"` or `"javascript"` currently
2. Add parsing logic in `extractSymbolsForFile()` — calls `extractFunctionsAndClasses()` for JS/TS or `parsePythonDefinitions()` for Python
3. Add import parsing if needed (`parseImportStatements()` for JS/TS, `parsePythonImportStatements()` for Python)
4. Add call detection patterns in `buildRelations()` — the current system is language-agnostic (name-based matching) but could be extended

### Adding a new tool

1. Add the engine function in `packages/engine/src/index.js`
2. Export it
3. Add an API route in `apps/api/src/index.js`
4. Add a MCP tool definition + case handler in `packages/mcp/src/index.js`
5. Add a CLI command in `apps/cli/src/index.js`

### Adding a new output format

The engine functions all return plain objects. The MCP server wraps them in `{ content: [{ type: "text", text: JSON.stringify(...) }] }`. To add a new format (e.g., HTML, Markdown), add a formatter in the API or MCP layer — the engine stays format-agnostic.

---

## Current limitations (V1)

| Limitation | Impact |
|---|---|
| Regex parser, not AST | Misses renamed imports via destructuring, dynamic calls, complex arrow patterns |
| Single-file analysis per module | Can't track cross-file symbol re-exports in JS (barrel files) |
| No TypeScript type awareness | Can't track interfaces, type aliases, or generics |
| Python: indentation-based only | Multi-line strings with def-like content may false-match |
| No incremental indexing | Every re-index is full — for large repos this is slow |
| MCP: stdio only | No HTTP/SSE transport for remote agent connections |
| No token budget control | API responses are full JSON — no compression or truncation |

---

## Roadmap (V2)

1. **Tree-sitter parser** — replace regex with AST-based extraction (packages/parser-ts stub exists)
2. **Incremental indexing** — only re-parse changed files instead of full repo scan
3. **Token-budgeted compression** — truncate/compress API responses to fit LLM context windows
4. **MCP HTTP transport** — support remote MCP connections (SSE-based)
5. **Semantic embeddings** — replace char trigram similarity with vector-based body comparison
6. **Cross-file re-exports** — track symbol propagation through barrel/index files
