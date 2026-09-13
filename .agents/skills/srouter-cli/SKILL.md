---
name: srouter-cli
description: Use when changing the SRouter CLI.
version: 1.1.0
author: Muhammad Adriansyah (Seaavey), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
    hermes:
        tags: [srouter, cli, commander, adapters, configuration]
        related_skills: [srouter-task-workflow]
---

# SRouter CLI Skill

Use this skill for `apps/cli`: Commander/Clack flows, configuration mutation, adapter integrations, environment generation, onboarding, migrations, and backup/restore behavior.

## When to Use

- Commands, prompts, adapters, shell exports, setup/link/sync flows, or dry-run behavior.
- Claude Code/OpenCode integration, config migration, rollback, or terminal-facing errors.

## Repository Rules

- Read `RULES.md`, `CODING-STYLE.md`, and `DESIGN.md` in `/home/seaavey/Obsidian/SRouter/` before editing.
- `src/index.ts` wires commands only; commands orchestrate; adapters own tool-specific side effects; `lib/*` holds reusable helpers.
- Every configuration write preserves backup/rollback behavior. `--dry-run` must not mutate files.
- Keep generated shell exports deterministic and correctly quoted for spaces/special characters.
- Use typed contracts, strict ESM, PascalCase helpers/types, and zero `any`.
- Keep adapter-specific logic in its adapter until a second concrete consumer exists.

## Procedure

1. Trace command registration from `src/index.ts` to the owning command, adapter, and filesystem/config helper.
2. Inspect existing tests, backup snapshots, generated output, and all consumers before editing.
3. Make the smallest change that preserves dry-run and rollback guarantees.
4. Add a focused test covering mutation safety or serialized output.
5. Update `/home/seaavey/Obsidian/SRouter/PROGRESS.md` with exact verification evidence.

## Verification

```text
cd apps/cli && pnpm run build
cd apps/cli && pnpm exec tsx --test --import ./tests/setup.ts tests/<file>.test.ts
pnpm exec prettier --check <changed-files>
git diff --check
```

Use `--dry-run` for mutation commands during verification. Inspect generated config/env artifacts and confirm no unexpected filesystem changes. Avoid root monorepo checks locally.
