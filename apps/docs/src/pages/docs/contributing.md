---
layout: ../../layouts/DocsLayout.astro
title: Contributing
description: Work safely in the pnpm workspace, trace boundaries, and verify focused changes before opening a pull request.
section: Project
---

## Workspace

SRouter is a pnpm workspace orchestrated by Turborepo. The main applications are `apps/api`, `apps/web`, `apps/cli`, and `apps/docs`; reusable runtime modules live under `packages/*`.

```text
apps/
  api/      Hono gateway
  web/      React dashboard
  cli/      Commander / Clack CLI
  docs/     Astro documentation
packages/
  types/ constants/ db/ executors/
  translator/ providers/ pricing/
```

Use Node.js 22 or later and the pinned pnpm version from the root `package.json`.

## Focused commands

Run checks only for the app or package you changed:

```bash
pnpm --filter docs check
pnpm --filter docs build
pnpm --filter web lint
pnpm exec prettier --check <changed-files>
git diff --check
```

Do not run root `pnpm build`, `pnpm test`, or broad lint commands on a resource-constrained development machine. CI runs the full workflow.

For a database-touching API test, run the package setup loader:

```bash
cd apps/api
pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/<focused-file>.test.ts
```

## Code boundaries

- API routes declare paths, validation, and route-local auth.
- Controllers adapt HTTP to domain calls.
- Logic owns business decisions.
- Services own side effects.
- Web routes compose pages; hooks own server state; components remain presentation-focused.
- CLI commands preserve configuration backup and rollback behavior.
- Packages do not import apps.

Trace definitions and usages before changing a shared contract. Reuse schemas from `@srouter/types` instead of duplicating request validation.

## Documentation changes

Keep docs claims grounded in repository source. Link to the owning file when a page explains behavior, and update the page when a route, command, package boundary, or default changes.

The documentation site is static Astro output. Its local development server runs on port `4321`:

```bash
pnpm --filter docs dev
```

## Pull requests

Before opening a PR:

1. Inspect `git diff --stat` and `git diff --check`.
2. Run focused checks for every touched package.
3. Run scoped Prettier on changed files.
4. Confirm no credentials or generated output were added.
5. Describe what was verified and what remains pending.
