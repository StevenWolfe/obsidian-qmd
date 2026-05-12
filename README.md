# QMD Search — Obsidian Plugin

Search your [`qmd`](https://github.com/tobi/qmd)-indexed knowledge bases from inside Obsidian using BM25 keyword search, vector semantic search, and LLM-reranked hybrid search — all running locally.

> **Desktop only.** Requires the `qmd` CLI and a configured collection.

---

## Prerequisites

1. Install `qmd`:
   ```bash
   npm install -g @tobilu/qmd
   ```
2. Index at least one collection:
   ```bash
   qmd collection add ~/path/to/notes --name my-notes
   qmd embed
   ```
   Or use the **Register vault as collection** button in the plugin settings.

---

## Installation

### Manual (current)

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. Copy them to `<your-vault>/.obsidian/plugins/qmd-search/`.
3. In Obsidian → Settings → Community plugins → enable **QMD Search**.

### BRAT (beta testing)

Install [BRAT](https://obsidian.md/plugins?id=obsidian42-brat), then add this repository URL to install directly from GitHub.

---

## Usage

### Commands

| Command | Default hotkey | Description |
|---|---|---|
| **QMD: Search** | *(none)* | Open the search modal |
| **QMD: Index status** | *(none)* | Show index health and collection stats |
| **QMD: Re-index collections** | *(none)* | Run `qmd update` to refresh the index |

Open the command palette (`Ctrl/Cmd+P`) and search for "QMD" to find all commands.

### Search modal

- Type a query and press **Enter** to search.
- **Collection** dropdown filters to a single indexed collection (populated from `~/.config/qmd/index.yml`).
- **Mode** buttons select the search strategy:
  - *Keyword* — fast BM25 full-text search
  - *Semantic* — vector similarity search
  - *Hybrid* — both combined with LLM reranking (best results, slower on first run while models load)
- **Intent** (expandable) steers the ranking pipeline without acting as a search term — useful for disambiguation (e.g. "web performance" when searching "caching").
- Results show alongside an inline vault filename search. Click any result to open the file at the matching line.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `qmd binary path` | `qmd` | Path to the qmd executable. Blur the field to verify the version. |
| `Transport mode` | CLI | **CLI** spawns `qmd` per query. **MCP HTTP** connects to a persistent daemon (faster after warm-up). |
| `MCP daemon port` | `8181` | Port for the MCP HTTP daemon (MCP mode only). |
| `Default collection` | *(all)* | Pre-selects a collection in the search modal. |
| `Default search mode` | Hybrid | Which mode the modal opens with. |
| `Log level` | error | Console verbosity: `off`, `error`, `warn`, `debug`. |

### Register vault as collection

The **Register vault as collection** button in settings runs:
```bash
qmd collection add <vault-path> --name <name>
qmd embed
```
You will be prompted to confirm the collection name (pre-filled with the vault name).

### Open index config

Opens `~/.config/qmd/index.yml` in your system default editor.

---

## How it works

The plugin communicates with `qmd` via one of two transports, selectable in settings:

- **CLI mode** — spawns `qmd search|vsearch|query --json` as a subprocess per query. No daemon required. First hybrid query may be slow while GGUF models load into memory.
- **MCP HTTP mode** — connects to `qmd mcp --http` running on `localhost:{port}`. The plugin manages the daemon lifecycle (start/stop), reusing an existing daemon if one is already running. Faster after the initial model load.

Results are normalised from `qmd`'s `qmd://collection/path` URI format into file paths, then matched against your vault to enable in-editor navigation.

---

## Troubleshooting

**"qmd not found"** — Obsidian's Electron process has a stripped PATH. Set the full path to the `qmd` binary in settings (e.g. `/home/you/.npm-global/bin/qmd`), or ensure it is in one of: `~/.nvm/versions/node/*/bin`, `~/.local/bin`, `~/.npm-global/bin`, `/usr/local/bin`.

**No results** — Run `qmd status` in a terminal to check your index is healthy. Run `qmd update` or use the Re-index command if files are stale.

**MCP daemon fails to start** — Try CLI mode, or run `qmd mcp --http` manually in a terminal to see the error output.

---

## Development

```bash
git clone https://github.com/StevenWolfe/obsidian-qmd
cd obsidian-qmd
npm install
npm run build        # → main.js
npx tsc --noEmit     # type-check
VAULT_PATH=~/path/to/vault npm run deploy
```

See [CLAUDE.md](CLAUDE.md) for architecture details.

---

## License

MIT — see [LICENSE](LICENSE).
