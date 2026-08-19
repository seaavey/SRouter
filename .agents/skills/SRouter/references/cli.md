# CLI Reference — @srouter/cli

## Table of Contents
1. [Architecture](#architecture)
2. [Commands](#commands)
3. [Tool Adapters](#tool-adapters)
4. [Configuration Store](#configuration-store)
5. [Adding a New Tool Adapter](#adding-a-new-tool-adapter)

---

## Architecture

The CLI (`apps/cli/`) is built with Commander.js + @clack/prompts for interactive UIs.

```
apps/cli/
├── bin/srouter.js           # Binary launcher (tsx fallback for dev)
├── src/
│   ├── index.ts             # Commander program definition
│   ├── adapters/            # Tool integration adapters
│   │   ├── base.ts          # AbstractToolAdapter interface
│   │   ├── claude.ts        # Claude Code adapter
│   │   ├── opencode.ts      # OpenCode adapter
│   │   └── index.ts         # Adapter registry (getAdapter, getAllAdapters)
│   ├── commands/            # Command handlers
│   │   ├── setup.ts         # Interactive wizard
│   │   ├── status.ts        # Diagnostics (also 'doctor' alias)
│   │   ├── link.ts          # Direct tool configuration
│   │   ├── unlink.ts        # Restore original config
│   │   ├── run.ts           # Ephemeral process launcher
│   │   └── env.ts           # Shell export generator
│   ├── lib/                 # Shared utilities
│   │   ├── configStore.ts   # ~/.srouter/ persistent config
│   │   ├── platform.ts      # OS/shell detection
│   │   ├── srouterClient.ts # Gateway API client
│   │   └── ui.ts            # Terminal styling (picocolors + clack)
│   └── types/index.ts       # CLI-specific TypeScript interfaces
├── tests/                   # Unit tests
├── package.json             # @srouter/cli
└── tsup.config.ts           # ESM build config (target: node22)
```

### Key Dependencies
- `commander` ^13.1.0 — CLI framework
- `@clack/prompts` ^0.9.1 — Interactive prompts
- `picocolors` ^1.1.1 — Terminal colors
- `@srouter/constants`, `@srouter/types` — Monorepo packages

---

## Commands

### `srouter setup` (alias: `config`)

Interactive onboarding wizard:

1. Tests gateway connectivity at saved URL (default `http://localhost:3000/v1`)
2. Prompts for API key (optional for local auth-free mode)
3. Multi-select installed tools to link
4. Fetches live models from gateway for selection
5. For Claude: offers tier customization (Sonnet/Opus/Haiku model overrides)
6. Creates timestamped backups before modifying any config
7. Persists preferences to `~/.srouter/cli.json`

### `srouter status` / `srouter doctor`

Diagnostic report:
- **System**: OS, platform, arch, shell, home directory
- **Gateway**: health status, latency (ms), available model count
- **Tools**: per-tool installation state, link state, config path, active proxy URL, active models

### `srouter link <tool>`

Direct tool configuration without the wizard.

**Options:**
- `-u, --url <url>` — Gateway URL
- `-k, --key <key>` — API key
- `-m, --model <model>` — Default model
- `--opus-model`, `--sonnet-model`, `--haiku-model` — Claude tier models
- `--dry-run` — Preview without writing

Falls back to saved defaults from `~/.srouter/cli.json` for any omitted flags.

### `srouter unlink <tool>`

Restores original tool configuration:
1. Attempts to restore from backup at `~/.srouter/backups/<tool>-<timestamp>.json`
2. If no backup exists, strips SRouter-specific env vars from the config file

### `srouter run <tool> [args...]`

Launches a tool with SRouter proxy env vars injected into the process (no disk modification):
- Spawns child process with `stdio: "inherit"`
- Injects `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, etc.
- Passes through extra CLI args and preserves exit codes

### `srouter env [tool]`

Generates shell export statements for manual session setup:
```bash
eval "$(pnpm srouter env claude)"
```

Supports bash/zsh, fish, PowerShell, and CMD syntax (auto-detected or via `--shell`).

---

## Tool Adapters

The adapter pattern (`AbstractToolAdapter` in `src/adapters/base.ts`) provides a uniform interface for all tool integrations:

```typescript
interface BaseToolAdapter {
    readonly id: string;       // e.g., "claude"
    readonly name: string;     // e.g., "Claude Code"
    readonly description: string;
    isInstalled(): Promise<boolean>;
    getStatus(): Promise<ToolStatus>;
    link(context: ToolConfigContext): Promise<LinkResult>;
    unlink(): Promise<boolean>;
    getEnv(context: ToolConfigContext): Record<string, string>;
}
```

### Claude Code Adapter

**Config file resolution** (in priority order):
1. `$CLAUDE_CONFIG_DIR/config.json`
2. `~/.claude.json`
3. Windows: `%APPDATA%/Claude/config.json`
4. macOS/Linux: `~/.claude/config.json` or `~/.config/claude/config.json`

**What it writes:**
- `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `model`
- Tier overrides: `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`

### OpenCode Adapter

**Config file resolution:**
1. Windows: `%APPDATA%/opencode/config.json`
2. macOS: `~/Library/Application Support/opencode/config.json`
3. Linux: `$XDG_CONFIG_HOME/opencode/config.json` or `~/.config/opencode/config.json`
4. Fallback: `~/.opencode.json`

**What it writes:**
- Provider block: `provider.srouter` with `@ai-sdk/openai` SDK config
- Active model: `model: "srouter/<model-id>"`

---

## Configuration Store

Located at `~/.srouter/`:

- `cli.json` — Persisted defaults (URL, API key, model selections, backup records, setup timestamp)
- `backups/` — Timestamped copies of tool configs created before any link modification

The `ConfigStore` class provides:
- `createBackup(toolId, originalPath)` — Snapshot before modification
- `restoreLatestBackup(toolId)` — Restore and clean up
- `get/set` methods for all defaults

---

## Adding a New Tool Adapter

1. Create `src/adapters/<tool-name>.ts` extending `AbstractToolAdapter`
2. Implement all interface methods (config path resolution, link/unlink, env generation)
3. Register in `src/adapters/index.ts` adapter registry
4. Add tests in `tests/<tool-name>Adapter.test.ts`

The adapter handles:
- Config file discovery across platforms
- Backup creation before modification
- Clean rollback on unlink
- Environment variable generation for `srouter run` and `srouter env`
