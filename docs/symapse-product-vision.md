# Symapse: Product Vision

## What Symapse Is

**Symapse is an architectural awareness layer for AI coding agents.**

It is NOT a code graph viewer. Nobody wakes up wanting a code graph viewer. They want **confidence** — confidence that a change won't break something elsewhere, confidence that the AI isn't duplicating existing systems, confidence that the architecture isn't silently decaying.

## The Two Pillars

### 1. Impact Awareness — "If I change this, what breaks?"

AI agents today modify code like a brilliant engineer with total amnesia. They change a function and have no idea what downstream systems depend on it. Regressions, hidden breakage, fragile refactors.

Symapse gives agents **propagation awareness** — a deterministic call graph that answers "what is affected by this change?" before the change is made.

### 2. Implementation Awareness — "What already solves this?"

AI agents append. They create parallel implementations instead of integrating with existing ones. Over time, repos become archaeological layers of duplicated intent. Dead code accumulates because no one — human or AI — knows what's still in use.

Symapse gives agents **structural memory** — an understanding of what already exists, what is actually used, and where new functionality should live to evolve the architecture rather than bloat it.

## The Transformation

```
Without Symapse:  Generate → Append → Forget  (chaos)
With Symapse:     Understand → Integrate → Evolve (awareness)
```

## What Symapse Is NOT Trying To Do

- It is not a replacement for LSPs or IDEs
- It is not a developer-facing graph visualization tool
- It is not trying to help AI write **more** code — it's trying to help AI **understand** the code that already exists

## The Long Game

> Symapse gives AI agents architectural memory, impact awareness, and implementation awareness so they can evolve software instead of merely generating code.

The indexer, parser, call graph, search, and impact engine are the **sensory organs**. The actual product is the awareness layer that sits on top of them — answering "what breaks?", "what overlaps?", "what should be reused?", "what can be removed?", "what already solves this problem?", and "where should this feature live?"
