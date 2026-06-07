# Symapse V1 Ship Plan

## The Test

> "Would an AI agent normally spend 5k—50k tokens figuring this out?"

If yes, it belongs in Symapse. If not, it can wait for V2.

---

## The V1 Tool Set (7 tools)

Every tool answers a question developers and AI agents ask daily.

---

### Pillar 1 — Impact Awareness

### 1. `symapse_impact`

**Question:** "If I change this, what breaks?"

**Status:** ✅ BUILT

**Input:** symbol name

**Output:** direct callers, direct callees, transitive callers/callees, impacted files, module dependencies

**Agent token savings:** Instead of grepping every file for references to a function, computing transitive call chains, and manually listing affected files — a single tool call.

---

### Pillar 2 — Architectural Evolution

### 2. `symapse_deadcode`

**Question:** "What can I safely remove?"

**Status:** ✅ BUILT

**Input:** optional limit (default 30)

**Output:** scored dead-code candidates with reasons (no inbound refs, not exported, etc.), filtered for test files, entry points, and lifecycle methods

**Heuristics:** test file penalty, entry-point penalty, lifecycle method penalty, handler callback penalty, Python `__all__` awareness

---

### 3. `symapse_overlap`

**Question:** "Did we build this already?"

**Status:** ✅ BUILT

**Input:** optional limit + minScore

**Output:** similar function pairs ranked by composite score

**Signals:**
| Signal | Method |
|---|---|
| Callee overlap | Jaccard of called functions (noise-filtered) |
| Structural similarity | Word bigram token overlap |
| Signature similarity | Length, return/await/throw patterns |
| Import overlap | Jaccard of shared imports |
| Skeleton similarity | Structural keyword bigram match |
| Literal similarity | Jaccard of string/number literals |
| Char trigram similarity | Low-level fuzzy body match |

**Weighting:** Dynamic — boosts behavioral signals when skeleton ≥ 0.70 + composite ≥ 0.50

---

### Pillar 3 — Architectural Discovery

### 4. `symapse_search`

**Question:** "Where does this thing live?"

**Status:** ✅ BUILT

**Input:** query string (matches name, qualified name, file path, kind)

**Output:** matching symbols with file paths and line numbers

---

### 5. `symapse_architecture`

**Question:** "Explain this repo."

**Status:** 🔴 TO BUILD

**Input:** none (auto-computed from index)

**Output:**
```text
Domains: API, Engine, Storage, Web
Core flows: Request → Engine → Store
Critical modules: refreshIndex, ensureState
Module graph: dependency grouping + topological summary
```

**Implementation:**
1. Cluster functions by module/namespace (using `byFile` and `qualifiedName` prefixes)
2. Compute inter-module import edges (aggregate at directory/package level)
3. Identify critical nodes (top 10 by fan-in count)
4. Extract naming conventions per module (exported ratio, function vs class preference)
5. Produce a compact textual summary fit for an agent response

**Agent token savings:** Instead of reading every file, building a mental model, and guessing architectural boundaries — one call that explains the repo topology.

---

### Pillar 4 — Safe Feature Development

### 6. `symapse_where` (was `symapse_feature_plan`)

**Question:** "Where should this new thing live?"

**Status:** 🔴 TO BUILD

**Input:** keywords or short description string

**Output:**
```text
Related symbols: [5—10 closest matches by name/content]
Suggested module: auth/ (based on import topology)
Neighboring functions: [functions in the same namespace]
Conventions: this module prefers exported functions, async patterns
Risk: no existing overlap found (green) / partial overlap found (yellow)
```

**Implementation:**
1. Accept a keyword/description string
2. Search for symbols matching the keywords (via `symapse_search`)
3. For each match, find its module neighborhood (co-located functions in same file/directory)
4. Rank suggested insertion points by:
   - Naming affinity (keyword matches module name conventions)
   - Import topology (modules that import similar dependencies)
   - Existing overlap score (are there near-duplicates already?)
5. Return the top 3 candidate modules with rationale

**Agent token savings:** Instead of searching for similar functions, manually exploring module structures, and deducing conventions — one call that recommends the architectural insertion point.

---

### Pillar 5 — Change Awareness

### 7. `symapse_changes`

**Question:** "What changed and what should I worry about?"

**Status:** ✅ BUILT

**Input:** none (auto-computed from index diff vs git)

**Output:** added, modified, and removed symbols since last index

---

## What Ships as MCP Tools (7)

| # | Tool | Status |
|---|---|---|
| 1 | `symapse_impact` | ✅ |
| 2 | `symapse_deadcode` | ✅ |
| 3 | `symapse_overlap` | ✅ |
| 4 | `symapse_search` | ✅ |
| 5 | `symapse_architecture` | 🔴 |
| 6 | `symapse_where` | 🔴 |
| 7 | `symapse_changes` | ✅ |

---

## What Ships as Internal Utilities (not user-facing tools)

| Utility | Purpose |
|---|---|
| `symapse_status` | Index stats, top files — debug/internal use |
| `symapse_refresh` | Re-index after edits — triggered by agent |
| `symapse_tree` | Repo directory tree — context compression |

---

## What Waits for V2

Not because they're bad. Because they're second-order.

- `symapse_refactor` — safe refactoring plans
- `symapse_orphans` — unlinked symbol detection (subset of deadcode)
- `symapse_health` — architectural quality metrics
- `symapse_complexity` — cyclomatic complexity per function
- `symapse_docs` — auto-generated architecture docs
- `symapse_graph` — visual call graphs
- AI-generated remediation recommendations
- Semantic embeddings for body comparison (replace char trigram with vector similarity)
- Tree-sitter AST parser (replace regex-based extraction)

---

## Immediate Build Order

1. **`symapse_architecture`** — highest leverage, zero new signals needed, pure aggregation of existing index data
2. **`symapse_where`** — the "stop duplicating" tool, uses existing search + overlap + file proximity

Both can be built entirely on the existing index — no new parsing infrastructure required.

---

## The V1 Story

When someone asks "What does Symapse do?":

```
symapse_search       Find code.
symapse_impact       Understand consequences.
symapse_deadcode     Remove unused code.
symapse_overlap      Prevent duplicate implementations.
symapse_architecture Explain the system.
symapse_where        Know where to integrate.
symapse_changes      Review changes safely.
```
