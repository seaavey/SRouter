---
layout: ../../../layouts/DocsLayout.astro
title: Providers and routing
description: Configure provider edges, model prefixes, combos, and fallback behavior.
section: Build with SRouter
---

## Provider edges

SRouter keeps provider authentication and upstream protocol differences behind a single local gateway contract. The provider registry describes supported connections; OAuth and quota adapters add provider-specific behavior; executors perform the request.

| Provider family        | Prefix examples  | Auth path            |
| ---------------------- | ---------------- | -------------------- |
| Google Antigravity     | `antigravity/*`  | OAuth 2.0 PKCE       |
| OpenAI Codex / ChatGPT | `openai_codex/*` | OAuth 2.0 PKCE       |
| Anthropic Claude       | `anthropic/*`    | API key / OAuth      |
| OpenCode Zen           | `opencode_zen/*` | Free / access token  |
| Amazon Q / Kiro        | `kiro/*`         | SigV4 / API key      |
| Qoder                  | `qoder/*`        | OAuth / device token |
| Custom endpoint        | `custom/*`       | Custom headers       |

The canonical provider catalog lives in `packages/constants/src/providers`. The runtime registry is in `packages/providers/src/registry.ts`.

## Model prefixes

A prefixed model makes the route explicit at the client boundary:

```text
antigravity/gemini-3.7-flash-high
anthropic/claude-3-7-sonnet
custom/my-local-model
```

The client can keep one base URL while the gateway selects the provider from the model identifier.

## Combos and fallback

Combos define an ordered set of model routes. Fallback policy decides when the next route should be attempted, such as a rate-limit response or an upstream provider failure. The runtime implementation lives in `apps/api/src/logic/fallbackRunner.ts` and `apps/api/src/logic/fallback.policy.ts`.

Use combos when the client should express one logical model choice while the gateway owns the provider sequence. Use a direct prefix when the route itself must be visible and deterministic.

## Operational controls

Provider connections can expose custom models, hidden models, enabled state, and round-robin behavior. Mutations are admin-protected; read paths use the virtual API key boundary where appropriate. The dashboard surfaces provider management under `apps/web/src/routes/providers` and combo management under `apps/web/src/routes/combo.tsx`.
