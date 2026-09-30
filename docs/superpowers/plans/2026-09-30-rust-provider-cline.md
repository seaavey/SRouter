# Cline Provider (OAuth-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new built-in provider `cline` to the Rust gateway (`server/`): WorkOS device-flow OAuth connect plus inference through Cline's OpenAI-compatible chat endpoint, so `cline/<provider>/<model>` resolves, streams, and returns OpenAI-compatible responses.

**Architecture:** One new provider module (`features/providers/cline/`) owning protocol constants, the live model snapshot, and the executor, wired into the existing `ProviderAdapter` enum exactly like `qoder`. One new route module (`features/provider_auth/cline.rs`) serving the two contract routes `/v1/auth/cline/{device,poll}` (Cline has no callback route in the frozen contract). Credentials are read by the executor straight from the `providers` row at request time, the same static-registry pattern the Qoder slice established. Two things differ from Qoder: the access token is short-lived, so the executor refreshes it lazily before each request, and the model list comes from a public catalog endpoint, so it is fetched live and never seeded. No new table: `oauth_sessions` and `providers.credentials` already exist (`server/migrations/0002_v2_schema.sql`; current `user_version` is 3).

**Tech Stack:** Rust edition 2024 (stable), axum 0.8, sqlx 0.9 (SQLite), reqwest 0.13 (rustls), serde/serde_json, tokio 1. No new crates: Cline talks plain JSON and form-urlencoded HTTP, and `url` is already in `Cargo.lock`.

**Spec:** `docs/api-v1-contract.md` rows 57-58 (route shapes), `docs/api-database-contract.md` (schema ownership), `apps/api/src/routes/v1/auth.ts` + `apps/api/src/logic/auth.logic.ts` + `apps/api/src/controllers/auth.controller.ts` + `apps/api/src/services/authHandlers.ts` (flow semantics, response bodies, provider row shape), `apps/api/src/services/tokenRefresh.ts` (refresh policy oracle), `apps/web/src/components/providers/providers.oauth-flow.tsx` (UI contract). Protocol facts come from the analysis below.

---

## Analisis Cline (independent protocol analysis)

Everything below was derived without reading `packages/*`. Sources, recorded here for `server/TODO.md` §4 "Catalog provenance":

1. Reverse engineering of the official Cline CLI binary: npm `cline` v3.0.66, `node_modules/cline/bin/.cline`, a 130,397,664-byte ELF (Bun-compiled, `BuildID[sha1]=5afca2666bfab8605a934f1b6231dacae0518a5f`, not stripped) with the minified JS bundle embedded as plain text. Extracted with `strings -n 6` plus byte-offset carving around known markers. Offsets are file offsets in that binary.
2. Official documentation fetched live on 2026-09-30 as Markdown from `docs.cline.bot`: `api/authentication.md`, `api/chat-completions.md`, `api/models.md`, `api/errors.md`.
3. Live endpoint probes without credentials on 2026-09-30 (recorded in the failure-mode table and Open questions).
4. `apps/api` source (allowed oracle): route table, controller, logic, handlers, registry, token refresh service.
5. `apps/web/src/components/providers/providers.oauth-flow.tsx`: the UI calls `/v1/auth/cline/device` then `/v1/auth/cline/poll`.
6. `docs/api-v1-contract.md` rows 57-58.

Cross-check note: the endpoint paths, the WorkOS device flow, and the `workos:` token prefix found in the binary match the flow `apps/api` drives (`requestDeviceAuthorization()` returning `userCode`/`verificationUri`, `providerSpecificData.authMethod = "workos-device"`), and the chat contract matches `docs.cline.bot`. The three independent sources agree.

### Binary evidence (file offsets in `bin/.cline`)

| Offset                                                                                 | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `81680331`                                                                             | Environment config: production `appBaseUrl: https://app.cline.bot`, `apiBaseUrl: https://api.cline.bot`, `mcpBaseUrl: https://api.cline.bot/v1/mcp`, `workOsClientId: client_01K3A541FN8TA3EPPHTD2325AR`. Env overrides `CLINE_ENVIRONMENT`, `CLINE_API_BASE_URL`, `CLINE_API_KEY`.                                                                                                                                                            |
| `81827385`                                                                             | Client tracking headers: `HTTP-Referer: https://cline.bot`, `X-Title: Cline`, `X-IS-MULTIROOT: false`, `X-CLIENT-TYPE: cline-sdk`, plus `User-Agent: Cline/<version>`, `X-CLIENT-VERSION`, `X-PLATFORM`, `X-PLATFORM-VERSION`, `X-CORE-VERSION`, `X-Task-ID` (builder function at `81827827`).                                                                                                                                                 |
| `84555204`                                                                             | `cline-pass` provider entry: `defaults: { baseUrl: "https://api.cline.bot/api/v1" }`, `apiKeyEnv: ["CLINE_API_KEY"]`.                                                                                                                                                                                                                                                                                                                          |
| `84626281`                                                                             | Cline provider family: `defaults.baseUrl` = `` `${apiBaseUrl}/api/v1` ``, `capabilities` includes `oauth`, `metadata.responseEnvelope: "success-data"`.                                                                                                                                                                                                                                                                                        |
| `84865348`                                                                             | Fetch wrapper: if the response body parses to `{success: true, data: …}`, the body is replaced by `data`.                                                                                                                                                                                                                                                                                                                                      |
| `88790591`                                                                             | Endpoint map: `authorize: "/api/v1/auth/authorize"`, `token: "/api/v1/auth/token"`, `register: "/api/v1/auth/register"`, `refresh: "/api/v1/auth/refresh"`; WorkOS paths `deviceAuthorization: "/user_management/authorize/device"`, `authenticate: "/user_management/authenticate"` on base `https://api.workos.com`; callback path `/auth`; callback ports 48801-48811; defaults `expires_in` 300 s, `interval` 5 s, HTTP timeout 30 000 ms. |
| `88792582` (device body), `88793531` (poll body), `88793916`-`88794053` (error switch) | WorkOS device authorization body (`client_id`), poll body (`grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code`, `client_id`), and the pending/error switch (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`); `slow_down` raises the poll wait by one second, which is what the official client does.                                                                             |
| `88798665`                                                                             | Refresh call: `POST {apiBaseUrl}/api/v1/auth/refresh`, JSON `{"refreshToken": …, "grantType": "refresh_token"}`.                                                                                                                                                                                                                                                                                                                               |
| `88799474`                                                                             | Refresh lead: `refreshBufferMs` defaults to 300000 ms (five minutes), the same lead D7 takes from the Node oracle.                                                                                                                                                                                                                                                                                                                             |
| `88813758`                                                                             | `workos:` prefix helpers: add the prefix when missing, strip it when present, `exp` read from the JWT payload as a fallback expiry.                                                                                                                                                                                                                                                                                                            |

### Endpoints used by this slice

| Purpose                | URL                                                            | Body / headers                                                                             |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Device authorization   | `POST https://api.workos.com/user_management/authorize/device` | `application/x-www-form-urlencoded`, `client_id=client_01K3A541FN8TA3EPPHTD2325AR`         |
| Device token poll      | `POST https://api.workos.com/user_management/authenticate`     | form `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code`, `client_id` |
| Register WorkOS tokens | `POST https://api.cline.bot/api/v1/auth/register`              | JSON `{accessToken, refreshToken}`                                                         |
| Refresh                | `POST https://api.cline.bot/api/v1/auth/refresh`               | JSON `{refreshToken, grantType: "refresh_token"}`                                          |
| Chat                   | `POST https://api.cline.bot/api/v1/chat/completions`           | OpenAI JSON, `Authorization: Bearer workos:<access>`                                       |
| Model catalog          | `GET https://api.cline.bot/api/v1/models`                      | `Accept: application/json`, no auth needed (observed `200`)                                |

Not used here, present in the binary and kept for follow-ups: `/api/v1/auth/authorize`, `/api/v1/auth/token` (authorization-code flow with a local callback server), `/api/v1/ai/cline/recommended-models`, `/api/v1/users/me`, `/api/v1/users/active-account`, `/api/v1/users/{id}/balance`, `/v1/mcp`.

### Device flow (the part `apps/api` exposes)

1. `GET /v1/auth/cline/device` (admin session) → WorkOS device authorization. Response body: `{authorizeUrl, state, userCode, expiresIn, interval}` where `authorizeUrl` is `verification_uri_complete` falling back to `verification_uri`, `state` is a fresh UUID, and the `oauth_sessions` row stores the `device_code` (the column exists since schema v2).
2. The operator opens `authorizeUrl` in a browser and approves.
3. `GET|POST /v1/auth/cline/poll` (admin session, `state` from query or JSON body) → claim the session → WorkOS authenticate → on success, register the WorkOS tokens with Cline. Poll semantics: missing `state` → `400`; unknown or expired session → `{status: "pending", error: "Session expired or not found"}`; `authorization_pending` → `{status: "pending"}` after releasing the claim; `slow_down` → same, with the next wait one second longer; `access_denied`, `expired_token`, `invalid_grant` → `{status: "pending", error: <reason>}` after releasing; success → delete the session row, upsert the provider, `{status: "ok", provider: {...}}`.
4. Register response: `{success, data: {accessToken, refreshToken, tokenType, expiresAt, userInfo: {clineUserId, email, name, …}}}`. `expiresAt` is an ISO timestamp, so `token_expires_at = Date.parse(expiresAt)` and `expiresIn = (expiresAt - now) / 1000`.
5. Provider row upsert (Node semantics from `apps/api/src/logic/auth.logic.ts`): `id = userInfo.clineUserId` falling back to `cline_<ms>` (so reconnects overwrite the same row), `provider_id = "cline"`, name = `name` falling back to `email` falling back to `Cline (Account #<last 4 of ms>)`, `category = "oauth"`, `protocol = "openai"`, `enabled = 1`, credentials with access/refresh/expiry/`last_refreshed_at`, `providerSpecificData = {authMethod: "workos-device", email}`.

There is no `/v1/auth/cline/login` and no `/v1/auth/cline/callback`: contract row 57 lists only `device` and `poll`. `/v1/auth/cline/token` (row 58) is the API-key import and is out of scope here (D6).

### Inference: OpenAI-compatible chat

- Request: standard OpenAI chat JSON. `model` is a `provider/model` id such as `anthropic/claude-sonnet-5.5` (docs: "Model ID in `provider/model` format, the same convention used by OpenRouter"). `tools` use the OpenAI function-calling shape. Upstream `stream` defaults to `true`.
- Auth header: `Authorization: Bearer workos:<access_token>`. The official client adds the `workos:` prefix when it is missing and strips it when reading a token back. Static API keys (`cline_…`) are sent without the prefix. The connection row stores the token with the `workos:` prefix already applied, exactly like the official client (binary `88813758`), and the executor adds the prefix only when it is missing.
- Optional headers the docs sanction: `HTTP-Referer`, `X-Title`. The official client additionally sends `X-CLIENT-TYPE`, `X-CLIENT-VERSION`, `X-PLATFORM`, `User-Agent: Cline/<version>`. Decision D9 keeps the request minimal and omits all of them.
- Streaming: OpenAI SSE, `data: {chunk}` lines ending with `data: [DONE]`. Chunks carry `choices[0].delta.content`, `choices[0].delta.reasoning` for reasoning models, `finish_reason`, and a final `usage` object that also carries `cost` (USD).
- Mid-stream errors: an HTTP 200 stream can deliver `choices[0].finish_reason = "error"` with `choices[0].error = {code, message}` (`context_length_exceeded`, `content_filter`, `rate_limit`, `server_error`). The official client also aborts on a chunk whose root carries an `error` member (binary `84765308`), and there is no `finish_reason == "error"` check in the binary. The gateway treats provider bytes as an OpenAI stream, so the executor turns either shape into an in-stream error event instead of forwarding it as a normal delta.
- Non-streaming: a plain `chat.completion` object. Defensive rule: if the parsed body is `{success: true, data: <obj>}`, use `<obj>` (the binary unwraps exactly this envelope for the cline provider family, offset `84865348`; see Open questions). A `{success: false, error}` body raises that error instead of aggregating into an empty completion.
- Error bodies arrive in two shapes: the docs describe the OpenAI `{error: {code, message, metadata}}` object, while the live 401 probe returned a flat `{"error": "Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account."}`. The parser must accept both and surface the message.
- Documented HTTP codes: `400` malformed request, `401` bad or expired token, `402` out of credits, `403` no access, `404` unknown model or endpoint, `429` rate limit, `5xx` upstream.

### Model catalog

`GET https://api.cline.bot/api/v1/models` returns the OpenAI list shape `{object: "list", data: [{id, object, created, owned_by}]}`. It answered `200` without any credentials at analysis time; 464 ids were listed, in `provider/model` format, with `:batch` suffixed variants (`openai/gpt-6.1-sol:batch`). The curated `GET /api/v1/ai/cline/recommended-models` answered `200` with `{recommended: 6, free: 5, clinePass: 14, clineCloud: 3}`. The official client does not call `/api/v1/models` at all: its catalog comes from `GET /api/v1/ai/cline/recommended-models` with a five-minute cache, built from the `free` and `clineCloud` arrays (binary `84221764` and `92329679`). This slice uses `/api/v1/models` (D4), because it matches the `openai` protocol and the `${base}/models` shape the Node `VerifyConnection` logic already builds.

No seed, same operator policy as the Qoder slice: the advertised list holds only what the last successful fetch returned, and only while a Cline connection row exists.

### Failure modes to handle

| Symptom                                                    | Cause                                                                                 | Handling                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `401` with the flat `Unauthorized: … re-authenticate` body | access token expired or revoked                                                       | try one lazy refresh first; if it fails, `authentication_error` telling the operator to reconnect Cline |
| `402`                                                      | out of Cline credits                                                                  | `authentication_error` with the credit message, no retry                                                |     | `finish_reason: "error"` mid-stream | context overflow, content filter, rate limit during generation | translate to an in-stream error event, never forward as a normal delta |
| a chunk whose root carries `error`                         | same causes, second wire shape the official client accepts                            | treat exactly like the `finish_reason` row: in-stream error, never a delta                              |
| Empty answer on reasoning models with small `max_tokens`   | `delta.reasoning` consumed the budget                                                 | same default the gateway already uses, and test with a generous budget                                  |
| Dropped stream events                                      | parsing per network chunk                                                             | reuse the cross-read line buffer pattern from `opencode/executor.rs` and the Qoder translator           |
| A second `data: [DONE]`                                    | upstream already terminates the stream                                                | the executor must not append its own terminator on pass-through                                         |
| Model id rejected upstream                                 | client sent `anthropic/…` without the `cline/` prefix, or a key the catalog never saw | registry resolves only `cline/<id>`; the catalog gate keeps unlisted ids out of `/v1/models`            |
| Stale catalog after disconnect                             | last fetch keeps standing until TTL                                                   | accepted, same as Qoder (only a registry rebuild clears it sooner)                                      |

---

## Context

`server/` contains no Cline code at all today: a repo grep over `server/` hits only the two unchecked `cline` rows in `server/TODO.md` §5 and the §5 header note "Nothing exists in Rust". `features/provider_auth/` holds only `qoder.rs`, `features/providers/` holds only `opencode` and `qoder`, and `SEED_PROVIDERS` has two entries (`server/src/features/providers/mod.rs:27`). `oauth_sessions` (with its `device_code` column) and `providers.credentials` already exist, so this slice needs no migration.

Contract obligations this slice must satisfy:

- Row 57: `GET /v1/auth/cline/device`, `GET|POST /v1/auth/cline/poll`, both admin session, poll reading `state` from query or JSON body.
- Row 58: `POST /v1/auth/cline/token` returns `201`. Deliberately deferred (D6), recorded as a deviation next to the ticked rows.
- The gateway contracts the executor must satisfy are unchanged from the Qoder plan: `chat.rs` forwards provider bytes verbatim once it sees a text delta and otherwise parses `data:` OpenAI chunks, `messages.rs` parses `data:` OpenAI chunks into Anthropic events, non-streaming must return a full `chat.completion`, and `ProviderAdapter` is built before `AppState`, so credential lookup happens inside the executor.

One parity gap to record up front: `apps/api/tests/` contains no Cline test file (grep returns zero hits), so unlike Qoder there is no black-box oracle test. The evidence available is `apps/api` source, the official docs, the binary, and the live probes above.

## Global Constraints

- **Only `server/` changes.** `apps/api`, `apps/web`, `apps/docs`, `packages/*` are untouched; `apps/api` stays byte-identical (oracle).
- No data or code may be read, imported, or copied from `packages/*`. Provenance for every constant is the analysis above and must be re-recorded as one plain line per source in the `cline/types.rs` module doc comment.
- No new table and no migration edit: `oauth_sessions` and `providers.credentials` are owned by `server/migrations/0002_v2_schema.sql`, schema stays at `user_version` 3, and `server/tests/schema.rs` keeps asserting `V3_TABLES.len() == 10`.
- No new `server/Cargo.toml` dependencies in this slice.
- OAuth only: `/v1/auth/cline/device` and `/v1/auth/cline/poll`. The `/v1/auth/cline/token` API-key import is out of scope (D6).
- `credentials` never enters a handler response or a log line; it is read only inside the executor and written only by the auth routes and the refresh path.
- SQL uses `?` placeholders with `.bind()`; row mapping uses `try_get` with `map_err`; no `unwrap()`/`expect()` in production code (tests may `expect`).
- Tests use `support::TestDatabase` only; never `~/.srouter/srouter.db`, never a real Cline credential, never the live upstream (a `#[ignore]`d live test is optional and off by default).
- Plain idiomatic Rust: reuse the shapes that already exist (plain structs, plain functions, `Default` impls, one `SELECT` per request). No new traits, builder layers, or DI wrappers just to wire the endpoints or the catalog (D1, D5).
- Focused verification only: one `cargo test --test <file>` at a time, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`. Never root `pnpm test`/`pnpm build`.
- Code, comments, identifiers, commit messages English; comments explain _why_. Conventional Commits (`feat(server): …`).
- Comments follow the loaded `antislop-code` checklist: one line, two at most, only where the code cannot show the reason. No banner separators, no ALL CAPS labels, no line-by-line narration, no empty labels, no vague `TODO`, no decorative emoji, no comment that restates the signature.
- Text in this slice carries no em dash (core rule R-02): use a comma, a colon, or parentheses.

## Decisions

- **D1: Credential plumbing.** Same as Qoder: the registry stays static, `ClineExecutor` stores `Option<AppDatabase>`, and each request loads its `providers` row with one `SELECT`. No cache, no DI layer.
- **D2: Credential JSON shape.** Reuse the Qoder layout, `{"access_token", "refresh_token", "token_expires_at", "last_refreshed_at", "provider_specific_data": {...}}`, and accept the camelCase aliases (`accessToken`, `refreshToken`, `expiresAt`) as a read fallback. The open question from the Qoder slice (rows written by a Node build) still applies and stays open.
- **D3: Registry shape.** Register statically at boot with key `["cline"]` and user-facing alias `cline`, so `/v1/models` lists `cline/<upstream id>`. `registry.resolve()` splits on the first `/`, so `cline/anthropic/claude-sonnet-5.5` resolves to the bare `anthropic/claude-sonnet-5.5` that goes upstream, while a bare `anthropic/claude-sonnet-5.5` request does not match the prefix path. `CLINE_PROVIDER` joins `SEED_PROVIDERS`, which takes the entry count from 2 to 3.
- **D4: Model catalog, live and connection-gated.** Nothing is seeded. The snapshot starts empty and only a successful `GET /api/v1/models` puts a `cline/…` id in `/v1/models`, and the fetch is skipped entirely while no Cline connection row exists, so an unconnected instance advertises zero Cline models. Refresh runs on the same mechanics the Qoder slice shipped: 5-minute TTL, callers wait only while the snapshot is empty (coalesced behind one mutex, 10 s cap), background refresh after it holds models, failed fetch never empties a landed snapshot, unfilled snapshot retries no sooner than 30 s, `refresh`/`force`/`Cache-Control: no-cache` break through, and a successful connect forces one fetch. Deviation to record: the official client builds its catalog from `recommended-models` instead, so the advertised set may differ from another client; parity review compares against the running Node build, not against the binary.
- **D5: Auth URLs are testable.** The auth module takes a `ClineEndpoints` struct with `Default` (`workos_device_url`, `workos_authenticate_url`, `api_base_url`) so the fake upstream can inject its own hosts; production defaults are the Global hosts above.
- **D6: Scope is OAuth only.** `/v1/auth/cline/token` (contract row 58) and the web API-key tab are deferred. The tab will `404` exactly like the Qoder PAT tab, which is the recorded deviation class.
- **D7: Refresh is lazy, inside the executor.** `apps/api/src/services/tokenRefresh.ts` is the oracle: a token is due when `now >= token_expires_at - 5 min`, when no expiry is known it is due if it was never refreshed or the last refresh is older than 12 h, and concurrent refreshes of the same account de-dupe on an in-flight map. The executor runs that check before each upstream call and persists rotated tokens with `update_cline_tokens`. The background sweeper stays a separate slice, so the matching `server/TODO.md` §5 row stays open with a note that the lazy path landed for Cline.
- **D8: `base_url` is `https://api.cline.bot/api/v1`.** Provenance is the docs and the binary, both of which give that as the API root, and it makes `VerifyConnection`'s `${base}/models` pattern produce a live URL. The Node constant lives in `packages/*`, which this plan may not read, so the value is a parity-review check, not a claim about Node.
- **D9: Minimal header set.** `Authorization` plus `Content-Type`, nothing else. The tracking headers are documented as optional, and sending a branded `X-CLIENT-TYPE` we do not own would misreport the client. The binary also sends `X-CORE-VERSION` and `X-Task-ID` (builder at `81827827`); they stay omitted for the same reason. If a live request is rejected for a missing header, that is a one-line fix recorded in the implementation notes.
- **D10: No test oracle in `apps/api`.** Record it rather than invent one: tests assert against `apps/api` source as a read-only reference, the official docs, and the fake upstream's emulation of the documented shapes. The live smoke test stays `#[ignore]`d.

## File Structure

| File                                              | Responsibility                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/features/providers/cline/mod.rs`      | new: module wiring + `adapter(database)` / `adapter_with_endpoints(endpoints, database)`, same shape as qoder                         |
| `server/src/features/providers/cline/types.rs`    | new: endpoints, WorkOS client id, `CLINE_PROVIDER` metadata, provenance doc comment, unit tests                                       |
| `server/src/features/providers/cline/catalog.rs`  | new: `ClineCatalog` snapshot, `parse_model_list`, TTL and retry-window refresh helpers                                                |
| `server/src/features/providers/cline/executor.rs` | new: credential load, lazy refresh, chat request build, stream and non-stream handling                                                |
| `server/src/features/providers/mod.rs`            | modify: `pub mod cline;` + re-exports, `CLINE_PROVIDER` into `SEED_PROVIDERS`                                                         |
| `server/src/features/providers/adapter.rs`        | modify: `ProviderAdapter::Cline` variant + delegating methods                                                                         |
| `server/src/features/providers/registry.rs`       | modify: register the cline adapter next to the others, add `cline_endpoints()` beside `qoder_endpoints()`                             |
| `server/src/features/provider_auth/mod.rs`        | modify: `pub mod cline;` + router export                                                                                              |
| `server/src/features/provider_auth/cline.rs`      | new: `device` and `poll` handlers + session lifecycle                                                                                 |
| `server/src/infrastructure/database/providers.rs` | modify: `upsert_cline_connection`, `load_cline_credentials`, `update_cline_tokens`                                                    |
| `server/src/constants.rs`                         | modify: `providers::cline` message catalog                                                                                            |
| `server/src/app.rs`                               | modify: mount the cline device/poll router behind `require_admin_session`                                                             |
| `server/src/main.rs`                              | modify: catalog warmup for cline, shared with the Qoder warmup                                                                        |
| `server/tests/support/mod.rs`                     | modify: `FakeClineUpstream` (WorkOS device + authenticate, register, refresh, chat SSE, `/models`) + `cline_registry` / `cline_state` |
| `server/tests/provider_auth.rs`                   | modify: device / poll HTTP tests                                                                                                      |
| `server/tests/cline_provider.rs`                  | new: refresh, request shape, stream handling, non-stream aggregation, no-connection error                                             |
| `server/tests/models.rs`                          | modify: live-only Cline catalog assertions                                                                                            |
| `server/tests/providers.rs`                       | modify: seeded entry count 2 → 3                                                                                                      |
| `server/TODO.md`                                  | modify: tick the Cline rows of §5 with their notes, add the §4 provenance line                                                        |

---

### Task 1: module skeleton, catalog, and registry wiring

- [ ] `server/src/features/providers/cline/types.rs`: `CLINE_BASE_URL = "https://api.cline.bot/api/v1"`, `CLINE_WEB_URL = "https://cline.bot"`, `CLINE_WORKOS_BASE_URL = "https://api.workos.com"`, `CLINE_WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR"`, `ClineEndpoints { workos_device_url, workos_authenticate_url, api_base_url }` with `Default`, `CLINE_PROVIDER: ProviderMetadata { id: "cline", name: "Cline", category: "oauth", protocol: "openai", base_url, web_url, alias: "cline", requires_api_key: false, requires_oauth: true, supports_custom_url: false, status_message }`, and a module doc comment of one plain line per provenance source (the six sources above, no narrative).
- [ ] `mod.rs` exporting the constants plus `adapter(database: Option<AppDatabase>)` and `adapter_with_endpoints(endpoints: ClineEndpoints, database: Option<AppDatabase>)`, mirroring `qoder::adapter` and `qoder::adapter_with_endpoints` (executor body lands in Task 4).
- [ ] Add `ProviderAdapter::Cline(ClineExecutor)` and its delegating methods in `adapter.rs`, including `models()` returning `Vec<String>`.
- [ ] `registry.rs`: register `cline::adapter()?` next to `qoder::adapter()?`, and add `cline_endpoints()` beside `qoder_endpoints()` so the device routes and the tests read the same hosts the executor uses.
- [ ] `providers/mod.rs`: push `CLINE_PROVIDER` into `SEED_PROVIDERS`.
- [ ] Tests: registry unit tests for `resolve("cline/anthropic/claude-sonnet-5.5")` (bare id keeps its inner slash), `resolve("cline/cline-free/mimo-v2.6-flash")`, `resolve("anthropic/claude-sonnet-5.5")` rejected on the prefix path, `list_models` emitting `cline/<id>` with `owned_by == "cline"`.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --lib cline`, `cargo test --manifest-path server/Cargo.toml --test providers`.

### Task 2: credential stores

- [ ] `infrastructure/database/providers.rs`: `upsert_cline_connection(...)` keyed on `id`, writing `provider_id = "cline"`, `category = "oauth"`, `protocol = "openai"`, `enabled = 1`, the D2 credential shape (access, refresh, `token_expires_at`, `last_refreshed_at`, `provider_specific_data` holding `authMethod` and `email`), `base_url` = `CLINE_BASE_URL` (the Node row carries it, `auth.logic.ts:510`), the access token stored with the `workos:` prefix already applied, and no `__seed__` marker in `meta`.
- [ ] `load_cline_credentials(database) -> Option<ClineCredentials>` returning the newest enabled `cline` row's access, refresh, expiry, and account id, accepting the camelCase aliases (D2).
- [ ] `update_cline_tokens(database, id, access, refresh, expires_at_ms, refreshed_at_ms)` used by the refresh path.
- [ ] All three fail loudly when `database.sqlite_pool()` is `None` or the backend is Postgres, reusing `postgres_unsupported()`.
- [ ] Tests in `server/tests/cline_provider.rs`: upsert then load round trip (assert key presence only, never token values in assertion messages), camelCase fallback, no row → `None`, token update overwrites expiry and `last_refreshed_at`.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --test cline_provider`.

### Task 3: `/v1/auth/cline/{device,poll}`

- [ ] `features/provider_auth/cline.rs`: `device` (admin session) POSTs the WorkOS device authorization, maps `device_code` / `user_code` / `verification_uri(_complete)` / `expires_in` / `interval`, saves the `oauth_sessions` row (`state`, `device_code`, `client_id`, empty `code_verifier` and `redirect_uri`), returns `{authorizeUrl, state, userCode, expiresIn, interval}`; a WorkOS failure answers `400` with the `device authorization failed` message, as the controller does (`auth.controller.ts:100`).
- [ ] `poll` (admin session, `GET`+`POST`) reading `state` from query or JSON body: missing → `400`; unknown or expired session → `{status: "pending", error: constants::providers::cline::SESSION_EXPIRED}` with the claim released; WorkOS `authorization_pending` → `{status: "pending"}`; `slow_down` → wait one extra second before the next attempt and return pending; `access_denied` / `expired_token` / `invalid_grant` → pending with the upstream reason after release; success → register the WorkOS tokens with Cline, delete the session row, upsert the provider row with the name fallbacks from the analysis, return `{status: "ok", provider: {...}}`.
- [ ] `constants.rs`: add `providers::cline` messages (missing state, session expired, device authorization failed, register failed, empty token, token expired, refresh failed, not connected). Every client-facing string lives there.
- [ ] `app.rs`: mount the router behind `require_admin_session`, under the existing CSRF and body-limit layers. No public callback route (none exists in the contract). No `/v1/v1` alias (TODO §6).
- [ ] Tests (`server/tests/provider_auth.rs`) against `FakeClineUpstream` through `cline_state`: device JSON shape and its four fields; poll pending → ok; missing state → `400`; unknown state → pending with the session message; denied → pending with reason; unauthorized device and poll → `401`; provider row persisted with `provider_id = "cline"` and `authMethod = "workos-device"`.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --test provider_auth`.

### Task 4: executor, lazy refresh, and chat request

- [ ] `executor.rs`: `ClineExecutor { id, keys, base_url, db: Option<AppDatabase>, client: UpstreamClient }` (plus the catalog handle from Task 6).
- [ ] `credentials()` → `ClineCredentials` from `load_cline_credentials`: no database → `constants::providers::cline::DATABASE_REQUIRED`; no row → `NOT_CONNECTED` (`401`).
- [ ] `ensure_fresh_token()`: due when `now >= token_expires_at - 5 min`, when no expiry is known, due if never refreshed or `last_refreshed_at` older than 12 h (D7). Refresh POSTs `{refreshToken, grantType: "refresh_token"}` to `/api/v1/auth/refresh`, parses `accessToken`, `refreshToken`, `expiresAt`, persists via `update_cline_tokens`, and de-dupes concurrent calls per provider id. A failed refresh with `invalid_grant` or a 4xx token error surfaces `TOKEN_EXPIRED` (`401`, reconnect message); a transport failure leaves the old token in place so the next request retries.
- [ ] `chat_url()` = `{base}/chat/completions`. Request body is the incoming OpenAI JSON with `model` set to the resolved upstream id (`cline/<id>` stripped by the registry) and `stream: true` for both paths.
- [ ] Headers: `Authorization: Bearer workos:<access>`, `Content-Type: application/json`, `Accept-Encoding: identity` (D9). A stored token that already carries the `workos:` prefix is not double-prefixed.
- [ ] Non-2xx mapping: `401` → `authentication_error` after one refresh attempt, `402` → `constants::providers::cline::OUT_OF_CREDITS`, other statuses → `upstream_status_error` carrying the upstream message (both error body shapes accepted).
- [ ] Unit tests: body carries the stripped model id and `stream: true`; the header is prefixed exactly once; a due token triggers one refresh and persists the rotation; a token that is not due sends no refresh; `invalid_grant` maps to the reconnect error.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --lib cline`.

### Task 5: stream and non-stream response handling

- [ ] Stream: forward provider SSE bytes through the cross-read line buffer; a `data:` line whose chunk parses to `finish_reason: "error"` or carries a root `error` member becomes `sse::error_event_bytes`; the upstream `data: [DONE]` is passed through as the terminator and never duplicated; a stalled or failed transport still emits an in-stream error through `encode_stream`.
- [ ] Non-stream: aggregate `delta.content`, `delta.reasoning`, fragmented `delta.tool_calls` (per-index reassembly), `finish_reason`, and the final `usage` (including `cost`) into a `chat.completion`, mirroring `opencode/executor.rs`; unwrap `{success: true, data}` first when the body carries that envelope, and surface `{success: false, error}` as an error instead of aggregating it.
- [ ] Tests in `server/tests/cline_provider.rs` against `FakeClineUpstream`: fragmented stream arrives intact and ends with exactly one `[DONE]`; a mid-stream error chunk becomes an error event and not a text delta; non-stream aggregation covers content, reasoning, tool calls, and usage; a wrapped `{success, data}` body unwraps; no connection → `401` with the not-connected message; `/v1/messages` smoke test produces Anthropic events from a Cline stream.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --test cline_provider`, then `--test chat_completions`, `--test messages`, `--test models`, `--test providers`.

### Task 6: live model catalog

Depends on Task 1 (adapter surface) and Task 2 (connection check); independent of Tasks 3-5.

- [ ] `catalog.rs`: `ClineCatalog { fetched_at_ms, attempted_at_ms, models: Vec<String> }` starting from `ClineCatalog::shared_empty()`, plus `parse_model_list(&Value) -> Option<ClineCatalog>` taking `data[].id`, skipping empty ids, sorting for stable comparison, and returning `None` when the response has no usable id (which keeps the current snapshot).
- [ ] `refresh_catalog()`: `GET {base}/models` with `Accept: application/json`, 10 s cap, keep the previous snapshot on any failure (transport, non-2xx, malformed JSON, missing `data`).
- [ ] `maybe_refresh(force)`: skip entirely when `load_cline_credentials()` returns `None` or errors (no SQLite pool, Postgres backend; the same guard qoder already has as `self.database.is_none()`), so a database-less boot never surfaces a catalog error (D4); otherwise the Qoder mechanics: empty snapshot waits behind one mutex with a double check, 30 s retry window on an unfilled snapshot, background refresh once it holds models, `force` breaks through both gates.
- [ ] Trigger points: `main.rs` warmup after the registry is built (spawned, skipped while unconnected), the auth route right after a successful connect (forced), `gateway/models.rs::list_models` and `get_model` (where `refresh`/`force`/`Cache-Control: no-cache` are honored), and `executor.rs` before an upstream call.
- [ ] Tests (`server/tests/models.rs` against the fake upstream): no `cline/` id before the first successful fetch and none while unconnected; a connected fetch advertises `cline/<id>` entries; a failing response leaves the last snapshot intact; the fetch is skipped with no connection row; eight concurrent `/v1/models` reads share one GET; disabling the provider hides its models.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --test models`, then `--test cline_provider`.

### Task 7: backlog sync and quality gates

- [ ] `server/TODO.md` §5: the cline routes live in one combined bullet (`TODO.md:203`) that also covers the openai/antigravity/claude logins, the codebuddy routes, and every `/token` route, so split it first: a ticked cline `device`/`poll` bullet noting that `/v1/auth/cline/token` (contract row 58) is deliberately deferred, the untouched remainder left unchecked; annotate the "Token refresh sweeper" row that the lazy path landed for Cline while the sweeper itself is still open; §4: add the provenance note pointing at `cline/types.rs`.
- [ ] Record deviations where the repo expects them (`server/TODO.md` next to the ticked rows; `docs/api-v1-contract.md` is not edited in a server-only slice).
- [ ] Run: `cargo fmt --manifest-path server/Cargo.toml -- --check`, `cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings`, and the focused test files one at a time: `--lib cline`, `--test provider_auth`, `--test cline_provider`, `--test models`, `--test providers`.
- [ ] `git diff --check`; commit as `feat(server): add Cline provider with WorkOS device-flow OAuth`.

## Review Focus

1. **Provenance.** No line of Rust may derive from `packages/*`; every constant traces to the `cline/types.rs` module doc, which must name the binary offsets and the docs pages.
2. **Credential safety.** Tokens never appear in responses, logs, `request_logs`, or assertion messages; `credentials` is read only in the executor, and the refresh path writes it back through one function.
3. **Refresh correctness.** The 5-minute lead, the 12-hour fallback, and the in-flight de-dupe must all match `apps/api/src/services/tokenRefresh.ts`; a refresh must never clear a still-valid token on a transport error.
4. **Mid-stream errors and `[DONE]`.** An upstream error chunk must not reach clients as text, and the terminator must appear exactly once.
5. **Schema freeze.** `V3_TABLES.len() == 10` must still hold; no migration touched.
6. **Catalog gate.** No connection means no `cline/…` advertisement, and no failed fetch may empty a landed snapshot.
7. **D2 blast radius.** If a real Node-written credential row must be readable beyond the two accepted spellings, stop and request a decision.
8. **No oracle test.** There is no `apps/api/tests/cline*.test.ts`; a reviewer must treat docs and the binary as the reference instead of expecting an oracle file (D10).
9. **`base_url` parity (D8).** Confirm against the running Node build during parity review rather than assuming the constant matches.
10. **Multi-slash model ids.** `cline/<provider>/<model>` must survive the first-slash split everywhere it is used: resolve, advertisement, and error messages.

## Verification

```bash
cargo test --manifest-path server/Cargo.toml --test provider_auth
cargo test --manifest-path server/Cargo.toml --test cline_provider
cargo test --manifest-path server/Cargo.toml --test models
cargo test --manifest-path server/Cargo.toml --test providers
cargo test --manifest-path server/Cargo.toml --lib cline
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
git diff --check
```

No results are recorded yet: this file is the plan, and the recorded pass counts belong to whoever executes it.

Black-box evidence (read, do not modify): `apps/api/src/logic/auth.logic.ts` (`InitiateClineDeviceAuth`, `PollClineDeviceToken`), `apps/api/src/services/authHandlers.ts` (the `cline` handler), `apps/api/src/services/tokenRefresh.ts`. Optional live smoke (network, `#[ignore]`d by default, needs a connected account): `server/tests/cline_live.rs` mirroring `opencode_live.rs`.

## Open questions for live verification

1. Does a successful chat response arrive as plain OpenAI JSON or wrapped in `{success: true, data}`? The defensive unwrap covers both; a live connected request settles it. The 401 probe already proved error bodies are flat `{error: "…"}`.
2. Does upstream accept a request with only `Authorization` and `Content-Type` (D9), or does it require the `X-CLIENT-TYPE` family?
3. What is the real lifetime of an account access token (`expiresAt`)? It decides how often the lazy refresh actually fires.
4. Is `GET /api/v1/models` still public once a bearer token is attached, and does the list differ per account (free vs ClinePass)?
5. Does the Node `CLINE_BASE_URL` constant equal `https://api.cline.bot/api/v1` (D8)?

## Follow-up (do not start without being asked)

- `/v1/auth/cline/token` API-key import and the web API-key tab (contract row 58).
- The background token-refresh sweeper (`server/TODO.md` §5), generalized beyond Cline.
- Callback URL selection and the `:1455` OAuth listener (`SROUTER_PUBLIC_URL`), which Cline does not need today because it has no callback route.
- Registry lifecycle on write: a reconnect currently refreshes the catalog in place, and a disconnect leaves the last fetched list standing until the TTL.
- The authorization-code login path from the binary (`/api/v1/auth/authorize` + `/api/v1/auth/token` with a local callback server), if a browser-redirect login is ever wanted instead of the device flow.

## Appendix: how the binary was read

```bash
strings -n 6 node_modules/cline/bin/.cline > cline-strings.txt
grep -abo '/api/v1/auth/authorize' node_modules/cline/bin/.cline   # locate the auth module
dd if=bin/.cline of=window.bin bs=1M skip=84 count=8               # carve the JS region
```

The bundle is embedded as plain minified JavaScript, so byte-offset carving around markers recovers the original source text without any deobfuscation step.
