---
layout: ../../../layouts/DocsLayout.astro
title: Streaming and SSE
description: Understand streaming responses, events, retries, and live telemetry.
section: Integrate
---

## Client streaming

OpenAI-compatible chat requests can set `stream: true`. The gateway returns Server-Sent Events and forwards provider output as it becomes available.

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sr-live-your_virtual_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"antigravity/gemini-3.7-flash-high","messages":[{"role":"user","content":"Stream this"}],"stream":true}'
```

## Runtime ownership

- `packages/executors/src/sse.ts` parses upstream SSE frames.
- `packages/executors/src/stream-utils.ts` normalizes stream handling.
- Provider executors adapt upstream event shapes.
- `packages/translator` maps usage and protocol fields.
- `apps/api/src/services/usageEvents.ts` publishes usage/log events.

Keep streaming code at these boundaries. Do not add provider-specific parsing to an API route.

## Dashboard events

The dashboard uses the logs event stream for live request visibility. It is distinct from a model completion stream: one serves the client response, the other serves operator telemetry. The web hook is `apps/web/src/hooks/useLogsStream.ts`.

## Failure behavior

Provider retries and fallback decisions happen before or around execution according to the provider's contract. A stream can terminate with an upstream error after headers have been sent; clients should treat an incomplete stream as a failed request and inspect the gateway logs for the provider and request context.
