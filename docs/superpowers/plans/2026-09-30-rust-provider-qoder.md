# Qoder Provider (OAuth-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new built-in provider `qoder` to the Rust gateway (`server/`) — device-flow OAuth connect plus inference through Qoder's COSY-signed SSE endpoint — so `qd/<model>` resolves, streams, and returns OpenAI-compatible responses.

**Architecture:** One new provider module (`features/providers/qoder/`) owning protocol constants, the COSY signer/codec, and the executor, wired into the existing `ProviderAdapter` enum exactly like `opencode`. One new route module (`features/provider_auth/`) serving the three contract routes `/v1/auth/qoder/{login,poll,callback}`. Credentials are read by the executor straight from the `providers` row at request time (the registry is static and is built before `AppState`, so adapters cannot take part in handler dependency injection), while a TTL-refreshed model snapshot fetched from `model/list` lives inside the qoder adapter so the advertised list stays current without rebuilding the registry (Task 7). No new table: `oauth_sessions` and `providers.credentials` already exist (`server/migrations/0002_v2_schema.sql`; current `user_version` is 3).

**Tech Stack:** Rust edition 2024 (stable), axum 0.8, sqlx 0.9 (SQLite), reqwest 0.13 (rustls), serde/serde_json, tokio 1. New crates this slice: `md-5` (COSY signature), `aes` + `cbc` (AES-128-CBC info encryption), `rsa` (PKCS#1 v1.5 `Cosy-Key` wrapping). `base64`, `sha2`, `uuid` (v4), `hex`, `getrandom` are already present.

**Spec:** `docs/api-v1-contract.md` "Retained route inventory" rows 57–65 (route shapes), `docs/api-database-contract.md` (schema v2 ownership), `apps/api/src/routes/v1/auth.ts` + `apps/api/src/logic/auth.logic.ts` + `apps/api/src/controllers/auth.controller.ts` (flow semantics and response bodies), `apps/api/tests/qoder-provider.test.ts` (black-box oracle for the device flow).

---

## Analisis Qoder (independent protocol analysis)

Everything below was derived from Qoder's own public surface, not from `packages/*`. Sources, recorded here for `server/TODO.md` §4 "Catalog provenance":

1. `apps/api/tests/qoder-provider.test.ts` — pins the authorize URL, the poll/userinfo paths, and the stored provider row shape (allowed oracle: `apps/api` tests).
2. `apps/api/src/logic/auth.logic.ts`, `apps/api/src/controllers/auth.controller.ts` — flow order, response bodies, session lifecycle.
3. `docs/api-v1-contract.md` rows 57–65 — frozen route inventory.
4. Independent protocol documentation: the MIT `pi-qoder-provider` npm package (`cosy.ts`, `stream.ts`, `qoder-encoding.ts`, `models.ts`, `README.md`), the `fengyinxia/qoder2api` and `City-Zero/qodercli2api` reverse-engineering READMEs (OpenAPI + `Cosy-*` header tables, request/response envelope), and `docs.qoder.com`.
5. `apps/docs/src/pages/docs/concepts/providers-routing.md` — public model prefix table (`qoder/*`).

Cross-check note: the COSY RSA public key, the header set, the body encoding, and the endpoint hosts are byte-identical between sources 4 and the Node constants, so the independent analysis and the existing Node implementation agree.

### Endpoints (Global region)

| Purpose             | URL                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Authorize (browser) | `https://qoder.com/device/selectAccounts?challenge=<S256>&challenge_method=S256&machine_id=<id>&nonce=<state>`                          |
| Device token poll   | `GET https://openapi.qoder.sh/api/v1/deviceToken/poll?nonce=<state>&verifier=<code_verifier>&challenge_method=S256`                     |
| User info           | `GET https://openapi.qoder.sh/api/v1/userinfo` (`Authorization: Bearer <token>`)                                                        |
| Chat (SSE)          | `POST https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1` |
| Model catalog       | `GET https://api3.qoder.sh/algo/api/v2/model/list` (COSY-signed GET, empty body)                                                        |

China/VPC hosts (`gateway.qoder.com.cn`, `openapi.qoder.com.cn`, `*.vpc.qoder.com.cn`) are a documented follow-up, not this slice.

Both HTTP calls send `User-Agent: qodercli/1.0.0` and `Accept: application/json`.

### Device flow (OAuth-only scope)

1. `GET /v1/auth/qoder/login` → generate `state` (UUID) + PKCE `code_verifier`, persist an `oauth_sessions` row, return `{authorizeUrl, state, codeVerifier, redirectUri}` (raw JSON via `Ok`, `302` redirect when `format=json` is absent).
2. Browser authorizes; client polls `GET /v1/auth/qoder/poll?state=…`.
3. Poll calls upstream `deviceToken/poll`: `202`/`404` → `{status:"pending"}`; `200` → `{token, refresh_token?, user_id?, expires_in|expires_at}`. Missing `expires_in` defaults to **30 days**.
4. On success: delete the session row, `GET /userinfo` for `name`/`email`/`organization_id`, upsert a `providers` row (`id = qoder_<ms>`, `provider_id = "qoder"`, `category = "oauth"`, `protocol = "openai"`, name `Qoder (<name>)`, credentials JSON) and return `{status:"ok", provider:{…}}`.
5. `GET|POST /v1/auth/qoder/callback` reads `code` + `state` from query, JSON body, or `callback_url`; for Qoder `code` is the nonce, so the callback reuses the same poll exchange. Missing values → `400` `invalid_request_error`. Success → `{success:true, message:"Login Qoder Berhasil!", provider}`.

Device tokens are long-lived (30 days) and the Node flow performs **no refresh** for them (`refreshTokens` echoes the existing token), so this slice stores `refresh_token` but does not schedule refresh work.

### Inference: COSY-signed request

Body is a Qoder-specific JSON envelope (not OpenAI):

```
{request_id, request_set_id, chat_record_id, session_id, stream:true, chat_task:"FREE_INPUT",
 is_reply:true, is_retry:false, source:1, version:"3", session_type:"qodercli",
 agent_id:"agent_common", task_id:"common", code_language:"", chat_prompt:"", image_urls:null,
 aliyun_user_type:"", system, messages[], tools[], parameters:{max_tokens},
 chat_context:{chatPrompt:"", imageUrls:null, extra:{context:[], modelConfig:{key,is_reasoning},
 originalContent:<last user text>}, features:[], text:<last user text>},
 model_config:{key, is_reasoning, max_output_tokens, source}, business:{product:"cli",
 version:"1.0.0", type:"agent", stage:"start", id, name:<first 30 chars of last user text>, begin_at}}
```

- `messages`/`tools` are plain OpenAI shape; `system` is the joined system prompt lifted out of `messages[0]`.
- `session_id` = first 16 hex of `sha256("qoder-session" ‖ uid ‖ model_key)`; `request_set_id`/`chat_record_id` = first 16 hex of `sha256("qoder-record" ‖ model ‖ each role/content ‖ tools ‖ "mt=<max_tokens>")`.
- **Body encoding (`Encode=1`):** `base64_std(body)` → let `a = n/3` → rotate as `std[n-a..] + std[a..n-a] + std[..a]` → map each char through the 66-char custom alphabet, `=` → `$`. Purely reversible, no key involved.
- **Headers:** `Authorization: Bearer COSY.<payload_b64>.<md5_hex>`, `Cosy-Key`, `Cosy-User`, `Cosy-Date`, `Cosy-Version`, `Cosy-Machineid`, `Cosy-Machinetoken`, `Cosy-Machinetype`, `Cosy-Machineos`, `Cosy-Clienttype`, `Cosy-Clientip`, `Cosy-Bodyhash`, `Cosy-Bodylength`, `Cosy-Sigpath`, `Cosy-Data-Policy`, `Cosy-Organization-Id`, `Cosy-Organization-Tags`, `Login-Version`, `X-Request-Id`, plus `X-Model-Key`, `X-Model-Source`, `Content-Type: application/json`, `Accept: text/event-stream`, `Cache-Control: no-cache`, `Accept-Encoding: identity`.
- `payload_b64` = `base64(JSON{version:"v1", requestId, info, cosyVersion:"1.0.0", ideVersion:""})`.
- `info` = AES-128-CBC (`key == iv == 16-char hex`) of `JSON{uid, security_oauth_token, name, aid:"", email}` → base64.
- `Cosy-Key` = RSA PKCS#1 v1.5 encrypt of the AES key with the fixed 1024-bit public key (SPKI PEM, constant below) → base64.
- Signature input = `payload_b64 ‖ "\n" ‖ Cosy-Key ‖ "\n" ‖ Cosy-Date ‖ "\n" ‖ encoded_body ‖ "\n" ‖ sigPath` → MD5 hex. `sigPath` = URL path with a leading `/algo` stripped (`/api/v2/service/pro/sse/agent_chat_generation`).
- `Cosy-Bodyhash` = MD5 hex of the encoded body bytes; `Cosy-Bodylength` = its byte length; both are ASCII-safe.
- Static client constants: `Cosy-Version`/`cosyVersion` `1.0.0`, `Cosy-Clienttype` `5`, `Cosy-Machinetype` `5`, `Cosy-Machineos` `x86_64_windows`, `Cosy-Data-Policy` `disagree`, `Login-Version` `v2`, `Cosy-Clientip` `127.0.0.1`.

```
-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----
```

### Response: wrapped SSE envelope (the part that is not OpenAI)

```
data: {"headers":{…},"body":"{\"choices\":[{\"delta\":{…},\"finish_reason\":null}]}","statusCodeValue":200}
event: finish
```

- Each `data:` line is an envelope; `body` is a **stringified** OpenAI chat chunk (`delta.content`, `delta.reasoning_content`, `delta.tool_calls[]` fragmented per index, `finish_reason`, `usage`).
- `statusCodeValue != 200` carries an error message in `body` → surface as an in-stream error event.
- There is **no `data: [DONE]`** and no OpenAI framing at all. The Rust gateway forwards provider bytes verbatim to `/v1/chat/completions` clients and parses `data:` OpenAI chunks in `/v1/messages`, so the executor must translate: envelope → `data: {openai_chunk}`, and append a terminal `data: [DONE]`.
- Frames arrive **fragmented across TCP reads** (the exact failure mode already fixed in `opencode/executor.rs`). Lines must be reassembled in a buffer across reads; parsing per network chunk silently drops events.

### Model catalog

Static seed for phase 1 (provenance: independent sources above, cross-checked for drift against the Node catalog):

| id              | name                      | kind                     |
| --------------- | ------------------------- | ------------------------ |
| `auto`          | Qoder Auto                | tier                     |
| `ultimate`      | Qoder Ultimate            | tier (reasoning, 1M ctx) |
| `performance`   | Qoder Performance         | tier (reasoning)         |
| `efficient`     | Qoder Efficient           | tier                     |
| `lite`          | Qoder Lite                | tier                     |
| `qmodel`        | Qwen 3.7 Plus (Qoder)     | frontier                 |
| `qmodel_latest` | Qwen 3.7 Max (Qoder)      | frontier                 |
| `dmodel`        | DeepSeek V4 Pro (Qoder)   | frontier (reasoning)     |
| `dfmodel`       | DeepSeek V4 Flash (Qoder) | frontier (reasoning)     |
| `gm51model`     | GLM 5.2 (Qoder)           | frontier (reasoning)     |
| `kmodel`        | Kimi K2.7 (Qoder)         | frontier                 |
| `mmodel`        | MiniMax M3 (Qoder)        | frontier                 |

Friendly-name aliases resolve to keys: `qwen3.7-max→qmodel_latest`, `qwen3.7-plus→qmodel`, `deepseek-v4-pro→dmodel`, `deepseek-v4-flash→dfmodel`, `glm-5.2→gm51model`, `kimi-k2.7→kmodel`, `minimax-m3→mmodel`. The live catalog (`model/list`, Task 7) is authoritative: a COSY-signed GET with an **empty body** (`Cosy-Bodylength: "0"`, `Cosy-Bodyhash = md5("")`, `Cosy-Sigpath: /api/v2/model/list`) returning plain JSON `{chat:[…]}` — not an SSE envelope — with the entry shape in the endpoint table above.

### Failure modes to handle

| Symptom                              | Cause                                               | Handling                                                                                    |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Opaque HTTP 500 from upstream        | missing/blank `uid` in `Cosy-User`                  | resolve identity via `/userinfo` at connect time and persist it; never invent a placeholder |
| `CSRFInvalid`                        | request hit a dashboard host instead of the gateway | fixed Global hosts in this slice; message documents the VPC requirement                     |
| `401`/expired token after 30 days    | device token lapsed                                 | `401 authentication_error` with a "reconnect Qoder" message                                 |
| empty answer with small `max_tokens` | reasoning deltas consumed the budget                | default `max_tokens` 32768, capped by the request                                           |
| dropped stream events                | per-chunk line parsing                              | cross-read line buffer (unit test with a fragmented fake)                                   |

---

## Context

`server/` today registers exactly one driver (`opencode_zen`) in a **static** `ProviderRegistry`, has no `features/provider_auth/` module at all, and never reads `providers.credentials` (documented in `server/src/infrastructure/database/providers.rs:2`). `oauth_sessions` has existed since schema v2 (`server/migrations/0002_v2_schema.sql:85-94`) with no Rust reader. The adapter enum (`features/providers/adapter.rs:26`) already carries the extension point this slice needs: adding a variant + delegating methods.

Relevant gateway contracts the executor must satisfy:

- `chat.rs:345` calls `adapter.chat_completion_stream(...)` and then either forwards the bytes verbatim (once it sees a text delta) or parses `data:` OpenAI chunks for tool interception — either way the provider stream must be OpenAI SSE, terminated by `data: [DONE]`.
- `messages.rs:433-460` parses `data:` OpenAI chunks to build Anthropic events.
- Non-streaming goes through `adapter.chat_completion(...)`, which must return a full `chat.completion` JSON.
- `ProviderAdapter` is built before `AppState` exists (`main.rs:25`), so per-request credential lookup happens inside the executor, not in a handler.

## Global Constraints

- **Only `server/` changes.** `apps/api`, `apps/web`, `apps/docs`, `packages/*` are untouched; `apps/api` stays byte-identical (oracle).
- No data or code may be read, imported, or copied from `packages/*` — provenance for every constant is recorded in the analysis above and must be re-recorded as a module doc comment in `qoder/types.rs`.
- No new table and no migration edit: `oauth_sessions` and `providers.credentials` are already owned by `server/migrations/0002_v2_schema.sql`, and the schema is at `user_version` 3. `server/tests/schema.rs` asserts `V3_TABLES.len() == 10`; if that count changes, the migration itself must be re-decided — do not bump it silently.
- New `server/Cargo.toml` dependencies are allowed in this slice (crypto has no std equivalent); keep the set to `md-5`, `aes`, `cbc`, `rsa`.
- OAuth only: `/v1/auth/qoder/login`, `/callback`, `/poll`. The `/v1/auth/qoder/token` import route, PAT handling, and bulk-PAT import are **out of scope** (documented deviation — see Follow-up).
- `credentials` never enters a handler response or a log line; it is read only inside the executor and written only by the auth routes.
- SQL uses `?` placeholders with `.bind()`; row mapping uses `try_get` with `map_err`; no `unwrap()`/`expect()` in production code (tests may `expect`).
- Tests use `support::TestDatabase` only; never `~/.srouter/srouter.db`, never a real Qoder credential, never the live upstream (a `#[ignore]`d live test is optional and must be off by default).
- Focused verification only: one `cargo test --test <file>` at a time, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`. Never root `pnpm test`/`pnpm build`.
- Code, comments, identifiers, commit messages English; comments explain _why_. Conventional Commits (`feat(server): …`).

## Decisions

- **D1 — Credential plumbing.** `ProviderRegistry::with_defaults()` becomes `with_defaults() == with_database(None)`, and `main.rs` builds the registry with `Some(database.clone())`. The `QoderExecutor` stores `Option<AppDatabase>` and loads its row per request (one `SELECT`, WAL-local; a cache would hide reconnects). No `OnceLock`, no new trait, no DI layer.
- **D2 — Credential JSON shape.** The `credentials` column layout is not covered by `docs/api-database-contract.md` ("provider record layout is unknown") and its only writer lives in `packages/*`, which this plan may not read. Rust therefore defines its own layout — `{"access_token", "refresh_token", "token_expires_at", "last_refreshed_at", "provider_specific_data":{...}}` — and its reader accepts the camelCase aliases (`accessToken`, `refreshToken`, `expiresAt`) as a compatibility fallback. Reading rows written by a Node build beyond those two spellings is **not** claimed; it needs an explicit decision (see Review Focus).
- **D3 — Registry shape.** Register the adapter statically at boot with keys `["qoder", "qd"]` and user-facing alias `qd` (so `/v1/models` lists `qd/<key>`), matching the alias the Node registry resolves `qd/ultimate` against. Consequence: `qd/*` models are advertised even with no connection, and a request without one fails with a clear `authentication_error` instead of `404`. Dynamic registration on connect is a follow-up (TODO §4 "Registry lifecycle on write").
- **D4 — Model catalog.** The static seed from the analysis table is the initial value and the permanent fallback. Task 7 refreshes a live snapshot from `model/list` on a 5-minute TTL (boot, successful connect, `/v1/models`, pre-request), and `refresh=true`/`force=true` only zero that TTL check — the static registry itself still treats those params as accepted-but-ignored (`registry.rs:94`).
- **D5 — Auth URLs are testable.** The auth module takes an endpoint struct with `Default` (`login_url`, `device_token_url`, `userinfo_url`) so the fake upstream can be injected; production defaults are the Global hosts.
- **D6 — Scope of the OAuth listener.** Callbacks are mounted on the main listener under `/v1` only. The `:1455` listener (TODO §1.4) is a separate slice; `SROUTER_PUBLIC_URL` handling is not re-implemented here.

## File Structure

| File                                                   | Responsibility                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/Cargo.toml`                                    | modify — add `md-5`, `aes`, `cbc`, `rsa`                                                                                                                                 |
| `server/src/features/providers/qoder/mod.rs`           | new — module wiring + `adapter()`, `adapter_with_base_url_and_db()` constructors                                                                                         |
| `server/src/features/providers/qoder/types.rs`         | new — endpoints, client constants, RSA key, model catalog + aliases, `QODER_PROVIDER` metadata, provenance doc comment                                                   |
| `server/src/features/providers/qoder/cosy.rs`          | new — body encode/decode primitives, AES/RSA/MD5 header signer (pure functions)                                                                                          |
| `server/src/features/providers/qoder/executor.rs`      | new — request build, signed POST/GET, envelope→OpenAI translation, non-stream aggregation                                                                                |
| `server/src/features/providers/qoder/catalog.rs`       | new — `QoderCatalog` snapshot, `ModelConfig`, `parse_chat_list`, seed fallback, TTL refresh helpers                                                                      |
| `server/src/features/providers/qoder/tests.rs`         | new — unit tests for codec, signer inputs, request body, envelope translation                                                                                            |
| `server/src/features/providers/mod.rs`                 | modify — `pub mod qoder;` + re-exports                                                                                                                                   |
| `server/src/features/providers/adapter.rs`             | modify — `ProviderAdapter::Qoder` variant + delegating `id/keys/alias/models/chat_completion/chat_completion_stream`; `models()` returns `Vec<ModelDefinition>` (Task 7) |
| `server/src/features/providers/registry.rs`            | modify — register qoder in `with_defaults()`; `with_database(...)` constructor                                                                                           |
| `server/src/features/provider_auth/mod.rs`             | new — router export (`create_qoder_auth_router`)                                                                                                                         |
| `server/src/features/provider_auth/qoder.rs`           | new — login / poll / callback handlers + session lifecycle                                                                                                               |
| `server/src/infrastructure/database/oauth_sessions.rs` | new — save / claim / release / delete / cleanup-expired                                                                                                                  |
| `server/src/infrastructure/database/providers.rs`      | modify — `upsert_qoder_connection`, `load_qoder_credentials`                                                                                                             |
| `server/src/infrastructure/database/mod.rs`            | modify — register `pub mod oauth_sessions;`                                                                                                                              |
| `server/src/constants.rs`                              | modify — `providers::qoder::*` message catalog                                                                                                                           |
| `server/src/app.rs`                                    | modify — mount `create_qoder_auth_router()` (admin-session layered except `callback`)                                                                                    |
| `server/src/main.rs`                                   | modify — build the registry with the live database                                                                                                                       |
| `server/tests/support/mod.rs`                          | modify — `FakeQoderUpstream` (chat + model list + device poll + userinfo, fragmented SSE mode) and a registry helper                                                     |
| `server/tests/provider_auth.rs`                        | new — login / poll / callback HTTP tests                                                                                                                                 |
| `server/tests/qoder_provider.rs`                       | new — signed request shape, stream translation, non-stream aggregation, no-connection error                                                                              |
| `server/tests/models.rs`                               | modify — dynamic catalog refresh (`model/list`) assertions, TTL no-op, seed fallback                                                                                     |
| `server/TODO.md`                                       | modify — tick the Qoder rows of §5, add §4 provenance note                                                                                                               |

---

### Task 1: module skeleton, catalog, and registry wiring

- [ ] `server/src/features/providers/qoder/types.rs`: endpoints, static client constants, RSA PEM, `QODER_MODELS: &[ModelDefinition]`, alias map, `QODER_PROVIDER: ProviderMetadata { id: "qoder", name: "Qoder", category: "oauth", protocol: "openai", base_url, web_url: "https://qoder.com", requires_api_key: false, requires_oauth: true, supports_custom_url: false, status_message }`, plus a module doc comment listing the five provenance sources from the analysis.
- [ ] `mod.rs` exporting `QODER_*` constants and placeholder `adapter()`/`adapter_with_base_url_and_db()` constructors (executor body lands in Task 5).
- [ ] Add `ProviderAdapter::Qoder(QoderExecutor)` and its seven delegating methods in `adapter.rs`.
- [ ] `registry.rs`: `with_defaults()` → `with_database(None)`; register `qoder::adapter()?` next to `opencode::adapter()?`.
- [ ] `main.rs`: build with `ProviderRegistry::with_database(Some(database.clone()))?`.
- [ ] Tests: extend `registry.rs` unit tests — `resolve("qd/auto")`, `resolve("qoder/auto")`, `resolve("auto")` (bare advertised id), `disabled_keys` reports both keys, `list_models` emits `qd/<key>` with `owned_by == "qd"`.

### Task 2: COSY codec and signer (pure functions)

- [ ] `cosy.rs::encode_body(&[u8]) -> String` implementing the rotate + custom-alphabet transform, and `decode_body(&str) -> Result<Vec<u8>, …>` used only by tests/diagnostics (documented as such).
- [ ] `cosy.rs::sign(body, url, identity, machine_id, timestamp, request_id) -> CosyHeaders` producing the full header map: AES-128-CBC `info`, RSA `Cosy-Key`, `payload_b64`, MD5 signature, body hash/length, `sigPath` (strip a leading `/algo`).
- [ ] `CosyIdentity { uid, auth_token, name, email }` — `uid` empty is a hard error (`constants::providers::qoder::MISSING_UID`), never a placeholder.
- [ ] Unit tests (`tests.rs`): encode↔decode round-trip including `=` padding, alphabet mapping and rotation for `n % 3 == 0/1/2`; signature input string built exactly as specified (assert against a fixed fixture); `sigPath` strips `/algo` and leaves other paths; header map contains every required key; RSA output decodes as base64 of 128 bytes (1024-bit key).
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --lib qoder`, `cargo fmt --check`.

### Task 3: OAuth session and credential stores

- [ ] `infrastructure/database/oauth_sessions.rs`: `save(state, code_verifier, client_id, redirect_uri)` (`client_id`/`redirect_uri` stored as `""` for the device flow), `claim(state) -> Option<OAuthSession>` (marks `claimed_at`, refuses a second concurrent claim, refuses rows older than 15 minutes), `release(state)` (clears `claimed_at`), `delete(state)`, `cleanup_expired(older_than_ms)`. Semantics are documented as a deviation to re-verify at parity review, because the Node implementations live in `packages/db` (out of bounds).
- [ ] `infrastructure/database/providers.rs`: `upsert_qoder_connection(...)` writing `id`, `provider_id="qoder"`, `name`, `category="oauth"`, `protocol="openai"`, `enabled=1`, `credentials` (D2 shape), `meta` (no `__seed__` marker), `created_at` — upsert on `id`; and `load_qoder_credentials(database) -> Option<QoderCredentials>` returning the newest non-seed `qoder` row's access/refresh/expiry/identity, accepting camelCase aliases.
- [ ] Both fail loudly when `database.sqlite_pool()` is `None` or the backend is Postgres, reusing `postgres_unsupported()`.
- [ ] Unit/integration tests inside `server/tests/provider_auth.rs`: save→claim→release→claim→delete lifecycle, expired-row rejection, camelCase credential fallback, no-rows → `None`.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --test provider_auth`.

### Task 4: `/v1/auth/qoder/{login,poll,callback}`

- [ ] `features/provider_auth/mod.rs` + `qoder.rs`: `login` (admin session) reading optional `client_id`, `redirect_uri`, `prompt`, `format=json`; builds the authorize URL with `challenge=<S256(code_verifier)>`, `challenge_method=S256`, `machine_id`, `nonce=<state>`; returns `{authorizeUrl, state, codeVerifier, redirectUri}` or `302`.
- [ ] `poll` (admin session, `GET`+`POST`) reading `state` from query or JSON body: missing → `400`; unknown/expired session → `{status:"pending", error:"Session expired or not found"}`; upstream `202`/`404` → `{status:"pending"}` (release the claim first); upstream error → release + `{status:"pending", error}`; success → delete session, `/userinfo`, upsert connection, generate/persist the machine id (`settings.qoder_machine_id`), return `{status:"ok", provider:{…}}`.
- [ ] `callback` (public, `GET`+`POST`) reading `code`/`state` from query, JSON, or `callback_url`; missing → `400 invalid_request_error` with `constants::providers::qoder::CALLBACK_MISSING_PARAMS`; success → `{success:true, message:"Login Qoder Berhasil!", provider}`.
- [ ] `constants.rs`: add `providers::qoder` messages (missing state, session expired, upstream poll failure, empty token, missing uid, token expired, not connected) — every client-facing string lives there, matching `constants::providers` style.
- [ ] `app.rs`: mount the router; `login`/`poll` behind `require_admin_session`, `callback` unauthenticated; all under the existing CSRF/body-limit layers. No `/v1/v1` alias (TODO §6).
- [ ] Tests (`server/tests/provider_auth.rs`) against `FakeQoderUpstream`: login JSON shape + authorize URL query params; poll pending→ok; poll with missing state → 400; callback without `code`/`state` → 400; callback success body; unauthorized login/poll → 401; provider row + credentials persisted (assert keys only, never values in assertion messages).
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --test provider_auth`.

### Task 5: executor — request build and signed upstream call

- [ ] `executor.rs`: `QoderExecutor { id, keys, base_url, models, db: Option<AppDatabase>, client: UpstreamClient }`.
- [ ] `build_request(model, request) -> Value`: strip system prompt, normalize messages (`user`/`assistant`/`tool` + `tool_call_id`, images as `image_url` data URLs), pass tools through, derive `session_id`/`request_set_id`/`chat_record_id`, resolve `model_config` from the catalog (`key`, `is_reasoning`, `max_output_tokens`), clamp `parameters.max_tokens` to the model's cap (default 32768).
- [ ] `credentials()` → `QoderCredentials` from `load_qoder_credentials`, mapping: no database → `constants::providers::qoder::DATABASE_REQUIRED`; no row → `qoder::NOT_CONNECTED` (`401`); expired (`token_expires_at` in the past) → `qoder::TOKEN_EXPIRED` (`401`).
- [ ] `chat_url()` = `{base}/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`.
- [ ] POST with `encode_body(...)` and the COSY header map; non-2xx → `upstream_stream_status_error` / `upstream_status_error`.
- [ ] Unit tests: produced JSON contains every required top-level field; `system` is lifted out of `messages[0]`; `parameters.max_tokens` clamp; `X-Model-Key` equals the resolved key.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --lib qoder`.

### Task 6: envelope → OpenAI translation (stream and non-stream)

- [ ] `translate_stream(upstream) -> ProviderStream`: cross-read line buffer → `data:` line → envelope JSON → error envelope (`statusCodeValue != 200`) becomes `sse::error_event_bytes`; otherwise parse `body`, normalize the chunk (`id: chatcmpl-<hex>`, `object: "chat.completion.chunk"`, `created`, `model`, `choices[0].index = 0`, `delta`, `finish_reason`, `usage`) and emit `data: <chunk>\n\n`. Terminate with `data: [DONE]\n\n` when upstream ends. Wrap with `encode_stream` so stalls/transport failures still produce an in-stream error instead of hanging.
- [ ] `chat_completion(...)`: always POST with `stream:true`, aggregate `delta.content`, `delta.reasoning_content`, fragmented `delta.tool_calls` (per-index reassembly), `finish_reason`, `usage` → `chat.completion` JSON mirroring `opencode/executor.rs` (estimate usage when upstream omits it).
- [ ] Tests in `server/tests/qoder_provider.rs` using `FakeQoderUpstream` with a **fragmented** SSE writer (frame split mid-`data:`): stream test asserts every chunk arrives, the last byte is `[DONE]`, and tool-call fragments reassemble; non-stream test asserts the aggregated message, `finish_reason`, and usage; error-envelope test asserts an in-stream `error` event; no-connection test asserts `401` + message; `/v1/messages` smoke test asserts Anthropic events are produced from a Qoder stream.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --test qoder_provider`, then `--test chat_completions`, `--test messages`, `--test models`, `--test providers` (regressions from the registry change).

### Task 7: dynamic model catalog (`model/list`)

Depends on Task 2 (signer) and Task 5 (executor + credentials); independent of Task 6.

- [ ] Widen the adapter surface so a catalog can change at runtime: `ProviderAdapter::models()` and both impls return `Vec<ModelDefinition>` instead of `&'static [ModelDefinition]` (the OpenCode adapter returns its static slice as a `Vec`); update `registry.rs:86,111` and the two slice-equality asserts in `opencode/tests.rs`.
- [ ] New `qoder/catalog.rs`: `QoderCatalog { fetched_at_ms, models: Vec<ModelDefinition>, configs: BTreeMap<String, ModelConfig> }` plus `ModelConfig { key, is_reasoning, max_output_tokens, source, is_vl }` and `QoderCatalog::seed()` built from `QODER_MODELS`.
- [ ] `parse_chat_list(&Value) -> QoderCatalog`: skip entries with an empty `key` or `enable != true`; `name = display_name` (fallback `key`); context = `max_input_tokens`, else the largest `context_config.*.token_count`, else `180000`; max output = `max_output_tokens` (default `32768`); `is_reasoning = is_reasoning || thinking_config.is_some()`; `source = "system"` unless the entry carries another; sort by `key` so repeated fetches compare equal.
- [ ] Hold the snapshot in `QoderExecutor` as `Arc<RwLock<QoderCatalog>>` seeded from `QoderCatalog::seed()`; `models()` is `snapshot.models.clone()`, so the advertised list is the seed until the first successful fetch.
- [ ] `refresh_catalog()`: COSY-signed `GET {base}/algo/api/v2/model/list` with an **empty body** (`Cosy-Bodylength: "0"`, `Cosy-Bodyhash = md5("")`, `Cosy-Sigpath: /api/v2/model/list`, `Accept: application/json`, `Accept-Encoding: identity`), parse `chat[]`, write the snapshot. On any failure — transport, non-2xx, malformed JSON, missing `chat` — keep the previous snapshot and return `Err`; **a catalog is never emptied**.
- [ ] `maybe_refresh(ttl)`: no-op when `fetched_at_ms` is fresher than the TTL (5 minutes) or no credentials exist; otherwise `tokio::spawn` the refresh and return immediately (fire-and-forget — no request ever waits on the network).
- [ ] Trigger points: `main.rs` right after the registry is built (spawn, drop the handle), `provider_auth/qoder.rs` immediately after a successful poll (the first fetch after connect), `gateway/models.rs::list_models` before reading the registry (this is where `refresh=true`/`force=true` zeroes the TTL check), and `executor.rs` before an upstream call.
- [ ] `build_request` prefers the snapshot's `ModelConfig` when filling `model_config` (`key`, `is_reasoning`, `max_output_tokens`, `source`) and falls back to the static table for a key the catalog does not know (alias resolution happens first, so `qd/qwen3.7-max` → `qmodel`).
- [ ] Tests (`server/tests/models.rs` and `qoder_provider.rs` against the fake upstream's `model/list` route): a refresh replaces the seed with the fetched keys under the `qd/` prefix; `enable: false` and keyless entries are dropped; a failing or `chat`-less response leaves the seed intact; the GET carries `Cosy-Bodylength: "0"` and `Cosy-Sigpath: /api/v2/model/list`; `build_request` picks up `is_reasoning` from the snapshot; a second read inside the TTL issues no second upstream GET.
- [ ] Verify: `cargo test --manifest-path server/Cargo.toml --test models`, then `--test qoder_provider`.

### Task 8: contract notes, backlog sync, quality gates

- [ ] `server/TODO.md` §5: tick the `qoder` login/callback rows and the "PKCE + state lifecycle" row (Qoder scope), annotate that `/v1/auth/qoder/token` and PAT flows are deliberately deferred; §4: add the provenance note pointing at `qoder/types.rs`.
- [ ] Document deviations where the repo expects them: `docs/api-v1-contract.md` "Scope" is _not_ edited in this slice (server-only constraint); instead the deviations are recorded in `server/TODO.md` next to the ticked rows — if a contract edit is wanted, it is a follow-up decision.
- [ ] Run: `cargo fmt --manifest-path server/Cargo.toml -- --check`, `cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings`, and the focused test files one at a time: `--lib qoder`, `--test provider_auth`, `--test qoder_provider`, `--test models`.
- [ ] `git diff --check`; commit as `feat(server): add Qoder provider with device-flow OAuth`.

## Review Focus

1. **Provenance.** No line of Rust may derive from `packages/*`; every constant traces to `qoder/types.rs`'s module doc.
2. **Credential safety.** Tokens never appear in responses, logs, `request_logs`, or assertion messages; `credentials` is read only in the executor.
3. **Fragmented SSE.** The translation must buffer across reads — this is the exact bug class already fixed once in `opencode/executor.rs:167-170`.
4. **`[DONE]` termination.** The gateway does not append it; if the executor forgets it, clients hang after the last chunk.
5. **Schema freeze.** `V3_TABLES.len() == 10` must still hold; no migration touched.
6. **D2 blast radius.** If a real Node-written credential row must be readable, stop and request a decision instead of guessing more key spellings.
7. **Static advertisement.** Confirm `qd/*` models showing up before any connection is acceptable (D3), or move to registry lifecycle work first.
8. **Catalog safety.** A failed or malformed `model/list` response must never empty the advertised list — the adapter keeps its previous snapshot, and a fetch-less build still serves the seed (Task 7).

## Verification

```bash
cd server
cargo test --manifest-path server/Cargo.toml --test provider_auth
cargo test --manifest-path server/Cargo.toml --test qoder_provider
cargo test --manifest-path server/Cargo.toml --test models
cargo test --manifest-path server/Cargo.toml --lib qoder
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
git diff --check
```

Black-box evidence for the auth flow (read, do not modify): `apps/api/tests/qoder-provider.test.ts`.
Optional live smoke (network, ignored by default, needs a real connected account): `server/tests/qoder_live.rs` mirroring `opencode_live.rs`, run with `-- --ignored`.

## Follow-up (do not start without being asked)

- `/v1/auth/qoder/token` PAT import + the web's PAT/bulk-PAT tabs (contract rows 61).
- Quota/usage: `GET /api/v2/quota/usage` behind `/v1/quota`.
- China/VPC hosts and `jobToken/exchange` + `jobToken/refresh` PAT lifecycle.
- The `:1455` OAuth listener and `SROUTER_PUBLIC_URL` callback selection (TODO §1.4).
- Registry rebuild on connect/disconnect so `qd/*` is advertised only while connected.
