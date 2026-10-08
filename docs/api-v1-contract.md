# API v1 Contract and Rust Migration Boundary

This document freezes the behavior visible at the `apps/api` HTTP boundary for the Rust migration. It records route wiring, controller behavior, middleware, and API test evidence. It does not reproduce source or data from `packages/*`. Request schemas imported from `@srouter/types` are described only where their fields are visible in API controllers or API tests.

## Scope and sources

- Retain the route behavior listed below in the Rust API.
- Remove the Cloudflare Tunnel feature entirely (owner ruling 2026-10-08). Rust never had the routes (`/v1/tunnel/*` answers `404`) and migration `0004_remove_tunnel_settings.sql` deletes its four settings keys, so schema v4 carries no tunnel state. The Node implementation in `apps/api` and the unused `apps/web/src/hooks/useTunnel.ts` are deleted when `apps/` comes into scope; until then `apps/api` still serves those routes.
- Use `apps/api/src/index.ts`, route/controller/middleware/service/logic files, and `apps/api/tests/*.test.ts` as the contract evidence. Use the Node API only as a temporary black-box comparison target.
- Do not inspect, copy, or use `packages/*` code or data as Rust source, seed data, or code-generation input.
- Rust built-in provider seeds and provider-specific model identifiers require independent provenance recorded beside their definitions; use the provider's official documentation or public catalog for provider facts. The Node API and this contract may establish SRouter compatibility behavior and metadata, but are not independent sources for upstream catalog data.
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
| Models | `/v1/models` (`GET`) | API-key auth | Returns `{object:"list", data:[...]}` and `Cache-Control: public, max-age=60, stale-while-revalidate=300`. `refresh=true` or `force=true` forces a refresh; `Cache-Control: no-cache` or `no-store` requests background revalidation. API-key model allowlists filter the list. The Rust build also serves `POST`, `PUT`, `PATCH`, and `DELETE` on this resource (see "Models in the Rust build"). |
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

### Models in the Rust build

The Rust build serves the two catalog reads above and adds the full model CRUD, so every model-level operation lives under `/v1/models` and nowhere else. The provider is inferred from the model id's `<prefix>/<bare>` shape, and the id is read through a catch-all segment because a model id may contain a slash (`claude/claude-sonnet-4-5`). The reads keep the API-key guard; the writes take the admin session.

| Method and path              | Auth          | Input and observable behavior                                                                                                                                                                                                                                        |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/models`            | Admin session | JSON `model_id` (required) plus optional `favorite`/`hidden` booleans. Registers a custom model and returns the entry with `201`, or `200` when it was already registered. An unknown provider prefix or a missing `model_id` returns `400` `Invalid model payload`. |
| `PUT /v1/models/{*model}`    | Admin session | Upserts a custom model idempotently and returns the entry. An empty body means "no flag change".                                                                                                                                                                     |
| `PATCH /v1/models/{*model}`  | Admin session | Sets the optional `favorite` and/or `hidden` flags and returns the entry with the new state; an empty body is a no-op.                                                                                                                                               |
| `DELETE /v1/models/{*model}` | Admin session | Removes a custom model and returns `{"deleted":true}`, or `404` `model_not_found` when the model was not custom.                                                                                                                                                     |

- **Custom models.** A registered model is stored bare under its provider and re-prefixed with the provider alias when the catalog merges it, so it lists as `<alias>/<bare>` and carries `custom: true`, mirroring Node's `MergeCustomModels`. `GET /v1/models` and `GET /v1/models/:model` return it too.
- **Entry shape.** A catalog entry is `{id, object, owned_by}` plus `favorite`, and `custom: true` on a custom row; hidden models never appear in this list. The shape matches the oracle schema, whose `ModelObjectSchema` (`packages/types/src/schemas/models.ts`) declares the same OpenAI fields, so the upstream metadata a provider's model list returns (`display_name`, `is_vl`, `format`, `max_input_tokens`, `price_factor`, `is_free`) stays parsed away. Serving it was ruled out on 2026-10-08 because it has no consumer and would make the payload a deviation from the oracle; the metadata would first have to travel from each provider catalog through the registry.
- **This replaces the model-level rows above.** `POST|DELETE /v1/providers/:providerId/models(/:modelId)`, `GET|POST /v1/providers/:providerId/hidden-models`, `DELETE /v1/providers/:providerId/hidden-models/:modelId`, and `GET|POST|DELETE /v1/favorites` are not served; the equivalent operations are the `/v1/models` writes. This is a deliberate deviation from Node, which has no `/v1/models` writes. Only the reads (`/models`, `/models/:model`) are mounted under the `/v1/v1` alias.
- **The web reads and writes these routes.** `apps/web`'s favorites hook takes its list from `GET /v1/models` and its writes from `PATCH /v1/models/{*model}` (`favorite`), and the provider hooks take the hidden set from the provider detail's `models[].hidden` and write it through the same `PATCH` (`hidden`); `POST|DELETE /v1/models` and the provider `enabled` flag are used the same way. Model ids are sent percent-encoded, which the catch-all segment decodes. Rolling the API back to `apps/api` therefore has to roll the web bundle back with it.

### Providers in the Rust build

The Rust provider registry contains the built-in drivers. Live model catalogs are shared by their adapters and refreshed after connection writes; they are cleared on a forced refresh when the last connection is gone. Where the rows above describe Node, the Rust build differs as follows.

- **One write route.** `PATCH /v1/providers/{provider_id}` replaces Node's `PATCH /v1/providers/:providerId/enabled`. Every field is optional and applied in one transaction: `enabled` (boolean), plus the model-id lists `hide`, `restore`, `favorite`, and `unfavorite`. A request that names no field, a non-boolean `enabled`, or a list entry that is not a non-empty string returns `400` with `Invalid payload`; an unknown provider returns `400` with `Provider '<id>' not found`. The response is the provider detail entry read back after the write.
- **Idempotent writes.** Hiding an already hidden model keeps its single override row, restoring a model that is not hidden succeeds without changing anything, and favoriting or unfavoriting repeats safely. Model ids are stored lowercased and matched case-insensitively, so a row written elsewhere with different casing is still found.
- **Hidden state is a flag.** A hidden model is written through `PATCH /v1/models/{*model}` (`hidden`), not a listing route. The provider detail response still carries `hidden` and `favorite` on each `models[]` entry and lists hidden models instead of filtering them out, unlike Node. `GET /v1/models` still drops hidden models and every model of a disabled provider.
- **Favorites.** Favorites are written through `PATCH /v1/models/{*model}` (`favorite`) and read back as the `favorite` flag on each `/v1/models` entry and on the provider detail's `models[]`. The backing table carries no provider dimension, so the model id alone identifies the row.
- **Round-robin is served.** `PATCH /v1/providers/:providerId/round-robin` takes `{enabled: bool}`
  behind the admin session and answers with the provider detail entry read back after the write;
  an unknown provider or an `enabled` value that is not a real boolean returns `400`. Every
  provider response (`GET /v1/providers`, `GET /v1/providers/catalog`, `GET /v1/providers/{id}`)
  carries `round_robin`. The flag turns rotation off, never on: **a missing settings row reads as
  on**, where Node defaults it off (`packages/db/src/settings.ts`). With a single connection
  rotation is a no-op, so the flag is an escape hatch rather than a setup step. Rotation walks the
  enabled connections newest-first inside the executor that loads credentials (`qoder`, `cline`,
  `grok-web`), and a connection that answered `429` is passed over for 60 seconds before the next
  request uses it; when every connection is cooling the newest is used anyway. The failover only
  covers the phase before the first response byte, so an in-stream failure still reaches the
  client unchanged.
- **Protocol is an enum.** `ProviderMetadata.protocol` and the `protocol` field of every provider response carry `ProviderProtocol { OpenAI, Anthropic, Custom }`, serialized lowercase, so the wire values are unchanged. Node's `ProviderProtocol` union also lists `gemini`; that value is dead (its only user, the `gemini_cli` provider, was deleted with `packages/providers/src/catalog.ts`) and the Rust enum does not carry it.
- **No credential material.** `connections[]` never carries a stored secret; the credential column is not read at all.
- **Field naming.** Connection status reports snake_case `connected_count` instead of Node's `connectedCount`.
- **Scope.** The build serves `GET /v1/providers`, `GET /v1/providers/catalog`, `GET /v1/providers/{provider_id}`, `PATCH /v1/providers/{provider_id}` (read/write, above), and the custom-provider routes `POST /v1/providers`, `DELETE /v1/providers/{provider_id}`, `POST /v1/providers/verify`, and `POST /v1/providers/connections/verify` (`features/providers/management/custom_routes.rs`). `POST /v1/providers` generates a UUID v4 internal id when the request carries none, validates `category`/`protocol`, requires an `api_key` for an `api_key`/`custom_provider` row, and refuses a base URL that resolves to a blocked address (the same `ssrf` guard the verify route uses). A registered row joins the live registry immediately and is re-read on boot, so its models resolve at the gateway. The provider routes are not mounted under the `/v1/v1` alias.

### Logs in the Rust build

The Rust logs surface follows the route rows above for routes, auth, and status
codes, with these differences.

- **Analytics field casing.** `GET /v1/logs/analytics` serializes snake_case (`bucket_size_ms`, `total_requests`, `top_models`, `p95_latency_ms`, `requests_per_second`, `error_rate`, `bucket_start`, `avg_latency_ms`, `est_cost`, `provider_id`, `raw_user_agent`) where Node emits camelCase (`bucketSizeMs`, `totalRequests`, ...). The report shape and values are otherwise the same.
- **Stats field casing.** `GET /v1/logs/stats`, and therefore the `usage.updated` payload on the event stream, serialize snake_case (`total_requests`, `total_success_requests`, `total_tokens`, `total_prompt_tokens`, `total_completion_tokens`, `total_cached_tokens`, `total_cache_creation_tokens`, `total_reasoning_tokens`, `total_estimated_cost`, `total_input_tokens`, `total_output_tokens`, `cost_label`, `estimated`, `by_model`) where Node emits camelCase (`totalRequests`, `byModel`, `costLabel`, ...). The values are otherwise the same.
- **Log record casing.** Log records returned by `GET /v1/logs` and `GET /v1/logs/:id` serialize snake_case (`status_code`, `request_id`, `api_key_id`, `cached_tokens`, `cache_creation_tokens`, `reasoning_tokens`, `estimated_cost`, `resolved_model`, `fallback_occurred`, `fallback_path`, `fallback_reason`, `created_at`, ...) rather than Node's camelCase. Stats `cost_label` uses four decimal places.
- **Bucket fill.** Analytics zero-fills buckets from the window start up to (exclusive) the report time, so the partial in-progress bucket is included whenever that time is not a bucket boundary, matching Node.

### Settings in the Rust build (owner ruling 2026-10-02)

The settings routes deviate from the route rows above by owner decision; the rows stay as the Node reference.

- **Response shape.** `GET`, `POST`, and `PATCH /v1/settings` all return only `{require_api_key}`. The compatibility field `requireApiKey` and the `settings` map are not echoed, unlike Node's `{require_api_key, requireApiKey, settings}` (and Node's mutation response also carries `message`).
- **Write acceptance.** `POST`/`PATCH` still accept a string-valued `settings` object and persist each entry as a key/value row, so data written by the web dashboard survives for later consumers; only the echo is omitted. Non-string values, a non-object `settings`, or a non-boolean `require_api_key` return `400` with `Invalid settings payload`, matching Node's Zod validation outcome.

### Storage in the Rust build (owner ruling 2026-10-05)

The Rust build is SQLite-only. A configured `DATABASE_URL` is refused at boot with `500` naming the backend, rather than starting a process whose repositories have no statements: the settings, catalog-flag, provider-connection, admin-auth, and request-log stores all read through `sqlite_pool()` and would otherwise answer from empty defaults or `500` at request time. The Node runtime keeps PostgreSQL support until cutover. Owner ruling 2026-10-08: PostgreSQL support is dropped from the Rust build altogether, so the refusal is permanent and no PG work item remains. `server/.env.example` and `server/TODO.md` §10 record the refusal.

### Database transfer in the Rust build

The Rust build implements both transfer routes in `server/src/features/database_transfer/`, mounted inside `/v1` only (not the `/v1/v1` compat group) and guarded by the admin session. The wire contract matches the rows above; the four implementation deviations (version carrier, legacy migration, streaming parser, lock owner modes) are recorded in `docs/api-database-contract.md` §"Database transfer in the Rust build". Regression evidence: `server/tests/database_transfer.rs`.

## Compatibility aliases and retired routes

The main listener mounts these compatibility paths under `/v1/v1`: `/chat/completions`, `/chat/completion`, `/chat`, `/messages`, `/messages/count_tokens`, `/images/generations`, `/models`, and `/models/:model`. They use the same route handlers and feature middleware as their `/v1` counterparts. The OAuth listener exposes only its `/v1` mounts, not `/v1/v1`.

`opencode-compat.test.ts` also assembles the route modules at `/` in a test-only Hono app. The production `index.ts` mounts them at `/v1` and `/v1/v1`; the test's root mounts do not add production root-level chat or model routes.

The Cloudflare Tunnel feature is removed by owner ruling 2026-10-08, so `/v1/tunnel/*` is deleted rather than ported: `GET /v1/tunnel/status`, `GET /v1/tunnel/events`, `GET /v1/tunnel/install`, `POST /v1/tunnel/start`, `POST /v1/tunnel/stop`, `POST /v1/tunnel/install`, and `PUT /v1/tunnel/config` are legacy-only while `apps/api` still exists (they required an admin session) and answer `404` on the Rust build. `tunnel-auth.test.ts` is not a Rust parity requirement and is deleted together with the Node routes.

Rust intentionally has no `/v1/settings/fallbacks` routes (owner ruling 2026-10-04). The legacy-only routes are `GET /v1/settings/fallbacks`, `POST /v1/settings/fallbacks`, `PUT|PATCH /v1/settings/fallbacks/:id`, and `DELETE /v1/settings/fallbacks/:id`. Gateway handlers execute model requests directly without fallback retry cascades, keeping `fallback_occurred = false`. `fallbacks-*.test.ts` and `fallback-policy.test.ts` are not Rust parity requirements.

## Shared HTTP behavior

### Headers and CORS

The main listener adds `X-Powered-By: Seaavey`, `X-Version: <API_VERSION>`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, and `Referrer-Policy: strict-origin-when-cross-origin`. The exact API version comes from the existing API version constant; the Rust build reports its crate version instead (see "Version in the Rust build" below).

When serving the web dist, asset paths ending in `js`, `css`, `map`, `woff`, `woff2`, `ttf`, `otf`, `png`, `svg`, `ico`, `webp`, `avif`, `jpg`, `jpeg`, or `gif` receive `Cache-Control: public, max-age=31536000, immutable`.

`SROUTER_CORS_ORIGINS` is a comma-separated allowlist. Loopback HTTP/HTTPS origins (`localhost`, `127.0.0.1`, and `[::1]`, with optional ports) are always allowed. CORS allows `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`; request headers `Content-Type`, `Authorization`, `x-api-key`, and `anthropic-version`; exposes `Content-Length`, `X-Request-Id`, and `X-Version`; and includes credentials.

### Version in the Rust build (owner ruling 2026-10-02)

Every version the Rust build reports comes from `package.version` in `server/Cargo.toml` (currently `0.2.0`), never from Node's `API_VERSION` (`packages/constants/src/version.ts`, currently `0.1.8`). That covers the `X-Version` header, the `version` field of `GET /` and `GET /v1`, and the upstream `User-Agent` (`srouter-server/<crate version>`). Releasing the Rust API means bumping `package.version` in `server/Cargo.toml`; the Rust build reads no other version source. No API consumer breaks on the differing number: the dashboard renders its own build-time `APP_VERSION` constant, and the CLI reports `CLI_VERSION`, so neither reads the version from the API.

### Field naming in the Rust build (owner ruling 2026-10-07)

Every JSON object the Rust build returns uses snake_case field names, with no camelCase exception. Three answers that used to be camelCase because the dashboard read them as written are now snake_case: the provider entry's `round_robin` (was `roundRobin`), the authorization-code login answer `{authorize_url, state, code_verifier, redirect_uri}` (was `{authorizeUrl, state, codeVerifier, redirectUri}`), and the Cline device answer `{authorize_url, state, user_code, expires_in, interval}` (was `{authorizeUrl, state, userCode, expiresIn, interval}`); the CodeBuddy login answer is `{authorize_url, state}`. `apps/web` reads the snake_case spelling. Payloads the server only forwards or stores keep the upstream spelling (for example Cline's stored `provider_specific_data.authMethod` or a vendor token response).

### Authentication, CSRF, rate limits, and request size

- API-key middleware first accepts a valid admin session. Otherwise it reads `x-api-key` or `Authorization: Bearer ...` (a non-Bearer `Authorization` value is also treated as the key). API-key enforcement is on when the setting `require_api_key` is true or the client is not loopback.
- A disabled key returns `401`; exhausted credit returns `402`; exhausted token quota returns `429`; missing/invalid required keys return `401`. Model allowlists apply to model list/detail and gateway requests. Node's key lookup selects only enabled rows, so there a disabled key behaves like an unknown one (`401 invalid_api_key` when auth is required, anonymous pass when it is not); the Rust build reads the row itself and always returns `401` with `code=api_key_disabled` (owner ruling 2026-10-02).
- Admin mutations use the `srouter_admin_session` cookie. The cookie is `HttpOnly`, path `/`, `SameSite=Lax`, and uses `Secure` only when `SROUTER_SECURE_COOKIES=true`; its max age is seven days.
- The CSRF guard applies to `POST`, `PUT`, `PATCH`, and `DELETE` under `/v1/*` only when the admin cookie is present. It checks `Origin`, then `Referer`; same-host requests and allowlisted origins pass. Requests without an Origin/Referer or without the admin cookie pass through.
- API-key rate limits use a fixed 60-second window per API-key ID and client address. A `rate_limit` of `0` means unlimited. A rejected request returns `429`, `code=rate_limit_exceeded`, and `Retry-After`. The limiter covers the chat and messages routes (and images in Node); the model catalog is not rate limited, so polling `GET /v1/models` never consumes the chat window.
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
| Provider management and models | `features/providers/`, `features/gateway/models.rs`, `infrastructure/database/providers.rs`, `infrastructure/database/catalog_flags.rs` | `custom-provider-uuid.test.ts`, `round-robin-endpoint.test.ts`, `verify-connection.test.ts`; Rust evidence: `tests/providers.rs`, `tests/models.rs` |
| Chat, messages, images, fallback, translation | `features/gateway/`, shared upstream adapter | `messages.test.ts`, `opencode-compat.test.ts`, `images-*.test.ts`, `fallback-policy.test.ts`, `fallbacks-cascade.test.ts`, `tool-interceptor.test.ts`, `malformed-json.test.ts`, `request-limits.test.ts` |
| Models, pricing, quota | `features/catalog/` | `models-endpoint.test.ts`, `pricing-route.test.ts`, `quota-oauth-filter.test.ts` |
| Logs, analytics, settings | `features/dashboard/` | `analytics.test.ts`, `logs-pagination.test.ts`, `settings-auth.test.ts` |
| Database transfer | `features/database_transfer/` | `database-route.test.ts` |
| Shared security and HTTP behavior | `http/middleware/` | `cors-allowlist.test.ts`, `csrf-origin-guard.test.ts`, `rate-limit.test.ts`, `request-limits.test.ts`, `malformed-json.test.ts` |

The tunnel-only `tunnel-auth.test.ts` is excluded from Rust parity and disappears with `apps/api` under the 2026-10-08 removal ruling.

SQLite is initialized before `boot()` at module load. For PostgreSQL, startup awaits database initialization before admin bootstrap. Startup then starts the provider registry; model warmup runs after the main listener begins serving, and the token-refresh sweeper starts after listener setup. The Node runtime also starts tunnel autostart as background work until `apps/api` is deleted (the feature is removed by the 2026-10-08 ruling); Rust never had that task.

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
