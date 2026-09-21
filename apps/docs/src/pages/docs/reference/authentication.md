---
layout: ../../../layouts/DocsLayout.astro
title: Authentication
description: Choose between virtual API keys, admin sessions, OAuth, and origin protection.
section: Reference
---

## Virtual API keys

Model-facing endpoints use a bearer token created in the dashboard. The key is checked by `apps/api/src/middleware/ApiKeyAuth.ts`, then model access and rate limits are applied where the route requires them.

```http
Authorization: Bearer sr-live-your_virtual_key
```

## Admin sessions

Dashboard mutations use the admin session guard in `apps/api/src/middleware/AdminAuth.ts`. The admin route owns setup, login, password change, status, and logout:

```text
GET  /v1/admin/status
POST /v1/admin/setup
POST /v1/admin/login
POST /v1/admin/change-password
POST /v1/admin/logout
```

The session cookie configuration can use secure cookies through `SROUTER_SECURE_COOKIES`.

## OAuth and token import

Provider-specific OAuth login, callback, polling, and token import routes are declared in `apps/api/src/routes/v1/auth.ts`. Callback routes must remain reachable for the provider flow; setup and token mutation routes remain admin-protected.

## Origin and request guards

`apps/api/src/middleware/CsrfOrigin.ts` protects `/v1/*` against disallowed origins, while `BodyLimit.ts` bounds incoming request size. These are transport guards and should remain mounted before feature routers.

Never put an upstream provider secret in a client configuration. Use a virtual key for the client and keep provider credentials in the gateway's provider connection state.
