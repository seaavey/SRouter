---
layout: ../../../layouts/DocsLayout.astro
title: Environment variables
description: Configure ports, storage, OAuth callbacks, dashboard serving, and runtime behavior.
section: Reference
---

## Runtime configuration

| Variable                 | Default                   | Purpose                                      |
| ------------------------ | ------------------------- | -------------------------------------------- |
| `PORT`                   | `3000`                    | Main API, dashboard, and OAuth callback port |
| `DATABASE_PATH`          | `~/.srouter/srouter.db`   | SQLite database path                         |
| `DATABASE_URL`           | Not set                   | Refused: SQLite is the only backend          |
| `WEB_DIST_PATH`          | `apps/web/dist`           | Built dashboard path                         |
| `SROUTER_PUBLIC_URL`     | Not set                   | Public OAuth callback URL on the main port   |
| `NODE_ENV`               | `development`             | Runtime environment                          |
| `SROUTER_SECURE_COOKIES` | `false` unless configured | Secure admin session cookies                 |

Defaults are resolved by the API at startup. Check `server/.env.example` and `server/src/config.rs` before introducing a new setting.

## OAuth callback behavior

OAuth callbacks run on the main `PORT`; set `SROUTER_PUBLIC_URL` when the gateway is behind a reverse proxy so the callback URL is built from the public address. The Node build's secondary `OAUTH_PORT` listener was removed with `apps/api`, so that variable is no longer read.

## Storage

SQLite is the default and stores data under `~/.srouter`. Set `DATABASE_PATH` for an alternate local file. PostgreSQL is not supported: a configured `DATABASE_URL` is refused at boot. See [Database](/docs/development/database/) for transfer and schema behavior.

## Docker

The production image exposes port `3000` and keeps runtime data in the `/app/data` volume. The dashboard is served from `apps/web/dist` when that build exists; otherwise the API runs without the dashboard static assets.
