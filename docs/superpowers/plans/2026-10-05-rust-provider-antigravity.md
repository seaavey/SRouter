# Antigravity Provider (OAuth + Gemini-native executor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Antigravity inference executor to the Rust gateway (`server/`): `/v1/auth/antigravity/{login,callback,token}` serves the Google OAuth PKCE flow and token import, and `AntigravityExecutor` serves `/v1/chat/completions` (stream + non-stream aggregation) through Google's CloudCode IDE envelope, advertising a static 17-model catalog that is gated on an existing connection.

**Architecture:** One provider module (`features/providers/antigravity/`) owning protocol constants, the static catalog, and the Gemini⇄OpenAI translation, plus one auth module (`features/provider_auth/antigravity.rs`) mirroring the OpenAI/Qoder PKCE pattern. The executor reads its connection from the `providers` row at request time (the static-registry pattern Cline/Codex/CodeBuddy established), bootstraps a Google project id once via `loadCodeAssist`, and reuses the existing background token sweeper (`main.rs`) by implementing `sweep_tokens`. No new table, no migration: `providers.credentials` and `oauth_sessions` already exist.

**Tech Stack:** Rust edition 2024 (stable), axum 0.8, sqlx 0.9 (SQLite), reqwest 0.13 (rustls), serde/serde_json, tokio 1. No new crates (sha2/base64/uuid/getrandom already present for PKCE).

**Spec / provenance:** `apps/api` (route/controller/handler semantics + `apps/api/tests/antigravity-provider.test.ts`), `packages/providers/src/oauth/antigravity.ts` and `packages/executors/src/antigravity.ts` + `packages/translator/src/antigravity.ts` (behavioural oracle), reverse-engineering notes in `.local/NOTES.md` (official binary `agy`, 2026-10-04), the public OmniRoute repository (`diegosouzapw/OmniRoute`, `open-sse/executors/antigravity*`), and live probes on 2026-10-05.

---

## Analisis Antigravity (independent protocol analysis)

Sources, recorded here for `server/TODO.md` §4 "Catalog provenance":

1. Reverse engineering of the official client binary `agy` (`.local/NOTES.md`, 2026-10-04): OAuth authorize/token endpoints, embedded client id/secret pair (verified byte-equal against `packages/constants/src/providers/antigravity.ts`), `cloudcode-pa` / `daily-cloudcode-pa` hosts, `v1internal:streamGenerateContent` / `v1internal:loadCodeAssist`, envelope literals (`requestType`, `userAgent`, `skip_thought_signature_validator`, `thought_signature`, `functionDeclarations`, `GOOGLE_ONE_AI`), UA literal `antigravity/ide/2.1.1`, `x-goog-api-client` value `gl-node/18.0.0 gd/1.0.0`, 13 of the 17 catalog ids.
2. Live probes without credentials on 2026-10-05:
    - Google authorize accepts `redirect_uri` on **any loopback origin, any path** (`localhost:3000`, `localhost:1455`, `localhost:5173` → `302 signin`) and the registered `https://antigravity.google/oauth-callback`; **any public URL is rejected** (`redirect_uri_mismatch`, verified against `srouter.example.com` and `example.com`).
    - `oauth2.googleapis.com/token` requires `client_secret` for both `authorization_code` and `refresh_token` grants (PKCE alone → `400 client_secret is missing`).
    - Unauthenticated `POST https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` → `401`, so no unauthenticated model endpoint exists.
3. OmniRoute public repository: alias table `gemini-3.x-flash-tiered` (PR #10882), `gemini-3.5-flash-high` → `gemini-3-flash-agent` confirmed working (issue #3763), `claude-opus-4-x-thinking` family live (issue #1926), always-stream endpoint (non-stream `generateContent` 400s on some models), minimal content headers + `Authorization: Bearer`.
4. `apps/api` + `packages/*` (allowed oracle): handler config, PKCE params, envelope/contents/tools construction, stream translation, aggregation.

### Endpoints used by this slice

| Purpose           | URL                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Authorize         | `GET https://accounts.google.com/o/oauth2/v2/auth`                                        |
| Token exchange    | `POST https://oauth2.googleapis.com/token` (form-encoded, `client_secret` required)       |
| Project bootstrap | `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`                      |
| Chat (stream)     | `POST https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse` |

Scope: `openid profile email https://www.googleapis.com/auth/cloud-platform` (Node oracle; the binary requests seven scopes, the extra four are not known to be required — recorded as an open question). `access_type=offline`, `prompt=consent` (overridable via `?prompt=`), PKCE S256.

### Wire behavior (from the Node oracle, corroborated above)

- **Envelope:** `{ project, model, userAgent: "antigravity", requestType: "agent", requestId, request }`, plus `enabledCreditTypes` when set.
- **requestId:** `agent/{conversation-uuid}/{timestamp}/{trajectory-uuid}/{step}` (5 segments, regex `^agent/[^/]+/\d+/[^/]+/\d+$`; conversation/trajectory are sha256-derived UUIDs seeded from the session id). The binary's `agent/jetski/%s/%d` and OmniRoute's short `agent/{ts}/{hex8}` are recorded as known variants, not ported.
- **Headers:** `Content-Type: application/json`, `User-Agent: antigravity/ide/2.1.1 darwin/arm64`, `Authorization: Bearer *** `x-goog-api-client: gl-node/18.0.0 gd/1.0.0`for`ya29.`tokens;`x-goog-api-key`for`AIzaSy` keys.
- **Model mapping (upstream wire name):** `3.8-flash-{high,medium,low}` → `gemini-3.8-flash-tiered`; `3.7-flash-{high,medium,low}` → `gemini-3.7-flash-tiered`; `3.5-flash-high` → `gemini-3-flash-agent`; `3.1-pro-high` → `gemini-pro-agent`; `3.5-flash-medium` → `3.5-flash-low`; `3.5-flash-low` → `3.5-flash-extra-low`; others pass through. Pro family carries a 400-fallback chain: `[gemini-pro-agent, <id>, gemini-3-pro]`.
- **Body:** OpenAI messages → Gemini `contents` (roles remapped, tool calls → `functionCall`, tool results → `functionResponse`, images → `inlineData`, zero-width characters stripped, trailing assistant turn stripped); `tools` → `functionDeclarations` with the JSON-schema cleanup list (drop `additionalProperties`, `$ref`, `format`, …) and `toolConfig: {functionCallingConfig: {mode: "VALIDATED"}}`; `generationConfig` = `maxOutputTokens` clamped by family cap (thinking/opus/sonnet 64000, pro/flash 65536, else 8192), `topP` (default 1.0), `topK: 40`, optional `temperature`.
- **Streaming is the only chat path:** non-stream callers run the SSE stream and accumulate (mirrors Node `chatCompletion`); each Gemini SSE frame becomes an OpenAI chunk frame, stream ends with exactly one `data: [DONE]\n\n` (the Rust gateway does not add `[DONE]`).
- **Retries:** next model candidate only on HTTP 400 (pro chain); one credits retry with `["GOOGLE_ONE_AI"]` on 429/`RESOURCE_EXHAUSTED`/quota text. No generic fetch retry (CodeBuddy/Codex precedent).
- **Errors:** non-2xx → `Antigravity Provider Error ({status}): {body}` with a `Retry-After` hint parsed from quota messages.

### Static model catalog (17 ids)

Owner ruling 2026-10-05: full 17-id Node parity. Provenance per group:

| Ids                                                                                                                                                                                        | Provenance                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `gemini-3.8-flash-{high,medium,low}`, `gemini-3.7-flash-{high,medium,low}`, `gemini-3.6-flash-{high,medium,low}`, `gemini-3.5-flash-low`, `gemini-3.1-pro-{high,low}`, `claude-sonnet-4-6` | literal in the `agy` binary + display name in its model table (13 ids)                                                       |
| `gemini-3.5-flash-high`, `gemini-3.5-flash-medium`                                                                                                                                         | display names in the binary; wire targets `gemini-3-flash-agent` / `3.5-flash-low` confirmed live via OmniRoute #3763/#10882 |
| `claude-opus-4-6-thinking`                                                                                                                                                                 | OmniRoute issue #1926 (`claude-opus-4-x-thinking` family)                                                                    |
| `gpt-oss-120b-medium`                                                                                                                                                                      | OmniRoute live notes (non-stream `generateContent` 400 → always-stream)                                                      |

Gated exactly like Node `listModels`: no connection → empty list (no `antigravity/*` advertised); connection present → the 17 ids. There is no unauthenticated catalog endpoint (probe 401), so the list is static by necessity, not by choice.

---

## Decisions

- **D1: Follow the SRouter Node oracle for wire behavior and route semantics**; independent sources (binary RE, OmniRoute, live probes) corroborate and, where they conflict with untested Node paths, decide (see D3/D7).
- **D2: Static 17-id catalog gated on the exact connection** (`provider_id = "antigravity"`); `maybe_refresh` only checks credentials and flips the shared snapshot — no upstream fetch.
- **D3: Loopback-pinned callback redirect (deviation from `default_callback_uri`'s public-url branch).** Probe-proven: Google rejects any non-loopback redirect for this client, so `SROUTER_PUBLIC_URL` is ignored for the antigravity redirect URI. Remote completions flow through the existing `callback_url` paste path. Documented in the module doc.
- **D4: Single-port callbacks.** Browser lands on a root HTML page `GET|POST /auth/antigravity/callback` (like OpenAI/Qoder); the JSON API lives at `GET|POST /v1/auth/antigravity/callback`. The Node `:1455` listener is not ported (owner ruling, `TODO.md` §1.4).
- **D5: Project bootstrap via `loadCodeAssist`.** On first use of a `ya29.` token, resolve `cloudaicompanionProject` and persist it in the connection credentials; fall back to a generated id (`{adj}-{noun}-{uuid5}`) when the call fails. Deviation from Node's quasi-random `ensureProjectId` — matches the binary and both independent clients (OmniRoute, claudex).
- **D6: Token refresh follows the Codex pattern**: `TOKEN_REFRESH_LEAD_MS` 5 min, per-connection mutex, existing `main.rs` sweeper; `grant_type=refresh_token` with `client_secret` (probe-proven required); persist rotated refresh tokens.
- **D7: Static chat endpoint** `ANTIGRAVITY_IDE_BASE_URL` (`daily-cloudcode-pa`); the per-connection `base_url` is not honored (CodeBuddy D7 precedent). `AIzaSy` keys switch the auth header only; the OpenAI-compat fallback executor is deferred.
- **D8: Always the SSE endpoint**; non-stream = accumulate. The `image_gen` request path is not ported (no image model in the catalog) — follow-up.
- **D9: Headers kept minimal** (Content-Type, pinned IDE UA, Authorization, `x-goog-api-client` for `ya29.`).
- **D10: Seed append, not insert.** `ANTIGRAVITY_PROVIDER` goes last in `SEED_PROVIDERS`: `total` assertions move 7 → 8 and `categories.oauth[0] == "qoder"` stays true.

## File Structure

| File                                                     | Responsibility                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `server/src/features/providers/antigravity/mod.rs`       | module wiring + re-exports                                                                                        |
| `server/src/features/providers/antigravity/types.rs`     | `ANTIGRAVITY_PROVIDER`, 17-id static catalog, OAuth/endpoint constants, provenance doc, unit tests                |
| `server/src/features/providers/antigravity/translate.rs` | envelope + requestId, contents/tools builders, schema cleanup, Gemini SSE → OpenAI chunks, accumulate, unit tests |
| `server/src/features/providers/antigravity/executor.rs`  | credential load, project bootstrap, headers, stream/non-stream, 400-cascade, credits retry, `sweep_tokens`        |
| `server/src/features/provider_auth/antigravity.rs`       | `create_antigravity_login_router[_with_endpoints]`, callback, token import                                        |
| `server/src/features/providers/mod.rs`                   | modify: `pub mod antigravity;` + re-exports, `ANTIGRAVITY_PROVIDER` appended to `SEED_PROVIDERS`                  |
| `server/src/features/providers/registry.rs`              | modify: register the adapter, `antigravity_endpoints()` accessor                                                  |
| `server/src/infrastructure/database/providers.rs`        | modify: `AntigravityCredentials`, load/upsert/update-token helpers                                                |
| `server/src/constants.rs`                                | modify: `providers::antigravity` messages (`NOT_CONNECTED`, success/import texts)                                 |
| `server/src/app.rs`                                      | modify: mount login (admin), `/v1` callback (public), root browser callback page                                  |
| `server/tests/support/mod.rs`                            | modify: `FakeAntigravityUpstream`, `antigravity_registry`, connect helper                                         |
| `server/tests/antigravity_auth.rs`                       | new: login URL params, callback semantics, token import, admin guards                                             |
| `server/tests/antigravity_provider.rs`                   | new: gating, envelope, translation, streaming, aggregation, retries, refresh                                      |
| `server/tests/providers.rs`                              | modify: seed `total` 7 → 8 (two assertions)                                                                       |
| `server/TODO.md`                                         | modify: split the combined rows, mark the landed Antigravity parts                                                |

---

### Task 1: types, catalog, and credential storage

- [ ] `types.rs`: `ANTIGRAVITY_PROVIDER` (id `antigravity`, category `oauth`, protocol `openai`, base `https://daily-cloudcode-pa.googleapis.com`, `requires_oauth: true`, status message), `ANTIGRAVITY_MODEL_IDS` (17), OAuth constants (client id/secret from `packages/constants`, authorize/token/loadCodeAssist/chat URLs), `AntigravityEndpoints { chat_url, token_url, code_assist_url }` with `Default`. Module doc names the four provenance sources and the D3/D5/D7 deviations.
- [ ] `infrastructure/database/providers.rs`: `AntigravityCredentials { access_token, refresh_token, expires_at, project_id }` + `load_antigravity_credentials` (newest enabled row) + `upsert_antigravity_connection` (mirrors `upsert_qoder_connection`) + token-update helper.
- [ ] Unit tests: credentials parse (snake/camel fallbacks), model-id list contents (`gemini-3.7-flash-high` present).

### Task 2: OAuth routes

- [ ] `provider_auth/antigravity.rs` reusing `provider_auth/mod.rs` helpers (`pkce_challenge`, `pkce_verifier`, `parse_callback`, `text_field`, `query_params`, `error_page`, `success_page`):
    - `GET /v1/auth/antigravity/login` (admin): reads `client_id`, `redirect_uri`, `prompt`, `format=json`; builds the Google authorize URL (`access_type=offline`, `prompt=consent` default, S256 challenge); default redirect = **loopback** `…/auth/antigravity/callback` (D3 — `SROUTER_PUBLIC_URL` ignored); `format=json` → `{authorizeUrl, state, codeVerifier, redirectUri}`, else 302.
    - `GET|POST /v1/auth/antigravity/callback` (public): query / JSON body / `callback_url` paste; exchange `authorization_code` + verifier + `client_secret` at the (injectable) token URL; persist the connection `antigravity_{timestamp}`, category `oauth`, protocol `openai`, name from `id_token` email via `email_from_token` else fallback; missing `code`/`state` → `400`, unknown state → `500 Invalid or expired OAuth state parameter`.
    - `GET|POST /auth/antigravity/callback` (root): browser HTML success/error page (D4, mirrors OpenAI/Qoder).
    - `POST /v1/auth/antigravity/token` (admin): `access_token`/`accessToken` required, `refresh_token`/`refreshToken` optional, `name` optional → same persistence; `201` + provider payload; missing token → `400`.
- [ ] `constants.rs::providers::antigravity`: `NOT_CONNECTED` plus the exact oracle texts (`Login Antigravity OAuth Berhasil!`, `Antigravity Access Token registered and saved directly to SQLite database!`).
- [ ] `app.rs`: mount login behind `require_admin_session`, callback public, root page behind `body_limit`.

### Task 3: translation layer

- [ ] `translate.rs` — pure functions ported from `packages/translator/src/antigravity.ts`:
    - `build_ide_request_id` (5-segment format, sha256-seeded UUID v5 layout) + `build_envelope`.
    - `parse_model_name` (alias table) + `model_fallbacks` (pro 400-cascade) + `output_cap` (family caps).
    - `build_contents` (roles, text, `inlineData` images from data URIs; remote URLs → SSRF-guarded fetch or text placeholder, mirroring the async/sync split), zero-width strip, trailing-assistant-turn strip, textual tool-call parse.
    - `build_tools` + JSON-schema cleanup list + `toolConfig VALIDATED`.
    - `gemini_stream_to_openai_chunks` (state: first `assistant` role delta, text → `content`, thought parts → `reasoning_content`, `functionCall` → `tool_calls` with generated ids, `finishReason` mapping, `usageMetadata` → `usage`) and `accumulate_chunks` (content, reasoning, per-index tool calls, last non-null finish, last usage).
- [ ] Unit tests: requestId matches the oracle regex; every alias row maps as specified; caps; schema cleanup drops the unsupported keys; role remap; chunk conversion for a text frame, a thought frame, a `functionCall` frame, and an `usageMetadata` frame; accumulation shape.

### Task 4: executor

- [ ] `AntigravityExecutor { endpoints, database, client, catalog: Arc<RwLock<..>>, refresh_locks }` implementing `ProviderExecutor`:
    - `models()` from the snapshot; `maybe_refresh` flips the snapshot on/off based on `load_antigravity_credentials` (D2), and runs the D5 project bootstrap when a `ya29.` token lacks a project id.
    - `chat_completion_stream`: ensure fresh token (`token_refresh_is_due` + D6 refresh against the injectable token URL), build envelope, `POST {chat_url}/v1internal:streamGenerateContent?alt=sse`, translate frames, re-frame `data: …\n\n`, end with one `[DONE]`; 400 → next cascade candidate; 429/quota → one `GOOGLE_ONE_AI` retry; non-2xx → typed error with retry hint.
    - `chat_completion`: run the stream and accumulate (D8).
    - `sweep_tokens`: refresh near-expiry antigravity connections (picked up by the existing sweeper loop — no `main.rs` change).
- [ ] `registry.rs`: register the adapter + `antigravity_endpoints()` accessor for test injection.

### Task 5: wiring and seed

- [ ] `mod.rs`: `pub mod antigravity;`, re-exports, `ANTIGRAVITY_PROVIDER` appended to `SEED_PROVIDERS` (D10).
- [ ] Registry default test: the default registry advertises **no** antigravity model (catalog gated on connection, same shape as the qoder test).

### Task 6: tests

- [ ] `tests/support/mod.rs`: `FakeAntigravityUpstream` (chat SSE leg with Gemini frames, token leg for exchange/refresh, `loadCodeAssist` leg), `antigravity_registry(db, endpoints)`, `connect_antigravity`.
- [ ] `tests/antigravity_auth.rs` (oracle: `apps/api/tests/antigravity-provider.test.ts` + `auth-providers.test.ts`):
    - login URL starts `https://accounts.google.com/o/oauth2/v2/auth`, contains `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, encoded `state`; default redirect is loopback `/auth/antigravity/callback`; `format=json` response shape; admin guard 401.
    - callback: missing `code`/`state` → 400; unknown state → 500; happy path exchanges against the fake token URL and persists `antigravity_{timestamp}` with `category=oauth`, `protocol=openai`, tokens stored; `callback_url` paste path.
    - token import: id matches `^antigravity_\d+$`, tokens persisted, `201`; missing `access_token` → 400; admin guard 401.
- [ ] `tests/antigravity_provider.rs` (fake upstream only):
    - not connected → 401 `NOT_CONNECTED`; connected → `models()` = 17 ids incl. `gemini-3.7-flash-high`; disconnected again → empty.
    - request captured: envelope keys, requestId regex, wire model name (`gemini-3.7-flash-high` → `gemini-3.7-flash-tiered`), headers (UA, `x-goog-api-client`), `maxOutputTokens` clamped to 65536, `topK: 40`, tools → `functionDeclarations` + `VALIDATED` + cleaned schema, contents role mapping + tool call/response parts.
    - SSE → OpenAI frames + single `[DONE]`; non-stream aggregation (content, finish, usage).
    - 400 → cascade candidate retried; 429 → one `GOOGLE_ONE_AI` retry; expired credentials → refresh against the fake token URL and persistence.
- [ ] `tests/providers.rs`: `total` 7 → 8 in both catalog tests; `oauth[0] == "qoder"` unchanged.

### Task 7: backlog sync and quality gates

- [ ] `server/TODO.md` §4: add the Antigravity provenance paragraph (binary RE + OmniRoute + probes). §5: split the combined rows (antigravity vs claude/commandcode/…) and mark the landed antigravity parts (login/callback/token/executor) only.
- [ ] `cargo fmt --check`; `cargo clippy --all-targets -- -D warnings`; `cargo test --lib antigravity`; `cargo test --test antigravity_auth --test antigravity_provider --test providers`.
- [ ] `prettier --check server/TODO.md` (changed files only); `git diff --check`.

## Verification

```bash
cd /root/SRouter/server
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --lib antigravity
cargo test --test antigravity_auth --test antigravity_provider --test providers
```

## Open questions for live verification

1. Does upstream require a real `loadCodeAssist` project id, or does any `project` string pass? (D5 ships the real bootstrap with a generated fallback, so both cases work; a live connection answers whether the fallback ever surfaces.)
2. Do the four ids without binary literals (`gemini-3.5-flash-{high,medium}`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`) answer on this account? The catalog advertises them per the owner ruling; a live chat decides whether to prune.
3. Are the four extra binary scopes needed for `streamGenerateContent`? Node's four-scope token is the shipped default (D-scope, see analysis); a `403` on first live chat would add scopes from the binary's list.
4. Does Google rotate `refresh_token` on refresh? (D6 already persists a rotated token when returned.)

## Follow-up (do not start without being asked)

- `image_gen` request path (`requestType: "image_gen"`, non-stream `generateContent`) once an image model is advertised.
- OpenAI-compatible fallback executor for local proxies / `AIzaSy` keys on an `/openai` base (Node parity), and honoring a per-connection `base_url`.
- Generic transient fetch retry (`fetchWithRetry` in Node) if live traffic shows flakiness.
