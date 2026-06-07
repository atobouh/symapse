# Supported Extensions

This document is the working reference for what Symapse can effectively track today.
Update it as the engine grows so the UI, indexer, and docs stay aligned.

## Current Support Model

Symapse currently has two different levels of support:

- File discovery and repo tree tracking
- Symbol, relation, and impact tracking

A file can be discoverable without being fully parsed for impact analysis.

## Fully Supported For Symbol Tracking

These extensions are currently parsed well enough for function/class/method extraction and impact graph building:

- `.js`
- `.jsx`
- `.ts`
- `.tsx`
- `.mts`
- `.cts`
- `.mjs`
- `.cjs`
- `.py`

## Tracked As Files, But Not Fully Parsed Yet

These extensions can be indexed as files in the tree and status views, but they are not yet first-class for symbol extraction:

- `.rb`
- `.go`
- `.rs`
- `.java`
- `.kt`
- `.kts`
- `.cs`
- `.php`
- `.swift`

## File Tracking Only

These are currently kept in the file inventory because they are useful for repo context, but they do not produce meaningful symbol extraction:

- `.json`
- `.jsonc`
- `.json5`
- `.md`
- `.markdown`
- `.yml`
- `.yaml`
- `.css`
- `.scss`
- `.less`
- `.html`
- `.htm`
- `.xml`
- `.toml`
- `.ini`
- `.env`
- `.txt`

## Ignored By Default

These directories are excluded by default because they usually add noise instead of useful project signal:

- `node_modules`
- `.git`
- `.symapse`
- `dist`
- `build`
- `coverage`
- `.next`
- `.venv`
- `venv`
- `env`
- `ENV`
- `__pycache__`
- `.pytest_cache`
- `.mypy_cache`
- `.tox`
- `.nox`
- `.ruff_cache`
- `.hypothesis`
- `.cache`
- `.turbo`
- `.parcel-cache`
- `.idea`
- `.vs`

## Notes For Future Updates

- When a new parser lands, move the extension from "tracked as files" into "fully supported" only after symbol extraction and impact traversal are verified.
- If a file type starts producing false positives, keep it in file tracking only until parsing is reliable.
- If a directory is consistently environment noise, keep it ignored by default.
