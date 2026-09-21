---
layout: ../../../layouts/DocsLayout.astro
title: Request lifecycle
description: Follow a request from authentication and validation to translation, execution, and streaming.
section: Build with SRouter
---

## The path

A model request crosses a small number of explicit boundaries. The route handles transport concerns; controllers adapt HTTP; logic decides; packages execute provider behavior.

```text
HTTP request
  → origin/body guards
  → API key authentication
  → rate and model access checks
  → schema validation
  → controller
  → routing / fallback logic
  → translator + executor
  → response or SSE stream
```

## 1. Request boundary

The API mounts CSRF origin and body-limit middleware for `/v1/*` in `apps/api/src/index.ts`. Feature routers add their own authentication and validation. For example, chat requests use `ApiKeyAuth`, `EnforceRateLimit`, `ValidateJson(ChatCompletionRequestSchema)`, and `EnforceModelAccess()` before reaching `ChatController.CreateCompletion`.

## 2. Controller and logic

Controllers adapt the Hono context to domain functions and shape the HTTP response. Business decisions stay in `apps/api/src/logic`: fallback policy, model routing, quota checks, logging, pricing, and protocol-specific orchestration are not hidden inside route declarations.

## 3. Provider execution

The executor layer selects the provider driver, builds the upstream request, handles retries and provider-specific authentication, then returns either a complete response or an async stream. The translator layer maps OpenAI and Anthropic contracts without coupling route code to every upstream protocol.

## 4. Response and telemetry

Request usage is recorded for logs, quota, analytics, and estimated cost. Streaming events are emitted as they arrive; the dashboard consumes live log events through its typed stream hook instead of polling at high frequency.

## Source map

| Stage                    | Source                                        |
| ------------------------ | --------------------------------------------- |
| App and route mounts     | `apps/api/src/index.ts`                       |
| Chat route               | `apps/api/src/routes/v1/chat.ts`              |
| Chat controller          | `apps/api/src/controllers/chat.controller.ts` |
| Fallback decisions       | `apps/api/src/logic/fallbackRunner.ts`        |
| Protocol translation     | `packages/translator/src`                     |
| Provider drivers and SSE | `packages/executors/src`                      |
| Usage events             | `apps/api/src/services/usageEvents.ts`        |
