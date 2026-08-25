---
name: srouter-cli
description: |
    Development skill for SRouter CLI (@srouter/cli / apps/cli). Use when working on CLI commands (setup, status, doctor, link, unlink, run, env), tool adapters (Claude Code, OpenCode), terminal UI (@clack/prompts, picocolors), or persistent CLI config (~/.srouter/).
---

# ⚡ SRouter — CLI Skill

Development guide for `@srouter/cli` (`apps/cli`), the terminal companion to configure and proxy AI coding tools with SRouter Gateway.

## Overview & Architecture

Built with Commander.js + `@clack/prompts` for interactive terminal workflows.

```
apps/cli/
├── bin/srouter.js           # Executable entrypoint
├── src/
│   ├── index.ts             # Commander program setup (.version(CLI_VERSION))
│   ├── adapters/            # AI tool adapters
│   │   ├── base.ts          # AbstractToolAdapter interface
│   │   ├── claude.ts        # Claude Code adapter
│   │   ├── opencode.ts      # OpenCode adapter
│   │   └── index.ts         # Adapter registry
│   ├── commands/            # Command implementations
│   │   ├── setup.ts         # Interactive onboarding wizard
│   │   ├── status.ts        # Health & tool diagnostic report (alias: doctor)
│   │   ├── link.ts          # Direct tool config linking
│   │   ├── unlink.ts        # Restore original config from backup
│   │   ├── run.ts           # Ephemeral process runner with proxy env
│   │   └── env.ts           # Print shell export statements
│   └── lib/                 # Platform, config store, API client utilities
└── tests/                   # Node.js native test runner test suite
```

## CLI Commands

- `srouter setup` (alias `config`): Interactive prompt to connect tools to SRouter.
- `srouter status` (alias `doctor`): System, gateway connectivity, and linked tools report.
- `srouter link <tool>`: Direct non-interactive linking (`-u <url>`, `-k <key>`, `-m <model>`).
- `srouter unlink <tool>`: Restores previous config from `~/.srouter/backups/`.
- `srouter run <tool> -- <args>`: Injects proxy environment variables into a single process.
- `srouter env <tool>`: Outputs bash/zsh `export` commands.

## Key Rules & Testing

1. **Version Constant**: Always import `CLI_VERSION` from `@srouter/constants`.
2. **Backups First**: Any mutating command (`link`, `setup`) must snapshot original configuration files before writing changes.
3. **Tests**:
    - Run tests via `cd apps/cli && pnpm test`.
    - Never run `pnpm test` across the whole monorepo directly.
