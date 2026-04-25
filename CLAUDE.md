# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`obsidian-qmd-search` — a desktop-only Obsidian community plugin that lets users search `tobi/qmd`-indexed knowledge bases from inside Obsidian. Uses BM25, vector, and LLM-reranked hybrid search provided by the external `qmd` CLI (`npm install -g @tobilu/qmd`).

## Commands

```bash
npm install          # install deps (js-yaml, esbuild, typescript, obsidian types)
npm run build        # production bundle → main.js
npm run dev          # watch mode for development
npx tsc --noEmit     # type-check only (no test suite yet)
VAULT_PATH=~/path/to/vault npm run deploy  # copy main.js + manifest.json + styles.css into vault
```

## Architecture

### Transport abstraction

All `qmd` interaction is behind a `QmdClient` interface (`src/client/base.ts`). The plugin instantiates one of two concrete implementations based on the `transportMode` setting, and swaps the instance if settings change.

- **`CliQmdClient`** (`src/client/cli.ts`) — uses `execFile` (not `spawn`) per query. Buffers full stdout before JSON parsing. Mode→command mapping: `keyword`→`search`, `semantic`→`vsearch`, `hybrid`→`query`. Strips ANSI escape sequences from error messages (qmd emits cursor-hide/show codes when it thinks it's in a TTY). `qmd status` has no `--json` flag; its plain-text output is parsed by `parseStatusText()`. `dispose()` is a no-op.
- **`McpQmdClient`** (`src/client/mcp.ts`) — uses Node's `http` module (not `fetch`) to send JSON-RPC 2.0 POSTs to `http://localhost:{port}/mcp`. On `init()`, checks `~/.cache/qmd/mcp.pid`; if alive reuses it, otherwise spawns `qmd mcp --http` and TCP-polls until port accepts connections (15 s timeout via `waitForEndpoint`). Performs an MCP `initialize` handshake to obtain a session ID, which is sent as `mcp-session-id` header on all subsequent calls. On `dispose()`, kills the daemon only if this instance spawned it.

### Key data flows

1. User opens SearchModal → types query → presses Enter
2. `SearchModal` fires `client.search(opts)` and an inline vault fuzzy-search in parallel
3. Vault results (Obsidian `prepareFuzzySearch`) render immediately; qmd results replace the loading state when the promise resolves
4. Clicking a result calls `navigateToResult(app, result)` (`src/util/navigate.ts`) which opens the file and scrolls to the line

### Result normalisation

`qmd --json` returns a bare array of `RawQmdResult` where the file field is a URI like `qmd://collection-name/relative/path.md`. `normalizeResult()` in `src/client/types.ts` splits this into `collection` and `path` fields used throughout the UI.

### Settings (`src/settings.ts`)

`QmdSearchSettings` is persisted via Obsidian's `loadData/saveData`. `saveSettings(rebuildClient)` accepts a boolean to skip client teardown for non-transport changes (e.g. default collection). `QmdSettingTab.display()` re-renders itself after transport mode changes to show/hide the port field.

### Node built-ins

All Node builtins (`child_process`, `fs`, `os`, `path`, `http`, `net`) are loaded via `require(...)` (CJS), not ESM `import`, because esbuild marks them as external. They are type-cast via `as typeof import(...)` for TypeScript. `electron` is also external — the settings tab accesses `require('electron').shell` for `openPath`.

### PATH resolution (`src/util/env.ts`)

Electron's renderer process strips the user's shell PATH. `buildEnv()` reconstructs a PATH that includes NVM-managed node bin dirs, `~/.local/bin`, `~/.npm-global/bin`, and standard system paths. All `execFile`/`spawn` calls pass `{ env: buildEnv() }`.

### Collection name discovery

`src/util/config.ts` reads and parses `~/.config/qmd/index.yml` using `js-yaml`. Handles both array-of-objects and object-keyed YAML shapes, returning `string[]` and falling back to `[]` on any error.

### Logging

`src/util/log.ts` exports a `log` object (`log.error`, `log.warn`, `log.debug`) gated by a `LogLevel` setting (`off` | `error` | `warn` | `debug`). Default level is `error`. `setLogLevel()` is called from `loadSettings` and `saveSettings`.
