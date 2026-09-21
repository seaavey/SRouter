---
layout: ../../../layouts/DocsLayout.astro
title: Architecture
description: See how the API, dashboard, CLI, and shared packages fit together.
section: Start here
---

## The workspace at a glance

SRouter is a pnpm workspace with four applications and seven reusable packages. The API owns the gateway runtime, the web app owns the operator dashboard, the CLI configures coding tools, and `apps/docs` explains the public and internal surfaces.

```text
apps/web  ─┐
apps/cli  ─┼──> apps/api ──> shared packages ──> provider edge
apps/docs ─┘
```

The applications may depend on packages, but packages must not import applications. This keeps protocol mapping, persistence, provider behavior, and contracts testable without the dashboard or HTTP server.

## Application boundaries

| Surface | Responsibility                                                               | Primary source  |
| ------- | ---------------------------------------------------------------------------- | --------------- |
| API     | Hono gateway, auth, validation, controllers, runtime decisions, side effects | `apps/api/src`  |
| Web     | React dashboard, routes, hooks, UI components, server state                  | `apps/web/src`  |
| CLI     | Commander commands, Clack prompts, tool adapters, local state                | `apps/cli/src`  |
| Docs    | Static Astro documentation and source map                                    | `apps/docs/src` |

## Package boundaries

| Package               | Owns                                                |
| --------------------- | --------------------------------------------------- |
| `@srouter/types`      | Zod schemas and inferred request/response types     |
| `@srouter/constants`  | Provider catalog, versions, shared constants        |
| `@srouter/db`         | SQLite/PostgreSQL persistence and database transfer |
| `@srouter/executors`  | Upstream drivers, retries, SSE, streaming           |
| `@srouter/translator` | Pure protocol and usage mapping                     |
| `@srouter/providers`  | Registry, OAuth, quota adapters, circuit breakers   |
| `@srouter/pricing`    | Pricing catalog and estimated cost calculation      |

## Where to start reading

- Start at `apps/api/src/index.ts` to see route mounting and middleware order.
- Follow a request into `apps/api/src/routes/v1` and its controller.
- Follow business decisions into `apps/api/src/logic`.
- Follow side effects into `apps/api/src/services`.
- Follow provider-specific behavior into `packages/executors` and `packages/providers`.
- Follow shared contracts into `packages/types`.
