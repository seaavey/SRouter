---
layout: ../../layouts/DocsLayout.astro
title: CLI
description: Configure SRouter from the terminal and connect supported coding tools to one local gateway.
section: Project
---

## Install and initialize

The CLI package is `@srouter/cli`. The setup command configures the local client connection and can be run through `npx`:

```bash
npx @srouter/cli setup
npx @srouter/cli doctor
```

Command implementations live in `apps/cli/src/commands`. Adapters for supported tools live in `apps/cli/src/adapters`.

## Commands

| Command    | Use                                                        |
| ---------- | ---------------------------------------------------------- |
| `setup`    | Initialize the CLI configuration and local connection      |
| `doctor`   | Check the local setup and dependencies                     |
| `link`     | Configure a supported coding tool to use SRouter           |
| `unlink`   | Restore a tool configuration from its backup               |
| `run`      | Run a coding tool with SRouter proxy environment variables |
| `status`   | Inspect the current CLI and gateway state                  |
| `sync`     | Synchronize supported configuration state                  |
| `migrate`  | Migrate an existing configuration                          |
| `database` | Work with database transfer operations                     |
| `env`      | Inspect or manage environment configuration                |
| `init`     | Initialize CLI-owned local state                           |

## Link a coding tool

```bash
npx @srouter/cli link claude --model claude-3-7-sonnet
npx @srouter/cli link opencode --model antigravity/gemini-3.7-flash-high
```

Use `run` when you want the proxy environment only for one process:

```bash
npx @srouter/cli run claude
```

## Preview mutations

Configuration-writing commands preserve backup and rollback behavior. Use `--dry-run` to inspect a change without writing files:

```bash
npx @srouter/cli link claude --dry-run
```

When a linked configuration is no longer needed, use `unlink` so the adapter can restore the saved backup rather than manually editing the tool configuration.

## Source map

- CLI entrypoint: `apps/cli/src/index.ts`
- Shared client: `apps/cli/src/lib/client.ts`
- Persistent state: `apps/cli/src/lib/store.ts`
- Platform detection: `apps/cli/src/lib/platform.ts`
- Claude adapter: `apps/cli/src/adapters/claude.ts`
- OpenCode adapter: `apps/cli/src/adapters/opencode.ts`
