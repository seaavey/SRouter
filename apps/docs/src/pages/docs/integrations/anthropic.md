---
layout: ../../../layouts/DocsLayout.astro
title: Anthropic-compatible API
description: Connect Anthropic SDKs and clients to the SRouter messages endpoint.
section: Integrate
---

## TypeScript SDK

Use the same gateway base URL and a virtual API key:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
    baseURL: "http://localhost:3000/v1",
    apiKey: "sr-live-your_virtual_key"
});

const message = await client.messages.create({
    model: "anthropic/claude-3-7-sonnet",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello from SRouter" }]
});

console.log(message.content[0].text);
```

## HTTP endpoint

```http
POST /v1/messages
Authorization: Bearer sr-live-your_virtual_key
Content-Type: application/json
```

```bash
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sr-live-your_virtual_key" \
  -d '{
    "model": "anthropic/claude-3-7-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello from SRouter"}]
  }'
```

The route is authenticated and rate-limited before `MessagesController.CreateMessage` handles the request. Protocol mapping stays in the translator package so the HTTP route is not coupled to every provider implementation.

## Source

- Route: `apps/api/src/routes/v1/messages.ts`
- Controller: `apps/api/src/controllers/messages.controller.ts`
- Translator: `packages/translator/src/anthropic.ts`
