---
layout: ../../../layouts/DocsLayout.astro
title: OpenAI-compatible API
description: Connect OpenAI SDKs and clients to SRouter chat completions.
section: Integrate
---

## Base URL and key

Set the client base URL to `http://localhost:3000/v1` and use a virtual API key created in the dashboard.

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sr-live-your_virtual_key"
)

response = client.chat.completions.create(
    model="antigravity/gemini-3.7-flash-high",
    messages=[{"role": "user", "content": "Ping!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

## HTTP endpoint

```http
POST /v1/chat/completions
Authorization: Bearer sr-live-your_virtual_key
Content-Type: application/json
```

The compatibility route validates `ChatCompletionRequestSchema`, enforces rate and model access limits, then calls `ChatController.CreateCompletion`.

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sr-live-your_virtual_key" \
  -d '{
    "model": "antigravity/gemini-3.7-flash-high",
    "messages": [{"role": "user", "content": "Ping!"}],
    "stream": true
  }'
```

## Model discovery

Use `GET /v1/models` to list available models and `GET /v1/models/:model` to inspect a specific identifier. The model must be visible to the virtual key and available through a connected provider.

## Source

- Route: `server/src/features/gateway/routes.rs`
- Schema: `server/src/features/gateway/translation/types.rs`
- Handler: `server/src/features/gateway/chat.rs`
- Translation and provider drivers: `server/src/features/gateway/translation` and `server/src/features/providers`
