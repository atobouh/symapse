# Symapse V2 — Internal Mechanics Reference

## 1. Indexing Pipeline

```
walk(repo) → collectFiles() → for each file:
  read source → stat(mtime,size) → hash content
  → getFileLanguage(ext) → extractSymbolsForFile()
    → regex parsing (language-specific)
  → buildRelations()
    → parseImportAliases
    → collectCallTargets (scan body for # calls)
    → build call + import edges
→ noise filter (frequency threshold)
→ compareSnapshots (detect changed/removed)
→ writeIndexState (normalized SQLite)
```

**Incremental logic**: mtime + size match + engine version match → skip file. Version bump forces full reparse.

**Stored per-file**: `{ path, hash, mtimeMs, size }`

**Stored per-symbol**: `{ id, name, qualifiedName, kind, filePath, startLine, endLine, exported, isDefault, parentName, bodyHash }` — no body text stored.

**Stored per-relation**: `{ kind, sourceId, targetId, sourceFilePath, targetFilePath, sourceKind, targetKind, sourceName, targetName }`

---

## 2. Tool Reference

### 2.1 `symapse_search` → `listFunctions()`

**Input**: query string  
**Output**: matching symbols (name, file, line, kind, exported)

**Scoring**: `name.toLowerCase().includes(query)` OR `filePath.includes(query)` OR `qualifiedName.includes(query)` OR `kind.includes(query)`. Exact substring, case-insensitive. No tokenization.

**Gap**: "toggle-preview" matches 0 symbols because no name contains that exact string. Tokenizing to ["toggle","preview"] and matching ANY token would find `Toggle`, `ToggleSort`, `test_toggle_preview`.

---

### 2.2 `symapse_impact` → `getImpact()`

**Input**: function name  
**Output**: direct callers, callees, transitive chains, impacted files

**Algorithm**:
1. Find all symbols matching `name`
2. `buildAdjacency(relations)` → two Maps: `callersByTarget` and `targetsByCaller`
3. Walk graph bidirectionally — `walkGraph()` uses BFS from start nodes

**No scoring** — deterministic graph traversal.

---

### 2.3 `symapse_deadcode` → `getDeadCodeCandidates()`

**Input**: limit (default 30)  
**Output**: sorted candidates with score and reasons

**Scoring** (`scoreDeadCodeCandidate`):

| Signal | Points |
|---|---|
| No inbound references | +70 |
| No outbound references | +15 |
| ≤2 outbound references | +8 |
| Not exported | +10 |
| Function kind | +5 |
| Method kind | +3 |
| Class kind | +2 |
| Test file path | −40 |
| Test function name | −35 |
| Entry point name | −35 |
| Lifecycle method | −25 |
| Handler callback | −20 |
| Module/exports name | −30 |

**Threshold**: 60+. Candidates below 60 are filtered.

**Relation counts**: `buildRelationCounts()` precomputes incoming/outgoing per symbol by scanning all `call` relations once.

---

### 2.4 `symapse_overlap` → `findSemanticOverlaps()`

**Input**: limit, minScore  
**Output**: function pairs with composite similarity score

**O(n²) pairwise comparison** — this is why it times out on large repos.

**Scoring — 5 weighted signals**:

| Signal | Method | Weight range |
|---|---|---|
| Callee overlap | Jaccard of called functions (noise-filtered) | 10-30% |
| Structural similarity | Word bigram overlap of body tokens | 15-25% |
| Signature similarity | Length ratio + return/await/throw match | 5-15% |
| Import overlap | Jaccard of shared imports | 5-15% |
| Behavioral similarity | Composite of skeleton + literal + char trigram | 10-30% |

**Dynamic weighting**: when skeleton ≥ 0.70 and composite ≥ 0.50, behavioral weight jumps to 30%. Role match (+20 bonus) added post-weighting.

**Body loading**: reads source files from disk on demand (not from index).

**Behavioral sub-scores**:
- **Skeleton similarity** (40%): structural keyword bigrams (if/for/return/const/function)
- **Literal similarity** (30%): Jaccard of string/number literals in body
- **Char trigram similarity** (30%): character-level fuzzy matching

**Recommendations**: "merge" (≥70 + overlap), "review" (≥55), "note" (otherwise).

---

### 2.5 `symapse_where` → `findWhereToIntegrate()`

**Input**: description  
**Output**: ranked module candidates, related symbols

**Algorithm**:
1. Tokenize description → keywords (≥2 chars)
2. Score every executable symbol by keyword match (name, qualifiedName, filePath, body)
3. Group top 8 matches by directory → candidate modules
4. Per module: count co-located symbols, detect overlap risk, infer conventions
5. Rank by risk (low first), then by match score

**Keyword scoring** (`scoreKeywordMatch`):
| Match type | Score |
|---|---|
| Exact match | 1.0 |
| Starts with | 0.9 |
| Contains | 0.7 |
| Word in path matches | 0.85 |
| Word starts with | 0.75 |
| Word contains | 0.5 |
| Body contains | +0.3 |

**Fallback**: if no keywords match, returns largest modules by symbol count.

---

### 2.6 `symapse_architecture` → `getArchitectureSummary()`

**Input**: none  
**Output**: domains, critical nodes, hub functions, entry points, inter-module flows, text summary

**Algorithm**:
1. Group executable symbols by `extractModuleName()` → domains
2. Per domain: count exported/internal, func/method/class breakdown
3. Compute inter-module import edges (count per source→target pair)
4. `buildRelationCounts()` → fan-in/fan-out per symbol
5. Critical: fanIn ≥ 2 OR fanOut ≥ 2, sorted by sum
6. Hubs: fanIn ≥ 2 AND fanOut ≥ 2
7. Entry points: exported AND fanIn ≥ 2 AND fanOut ≥ 2

**Module naming** (`extractModuleName`):
- If path contains `packages/` → slice from that point
- If path contains `apps/` → slice from that point
- Otherwise → last 2 path segments

---

### 2.7 `symapse_clarify` → `clarifyRequest()`

**Input**: description  
**Output**: confidence, ambiguous terms, missing decisions, questions

**Algorithm**:
1. `detectAmbiguities()` — check description against `AMBIGUITY_PATTERNS` (hardcoded term→options map like notifications→[email,push,SMS])
2. Detect action verb (add/build/migrate/switch/replace/remove/refactor/optimize/integrate/create) → pull implications
3. Detect scope signals (all/every/only/just/new/existing/current/legacy)
4. Find related existing symbols by keyword match
5. Compute confidence from related matches + ambiguity + decisions

**Confidence formula**: `min(90, max(10, (related≥3?35:related?20:5) + (ambiguity≤1?25:10) + (decisions≤3?20:5) + (modules≥2?10:0)))`

---

### 2.8 `symapse_context` → `getContextFiles()`

**Input**: description  
**Output**: ranked must-read files with directive text

**Three-layer scoring**:

**Layer 1 — Keyword scoring** (per symbol):
| Match | Points |
|---|---|
| Name contains keyword | +3 (+4 if body match) |
| File path contains keyword | +2 |
| Body contains keyword | +4 |
| Filename-only match (no body/name) | ×0.3 penalty |
| Fan-in + fan-out ≥ 20 | +10 |
| Fan-in + fan-out ≥ 10 | +7 |
| Fan-in + fan-out ≥ 5 | +4 |
| Module kind | +5 |
| Exported | +3 |
| Cross-domain extension | ×0.3 penalty |

Symbols sorted by score, top 15 become `topTracers`.

**Layer 2 — Call tracing**:
For each top tracer, follow call and import edges. Callee files get +60% of caller's score. Imported files get +40%.

**Layer 3 — Intent detection**:
After Layers 1-2 produce `ranked` files:
1. Count `INTENT_KEYWORDS` matches per file (e.g., "login"→auth, "session"→auth, "payment"→payment)
2. Compute density: intentMatches / totalSymbolsInFile
3. Score = `min(80, 15 + count * 8) * min(2, 0.5 + density * 2)`
4. Intent files ≥ 20 score → cross-layer trace their callees
5. Top 3 intent files added to ranked list

**Contextual limit** scales with repo size and keyword count:
- ≤30 files → 2-3
- 30-200 → 3-5
- 200-2000 → 4-7
- 2000+ → 5-10

**Output**: directive text listing files with reasons (role, callers, traced-from, intent).

---

### 2.9 `symapse_conventions` → `getConventions()`

**Input**: none  
**Output**: per-module symbol counts, naming patterns, export/async conventions

**Algorithm**: group executable symbols by directory, count exported/internal, detect naming patterns (camelCase, PascalCase, kebab-case, snake_case), count async vs sync functions.

**Minimal** — no scoring, simple aggregation.

---

## 3. Known Gaps from Benchmark

| Gap | Root cause | Affected tools |
|---|---|---|
| Compound search returns 0 | Exact substring match, no tokenization | search |
| Context 40% noise | Keyword scoring dominates intent; tracing only from top 15 | context |
| Overlap times out | O(n²) comparison on all pairs | overlap |
| C has 0% reduction | No C function parser — extension only | all |
| Go methods invisible | Already fixed (receiver regex) | search, impact |
| React reconciler symbols unindexed | JS parser catches top-level but not deeply nested patterns | search, context |
| SQLite single-file no advantage | One file = no structural exploration savings | all |
| Quality always 1pt behind on detail | Agents read fewer files → less specific line numbers | plan quality |
