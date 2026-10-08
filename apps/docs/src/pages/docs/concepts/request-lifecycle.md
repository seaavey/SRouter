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

The API mounts CSRF origin and body-limit middleware for `/v1/*` in `server/src/app.rs`. Feature routers add their own authentication and validation. For example, chat requests pass API-key authentication and the rate limiter, validate the OpenAI-compatible request body, and enforce the API key's model allowlist before reaching the chat handler.

## 2. Controller and logic

Handlers adapt the HTTP request to domain functions and shape the response. Business decisions stay in `server/src/features`: model routing, quota checks, logging, pricing, and protocol-specific orchestration are not hidden inside route declarations.

## 3. Provider execution

The executor layer selects the provider driver, builds the upstream request, handles retries and provider-specific authentication, then returns either a complete response or an async stream. The translator layer maps OpenAI and Anthropic contracts without coupling route code to every upstream protocol.

## 4. Response and telemetry

Request usage is recorded for logs, quota, analytics, and estimated cost. Streaming events are emitted as they arrive; the dashboard consumes live log events through its typed stream hook instead of polling at high frequency.

## Source map

| Stage                    | Source                                      |
| ------------------------ | ------------------------------------------- |
| App and route mounts     | `server/src/app.rs`                         |
| Chat route               | `server/src/features/gateway/routes.rs`     |
| Chat handler             | `server/src/features/gateway/chat.rs`       |
| Model resolution         | `server/src/features/providers/registry.rs` |
| Protocol translation     | `server/src/features/gateway/translation`   |
| Provider drivers and SSE | `server/src/features/providers`             |
| Usage events             | `server/src/features/logs.rs`               |
