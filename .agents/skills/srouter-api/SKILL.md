---
name: srouter-api
description: Use when changing SRouter API or backend runtime.
version: 1.1.0
author: Muhammad Adriansyah (Seaavey), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
    hermes:
        tags: [srouter, api, hono, backend, providers, database]
        related_skills: [srouter-task-workflow]
---

# SRouter API Skill

Use this skill for `apps/api` and backend runtime packages. Keep HTTP concerns in routes/controllers, business decisions in logic, and side effects in services or shared packages.

## When to Use

- Hono routes, validation, auth, OAuth, SSE, or API responses.
- Provider executors, translators, registries, quota logic, database access, or pricing.
- Backend tests, route smoke checks, or provider catalog changes.

## Repository Rules

- Read `RULES.md`, `CODING-STYLE.md`, and `DESIGN.md` in `/home/seaavey/Obsidian/SRouter/` before editing.
- Routes under `apps/api/src/routes/v1` mount under `/v1`; keep route-local auth inside the feature router.
- Keep the flow `route → controller → logic → service/package`.
- Use Zod at I/O boundaries and derive types from shared schemas.
- Use `snake_case` for request/database contracts and shared types; never duplicate a shared contract in an app.
- Use PascalCase for helpers, controllers, and routers. Never use `any` or speculative abstractions.
- Packages may not import from apps.
- Provider metadata belongs in `packages/constants/src/providers/`; do not scatter provider URLs or model catalogs.
- Use parameterized `?` queries in `packages/db`; document non-automatic schema changes in `DB-MIGRATION.md`.
- Keep translators pure and executors responsible for upstream behavior and stream framing.

## Procedure

1. Inspect `git status`, the owning route/package, its tests, and all usages before editing.
2. Load the relevant reference under `references/` before changing the subsystem.
3. Trace the contract end to end: route validator, controller, logic, service/package, and frontend consumer when applicable.
4. Make the smallest change that preserves existing auth, response envelopes, SSE framing, and error behavior.
5. Add or update a focused regression test for changed behavior.
6. Update `/home/seaavey/Obsidian/SRouter/PROGRESS.md` with scope, findings, and verification evidence.

## Verification

Run only focused checks for touched packages; never run root monorepo build/test/lint locally.

```text
cd apps/api && pnpm run build
cd apps/api && pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/<file>.test.ts
cd packages/<touched-package> && pnpm run build
pnpm exec prettier --check <changed-files>
git diff --check
```

For route changes, smoke-test the mounted endpoint against a running API and verify auth, response envelope, errors, and SSE framing. Report exact commands and exit results; do not claim broad coverage from focused checks.
