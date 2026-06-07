# Symapse: Current State and Path Forward

## What Symapse Is Trying To Become

Symapse should be an AI navigation and investigation layer for codebases, optimized for architectural understanding with very low token cost.

That means:

- let AI explore a repo
- let AI ask what exists, what breaks, and what should be reused
- help AI understand architecture, not just dump code
- avoid huge graph exports and large payloads by default

The key design rule is:

- summaries first
- detail only when requested

In the simplest form:

- Symapse helps AI understand codebases without wasting tokens

## Where Symapse Is Right Now

Symapse is currently the indexer and navigator layer.

It can:

- index a local repo or file target
- build a symbol graph
- search functions, files, and relationships
- inspect impact
- show repo tree and changes
- render a UI for navigation and inspection
- support JS/TS-style files and `.py` at the symbol level

## What Symapse Does Not Yet Do Well Enough

The current system still sends too much raw structure when the goal is AI reasoning.

Missing pieces:

- a canonical architectural node format
- a summarization or compression layer
- token budgets per query
- layered expansion instead of dumping everything
- overlap, reuse, and ownership summaries
- a protocol for asking for more detail instead of sending it all at once

## How We Get There

### 1. Define The AI Payload Shape

Every node should have a compact, fixed schema such as:

- `id`
- `name`
- `kind`
- `filePath`
- `responsibility`
- `upstreamSummary`
- `downstreamSummary`
- `overlapFlags`
- `confidence`
- `evidenceRefs`

This should be the default thing AI sees.

### 2. Add Summaries Before Detail

Instead of returning hundreds of raw callers and callees, Symapse should return:

- counts
- grouping by file/module/kind
- top few most relevant relationships
- a clear path to expand further

### 3. Build A Compression Engine

This engine should:

- dedupe repeated nodes
- group edges by file/module/kind
- collapse low-signal relationships
- cap output by token budget
- preserve drill-down links

### 4. Make Expansion Explicit

The AI should be able to ask for more detail in a targeted way:

- show more callers from a specific file
- expand a cluster
- show function bodies for only selected nodes

This makes Symapse conversational instead of dump-heavy.

### 5. Add Architectural Summaries

Symapse should infer:

- what a file or module is for
- whether something looks duplicated
- where responsibilities overlap
- what should probably be reused

### 6. Track Token Cost As A Product Metric

For every node or query, track:

- summary token count
- expanded token count
- max payload size
- average tokens per useful answer

This keeps the design honest.

## The Right Mental Model

Symapse should become three layers:

- Indexer: builds the local truth
- Compressor: reduces truth to token-efficient summaries
- Navigator: lets AI and humans ask targeted questions

## The Current Gap

We are currently building the indexer and navigator.

To achieve the low-token AI vision, we still need to add the compressor.

## One-Sentence Summary

Symapse should help AI understand codebases without wasting tokens.

