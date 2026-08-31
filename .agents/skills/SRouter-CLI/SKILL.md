---
name: srouter-cli
description: |
    Comprehensive development skill for the SRouter CLI (@srouter/cli / apps/cli). Use whenever working on, modifying, debugging, or reviewing: Commander.js command orchestration, srouter CLI commands (setup, init, link, unlink, status, doctor, sync, env, run, migrate), adapter integrations (Claude Code ~/.claude.json, OpenCode ~/.opencode.json), backup/restore snapshotting (~/.srouter/backups/), shell environment variable exports (bash, zsh, fish, powershell), interactive terminal prompts (@clack/prompts), or dry-run safety modes.
---

# ⚡ SRouter — CLI Skill

Development guide for `apps/cli` (`@srouter/cli`).

## When To Read References

| Reference | Use When |
| --- | --- |
| `references/commands.md` | Adding/debugging commands or CLI flows |
| `references/adapters.md` | Working on adapters, env injection, backups |
| `references/conventions.md` | Working on Commander architecture or TS conventions |
| `references/testing.md` | Running tests and verification workflows |

Read the relevant reference before editing that subsystem. The references contain operational constraints and failure patterns that are intentionally kept out of this top-level file.

## Stack

- Commander.js
- `@clack/prompts`
- TypeScript ESM
- tsup
- native `node:test`
- `tsx --test`

## Architecture

```text
src/index.ts
  ↓
commands/*
  ↓
adapters/* + lib/*
```

Main structure:

```text
apps/cli/
├── src/
│   ├── adapters/
│   ├── commands/
│   ├── lib/
│   ├── types/
│   └── index.ts
├── tests/
└── bin/srouter.js
```

## Core Rules

- `index.ts` wires commands only
- commands orchestrate flows
- adapters own tool-specific logic
- `lib/*` owns reusable helpers
- always create backups before writes
- dry-run mode must never mutate files
- keep shell exports deterministic
- avoid `any`
- use PascalCase helpers/types

## Development Workflow

When implementing or debugging CLI behavior:

1. trace command registration from `src/index.ts`
2. inspect orchestration in `commands/*`
3. isolate side effects inside adapters/lib
4. verify backup creation before mutations
5. verify dry-run paths do not mutate files
6. run targeted tests before broad verification

This separation prevents orchestration bugs from leaking into adapters and keeps destructive behavior easy to reason about.

## Decision Guide

Put code in:

- `commands/*` → orchestration, prompts, flow control
- `adapters/*` → tool-specific filesystem/env/config behavior
- `lib/*` → reusable pure/shared helpers
- `types/*` → shared contracts and option types

If logic only exists for one adapter, keep it inside that adapter until a second concrete consumer appears.

## Common Failure Patterns

- config mutation without backup creation
- dry-run paths still mutating filesystem state
- shell export quoting breaking on spaces/special chars
- duplicated adapter logic drifting across providers
- mixing prompt UX with filesystem side effects
- adding speculative flags/options that are never exercised

Most CLI regressions come from side effects and environment serialization, not Commander wiring.

## Debugging Heuristics

When debugging:

1. reproduce with the smallest command possible
2. verify generated env/config output before execution
3. compare dry-run vs real execution paths
4. inspect backup snapshots after mutation flows
5. trace adapter serialization before blaming shell behavior

Prefer inspecting generated config artifacts over reasoning abstractly about CLI behavior.

## Avoid

- business logic inside `index.ts`
- direct filesystem writes without snapshotting
- shell-specific nondeterministic exports
- adapter-specific logic inside shared helpers
- premature abstractions for one-off commands
- broad monolithic command handlers

## Supported Areas

Commands:

- `setup`
- `init`
- `link`
- `unlink`
- `status`
- `doctor`
- `sync`
- `env`
- `run`
- `migrate`

Adapters:

- Claude Code
- OpenCode

## Verification Gate

```bash
cd apps/cli && pnpm run build
cd apps/cli && pnpm test
```

Prefer targeted tests during iteration.
