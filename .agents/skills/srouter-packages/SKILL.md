---
name: srouter-packages
description: |
    Comprehensive development skill for the shared core packages in SRouter (`packages/*` including `@srouter/types`, `@srouter/db`, `@srouter/executors`, `@srouter/translator`, `@srouter/constants`, `@srouter/providers`, `@srouter/pricing`). Use whenever modifying, creating, debugging, or reviewing: shared Zod schemas & snake_case data contracts (@srouter/types), SQLite database queries & table schemas (@srouter/db), upstream provider executor drivers & SSE stream framing (@srouter/executors), pure OpenAI/Anthropic dialect translation (@srouter/translator), centralized versioning & provider catalogs (@srouter/constants), circuit breakers & OAuth flows (@srouter/providers), or token pricing & cost estimators (@srouter/pricing).
---

# 📦 SRouter — Shared Packages Skill

Development guide and architectural boundaries for shared packages (`packages/*`).

## When To Read References

| Reference | Package | Use When |
| --- | --- | --- |
| `references/types.md` | `@srouter/types` | Modifying Zod schemas, data contracts, snake_case validation |
| `references/db.md` | `@srouter/db` | Adding/updating SQLite queries, tables, mappers, migrations |
| `references/executors.md` | `@srouter/executors` | Building provider drivers, SSE framing, upstream requests |
| `references/translator.md` | `@srouter/translator` | Pure OpenAI ↔ Anthropic dialect mapping, schema cleanup |
| `references/constants.md` | `@srouter/constants` | Version constants, model lists, provider catalog metadata |
| `references/providers.md` | `@srouter/providers` | Circuit breaker logic, OAuth providers, provider registry |
| `references/pricing.md` | `@srouter/pricing` | Token pricing, cost calculators, usage estimation |

Read the relevant reference document before modifying that package.

## Core Stack

- TypeScript ESM
- Zod 3 (Contract & schema definitions)
- Native `node:sqlite` (WAL mode, parameterized queries)
- Node.js ≥ 22
- `tsup` (ESM module builds)
- Native `node:test` via `tsx`

## Architecture & Dependency Law

```text
apps/* (api, web, cli)
  ↓ imports
packages/* (types, db, executors, translator, constants, providers, pricing)
```

1. **One-Way Dependency**: Packages are standalone reusable libraries. `apps/*` may import packages, but **packages NEVER import from `apps/*`**.
2. **Pure Translation Law**: `@srouter/translator` must remain 100% pure functions (no `fetch`, no filesystem IO, no clocks, no timers, no env variables).
3. **Database Parameterization Law**: Every query in `@srouter/db` must be strictly parameterized (`?` placeholders). No string interpolation.
4. **Schema Single Source of Truth**: Data contracts live exclusively in `@srouter/types`. TypeScript types must be derived using `z.infer<typeof Schema>`.
5. **No Hardcoded Versions/Catalogs**: Versions (`GLOBAL_VERSION`, `APP_VERSION`, etc.) and provider metadata live exclusively in `@srouter/constants`.

## Package Map

```text
packages/
├── constants/    # Single source for versions, provider definitions, model catalogs
├── db/           # SQLite queries, connection pooling, table mappers, migration notes
├── executors/    # Upstream HTTP drivers, BaseExecutor, SSE stream frame parsers
├── pricing/      # Model pricing matrix, token cost calculation, cost estimators
├── providers/    # Circuit breakers, OAuth credential providers, provider registry
├── translator/   # Pure payload/stream transformers (OpenAI ↔ Anthropic)
└── types/        # Canonical snake_case Zod schemas and derived TypeScript types
```

## Verification Gate

Always build and test only the touched package from within its directory:

```bash
cd packages/<package-name> && pnpm run build
cd packages/<package-name> && pnpm test
```
