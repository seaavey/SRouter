---
layout: ../../../layouts/DocsLayout.astro
title: Architecture
description: See how the API, dashboard, CLI, and shared packages fit together.
section: Start here
---

## The workspace at a glance

SRouter is a pnpm workspace with three applications plus the Rust API: `server/` owns the gateway runtime, the web app owns the operator dashboard, the CLI configures coding tools, and `apps/docs` explains the public and internal surfaces.

```text
apps/web  ─┐
apps/cli  ─┼──> server/ (Rust API) ──> provider edge
apps/docs ─┘
```

The applications may depend on packages, but packages must not import applications. This keeps protocol mapping, persistence, provider behavior, and contracts testable without the dashboard or HTTP server.

## Application boundaries

| Surface | Responsibility                                                                 | Primary source  |
| ------- | ------------------------------------------------------------------------------ | --------------- |
| API     | Rust/Axum gateway, auth, validation, handlers, runtime decisions, side effects | `server/src`    |
| Web     | React dashboard, routes, hooks, UI components, server state                    | `apps/web/src`  |
| CLI     | Commander commands, Clack prompts, tool adapters, local state                  | `apps/cli/src`  |
| Docs    | Static Astro documentation and source map                                      | `apps/docs/src` |

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

- Start at `server/src/app.rs` to see route mounting and the middleware stack.
- Follow a request into `server/src/features/gateway` and its feature handler.
- Follow business decisions into `server/src/features`.
- Follow side effects into `server/src/infrastructure`.
- Follow provider-specific behavior into `packages/executors` and `packages/providers`.
- Follow shared contracts into `packages/types`.
