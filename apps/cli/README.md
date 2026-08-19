# SRouter CLI

`@srouter/cli` is the command-line companion for SRouter. It connects AI coding tools to a SRouter gateway, writes the required tool configuration, generates shell environment variables, and provides diagnostics and rollback.

Part of the [`SRouter`](../../README.md) monorepo.

## Supported workflow

```text
┌───────────────┐
│ srouter setup │
└───────┬───────┘
        │
        ├── detect gateway
        ├── select tool / model
        └── write client config
                 │
                 ▼
      Claude Code / OpenCode
                 │
                 ▼
          SRouter Gateway
```

The CLI currently targets:

- **Claude Code**
- **OpenCode**

## Installation

From the SRouter monorepo:

```bash
corepack enable
pnpm install
```

Run the local CLI through the root workspace:

```bash
pnpm srouter --help
pnpm srouter setup
```

The package also exposes a `srouter` binary. When the built CLI is available, the bin entry loads `dist/index.js`; during local development it falls back to the TypeScript source through `tsx`.

## Commands

### `srouter setup`

Interactive setup wizard for connecting coding tools to SRouter.

```bash
pnpm srouter setup
```

Useful options include:

```bash
pnpm srouter setup \
  --url http://localhost:3000/v1 \
  --key sr-live-your-key \
  --model anthropic/claude-3-7-sonnet
```

Claude Code tier-specific model options are also supported:

```bash
pnpm srouter setup \
  --opus-model claude-3-opus-20240229 \
  --sonnet-model claude-3-7-sonnet \
  --haiku-model claude-3-5-haiku-20241022
```

### `srouter link <tool>`

Configure a specific supported tool.

```bash
pnpm srouter link claude --model claude-3-7-sonnet
pnpm srouter link opencode --model claude-3-7-sonnet
```

Preview changes without writing files:

```bash
pnpm srouter link claude --dry-run
```

### `srouter status`

Inspect gateway connectivity, available models, and current tool-link state.

```bash
pnpm srouter status
```

`doctor` is an alias:

```bash
pnpm srouter doctor
```

### `srouter env [tool]`

Print proxy environment variables for a shell session.

```bash
eval "$(pnpm srouter env claude)"
```

Supported shell syntax includes bash, zsh, fish, PowerShell, and cmd.

Examples:

```bash
pnpm srouter env --shell fish
pnpm srouter env --shell powershell
```

### `srouter run <tool>`

Launch a coding tool with the SRouter proxy environment injected into its process.

```bash
pnpm srouter run claude
pnpm srouter run opencode
```

Arguments after the tool name are forwarded to the target CLI.

### `srouter unlink <tool>`

Restore a supported tool's previous configuration from the backup created by the CLI.

```bash
pnpm srouter unlink claude
pnpm srouter unlink opencode
```

## Configuration model

The CLI accepts a common set of gateway options:

| Option           | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `--url`          | SRouter gateway base URL                      |
| `--key`          | SRouter API key                               |
| `--model`        | Default model ID                              |
| `--opus-model`   | Claude Code Opus model                        |
| `--sonnet-model` | Claude Code Sonnet model                      |
| `--haiku-model`  | Claude Code Haiku model                       |
| `--dry-run`      | Preview changes without writing configuration |

The default development gateway is normally `http://localhost:3000/v1`.

## Project structure

```text
apps/cli/
├── src/
│   ├── commands/
│   │   ├── setup.ts
│   │   ├── link.ts
│   │   ├── unlink.ts
│   │   ├── status.ts
│   │   ├── env.ts
│   │   └── run.ts
│   └── index.ts
├── bin/
│   └── srouter.js
├── tests/
└── package.json
```

The CLI uses Commander for argument parsing and Clack prompts for the interactive setup experience. Shared SRouter constants and types come from workspace packages.

## Development and testing

Run the CLI from source through the workspace script:

```bash
pnpm srouter --help
```

Run CLI tests:

```bash
pnpm --filter @srouter/cli test
```

The package includes a `bin/srouter.js` launcher that prefers a compiled `dist/index.js` and otherwise falls back to the local TypeScript entrypoint through `tsx`.

## Safety / rollback

Configuration changes made by the linking flow are designed to be reversible. Use `srouter unlink <tool>` to restore a previous configuration from the CLI's backup mechanism.

## Related apps

- [`apps/api`](../api/README.md) — gateway server
- [`apps/web`](../web/README.md) — management dashboard
- [`../../README.md`](../../README.md) — complete SRouter documentation
