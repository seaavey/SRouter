---
layout: ../../layouts/DocsLayout.astro
title: Shared packages
description: The reusable contracts and runtime modules that connect the API, dashboard, CLI, and provider drivers.
section: Project
---

## Package map

The workspace keeps reusable behavior in `packages/*`. Packages must not import applications; apps consume package contracts and runtime modules through their public entrypoints.

| Package               | Responsibility                                          | Source                    |
| --------------------- | ------------------------------------------------------- | ------------------------- |
| `@srouter/types`      | Zod schemas and shared inferred types                   | `packages/types/src`      |
| `@srouter/constants`  | Versions, provider catalog, shared constants            | `packages/constants/src`  |
| `@srouter/db`         | SQLite/PostgreSQL persistence and schema initialization | `packages/db/src`         |
| `@srouter/executors`  | Provider drivers, retries, SSE, streaming               | `packages/executors/src`  |
| `@srouter/translator` | Pure protocol and usage mapping                         | `packages/translator/src` |
| `@srouter/providers`  | Provider registry, OAuth, quota adapters                | `packages/providers/src`  |
| `@srouter/pricing`    | Pricing catalog and cost calculation                    | `packages/pricing/src`    |

## Dependency boundaries

```text
apps/web  ───────┐
apps/api  ───────┼──> shared packages
apps/cli  ───────┘

providers ──> executors / translator / types / constants
api       ──> db / providers / pricing / types / constants
```

The API owns HTTP orchestration. Provider drivers and protocol mapping stay in packages so the same runtime contracts can be tested independently from the dashboard.

## Finding a behavior

Start from the public barrel at `packages/<name>/src/index.ts`, then follow the specific module:

1. Find the shared schema or type in `packages/types/src/schemas`.
2. Find the provider or protocol implementation in `packages/providers`, `executors`, or `translator`.
3. Find the API boundary that consumes it under `apps/api/src`.
4. Find the dashboard or CLI caller under `apps/web/src` or `apps/cli/src`.

Focused package tests live beside the package in its `tests/` directory. Generated `dist/` output is not the source of truth.

## Database note

The database defaults to SQLite at `~/.srouter/srouter.db` with WAL mode. Set `DATABASE_PATH` for another SQLite file or `DATABASE_URL` for PostgreSQL. The declarative schema is initialized from `packages/db/src/db.ts`; non-automatic schema changes belong in `DB-MIGRATION.md`.
