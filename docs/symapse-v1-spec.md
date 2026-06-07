# Symapse V1 Spec

## Goal

Symapse V1 should be a practical local repo indexer and architectural inspection tool that works on real projects, including Symapse itself.

It should be:

- simple
- deterministic
- token-efficient
- usable by humans and AI
- visually minimal

The purpose of V1 is not to impress with visuals.
The purpose of V1 is to make architectural understanding usable.

## V1 Product Shape

Symapse V1 is:

- a local repo/file indexer
- a search tool
- an impact tool
- a tree/browser tool
- a change inspection tool
- a compact architectural map
- an AI-facing context engine

## V1 Design Principles

- Use one shared source of truth for the repo model.
- Keep the UI minimal and readable.
- Prefer summaries over raw dumps.
- Expand detail only when requested.
- Keep token cost low.
- Make critical states visible with limited color.
- Avoid complex graph motion or heavy visual styling.

## What V1 Must Answer

V1 should answer these questions well:

- What files matter?
- What symbols matter?
- What depends on what?
- What changes are risky?
- What already solves this problem?
- What should I inspect next?

## Core Capabilities

### 1. Indexing

Symapse should index a local repo or a single file target.

It should:

- build a file inventory
- extract symbols
- build relationships
- compute impact
- store state locally

### 2. Search

Symapse should let users search:

- files
- symbols
- relationships
- impacted nodes

Search results should be compact and easy to scan.

### 3. Tree View

Symapse should show the repository structure as a simple expandable tree.

Tree view should:

- show files and folders
- avoid noise directories by default
- support repo and file targets

### 4. Changes View

Symapse should show git-backed changes where possible.

It should distinguish:

- added
- modified
- deleted
- untracked
- renamed

### 5. Impact View

Symapse should show what a symbol touches.

It should answer:

- callers
- callees
- impacted files
- related symbols

### 6. Minimal Visual Map

The visual map should be a grayscale-first architectural sketch.

It should use:

- dots
- bars
- labels
- limited accent colors

The map should show:

- selected node
- related nodes
- relative importance
- critical states
- connectivity at a glance

The map should not try to be a fancy graph.

## UI Philosophy

The UI should feel like a useful console, not a demo.

It should be:

- black, white, and gray first
- readable
- compact
- direct
- fast to scan

Color should only be used for:

- selection
- warnings
- critical actions
- status changes

## Token Efficiency Rule

Symapse V1 must not send large raw graph payloads by default.

It should:

- summarize before expanding
- cluster similar nodes
- dedupe repeated relationships
- group by file/module/kind
- cap output by useful context, not by raw volume

This is essential for AI use.

## Architecture Layers

### Indexer

Builds local truth from the repo.

### Compressor

Turns repo truth into small summaries and AI-friendly payloads.

### Navigator

Lets humans and AI ask questions and expand detail on demand.

### Minimal Map

Shows a compressed visual sketch of the architecture.

## Build Order

### Step 1

Make sure the indexer is reliable on a real repo.

### Step 2

Make search, tree, changes, and impact compact and stable.

### Step 3

Add compression for AI-facing outputs.

### Step 4

Keep the map simple and useful.

### Step 5

Use Symapse on Symapse and refine from real usage.

## Non-Goals For V1

Do not start V1 with:

- complex force-directed graphing
- heavy animations
- overly polished visual design
- huge multi-mode navigation systems
- broad language coverage before the core works
- large raw graph exports to AI

## Success Criteria

V1 is successful if:

- it can index a real repo cleanly
- it can answer architectural questions quickly
- it stays token-efficient
- it is simple enough to trust
- it is useful for both humans and AI

## One-Line Summary

Symapse V1 is a minimal architectural inspection tool that helps humans and AI understand codebases without wasting tokens.

