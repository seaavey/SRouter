# SRouter API

The SRouter API is the runtime gateway that sits between clients and upstream AI providers. It exposes OpenAI-compatible and Anthropic-compatible endpoints, manages provider connections, handles API-key authentication, records telemetry, and runs background OAuth token refresh for supported providers.

Part of the [`SRouter`](../../README.md) monorepo.

## What this app does

```text
Client / SDK
    │
    │ OpenAI or Anthropic compatible HTTP
    ▼
┌───────────────────────────────┐
│        SRouter API             │
│                               │
│ auth → validation → routing   │
│       ↘ translation           │
│       ↘ quota / logs          │
└───────────────┬───────────────┘
                │
                ▼
      Upstream AI providers
```

Core responsibilities include:

- OpenAI chat completions at `/v1/chat/completions`
- Anthropic messages at `/v1/messages`
- Model discovery at `/v1/models`
- Provider management, virtual API keys, settings, quotas, and audit logs
- API-key enforcement and Zod request validation
- OAuth callbacks and background token refresh
- Optional static serving of the built `apps/web` dashboard in production

## Development

From the repository root:

```bash
corepack enable
pnpm install
pnpm --filter api dev
```

The API listens on `http://localhost:3000` by default.

Useful root-level commands:

```bash
pnpm dev
pnpm build
pnpm test
pnpm --filter api test
```

The app is built with `tsup` and starts from `dist/index.js`:

```bash
pnpm --filter api build
pnpm --filter api start
```

## Endpoints

| Method     | Endpoint               | Purpose                                     |
| ---------- | ---------------------- | ------------------------------------------- |
| `GET`      | `/health`              | Health check                                |
| `GET`      | `/v1`                  | Gateway metadata / discovery                |
| `POST`     | `/v1/chat/completions` | OpenAI-compatible completion, including SSE |
| `POST`     | `/v1/chat/completion`  | Alias for chat completion                   |
| `POST`     | `/v1/messages`         | Anthropic-compatible messages               |
| `GET`      | `/v1/models`           | List available models                       |
| `GET`      | `/v1/models/:model`    | Inspect a model                             |
| `GET`      | `/v1/providers`        | List provider connections                   |
| `POST`     | `/v1/providers`        | Create or update provider configuration     |
| `DELETE`   | `/v1/providers/:id`    | Remove a provider                           |
| `GET`      | `/v1/keys`             | List virtual API keys                       |
| `POST`     | `/v1/keys`             | Create a virtual API key                    |
| `DELETE`   | `/v1/keys/:id`         | Revoke a key                                |
| `GET`      | `/v1/quota`            | Provider quota and reset data               |
| `GET`      | `/v1/logs`             | Request audit logs                          |
| `GET`      | `/v1/logs/stats`       | Usage statistics                            |
| `GET/POST` | `/v1/settings`         | Gateway configuration                       |

Provider authentication and OAuth callbacks are also mounted under the `/v1` API surface.

## Configuration

The app reads these gateway-level environment variables:

| Variable            | Default         | Description                                                            |
| ------------------- | --------------- | ---------------------------------------------------------------------- |
| `PORT`              | `3000`          | HTTP server port                                                       |
| `OAUTH_PORT`        | `1455`          | Local OAuth callback listener (skipped when `SROUTER_PUBLIC_URL` set)  |
| `SROUTER_PUBLIC_URL`| —               | Public origin (e.g. `https://app.herokuapp.com`); rewrites OAuth callback URLs to `/v1/auth/.../callback` on the main server |
| `DATABASE_PATH`     | `srouter.db`    | SQLite database path                                                   |
| `NODE_ENV`          | `development`   | Runtime environment                                                    |
| `WEB_DIST_PATH`     | `apps/web/dist` | Built dashboard path                                                   |

When `SROUTER_PUBLIC_URL` is configured the local `OAUTH_PORT` listener is
not bound — callback routes are served by the main listener, so the gateway
runs on platforms that expose only one port (Heroku).

For local development, the repository root `.env.example` can be copied to `.env`.

## Internal architecture

```text
src/
├── controllers/      # HTTP-level request orchestration
├── logic/            # Provider/auth business logic
├── middleware/       # Auth and request validation
├── routes/v1/        # API route definitions
├── services/         # Registry, OAuth refresh, web serving, etc.
└── index.ts          # Hono application entrypoint
```

The API depends on shared workspace packages for provider executors, translation, database access, pricing, constants, and domain types.

### OAuth token sweeper

Supported OAuth providers can be refreshed in the background. The sweeper runs every minute and attempts refresh shortly before an access token expires, reducing interruptions caused by short-lived credentials.

### Web dashboard serving

When `apps/web/dist/index.html` exists at the resolved web path, the API can serve the dashboard in production. Without a built dashboard, the root route falls back to API metadata instead.

## Testing

API tests use Node's test runner through `tsx`:

```bash
pnpm --filter api test
```

For a single test file during development, run the underlying `tsx --test` command against the desired file.

## Related packages

- [`apps/web`](../web/README.md) — React dashboard
- [`apps/cli`](../cli/README.md) — SRouter CLI
- [`packages/providers`](../../packages/providers/README.md) — provider registry and OAuth state
- [`packages/executors`](../../packages/executors/README.md) — upstream provider drivers
- [`packages/translator`](../../packages/translator/README.md) — protocol translation
- [`packages/db`](../../packages/db/README.md) — SQLite persistence
