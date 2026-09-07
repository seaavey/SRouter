---
name: srouter-api
description: |
    Development skill for SRouter API server and backend packages (@srouter/db, @srouter/executors, @srouter/providers, @srouter/translator, @srouter/pricing, @srouter/constants, @srouter/types). Use when working on apps/api routes, Hono middleware, authentication, OAuth flows, provider drivers, translators, streaming APIs, database access, or backend package architecture.
---

# ⚡ SRouter — API & Backend Skill

Development guide for `apps/api` and backend packages.

## When To Read References

| Reference | Use When |
| --- | --- |
| `references/architecture.md` | Working on routing, layering, lifecycle, Hono structure |
| `references/auth.md` | Working on auth, API keys, admin sessions, OAuth |
| `references/providers.md` | Working on executors, translators, providers, constants |
| `references/conventions.md` | Working on naming, Zod, response helpers, typing |
| `references/testing.md` | Running tests, smoke checks, validating streams |

## Core Stack

- Hono 4
- Node.js 22+
- SQLite (`node:sqlite`)
- Zod
- SSE streaming
- tsup ESM builds

## Core Rules

- All APIs mount under `/v1`
- Routes stay thin
- Logic owns orchestration
- Translators stay pure
- Executors isolate upstream behavior
- Never use `any`
- Use PascalCase helpers/controllers/routers
- Prefer Zod-derived types
- Avoid speculative abstractions

## Main Areas

```text
apps/api/src/
├── controllers/
├── logic/
├── middleware/
├── routes/v1/
├── services/
└── utils/
```

Backend packages:

```text
packages/
├── constants/
├── db/
├── executors/
├── translator/
└── types/
```

## Important Patterns

### Routing

```text
routes → controllers → logic → services/packages
```

### Auth

- `ApiKeyAuth` for API access
- `RequireAdmin` for mutations/admin
- OAuth handlers grouped under `AuthController.<Provider>`

### Responses

Use response helpers from:

```text
@/utils/response.js
```

### Providers

Provider metadata belongs in:

```text
packages/constants/src/providers/
```

## Verification Gate

```bash
cd apps/api && pnpm run build
cd apps/api && pnpm test
```

Prefer targeted tests while iterating.
