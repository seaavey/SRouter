---
name: srouter
description: |
  Complete development guide for the SRouter project — a local-first AI gateway and LLM proxy router built with Hono, TypeScript, SQLite WAL, and React 19. Use this skill whenever working on the SRouter codebase: adding providers, modifying the API gateway, editing the web dashboard, updating the CLI, writing tests, debugging routing/OAuth/streaming issues, managing the monorepo, or understanding the architecture. Trigger on any mention of SRouter, AI gateway, LLM proxy, provider routing, virtual API keys, model combo/failover, token saver, OAuth PKCE token refresh, quota monitoring, or any work inside the SRouter monorepo at /home/seaavey/Projects/SRouter. Also trigger when the user mentions provider executors, chat completions proxy, Anthropic Messages translation, or the @srouter/* packages.
---

# ⚡ SRouter — Development Skill

> Local-first AI gateway & LLM proxy for OpenAI-, Anthropic-, and custom-compatible providers.

This skill contains everything you need to work effectively on the SRouter codebase. It covers architecture, conventions, every package, the API server, web dashboard, CLI, and common development workflows.

## Quick Orientation

SRouter is a **pnpm + Turborepo monorepo** that gives developers one stable API while routing requests to many upstream AI providers. The core value: you configure providers once in SRouter, and all your tools (Cursor, Claude Code, OpenCode, Aider, SDKs, cURL) talk to `localhost:3000` with a single `sr-live-*` virtual key.

```
/home/seaavey/Projects/SRouter/
├── apps/
│   ├── api/          # Hono REST API server, OAuth, token sweeper
│   ├── cli/          # @srouter/cli — tool linking & diagnostics
│   └── web/          # React 19 dashboard (TanStack Router, Tailwind v4)
├── packages/
│   ├── constants/    # Model catalogs, provider presets, shared definitions
│   ├── db/           # SQLite WAL repository layer (node:sqlite)
│   ├── executors/    # Provider drivers — one per upstream provider
│   ├── pricing/      # Token cost estimation & model pricing
│   ├── providers/    # Provider registry, OAuth state, coordinator
│   ├── translator/   # OpenAI ↔ Anthropic protocol translation
│   └── types/        # Domain models, Zod schemas, TypeScript interfaces
├── turbo.json        # Turborepo pipeline configuration
├── pnpm-workspace.yaml
├── Dockerfile        # Multi-stage production build
└── docker-compose.yml
```

**Ports:**
- `3000` — API gateway + production dashboard
- `5173` — Vite dev server (dashboard, dev mode only)
- `1455` — OAuth PKCE callback listener

## Tech Stack

| Layer         | Technology                                              |
| ------------- | ------------------------------------------------------- |
| Runtime       | Node.js ≥22 (required for native `node:sqlite`)         |
| Language      | TypeScript 5.8, ESM (`"type": "module"`)                |
| HTTP server   | Hono v4.13                                              |
| Database      | SQLite WAL via `node:sqlite` (zero external deps)       |
| Frontend      | React 19, TanStack Router, TanStack Table v8            |
| Styling       | Tailwind CSS v4, Base UI                                |
| Package mgr   | pnpm 11.20.0 (via Corepack)                             |
| Build system  | Turborepo, esbuild (API), Vite (web)                    |
| CI/CD         | GitHub Actions (Node 22+24 matrix, GHCR Docker publish) |
| Formatting    | Prettier (4-space indent, double quotes, no trailing commas) |

## Code Conventions

These conventions apply throughout the codebase. Follow them in all new code.

### Formatting (Prettier)
- **Tab width**: 4 spaces
- **Quotes**: Double quotes (`"`)
- **Print width**: 100 characters
- **Trailing commas**: None
- Run `pnpm format:check` to verify, `pnpm format` to auto-fix

### Commits
Use **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `perf:`, `chore:`
Scope is optional but helpful: `feat(quota): add live quota tracking`

### Module System
All packages use ESM (`"type": "module"`). Use `import`/`export` syntax, never `require()`.

### TypeScript
- Strict mode enabled
- Zod for runtime validation (schemas in `@srouter/types`)
- Prefer interfaces over type aliases for object shapes
- Use `satisfies` operator for type narrowing where helpful

---

## Architecture Deep Dive

For detailed information on each component, read the corresponding reference file:

- **API Server & Routing** → read [references/api-server.md](references/api-server.md)
- **Provider Executors** → read [references/executors.md](references/executors.md)
- **Provider Registry & Circuit Breaker** → read [references/providers.md](references/providers.md)
- **Database Layer** → read [references/database.md](references/database.md)
- **Web Dashboard** → read [references/web-dashboard.md](references/web-dashboard.md)
- **CLI** → read [references/cli.md](references/cli.md)
- **Translation Layer** → read [references/translator.md](references/translator.md)
- **Constants, Types & Pricing** → read [references/constants-types-pricing.md](references/constants-types-pricing.md)

### Request Flow (High Level)

```
Client request (OpenAI or Anthropic format)
  │
  ▼
┌─────────────────────────────────────┐
│ Hono Middleware Pipeline            │
│  1. CORS                            │
│  2. Global error handler            │
│  3. Auth (virtual key validation)   │
│  4. Body parser (malformed JSON)    │
│  5. Token saver (prompt compress)   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Route Handler                       │
│  • /v1/chat/completions (OpenAI)    │
│  • /v1/messages (Anthropic)         │
│  • /v1/models                       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Model Resolution                    │
│  • Direct model → executor lookup   │
│  • Combo alias → failover cascade   │
│  • Case-insensitive matching        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Provider Executor                   │
│  • Translate if needed (via         │
│    @srouter/translator)             │
│  • Forward to upstream API          │
│  • Stream SSE chunks back           │
│  • Normalize usage data             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Response                            │
│  • Standardized OpenAI/Anthropic    │
│    format back to client            │
│  • Request logged to SQLite         │
│  • Cost estimated via @srouter/     │
│    pricing                          │
└─────────────────────────────────────┘
```

### Provider System

SRouter supports 14+ providers. Each provider has:
1. **An executor** in `packages/executors/src/` — handles the actual HTTP call to the upstream API
2. **A registry entry** in `packages/providers/` — manages credentials, OAuth state, health
3. **A constants entry** in `packages/constants/` — model catalogs, branding, presets

**Provider categories:**

| Category          | Providers                                                     | Auth Type              |
| ----------------- | ------------------------------------------------------------- | ---------------------- |
| OAuth PKCE        | Antigravity, OpenAI Codex, Qoder, CodeBuddy                  | OAuth 2.0 + PKCE       |
| API Key (Bearer)  | Neosantara, GoRouter, BluesMinds, SeekAI, TabiToken, TokenRouter, CommandCode | Bearer token |
| AWS SigV4         | Kiro (Amazon Q)                                               | AWS credentials        |
| Mixed             | Anthropic (API key or OAuth)                                  | Configurable           |
| Custom            | User-defined endpoints                                        | Custom                 |

### Model Combo & Failover

The combo system lets users define multi-step failover chains:
```
combo/my-flagship → Step 1: anthropic/claude-3-7-sonnet
                  → Step 2: openai_codex/gpt-4o (failover)
                  → Step 3: antigravity/gemini-2.5-flash (backup)
```

Failover triggers on: HTTP 429, 403, 5xx, missing provider driver, rate limit exhaustion, upstream connection failure.

### Virtual API Keys

Keys are prefixed `sr-live-*` and support:
- Configurable expiration
- Rate limits
- Usage quotas
- Token tracking
- Enforcement mode (required vs open access)

### Token Saver

Multi-stage prompt compression before LLM execution:
1. Whitespace compaction
2. Redundant comment stripping
3. Repetitive string compression

### OAuth & Token Sweeper

- Dedicated OAuth callback server on port 1455
- Background sweeper daemon runs every 60 seconds
- Refreshes tokens before expiry with configurable lead time
- Supports multiple concurrent OAuth sessions

---

## Common Development Tasks

### Adding a New Provider

This is the most common extension point. Read [references/executors.md](references/executors.md) for the full guide. Quick checklist:

1. **Create executor** in `packages/executors/src/<provider-name>.ts`
   - Implement the executor interface returning `ExecutorResult`
   - Handle streaming SSE and non-streaming responses
   - Normalize usage data (prompt_tokens, completion_tokens)

2. **Register in constants** — add to `packages/constants/src/`
   - Model catalog with capabilities (vision, reasoning)
   - Provider branding (name, logo URL, color)
   - Default base URL

3. **Add provider type** — update `packages/types/src/` with Zod schema

4. **Wire up in providers** — register in `packages/providers/src/`

5. **Add to web dashboard** — provider card in `apps/web/src/`

6. **Test** — add integration test in `apps/api/src/__tests__/`

### Modifying the Dashboard

Read [references/web-dashboard.md](references/web-dashboard.md). Key patterns:
- Routes defined via TanStack Router file-based routing
- API calls use custom hooks with `fetch` to `localhost:3000`
- Theme system: dark/light with View Transitions API
- Component library: Base UI + custom Tailwind components

### Running Development

```bash
pnpm dev          # Start all: API (3000) + Web (5173) + OAuth (1455)
pnpm build        # Build everything
pnpm test         # Run all tests
pnpm lint         # Lint
pnpm format:check # Check formatting
```

### Testing

- Tests live alongside source in `__tests__/` directories
- Integration tests for API routes test the full pipeline
- Clean up test data (providers, logs) after each test to avoid leaking into production SQLite
- Build packages before testing: `pnpm build && pnpm test`

### Docker

```bash
# Build and run locally
docker compose up -d

# View logs
docker compose logs -f

# Production image from GHCR
docker pull ghcr.io/seaavey/srouter:latest
```

Multi-stage Dockerfile: base (Node 22 alpine) → builder (install + build) → runner (minimal production image). The API serves the dashboard as embedded static files in production.

---

## Package Dependency Graph

```
apps/api
  └── @srouter/db
  └── @srouter/executors
  └── @srouter/providers
  └── @srouter/translator
  └── @srouter/pricing
  └── @srouter/constants
  └── @srouter/types

apps/web
  └── @srouter/types (shared interfaces)

apps/cli
  └── @srouter/types

packages/executors
  └── @srouter/types
  └── @srouter/constants

packages/providers
  └── @srouter/db
  └── @srouter/types

packages/translator
  └── @srouter/types

packages/pricing
  └── @srouter/constants
  └── @srouter/types
```

When modifying a package, consider downstream impacts. Turborepo handles build ordering via `dependsOn: ["^build"]`.

---

## Gotchas & Important Notes

1. **Node ≥22 is required** — `node:sqlite` is a native Node.js module only available in v22+. The project will not run on older versions.

2. **WAL mode** — SQLite runs in WAL (Write-Ahead Logging) mode for concurrent reads during writes. Don't switch to journal mode.

3. **Hono, not Express** — The API uses Hono, not Express. Middleware and routing patterns are different. Context is accessed via `c` parameter, not `req`/`res`.

4. **ESM only** — All packages are ESM. No CommonJS `require()`. Use `import` for everything.

5. **No external database** — SQLite is embedded. No Redis, no Postgres. Keep it that way unless there's a very compelling reason.

6. **Provider credentials are local** — Stored in SQLite, never phoned home. This is a core security promise.

7. **Port 1455** — The OAuth callback port is hardcoded in many OAuth providers' redirect URIs. Changing it breaks OAuth flows.

8. **Turborepo caching** — Dev and start tasks have `"cache": false`. Build outputs go to `dist/**`.

9. **pnpm workspace protocol** — Internal packages use `workspace:*` protocol in package.json. Don't replace with version numbers.

10. **Test isolation** — Always clean up test artifacts (providers, logs) in integration tests to prevent pollution of the production database.
