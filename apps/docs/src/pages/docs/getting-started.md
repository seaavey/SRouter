---
layout: ../../layouts/DocsLayout.astro
title: Getting started
description: Run SRouter locally, connect a provider, and send your first request through the gateway.
section: Start here
---

## Connect a provider

After [installing SRouter](/docs/installation/), open the dashboard at `http://localhost:3000` and open **Providers**. Complete the authentication flow for one supported provider before sending a model request.

The provider connection owns the upstream credential. Your clients should use a SRouter virtual key instead of the provider's original credential.

## Create a virtual key

Open **API Keys** in the dashboard and create a key for the client or tool that will use the gateway. Configure limits when needed:

- request rate limit;
- token quota;
- credit limit;
- expiration;
- model scope.

Use the generated key as the `Authorization: Bearer ...` value. Do not copy provider credentials into client configuration.

## Configure the gateway

The default gateway URL is:

```text
http://localhost:3000/v1
```

For local source development, the API runs on `3000`, the React dashboard runs on `5173`, and the OAuth callback listener uses `1455`. Docker serves the built dashboard and API from the main `3000` port.

Set environment variables only when the defaults do not fit your setup:

| Variable             | Default                         | Purpose                      |
| -------------------- | ------------------------------- | ---------------------------- |
| `PORT`               | `3000`                          | Main API and dashboard port  |
| `OAUTH_PORT`         | `1455`                          | OAuth callback listener      |
| `DATABASE_PATH`      | `~/.srouter/srouter.db` locally | SQLite database path         |
| `DATABASE_URL`       | Not set                         | PostgreSQL connection string |
| `SROUTER_PUBLIC_URL` | Not set                         | Public OAuth callback URL    |

## Send a request

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

The gateway also exposes the Anthropic-compatible `POST /v1/messages` endpoint. See the [OpenAI integration](/docs/integrations/openai/) and [Anthropic integration](/docs/integrations/anthropic/) guides for SDK examples.

## If the request fails

1. Check that the API responds: `curl http://localhost:3000/health`.
2. Confirm the provider connection is active in the dashboard.
3. Confirm the virtual key is present and has not expired.
4. Confirm the model prefix matches a connected provider.
5. Inspect request logs for validation or upstream errors.

Continue with [API routes](/docs/reference/api-routes/) or [Errors and limits](/docs/reference/errors/) when you need the exact HTTP surface.
