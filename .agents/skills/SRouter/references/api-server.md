# API Server Reference — apps/api

## Table of Contents

1. [Architecture](#architecture)
2. [File Structure](#file-structure)
3. [Server Entry Point](#server-entry-point)
4. [Route Map](#route-map)
5. [Middleware Pipeline](#middleware-pipeline)
6. [Chat Execution Engine](#chat-execution-engine)
7. [OAuth PKCE Flows](#oauth-pkce-flows)
8. [Token Sweeper](#token-sweeper)
9. [Provider Registry](#provider-registry)
10. [Tool Interception](#tool-interception)
11. [Error Handling](#error-handling)
12. [Admin Auth System](#admin-auth-system)

---

## Architecture

The API follows a clean layered architecture:

```
Routes → Controllers → Logic → Services / DB / Executors
```

### File Structure

```
apps/api/src/
├── index.ts                    # Dual Hono server (port 3000 + 1455)
├── controllers/                # Request handlers
│   ├── auth.controller.ts      # OAuth login/callback/import
│   ├── chat.controller.ts      # OpenAI chat completions
│   ├── messages.controller.ts  # Anthropic messages proxy
│   ├── models.controller.ts    # Model catalog
│   ├── providers.controller.ts # Provider management
│   ├── keys.controller.ts      # Virtual API keys
│   ├── quota.controller.ts     # Quota metrics
│   ├── logs.controller.ts      # Audit logs
│   ├── settings.controller.ts  # System settings
│   ├── fallbacks.controller.ts # Fallback rules CRUD
│   └── tokenSaver.controller.ts # Token saver config
├── logic/                      # Business logic
│   ├── auth.logic.ts           # PKCE generation, session lifecycle
│   ├── auth.providers.ts       # Provider metadata & executor factories
│   ├── chat.logic.ts           # Routing, fallbacks, tool interception, logging
│   ├── models.logic.ts         # Model registry, fuzzy resolution
│   ├── providers.logic.ts      # Catalog grouping, verification
│   ├── quota.logic.ts          # Quota aggregation
│   └── logs.logic.ts           # Log queries, pricing calculation
├── middleware/
│   ├── adminAuth.ts            # Admin session cookie auth
│   ├── apiKeyAuth.ts           # Virtual API key / admin bearer auth
│   └── validator.ts            # Zod request validation
├── routes/v1/                  # Route definitions
│   ├── admin.ts, auth.ts, chat.ts, keys.ts, logs.ts,
│   ├── messages.ts, models.ts, providers.ts, quota.ts, settings.ts
├── services/
│   ├── adminAuth.ts            # Scrypt hashing, session tokens
│   ├── registry.ts             # ProviderRegistry instance & seeding
│   ├── tokenRefresh.ts         # Background sweeper & lazy refresh
│   ├── toolInterceptor.ts      # Search tool call interception
│   └── webDist.ts              # Static dashboard path resolution
└── utils/
    └── response.ts             # Standardized ok() / err() helpers
```

### Key Dependencies

- `hono` + `@hono/node-server` — HTTP framework
- `@hono/zod-validator` + `zod` — Request validation
- Internal: `@srouter/db`, `@srouter/executors`, `@srouter/providers`, `@srouter/translator`, `@srouter/pricing`, `@srouter/constants`, `@srouter/types`

---

## Server Entry Point

**Dual server architecture** (`src/index.ts`):

1. **Primary listener (port 3000):**
    - All API routes under `/v1`
    - Embedded SPA serving (static files from `apps/web/dist`)
    - Model registry warming on startup

2. **Secondary listener (port 1455):**
    - OAuth redirect callbacks (`/auth/*/callback`)
    - Also mounts `/v1/messages`, `/v1/chat`, `/v1/models` for CLI tools configured on this port

### Startup sequence:

1. Database seeding (`seedDefaultProviders()`, `loadSavedProvidersFromDB()`)
2. Token sweeper start (`startTokenRefreshSweeper()`)
3. HTTP listeners bind
4. Model cache warming (`warmModelRegistry()`)

---

## Route Map

### Core API

| Method | Path                   | Auth   | Purpose                             |
| ------ | ---------------------- | ------ | ----------------------------------- |
| `POST` | `/v1/chat/completions` | apiKey | OpenAI chat completion (JSON + SSE) |
| `POST` | `/v1/messages`         | apiKey | Anthropic messages (translated)     |
| `GET`  | `/v1/models`           | apiKey | List all available models           |
| `GET`  | `/v1/models/:model`    | apiKey | Model details by ID                 |
| `GET`  | `/health`              | none   | Health check                        |

### Management

| Method     | Path                    | Auth         | Purpose                  |
| ---------- | ----------------------- | ------------ | ------------------------ |
| `GET/POST` | `/v1/providers`         | apiKey/admin | List/add providers       |
| `GET`      | `/v1/providers/catalog` | apiKey       | Grouped provider catalog |
| `POST`     | `/v1/providers/verify`  | admin        | Test upstream connection |
| `DELETE`   | `/v1/providers/:id`     | admin        | Remove provider          |
| `GET/POST` | `/v1/keys`              | apiKey/admin | List/create virtual keys |
| `DELETE`   | `/v1/keys/:id`          | admin        | Revoke key               |
| `GET/POST` | `/v1/settings`          | apiKey/admin | Read/update settings     |
| `GET`      | `/v1/logs`              | apiKey       | Request audit logs       |
| `GET`      | `/v1/logs/stats`        | apiKey       | Usage + cost aggregates  |
| `GET`      | `/v1/quota`             | apiKey       | Provider quota + limits  |

### OAuth (`/v1/auth/{provider}/...`)

Each OAuth provider has: `login`, `callback`, `token/import-token` endpoints.
Supported: `openai`, `antigravity`, `claude`, `codebuddy`, `qoder`

### Admin (`/v1/admin/...`)

`status`, `setup`, `login` (rate-limited: 5 attempts/15min), `change-password`, `logout`

### Settings Extensions

| Method       | Path                            | Purpose             |
| ------------ | ------------------------------- | ------------------- |
| `GET/PUT`    | `/v1/settings/token-saver`      | Token saver config  |
| `POST`       | `/v1/settings/token-saver/test` | Preview compression |
| `GET/POST`   | `/v1/settings/fallbacks`        | Fallback rules      |
| `PUT/DELETE` | `/v1/settings/fallbacks/:id`    | Update/delete rule  |

---

## Middleware Pipeline

### 1. `apiKeyAuth` (most routes)

- Bypasses if admin session cookie is present
- If `requireApiKey` is disabled and no key provided: access permitted
- Extracts from `x-api-key`, `Authorization: Bearer`, or raw `Authorization`
- Validates against `api_keys` table
- Returns 401 with `invalid_api_key` or `missing_api_key`

### 2. `adminAuth` (management routes)

- Reads `srouter_admin_session` cookie
- SHA-256 hashes cookie, queries `admin_sessions` table
- Cleans expired sessions lazily
- Returns 401 `authentication_required` on failure

### 3. `validateJson` (chat routes)

- Wraps Zod schema validation
- Catches empty/malformed JSON
- Returns OpenAI-standard 400 `invalid_request_error`

---

## Chat Execution Engine

The chat execution flow in `chat.logic.ts`:

1. **Token Saver** — Compress prompts via regex rules
2. **Model Resolution** — Direct lookup or combo alias → cascade
3. **Fallback Cascade** — Build candidate array from `fallback_rules`
4. **Fresh Token Check** — `ensureFreshToken()` for OAuth providers
5. **Execute** — Forward to provider executor
6. **Tool Interception** — Intercept search tool calls if not client-defined
7. **Usage Extraction** — prompt/completion/cached/reasoning tokens
8. **Cost Estimation** — via `@srouter/pricing`
9. **Audit Log** — Record everything to `request_logs`

### Fallback triggers:

HTTP 429, 403, 5xx, missing provider driver, rate limit exhaustion, upstream connection failure

---

## OAuth PKCE Flows

### Lifecycle:

1. **Login** → Generate `codeVerifier`, `codeChallenge` (S256), `state`
2. **Store** → Save session in SQLite `oauth_sessions` (15-min TTL)
3. **Redirect** → Send user to provider auth URL
4. **Callback** → Listen on port 3000 AND 1455 (GET + POST)
5. **Exchange** → Validate `state`, exchange `code` + `code_verifier`
6. **Register** → Insert provider row, instantiate executor, register in registry
7. **Response** → HTML page with `postMessage({ type: "SROUTER_OAUTH_SUCCESS" })`

### Provider-specific configurations in `auth.providers.ts`:

Each provider has: `idPrefix`, `displayName`, `oauthClass`, `clientId()`, `defaultRedirectUri`, `mapOAuthTokens`, `buildExecutor`

---

## Token Sweeper

Background daemon in `tokenRefresh.ts`:

### Configuration:

- `REFRESH_LEAD_MS`: 5 minutes before expiration
- `SWEEP_INTERVAL_MS`: 60 seconds
- `inFlightRefreshes`: Deduplication map preventing concurrent refresh stampedes

### Refresh conditions (`isDueForRefresh`):

- No `refreshToken` → never due
- No `accessToken` → due immediately
- `tokenExpiresAt` set → due if `now >= expiry - 5min`
- No expiry recorded → due if never refreshed or `> 12h` since last refresh

### Execution:

1. **Background sweep** — 5s initial delay, then every 60s. Timers use `.unref()`.
2. **Single refresh** — OAuth client refresh → update SQLite → update live executor
3. **Lazy pre-route** — `ensureFreshToken()` called before every chat execution

---

## Provider Registry

Global singleton in `registry.ts`:

### Seeding:

- Iterates `DEFAULT_PROVIDERS` from `@srouter/constants`
- Inserts catalog metadata with `{ __is_seed_driver: "true" }`
- Cleans stale seeds, updates modified configs

### Loading:

- Reads `providers` table (enabled, non-seed)
- Dynamically constructs executor instances
- Registers in live `ProviderRegistry`

### Model warming:

- `warmModelRegistry()` → `registry.refreshModels()` on startup

---

## Tool Interception

`toolInterceptor.ts` — Server-side search tool call handling:

- Intercepts: `web_search`, `google_search`, `duckduckgo_search`, `brave_search`, `bing_search`
- Only when NOT explicitly defined by client
- Executes via `performWebSearch`
- Appends synthetic tool results to messages
- Re-submits upstream (max depth: 3)

---

## Error Handling

### Global handler patterns:

- `HTTPException` → `{ error: { message, type: "invalid_request_error", code } }`
- `SyntaxError` (JSON) → 400 `invalid_json`
- Unhandled → 500 `internal_error`
- Streaming errors → SSE data chunk with error object before close
- Anthropic protocol → `{ type: "error", error: { type, message } }`

### Response helpers:

- `ok(c, data, status?)` — Success response
- `err(c, message, status?, code?)` — Error response

---

## Admin Auth System

### Password security:

- Scrypt hashing for admin password
- Session tokens stored as SHA-256 hashes
- Loopback detection for initial setup

### Session management:

- Cookie-based (`srouter_admin_session`)
- Configurable secure cookies via `SROUTER_SECURE_COOKIES`
- Lazy expired session cleanup

### Remote setup:

- `SROUTER_SETUP_TOKEN` env var for non-localhost initial setup
