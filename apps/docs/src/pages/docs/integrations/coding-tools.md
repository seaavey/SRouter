---
layout: ../../../layouts/DocsLayout.astro
title: Coding tools
description: Configure Claude Code and OpenCode with the SRouter CLI.
section: Integrate
---

## Install and inspect

```bash
npx @srouter/cli setup
npx @srouter/cli status
```

`status` also has the `doctor` alias. It checks gateway connectivity, active models, and tool link status.

## Configure tools

```bash
npx @srouter/cli link claude --model claude-3-7-sonnet
npx @srouter/cli link opencode --model antigravity/gemini-3.7-flash-high
```

Run a tool with SRouter environment variables without permanently changing its configuration:

```bash
npx @srouter/cli run claude
```

Use `--dry-run` before a configuration mutation:

```bash
npx @srouter/cli link claude --dry-run
```

## Adapters

Tool-specific configuration is isolated in `apps/cli/src/adapters`. The Claude and OpenCode adapters own their file formats; the command layer owns orchestration and rollback behavior. `unlink` restores the saved configuration when a link is removed.

Supported adapters in the source include Claude Code, OpenCode, and Hindsight. The exact supported tool names are declared in `apps/cli/src/index.ts` and adapter modules.
