---
layout: ../../../layouts/DocsLayout.astro
title: Environment variables
description: Configure ports, storage, OAuth callbacks, dashboard serving, and runtime behavior.
section: Reference
---

## Runtime configuration

| Variable                 | Default                   | Purpose                                    |
| ------------------------ | ------------------------- | ------------------------------------------ |
| `PORT`                   | `3000`                    | Main API and dashboard port                |
| `OAUTH_PORT`             | `1455`                    | Secondary local OAuth callback listener    |
| `DATABASE_PATH`          | `~/.srouter/srouter.db`   | SQLite database path                       |
| `DATABASE_URL`           | Not set                   | PostgreSQL connection string               |
| `WEB_DIST_PATH`          | `apps/web/dist`           | Built dashboard path                       |
| `SROUTER_PUBLIC_URL`     | Not set                   | Public OAuth callback URL on the main port |
| `NODE_ENV`               | `development`             | Runtime environment                        |
| `SROUTER_SECURE_COOKIES` | `false` unless configured | Secure admin session cookies               |

Defaults are resolved by the API startup and database packages. Check the `.env.example` files and `apps/api/src/services/startup.ts` before introducing a new setting.

## OAuth callback behavior

When `SROUTER_PUBLIC_URL` is set, OAuth callbacks use the main `PORT`. Without it, the local secondary listener uses `OAUTH_PORT`. This matters when the gateway is behind a reverse proxy or tunnel.

## Storage

SQLite is the default and stores data under `~/.srouter`. Set `DATABASE_PATH` for an alternate local file or `DATABASE_URL` for PostgreSQL. See [Database](/docs/development/database/) for transfer and schema behavior.

## Docker

The production image exposes ports `3000` and `1455` and mounts `/root/.srouter`. The dashboard is served from `apps/web/dist` when that build exists; otherwise the API can run without the dashboard static assets.
