---
layout: ../../../layouts/DocsLayout.astro
title: Testing and verification
description: Run focused checks without hiding failures behind broad workspace commands.
section: Project
---

## Focused checks

Run checks for the app or package you changed:

```bash
pnpm --filter <app-or-package> build
pnpm --filter web lint
pnpm exec prettier --check <changed-files>
git diff --check
```

For this documentation app:

```bash
pnpm --filter docs check
pnpm --filter docs build
```

Do not run root `pnpm build`, `pnpm test`, or broad lint commands on a resource-constrained development machine. CI runs the full workflow.

## Focused tests

API tests use an isolated database setup:

```bash
cd apps/api
pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/<focused-file>.test.ts
```

CLI tests use its setup loader:

```bash
cd apps/cli
pnpm exec tsx --test --import ./tests/setup.ts tests/<focused-file>.test.ts
```

Package tests run from the package directory. This keeps test environment variables isolated and avoids touching the default local database.

## Verification evidence

A completion report should name the exact commands and results. Do not call a queued CI check a success, and do not claim browser behavior from typechecking alone. For UI changes, verify responsive behavior and keyboard focus in a browser when the environment supports it.
