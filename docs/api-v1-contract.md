# API v1 Contract and Rust Migration Boundary

This document freezes the behavior visible at the `apps/api` HTTP boundary for the Rust migration. It records route wiring, controller behavior, middleware, and API test evidence. It does not reproduce source or data from `packages/*`. Request schemas imported from `@srouter/types` are described only where their fields are visible in API controllers or API tests.

## Scope and sources

- Retain the route behavior listed below in the Rust API.
- Exclude Cloudflare Tunnel routes and startup work from Rust. They remain available in the Node API during the fallback period and become unavailable after Rust cutover.
- Use `apps/api/src/index.ts`, route/controller/middleware/service/logic files, and `apps/api/tests/*.test.ts` as the contract evidence. Use the Node API only as a temporary black-box comparison target.
- Do not inspect, copy, or use `packages/*` code or data as Rust source, seed data, or code-generation input.
- The request and response schema definitions imported from `@srouter/types` are outside the allowed source boundary. This document records visible fields and observable outcomes; it does not infer fields that the controller and API tests do not expose.

## Listeners and top-level routes

<!-- prettier-ignore -->
| Listener | Method and path | Behavior |
| --- | --- | --- |
| Main | `GET /health` | Returns `{"status":"ok"}`. |
| Main | `GET /v1` | Returns API name, status, version, and documentation description. |
| Main | `GET /` | Serves the web SPA when the configured web dist has `index.html`; otherwise returns the API information object. |
| OAuth | `GET`, `POST /auth/callback` | OpenAI OAuth callback. |
| OAuth | `GET`, `POST /auth/antigravity/callback` | Antigravity OAuth callback. |
| OAuth | `GET`, `POST /auth/claude/callback` | Claude OAuth callback. |
| OAuth | `GET`, `POST /auth/qoder/callback` | Qoder OAuth callback. |

The main listener uses `PORT` (default `3000`). The OAuth listener uses `OAUTH_PORT` (default `1455`) and `OAUTH_HOST` (default `0.0.0.0`). `SROUTER_PUBLIC_URL`, when nonempty, suppresses the OAuth listener; public callback URLs use the main listener's `/v1/auth/.../callback` routes. Local callback URLs use the OAuth listener. User-provided non-local callback URLs pass through unchanged.

The OAuth listener also mounts `/v1/messages`, `/v1/chat/completions`, `/v1/chat/completion`, `/v1/models`, and `/v1/models/:model`. It does not use the main app's global security-header, CORS, CSRF, or body-limit middleware; feature-level authentication and validation still apply.

<!-- prettier-ignore -->
| Environment variable | Behavior |
| --- | --- |
| `PORT` | Main HTTP listener; default `3000`. |
| `OAUTH_PORT` | OAuth listener; default `1455`. |
| `OAUTH_HOST` | OAuth bind host; default `0.0.0.0`. |
| `SROUTER_PUBLIC_URL` | Public callback base URL; suppresses the secondary OAuth listener when set. |
| `SROUTER_CORS_ORIGINS` | Comma-separated public CORS allowlist. |
| `SROUTER_ADMIN_PASSWORD` | Optional admin bootstrap/reset password, applied at startup when set. |
| `SROUTER_SECURE_COOKIES` | Sets the admin session cookie's `Secure` flag when equal to `true`. |
| `WEB_DIST_PATH` | Overrides the web dist path. Without it, the API searches repository and app-relative `dist` candidates. |
| `DATABASE_PATH` | Overrides the default SQLite database path, `~/.srouter/srouter.db`. |
| `DATABASE_URL` | Selects PostgreSQL storage when configured. |
| `CLAUDE_OAUTH_CLIENT_ID` | Overrides the Claude OAuth client ID. |

## Retained route inventory

“API-key auth” means the shared middleware accepts a valid admin session or API key. When API keys are not required, requests from loopback clients can omit a key; non-loopback requests still require one. “Admin session” means the `srouter_admin_session` cookie verified by the admin-session middleware. Methods on one row share the row's stated input and behavior unless noted.

<!-- prettier-ignore -->
| Feature | Method and path | Auth | Input and observable behavior |
| --- | --- | --- | --- |
| Admin auth | `GET /v1/admin/status` | None | Returns `setupRequired` and `authenticated`. |
| Admin auth | `POST /v1/admin/setup` | None; loopback-only | JSON `password`, `confirmation`; password must contain 1–128 characters. Creates the first admin and session cookie; `201`. Rejects remote setup (`403`) and repeated setup (`409`). |
| Admin auth | `POST /v1/admin/login` | None | JSON `password`; success sets the session cookie. Invalid credentials return `401`; five failed attempts per client address cause a 15-minute `429` block. |
| Admin auth | `POST /v1/admin/change-password` | Admin session | JSON `current_password`, `new_password`, `confirmation`; updates the password. |
| Admin auth | `POST /v1/admin/logout` | Admin session | Revokes the session, clears its cookie, and returns `204`; an invalid session returns `401` and clears the cookie. |
| Provider auth | `/v1/auth/cline/device` (`GET`), `/v1/auth/cline/poll` (`GET`, `POST`) | Admin session | Device authorization and state polling; poll reads `state` from the query or JSON body. |
| Provider auth | `/v1/auth/cline/token` (`POST`) | Admin session | Validated token-import JSON; success returns provider data and `201`. |
| Provider auth | `/v1/auth/{openai,antigravity,claude,qoder}/login` (`GET`) | Admin session | OAuth start. Reads optional `client_id`, `redirect_uri`, `prompt`, and `format=json`; otherwise redirects to the authorization URL. |
| Provider auth | `/v1/auth/{openai,antigravity,claude,qoder}/callback` (`GET`, `POST`) | None | Reads `code` and `state` from query, POST JSON, or `callback_url`; success returns the connected provider. Missing values return `400`. |
| Provider auth | `/v1/auth/{openai,antigravity,claude,qoder}/token` (`POST`) | Admin session | Validated token-import JSON; success returns provider data and `201`. |
| Provider auth | `/v1/auth/{commandcode,anthropic,atria,tokenrouter}/token` (`POST`) | Admin session | Validated token-import JSON; success returns provider data and `201`. |
| Provider auth | `/v1/auth/{codebuddy,codebuddy-cn}/login` (`GET`) | Admin session | Device OAuth start; returns authorization URL and state for `format=json`, otherwise redirects. |
| Provider auth | `/v1/auth/{codebuddy,codebuddy-cn}/poll` (`GET`, `POST`) | Admin session | Poll reads state from query or JSON body and returns the device-flow result. |
| Provider auth | `/v1/auth/{codebuddy,codebuddy-cn}/token` (`POST`) | Admin session | Validated token-import JSON; success returns provider data and `201`. |
| Chat gateway | `/v1/chat/completions`, `/v1/chat/completion` (`POST`) | API-key auth, rate limit, model access | Validated chat-completion JSON. `developer` messages are normalized to `system`. Non-streaming returns an OpenAI-compatible completion; streaming returns SSE chunks followed by `[DONE]`. API-key requests reserve the requested `max_tokens` budget (default `4096`). |
| Messages gateway | `/v1/messages` (`POST`) | API-key auth, rate limit, model access | Anthropic Messages JSON, including the `model`, `messages`, `max_tokens`, and optional `stream` fields used by API tests. Honors `anthropic-version`; non-streaming returns an Anthropic message and streaming emits Anthropic SSE events. |
| Models | `/v1/models` (`GET`) | API-key auth | Returns `{object:"list", data:[...]}` and `Cache-Control: public, max-age=60, stale-while-revalidate=300`. `refresh=true` or `force=true` forces a refresh; `Cache-Control: no-cache` or `no-store` requests background revalidation. API-key model allowlists filter the list. |
| Models | `/v1/models/:model` (`GET`) | API-key auth | Returns the model or `404`; checks API-key model allowlists and accepts `refresh=true` or `force=true`. |
| Pricing | `/v1/pricing/models` (`GET`) | API-key auth | Returns the pricing model list with `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`; `refresh=true`, `force=true`, or request `no-cache`/`no-store` forces refresh. |
| Images | `/v1/images/generations` (`POST`) | API-key auth, rate limit, model access | Validated image-generation JSON. API tests exercise `prompt` and `model`. Returns provider image output; unsupported image models return `400`. |
| API keys | `/v1/keys` (`GET`) | Admin session | Returns `{object:"list", data:[...]}`. |
| API keys | `/v1/keys` (`POST`) | Admin session | JSON fields visible in the controller: `name`, `enabled`, `rate_limit`, `quota_limit`, `credit_limit`, and `allowed_models`; creates a key and returns `201`. |
| API keys | `/v1/keys/:id` (`PATCH`) | Admin session | Validated partial key update; returns the updated key, `404` for a missing key. |
| API keys | `/v1/keys/:id/credit` (`POST`) | Admin session | JSON `amount`; returns the updated key or `404`. |
| API keys | `/v1/keys/:id` (`DELETE`) | Admin session | Revokes and deletes a key; returns a message or `404`. |
| Providers | `/v1/providers` (`GET`) | API-key auth | Returns `{object:"list", data:[...]}`. |
| Providers | `/v1/providers/catalog` (`GET`) | API-key auth | Returns the provider catalog. |
| Providers | `/v1/providers/:providerId` (`GET`) | API-key auth | Returns provider details or `404`. |
| Providers | `/v1/providers/verify` (`POST`) | Admin session | Validated connection-verification JSON; returns the verification result. |
| Providers | `/v1/providers/connections/verify` (`POST`) | Admin session | JSON `connection_id`; returns verification result, `400` for invalid input, `404` when the saved connection is missing. |
| Providers | `/v1/providers` (`POST`) | Admin session | Validated provider JSON; creates a provider connection. |
| Providers | `/v1/providers/:id` (`DELETE`) | Admin session | Deletes a connection or returns `404`; refreshes the live registry. |
| Providers | `/v1/providers/:providerId/models` (`POST`) | Admin session | JSON `model_id`; adds a custom model and returns `201`. |
| Providers | `/v1/providers/:providerId/models/:modelId` (`DELETE`) | Admin session | Removes a custom model; returns a message or `404`. |
| Providers | `/v1/providers/:providerId/round-robin` (`PATCH`) | Admin session | JSON `enabled`; changes round-robin behavior. |
| Providers | `/v1/providers/:providerId/enabled` (`PATCH`) | Admin session | JSON `enabled`; changes provider availability. |
| Providers | `/v1/providers/:providerId/hidden-models` (`GET`) | API-key auth | Returns `{models:[...]}`. |
| Providers | `/v1/providers/:providerId/hidden-models` (`POST`) | Admin session | JSON `model_id`; hides a model and returns `201`. |
| Providers | `/v1/providers/:providerId/hidden-models/:modelId` (`DELETE`) | Admin session | Restores a model; returns a message or `404`. |
| Favorites | `/v1/favorites` (`GET`) | API-key auth | Returns `{models:[...]}`. |
| Favorites | `/v1/favorites` (`POST`) | Admin session | JSON `model_id`; adds a favorite and returns `201`. |
| Favorites | `/v1/favorites/:modelId` (`DELETE`) | Admin session | Removes a favorite or returns `404`. |
| Quota | `/v1/quota`, `/v1/qouta` (`GET`) | API-key auth | Returns provider OAuth quota data. `refresh=true` or `force=true` requests a refresh. `/qouta` is a retained compatibility spelling. |
| Logs | `/v1/logs` (`GET`) | API-key auth | Returns recent logs (`limit`, default `50`) or paginated logs (`page`, default `1`, plus `limit` and optional `status=all\|success\|error`). |
| Logs | `/v1/logs/:id` (`GET`) | API-key auth | Returns an enriched log or `404`. |
| Logs | `/v1/logs/stats` (`GET`) | API-key auth | Returns aggregate usage statistics. |
| Logs | `/v1/logs/analytics` (`GET`) | API-key auth | Returns analytics for `window` (default `24h`); invalid windows return `400`. |
| Logs | `/v1/logs/events` (`GET`) | API-key auth | SSE stream: `connected`, `usage.updated`, optional `request.logged`, and `: ping` heartbeats every 25 seconds. Maximum 16 active streams; excess requests receive `429`. |
| Settings | `/v1/settings` (`GET`) | API-key auth | Returns `require_api_key`, compatibility field `requireApiKey`, and `settings`. |
| Settings | `/v1/settings` (`POST`, `PATCH`) | Admin session | Validated JSON can update `require_api_key` and string-valued `settings`; returns the updated settings object. |
| Fallbacks | `/v1/settings/fallbacks` (`GET`) | API-key auth | Returns `{fallbacks:[...]}`. |
| Fallbacks | `/v1/settings/fallbacks` (`POST`) | Admin session | Snake-case JSON fields `source_model`, `target_model`, and optional `priority`, `enabled`, `trigger_on_status`, `max_retries`; creates a rule and returns `201`. |
| Fallbacks | `/v1/settings/fallbacks/:id` (`PUT`, `PATCH`) | Admin session | Validated partial rule update; returns updated rule or `404`. |
| Fallbacks | `/v1/settings/fallbacks/:id` (`DELETE`) | Admin session | Deletes a rule; returns a message or `404`. |
| Database transfer | `/v1/admin/database/export` (`GET`) | Admin session only | Streams a snapshot as `application/octet-stream` with an attachment filename. API keys and loopback access do not replace an admin session. |
| Database transfer | `/v1/admin/database/import` (`POST`) | Admin session only | Accepts exactly one multipart file in field `database`, maximum 25 MiB. The main listener's global body limit returns `413` for an oversized `Content-Length`; the route maps an oversized chunked upload to `400` with `upload_too_large`. Validates before replacement, makes a recoverable backup, clears the admin cookie after success, and returns `ok`, `backup_path`, `restart_required`, and `reauth_required`. |

## Compatibility aliases and retired routes

The main listener mounts these compatibility paths under `/v1/v1`: `/chat/completions`, `/chat/completion`, `/messages`, `/models`, and `/models/:model`. They use the same route handlers and feature middleware as their `/v1` counterparts. The OAuth listener exposes only its `/v1` mounts, not `/v1/v1`.

`opencode-compat.test.ts` also assembles the route modules at `/` in a test-only Hono app. The production `index.ts` mounts them at `/v1` and `/v1/v1`; the test's root mounts do not add production root-level chat or model routes.

Rust intentionally has no `/v1/tunnel/*` routes. The legacy-only routes are `GET /v1/tunnel/status`, `GET /v1/tunnel/events`, `GET /v1/tunnel/install`, `POST /v1/tunnel/start`, `POST /v1/tunnel/stop`, `POST /v1/tunnel/install`, and `PUT /v1/tunnel/config`. They require an admin session in the Node API. `tunnel-auth.test.ts` is not a Rust parity requirement.

## Shared HTTP behavior

### Headers and CORS

The main listener adds `X-Powered-By: Seaavey`, `X-Version: <API_VERSION>`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, and `Referrer-Policy: strict-origin-when-cross-origin`. The exact API version comes from the existing API version constant.

When serving the web dist, asset paths ending in `js`, `css`, `map`, `woff`, `woff2`, `ttf`, `otf`, `png`, `svg`, `ico`, `webp`, `avif`, `jpg`, `jpeg`, or `gif` receive `Cache-Control: public, max-age=31536000, immutable`.

`SROUTER_CORS_ORIGINS` is a comma-separated allowlist. Loopback HTTP/HTTPS origins (`localhost`, `127.0.0.1`, and `[::1]`, with optional ports) are always allowed. CORS allows `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`; request headers `Content-Type`, `Authorization`, `x-api-key`, and `anthropic-version`; exposes `Content-Length`, `X-Request-Id`, and `X-Version`; and includes credentials.

### Authentication, CSRF, rate limits, and request size

- API-key middleware first accepts a valid admin session. Otherwise it reads `x-api-key` or `Authorization: Bearer ...` (a non-Bearer `Authorization` value is also treated as the key). API-key enforcement is on when the setting `require_api_key` is true or the client is not loopback.
- A disabled key returns `401`; exhausted credit returns `402`; exhausted token quota returns `429`; missing/invalid required keys return `401`. Model allowlists apply to model list/detail and gateway requests.
- Admin mutations use the `srouter_admin_session` cookie. The cookie is `HttpOnly`, path `/`, `SameSite=Lax`, and uses `Secure` only when `SROUTER_SECURE_COOKIES=true`; its max age is seven days.
- The CSRF guard applies to `POST`, `PUT`, `PATCH`, and `DELETE` under `/v1/*` only when the admin cookie is present. It checks `Origin`, then `Referer`; same-host requests and allowlisted origins pass. Requests without an Origin/Referer or without the admin cookie pass through.
- API-key rate limits use a fixed 60-second window per API-key ID and client address. A `rate_limit` of `0` means unlimited. A rejected request returns `429`, `code=rate_limit_exceeded`, and `Retry-After`.
- Global body middleware rejects `Content-Length` above 25 MiB with `413` and `code=request_too_large`. Chat JSON validation and Anthropic message parsing also cap the actual body size, including chunked bodies.
- Provider verification rejects non-HTTP(S), unresolved, private, loopback, link-local, CGNAT, multicast, and metadata-service URL targets. Redirects must not bypass this validation.
- Chat JSON validation returns `400` for empty, malformed, or schema-invalid JSON. The Anthropic messages endpoint uses its Anthropic error envelope and separately rejects invalid JSON and oversized bodies.

### Error envelopes

Standard API errors use `{error:{message,type,code?,param?}}`. Status-based types are `invalid_request_error` for `400`, `404`, `409`, and `422`; `authentication_error` for `401`; `permission_error` for `403`; `rate_limit_error` for `429`; and `api_error` by default. A handler can override the type or attach `code` and `param`.

Unhandled malformed JSON maps to `400` with `code=invalid_json`; other unhandled errors map to `500`. Anthropic message errors use `{type:"error",error:{type,message}}`. The stream handlers preserve their respective error envelope in SSE data.

### Streaming

Chat and messages streams use `text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and `X-Accel-Buffering: no`. OpenAI-compatible chat emits each completion chunk as an SSE `data` record and ends with `[DONE]`; an in-stream failure is encoded as an error payload. Anthropic messages preserve ordered named events such as `message_start`, `content_block_start`, `content_block_delta`, `message_delta`, and `message_stop`; failures use an `error` event. Usage logs expose their separate `connected`, `usage.updated`, `request.logged`, and heartbeat records as described above.

## Persistence and side effects visible at the API boundary

<!-- prettier-ignore -->
| Route group | Observable state change |
| --- | --- |
| Admin auth | Setup creates the first admin account and session; login creates a session; logout revokes it; password change replaces the password hash. |
| API keys | Create, update, credit, and delete key records. Gateway requests check key status, credit and token limits, reserve token budget, and record usage. |
| Provider auth and management | OAuth/device flows create provider connection state; imports/callbacks persist provider credentials; management endpoints add, remove, enable, verify, or configure connections, custom/hidden models, and round-robin behavior. |
| Favorites, settings, fallbacks | Mutations persist favorites, API-key enforcement settings, string settings, and fallback rules. |
| Gateway and images | Successful and failed usage is reflected in logs and usage events; provider execution can update token, cost, and quota accounting. Streaming cancellation and partial output affect whether usage is billed. |
| Dashboard | Logs, stats, and analytics are reads over recorded usage; event streams subscribe to usage updates. |
| Database transfer | Export creates a database snapshot. Import validates a candidate before replacing storage, retains a backup for recovery, and may require restart and admin reauthentication. |

Rust schema and SQL details remain gated by `docs/api-database-contract.md`; this API contract does not infer an internal database schema.

## Source mapping and regression evidence

<!-- prettier-ignore -->
| API area | Rust destination | Existing regression evidence |
| --- | --- | --- |
| Startup, listeners, static web | `main.rs`, `app.rs`, `http/listeners.rs`, `http/static_files.rs` | `startup.test.ts`, `web-dist.test.ts` |
| Admin auth and API keys | `features/admin_auth/`, `features/api_keys/`, shared HTTP middleware | `admin-auth-route.test.ts`, `admin-auth-service.test.ts`, `admin-auth-store.test.ts`, `admin-auth-middleware.test.ts`, `api-keys.test.ts`, `api-keys-credit-db.test.ts`, `api-keys-credit-route.test.ts`, `api-keys-quota-credit.test.ts`, `api-keys-usage-deduction.test.ts`, `api-keys-allowed-models.test.ts`, `settings-auth.test.ts` |
| Provider OAuth and token refresh | `features/provider_auth/` | `auth-providers.test.ts`, `token-refresh.test.ts`, `antigravity-provider.test.ts`, `codebuddy-provider.test.ts`, `qoder-provider.test.ts`, `tokenrouter-provider.test.ts`, `kiro-provider.test.ts`, `bai-provider.test.ts`, `neosantara-provider.test.ts`, `experientiallabs-provider.test.ts` |
| Provider management and favorites | `features/providers/` | `custom-provider-uuid.test.ts`, `round-robin-endpoint.test.ts`, `verify-connection.test.ts` |
| Chat, messages, images, fallback, translation | `features/gateway/`, shared upstream adapter | `messages.test.ts`, `opencode-compat.test.ts`, `images-*.test.ts`, `fallback-policy.test.ts`, `fallbacks-cascade.test.ts`, `tool-interceptor.test.ts`, `malformed-json.test.ts`, `request-limits.test.ts` |
| Models, pricing, quota | `features/catalog/` | `models-endpoint.test.ts`, `pricing-route.test.ts`, `quota-oauth-filter.test.ts` |
| Logs, analytics, settings | `features/dashboard/` | `analytics.test.ts`, `logs-pagination.test.ts`, `settings-auth.test.ts` |
| Database transfer | `features/database_transfer/` | `database-route.test.ts` |
| Shared security and HTTP behavior | `http/middleware/` | `cors-allowlist.test.ts`, `csrf-origin-guard.test.ts`, `rate-limit.test.ts`, `request-limits.test.ts`, `malformed-json.test.ts` |

The tunnel-only `tunnel-auth.test.ts` remains a legacy baseline and is excluded from Rust parity.

SQLite is initialized before `boot()` at module load. For PostgreSQL, startup awaits database initialization before admin bootstrap. Startup then starts the provider registry; model warmup runs after the main listener begins serving, and the token-refresh sweeper starts after listener setup. The current Node runtime also starts tunnel autostart as background work; Rust intentionally omits it.

## Legacy baseline before Rust work

Each command used `tests/setup.ts`, which redirects SQLite to a per-process temporary file and removes `DATABASE_URL`.

<!-- prettier-ignore -->
| Command target | Result |
| --- | --- |
| `opencode-compat.test.ts` | 1 passed, 0 failed |
| `messages.test.ts` | 3 passed, 0 failed |
| `database-route.test.ts` | 8 passed, 0 failed |
| `startup.test.ts` | 2 passed, 0 failed |
| `web-dist.test.ts` | 1 passed, 0 failed |

Total: 15 tests passed, 0 failed. No pre-existing failure was observed in these representative baseline files.
