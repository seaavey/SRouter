---
layout: ../../../layouts/DocsLayout.astro
title: API routes
description: Browse the complete mounted HTTP route surface and its authentication boundary.
section: Reference
---

## Mounts

The Hono app mounts feature routers under `/v1` in `apps/api/src/index.ts`. `/health` and `/v1` are root-level discovery exceptions. Compatibility routes for clients that append `/v1` twice are also mounted under `/v1/v1` for the model, chat, and messages routers.

## Complete route catalog

| Method                                  | Endpoint                                      | Auth boundary                               |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| `GET`                                   | `/health`                                     | Public                                      |
| `GET`                                   | `/v1`                                         | Public discovery                            |
| `POST`                                  | `/v1/chat/completions`                        | Virtual API key, rate, schema, model access |
| `POST`                                  | `/v1/chat/completion`                         | Virtual API key, rate, schema, model access |
| `POST`                                  | `/v1/messages`                                | Virtual API key, rate                       |
| `GET`                                   | `/v1/models`                                  | Virtual API key                             |
| `GET`                                   | `/v1/models/:model`                           | Virtual API key                             |
| `GET`                                   | `/v1/providers`                               | Virtual API key                             |
| `GET`                                   | `/v1/providers/catalog`                       | Virtual API key                             |
| `GET`                                   | `/v1/providers/:providerId`                   | Virtual API key                             |
| `GET`                                   | `/v1/providers/:providerId/hidden-models`     | Virtual API key                             |
| `GET`                                   | `/v1/favorites`                               | Virtual API key                             |
| `POST`, `DELETE`                        | `/v1/favorites*`                              | Admin for mutations                         |
| `POST`, `DELETE`, `PATCH`               | `/v1/providers*`                              | Admin for mutations                         |
| `GET`, `POST`, `PATCH`, `DELETE`        | `/v1/keys*`                                   | Admin                                       |
| `GET`                                   | `/v1/quota` and `/v1/qouta`                   | Virtual API key                             |
| `GET`                                   | `/v1/logs`, `/stats`, `/events`, `/analytics` | Virtual API key                             |
| `GET`                                   | `/v1/pricing/models`                          | Virtual API key                             |
| `GET`, `POST`, `PATCH`                  | `/v1/settings*`                               | Admin for mutations                         |
| `GET`, `POST`, `PUT`, `PATCH`, `DELETE` | `/v1/settings/fallbacks*`                     | Admin for mutations                         |
| `GET`, `POST`                           | `/v1/tunnel/*`                                | Admin                                       |
| `GET`, `POST`                           | `/v1/admin/*`                                 | Session / setup flow                        |
| `GET`, `POST`                           | `/v1/auth/*`                                  | Admin for token operations                  |
| `GET`, `POST`                           | `/v1/admin/database/*`                        | Admin                                       |
| `POST`                                  | `/v1/images/generations`                      | Virtual API key, rate, schema, model access |

The `/v1/qouta` spelling is a compatibility alias preserved by the route source; use `/v1/quota` in new clients.

## Route source

Feature registration is in `apps/api/src/index.ts`. Route declarations live under `apps/api/src/routes/v1`, with controllers, middleware, and logic kept in their own directories.
