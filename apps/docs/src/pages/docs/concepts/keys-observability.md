---
layout: ../../../layouts/DocsLayout.astro
title: Keys and observability
description: Use virtual API keys and inspect quotas, logs, analytics, and pricing.
section: Build with SRouter
---

## Virtual API keys

Virtual keys are the client-facing credential. They let SRouter keep upstream provider credentials in the gateway while clients use one local API key. Keys can define rate limits, token quotas, model access, expiration, and credit limits.

The key route is admin-protected because it mutates access policy:

```text
GET    /v1/keys
POST   /v1/keys
PATCH  /v1/keys/:id
POST   /v1/keys/:id/credit
DELETE /v1/keys/:id
```

Source: `apps/api/src/routes/v1/keys.ts`, `apps/api/src/controllers/keys.controller.ts`, and `apps/web/src/routes/keys.tsx`.

## Quotas

Quota adapters live in `packages/providers/src/quota`. The API exposes the normalized result through `GET /v1/quota`; the dashboard renders provider quota cards and table views from `apps/web/src/routes/quota.tsx`.

## Logs and analytics

Request logs provide the evidence for traffic decisions. The API exposes list, stats, events, and analytics endpoints. The web dashboard uses the data for the logs table, usage overview, traffic charts, latency, token usage, and provider breakdowns.

```text
GET /v1/logs
GET /v1/logs/stats
GET /v1/logs/events
GET /v1/logs/analytics
```

The events endpoint is the realtime path. Do not replace it with aggressive polling when the stream is available.

## Pricing

`packages/pricing` owns the pricing catalog and matching logic. `apps/api/src/logic/pricing.logic.ts` adapts it for the API, while the dashboard displays model pricing and estimated request cost. Pricing is an estimate when the upstream catalog contains a matching model; the UI should not present an estimate as provider billing truth.
