# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`obsidian-qmd-search` — a desktop-only Obsidian community plugin that lets users search `tobi/qmd`-indexed knowledge bases from inside Obsidian. Uses BM25, vector, and LLM-reranked hybrid search provided by the external `qmd` CLI (`npm install -g @tobilu/qmd`).

## Commands

```bash
npm install          # install deps (js-yaml, esbuild, typescript, obsidian types)
npm run build        # production bundle → main.js
npm run dev          # watch mode for development
```

To install into a vault for manual testing, copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/obsidian-qmd-search/` inside the vault directory.

There is no automated test suite yet. TypeScript type-checking is the primary correctness check; run:
```bash
npx tsc --noEmit
```

## Architecture

### Transport abstraction

All `qmd` interaction is behind a `QmdClient` interface (`src/client/base.ts`). The plugin instantiates one of two concrete implementations based on the `transportMode` setting, and swaps the instance if settings change.

- **`CliQmdClient`** (`src/client/cli.ts`) — spawns `qmd` as a subprocess per query using `require('child_process').spawn`. Buffers full stdout before JSON parsing. Mode→command mapping: `keyword`→`search`, `semantic`→`vsearch`, `hybrid`→`query`. `dispose()` is a no-op.
- **`McpQmdClient`** (`src/client/mcp.ts`) — sends JSON-RPC 2.0 POSTs to `http://localhost:{port}/mcp`. On `init()`, checks `~/.cache/qmd/mcp.pid`; if the process is alive it reuses it, otherwise spawns `qmd mcp --http` and polls until ready (15 s timeout). On `dispose()`, kills the daemon only if this instance spawned it.

### Key data flows

1. User opens SearchModal → types query → presses Enter
2. `SearchModal` calls `client.search(opts)` → results rendered via `buildResultItem()`
3. Clicking a result calls `navigateToResult(app, result)` (`src/util/navigate.ts`) which opens the file and scrolls to the line

### Settings (`src/settings.ts`)

`QmdSearchSettings` is persisted via Obsidian's `loadData/saveData`. `QmdSettingTab.display()` re-renders itself after transport mode changes to show/hide the port field. "Register vault as collection" shells out to `qmd collection add` then `qmd embed`.

### Node built-ins

All Node builtins (`child_process`, `fs`, `os`, `path`) are loaded via `require(...)` (CJS), not ESM `import`, because esbuild marks them as external. They are type-cast via `as typeof import(...)` for TypeScript. `electron` is also external — the settings tab accesses `require('electron').shell` for `openPath`.

### Collection name discovery

`src/util/config.ts` reads and parses `~/.config/qmd/index.yml` using `js-yaml`. It handles both array-of-objects and object-keyed YAML shapes, returning `string[]` and falling back to `[]` on any error.
