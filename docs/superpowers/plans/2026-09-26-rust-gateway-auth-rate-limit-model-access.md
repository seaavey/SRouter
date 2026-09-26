# Rust Gateway Middleware (Auth, Rate Limit, Model Access) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Node API-key auth, fixed-window rate limit, and model allowlist middleware to the Rust gateway so `/v1/chat/completions` and its `/v1/v1` alias enforce the frozen contract.

**Architecture:** Cross-feature HTTP middleware lives in `server/src/http/middleware/`; feature authorization (key records, allowlist matching) lives in `server/src/features/api_keys/` and `server/src/features/admin_auth/`, per the parent plan's ownership rules. Auth is the outermost layer, the rate limit is next, and body validation plus the allowlist check run inside the gateway handler, reproducing the Node order (auth → rate limit → validation → model access). Stores are trait objects reached through `AppState.security`, so behavior is testable with fixtures today while the SQLx-backed implementations stay behind the parent plan's schema gate.

**Tech Stack:** Rust edition 2024 (stable toolchain), axum 0.8, tower 0.5 (dev), futures-util 0.3 (`BoxFuture` for dyn-compatible async traits), sha2 0.10 + hex 0.4 (admin session hashing), sqlx 0.9 (connection plumbing only), serde_json.

**Spec:** `docs/superpowers/specs/2026-09-24-srouter-api-rust-migration-design.md` (migration design), `docs/api-v1-contract.md` (frozen route, error, and middleware behavior), `docs/superpowers/plans/2026-09-24-srouter-api-rust-migration.md` (parent plan: Task 4 router shell, Task 5 schema gate, Task 6 auth/keys).

## Global Constraints

- The Rust crate never imports, reads, or copies `packages/*`; dependencies come from the registry only (parent plan rule).
- Do not write SQL, migrations, or table/column assumptions until the parent plan's schema gate (Task 2 step 3, Task 5) is resolved and approved. Task 6 below is blocked until then.
- Until Task 6 lands, the Rust server runs with empty-store semantics: no API keys exist, `require_api_key` is false, no admin sessions are valid. Remote requests are still rejected. Never point production traffic at the Rust server expecting DB-backed auth, and keep the shadow on alternate ports (`PORT=3001`, `OAUTH_PORT=1456`).
- Error envelopes, status codes, `type`, `code`, and message text are frozen by `docs/api-v1-contract.md` and the parity table below; copy them verbatim.
- Forbidden: `pnpm dev|start|build`, `turbo run dev|start|build`, any dev server or build. Allowed verification: `cd server && cargo fmt --check`, `cargo test`, `cargo test --test <file>`, and `git diff --check`. Docs markdown is prettier-checked from the repo root.
- Conventional Commits, English commit messages; reply to the user in Bahasa Indonesia.
- Every task ends by appending a timestamped entry to `.local/CONTEXT.md` (`YYYY-MM-DD --- HH-MM TZ`) and running `pnpm exec prettier --write .local` plus `git diff --check`.

## Frozen Parity Reference

Auth errors (source: `apps/api/src/middleware/ApiKeyAuth.ts` at the frozen revision, contract: `docs/api-v1-contract.md` §Authentication, CSRF, rate limits, and request size):

| Case                                                                | Status | `type`                  | `code`                | `message`                                                                                                                              |
| ------------------------------------------------------------------- | ------ | ----------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Disabled key                                                        | 401    | `invalid_request_error` | `api_key_disabled`    | `The provided SRouter API Key is disabled`                                                                                             |
| Credit exhausted (`credit_limit > 0 && usage_cost >= credit_limit`) | 402    | `insufficient_quota`    | `insufficient_credit` | `Insufficient credit balance. Your credit limit has been reached.`                                                                     |
| Quota exhausted (`quota_limit > 0 && usage_tokens >= quota_limit`)  | 429    | `insufficient_quota`    | `quota_exceeded`      | `Token quota exceeded. Your lifetime token limit has been reached.`                                                                    |
| Key present but unknown, auth required                              | 401    | `invalid_request_error` | `invalid_api_key`     | `Invalid SRouter API Key`                                                                                                              |
| No key, auth required, remote client                                | 401    | `invalid_request_error` | `missing_api_key`     | `Remote/public requests require a valid SRouter API Key. Please provide your key via 'Authorization: Bearer ***' or 'x-api-key'.`      |
| No key, auth required, loopback client                              | 401    | `invalid_request_error` | `missing_api_key`     | `Missing SRouter API Key. Please provide a valid key via 'Authorization: Bearer ***' header or disable 'Require API Key' in Settings.` |

Rate limit and model access errors keep the status-derived type (`429` → `rate_limit_error`, `403` → `permission_error`); only the two quota errors above override the type.

| Case                | Status | `type`             | `code`                | `message`                                                                                 |
| ------------------- | ------ | ------------------ | --------------------- | ----------------------------------------------------------------------------------------- |
| Rate limit exceeded | 429    | `rate_limit_error` | `rate_limit_exceeded` | `Rate limit exceeded: this API key allows {limit} request{s} per minute.` + `Retry-After` |
| Model not allowed   | 403    | `permission_error` | `model_not_allowed`   | `Model '{model}' is not allowed for this API key`                                         |

Credential and client-identity rules:

- A valid admin session cookie short-circuits everything: no key needed, no rate limit, no allowlist restriction.
- `x-api-key` (any casing) is read first and trimmed; an empty or whitespace-only value counts as absent.
- Otherwise `Authorization` is read: an exact `Bearer ` prefix (case-sensitive) is stripped and the remainder trimmed; any other value is trimmed and used whole. Empty results count as absent.
- `auth_required = require_api_key_setting || !is_loopback(client_address)`.
- The client address comes only from `ConnectInfo<SocketAddr>` (the socket peer). Proxy and client-identifying headers (`Host`, `X-Forwarded-For`, `X-SRouter-Client`, ...) are never trusted. This intentionally drops Node's URL-host fallback, which exists because Hono's `getConnInfo` fails in its test harness and would let a remote client claim `localhost`; the real Rust listener always has connect info.
- `is_loopback_address` lowercases, strips one `::ffff:` prefix, then matches exactly `127.0.0.1` or `::1` (Node's `isLoopbackAddress`), so `127.0.0.2` counts as remote.
- Missing client address → not loopback → remote enforcement and the remote message.

Rate limit algorithm (source: `apps/api/src/middleware/RateLimit.ts`):

- Applies only when the principal carries an API-key record with `rate_limit > 0`; `0` means unlimited. Admin sessions and anonymous requests are never limited.
- Window key is `"{api_key_id}:{client_address_or_unknown}"`; state is per process and shared across both mounts.
- The first request in a window stores `count = 1, reset_at = now + 60_000`. Later requests increment; once `count > limit` the request fails with `Retry-After = max(1, ceil((reset_at - now) / 1000))` seconds.
- A rejected request keeps its increment and its window entry until it expires.
- Before keying, when tracked windows exceed 10_000, expired entries are dropped (expired only; live entries are kept).

Model allowlist (source: `apps/api/src/middleware/ModelAccess.ts`, cases frozen by `apps/api/tests/api-keys-allowed-models.test.ts`):

- `null` or empty list → every model allowed.
- Normalization: strip an exact lowercase `srouter/` prefix, then lowercase.
- Allowed when normalized values match, or `allowed.to_lowercase() == model.to_lowercase()`, or the last `/`-separated segments match while at least one side has a single segment (so `openai/gpt-4o` and `anthropic/gpt-4o` do not match each other).
- An empty requested model skips the check (Node's `if (Model && ...)`).

Ordering (frozen by the Node route composition in `apps/api/src/routes/v1/chat.ts`):

1. Admin session check → 2. key lookup and enabled/credit/quota checks → 3. rate limit → 4. JSON read and validation (`400`) → 5. model allowlist (`403`) → 6. provider resolution.

Known, intentional differences from the Node runtime, to be listed in the pull request:

- Disabled keys always return `401 api_key_disabled`. Node's key lookup filters `enabled = 1` in SQL, so a disabled key on loopback with enforcement off is treated as anonymous; the frozen contract says a disabled key returns `401`, so the Rust store returns the row and the middleware enforces it.
- No URL-host fallback for the client address (spoofing vector, see above).

## File Structure

- `server/src/http/middleware/client_address.rs` — pure client-address and loopback helpers.
- `server/src/http/middleware/api_key_auth.rs` — auth middleware, credential extraction, cookie parsing, auth error constructors.
- `server/src/http/middleware/rate_limit.rs` — `RateLimiter` state plus the rate-limit middleware.
- `server/src/features/api_keys/{mod.rs,model.rs,store.rs,access.rs}` — key record and principal types, key store trait plus empty store, allowlist matching.
- `server/src/features/admin_auth/{mod.rs,session.rs}` — session cookie name, token hashing, session store trait plus empty store.
- `server/src/state.rs` — `SecurityState` and the `AppState::with_security` constructor.
- `server/src/app.rs` — layer composition on the gateway sub-router (before `nest`, so `/` and `/health` stay public).
- `server/src/features/gateway/chat.rs` — allowlist enforcement after body validation, before streaming resolution.
- `server/tests/{api_key_auth,rate_limit,model_access}.rs` — behavior tests against the real router.
- `server/tests/support/mod.rs` — fixture stores, client-address injection helpers, state builders.

No new empty directories; no route/controller/service layer is introduced.

## Task 1: Resolve the client address from the connection

**Files:**

- Create: `server/src/http/middleware/client_address.rs`
- Modify: `server/src/http/middleware/mod.rs`, `server/src/http/listeners.rs`

**Interfaces:**

- `pub fn resolve_client_address(parts: &axum::http::request::Parts) -> Option<String>` returns the `ConnectInfo<SocketAddr>` peer IP, or `None` when connect info is absent.
- `pub fn is_loopback_address(address: &str) -> bool` implements Node's exact-match rule (lowercase, strip one `::ffff:`, then `127.0.0.1` or `::1`).
- `serve_main` switches to `router.into_make_service_with_connect_info::<SocketAddr>()` so the extractor is populated in the real listener.

**Steps:**

- [ ] Write inline `#[cfg(test)]` tests: `loopback_addresses_are_exact` (`127.0.0.1`, `::1` true; `127.0.0.2`, `203.0.113.7`, `localhost`, `""` false), `v4_mapped_loopback_is_normalized` (`::FFFF:127.0.0.1` true), `connect_info_supplies_the_client_address` (`ConnectInfo(SocketAddr::from(([203, 0, 113, 7], 5555)))` → `Some("203.0.113.7")`), `header_only_requests_have_no_client_address` (no connect info, `Host: localhost` and `X-Forwarded-For: 127.0.0.1` → `None`), `connect_info_beats_request_headers` (connect info `203.0.113.7` plus `Host: localhost` → `Some("203.0.113.7")`).
- [ ] Run `cd server && cargo test --lib client_address` and confirm it fails because the module does not exist yet.
- [ ] Implement both functions and register the module in `http/middleware/mod.rs`.
- [ ] Change `serve_main` to `axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())`.
- [ ] Run `cargo test --lib client_address`, then `cargo test`, `cargo fmt --check`, and `git diff --check`.
- [ ] Commit: `feat(server): resolve the gateway client address from the connection`.
- [ ] Append the `.local/CONTEXT.md` entry and format `.local/`.

## Task 2: Add pluggable security state and store traits

**Files:**

- Create: `server/src/features/api_keys/{mod.rs,model.rs,store.rs}`, `server/src/features/admin_auth/{mod.rs,session.rs}`
- Modify: `server/src/features/mod.rs`, `server/src/state.rs`, `server/src/lib.rs`, `server/Cargo.toml`

**Interfaces:**

- `features/api_keys/model.rs`: `pub struct APIKeyRecord { pub id: String, pub enabled: bool, pub rate_limit: u32, pub quota_limit: f64, pub usage_tokens: f64, pub credit_limit: f64, pub usage_cost: f64, pub allowed_models: Option<Vec<String>> }` (derives `Clone, Debug, PartialEq`); `pub enum AuthSource { AdminSession, APIKey, Anonymous }`; `pub struct APIPrincipal { pub source: AuthSource, pub api_key: Option<APIKeyRecord> }` (`AuthSource` derives `Clone, Copy, Debug, PartialEq, Eq`; `APIPrincipal` derives `Clone, Debug` because axum's `Extension` extractor clones the value out of the request). Counters are `f64` because Node stores JS numbers (credit limits can be fractional, e.g. `$10.99`); `rate_limit` is whole requests per minute.
- `features/api_keys/store.rs`: `pub trait APIKeyStore: Send + Sync { fn find_by_key<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<APIKeyRecord>, APIError>>; fn require_api_key(&self) -> BoxFuture<'_, Result<bool, APIError>>; }` plus `pub struct EmptyAPIKeyStore` returning `None` and `false`. Rows come back regardless of `enabled`; the middleware enforces it.
- `features/admin_auth/session.rs`: `pub const ADMIN_SESSION_COOKIE: &str = "srouter_admin_session"`; `pub fn hash_session_token(token: &str) -> String` (SHA-256 lowercase hex, matching Node's `createHash("sha256").digest("hex")`); `pub trait AdminSessionStore: Send + Sync { fn has_valid_session<'a>(&'a self, token_hash: &'a str, now_ms: i64) -> BoxFuture<'a, Result<bool, APIError>>; }` plus `pub struct EmptyAdminSessionStore` returning `false`.
- `state.rs`: `pub struct SecurityState { pub api_keys: Arc<dyn APIKeyStore>, pub admin_sessions: Arc<dyn AdminSessionStore> }` with `SecurityState::new(...)`, `SecurityState::unconfigured()` (both empty stores) and `is_persistence_configured() -> bool`; `AppState::with_security(config, providers, security)` plus `with_registry` delegating to it so existing tests keep compiling.
- `lib.rs` re-exports `SecurityState`; `features/mod.rs` adds `pub mod admin_auth;` and `pub mod api_keys;`.
- `Cargo.toml` adds `sha2 = "0.10"` and `hex = "0.4"` (both already resolved in `Cargo.lock`).

**Steps:**

- [ ] Add the two dependencies and write failing unit tests: `hash_session_token_matches_node` (`sha256("abc")` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`), `empty_api_key_store_reports_no_keys_and_no_requirement`, `empty_admin_session_store_rejects_every_session`, `unconfigured_security_state_reports_no_persistence`.
- [ ] Run `cargo test --lib` and confirm the tests fail (missing modules).
- [ ] Implement the types, traits, empty stores, and `AppState::with_security`; no middleware yet.
- [ ] Run `cargo test` (existing chat/http/database tests must stay green), `cargo fmt --check`, `git diff --check`.
- [ ] Commit: `feat(server): add pluggable api key and admin session stores`.
- [ ] Append the `.local/CONTEXT.md` entry and format `.local/`.

## Task 3: Enforce API-key and admin-session auth on gateway routes

**Files:**

- Create: `server/src/http/middleware/api_key_auth.rs`, `server/tests/api_key_auth.rs`
- Modify: `server/src/http/middleware/mod.rs`, `server/src/app.rs`, `server/src/main.rs`, `server/tests/support/mod.rs`, `server/tests/chat_completions.rs`, `server/tests/opencode_live.rs`

**Interfaces:**

- `pub async fn api_key_auth(State(state): State<AppState>, mut request: Request, next: Next) -> Response`: valid admin session first, then key lookup with enabled/credit/quota checks, then `request.extensions_mut().insert(APIPrincipal {...})` and `next.run(request)`. Every rejection is an `APIError` response from the parity table.
- Helpers with inline unit tests: `request_key(headers: &HeaderMap) -> Option<String>`, `cookie_value(headers: &HeaderMap, name: &str) -> Option<String>`, `pub fn auth_required(require_api_key: bool, client_address: Option<&str>) -> bool` (`require_api_key || !is_loopback_address(address)`).
- `app.rs` applies the layer to the gateway sub-router before nesting: `.layer(from_fn_with_state(state.clone(), api_key_auth))`; `/` and `/health` stay unauthenticated, and both `/v1` and `/v1/v1` inherit it from the shared router clone.
- `main.rs` prints a startup warning while `!state.security.is_persistence_configured()` so a shadow boot cannot look production-ready.
- Test support: `FixtureAPIKeyStore::new(require_api_key: bool, keys: Vec<(String, APIKeyRecord)>)` and `FixtureAdminSessionStore::new(valid_token_hashes: Vec<String>)` implementing the public traits; `with_loopback_client(request)`, `with_remote_client(request, "203.0.113.7")` injecting `ConnectInfo<SocketAddr>`; `app_state_with_fake_upstream_and_security(security) -> (FakeUpstream, AppState)`.
- Tests build configuration the way `app_state_with_fake_upstream` already does (`HOME=/tmp/srouter-test-home`) and assemble state with `AppState::with_security(config, ProviderRegistry::new(), security)`; an empty registry keeps every request off the network and turns "passed the middleware" into a deterministic `404`.

**Steps:**

- [ ] Write `server/tests/api_key_auth.rs` against `create_router` with an empty `ProviderRegistry::new()`: `anonymous_loopback_requests_pass_when_the_requirement_is_off`, `loopback_requests_need_a_key_when_the_requirement_is_on`, `remote_requests_need_a_key_even_when_the_requirement_is_off`, `a_valid_key_passes_and_identifies_the_principal`, `an_unknown_key_returns_invalid_api_key_when_required`, `an_unknown_key_passes_anonymously_when_not_required_and_loopback`, `a_disabled_key_returns_api_key_disabled`, `exhausted_credit_returns_402_insufficient_credit`, `exhausted_quota_returns_429_quota_exceeded`, `credit_is_checked_before_quota`, `a_valid_admin_session_cookie_passes_without_a_key`, `an_unknown_admin_session_cookie_does_not_pass`, `x_api_key_wins_over_the_authorization_header`, `a_bare_authorization_value_is_treated_as_a_key`, `whitespace_only_credentials_are_treated_as_missing`, `spoofed_client_headers_do_not_change_the_decision`, `the_v1_v1_alias_is_protected_too`, `rejections_keep_the_frozen_security_headers`.
- [ ] Asserts: exact `message`, `code`, and `type` from the parity table for every rejection; "passes" means the request reached the handler, observed as `404` from the empty registry.
- [ ] Run `cargo test --test api_key_auth` and confirm it fails (no middleware yet).
- [ ] Implement the middleware, credential/cookie extraction, and error constructors; add inline unit tests for `request_key`, `cookie_value`, and `auth_required`.
- [ ] Wire the layer in `app.rs`, add the startup warning, and update the existing request builders (`chat_completions.rs` helpers plus its inline request near line 272, `opencode_live.rs`) to inject loopback connect info.
- [ ] Run `cargo test --test api_key_auth`, then `cargo test`, `cargo fmt --check`, `git diff --check`. Boot smoke check: `cd server && PORT=3801 cargo run`, then `curl -i -X POST localhost:3801/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"does-not-exist","messages":[{"role":"user","content":"hi"}]}'` returns `404` (loopback anonymous passed auth), and repeating with `-H 'Host: example.com' -H 'X-Forwarded-For: 127.0.0.1'` still returns `404`; `Ctrl-C` exits `0`.
- [ ] Commit: `feat(server): enforce api key and admin session auth on gateway routes`.
- [ ] Append the `.local/CONTEXT.md` entry and format `.local/`.

## Task 4: Enforce the fixed-window rate limit

**Files:**

- Create: `server/src/http/middleware/rate_limit.rs`, `server/tests/rate_limit.rs`
- Modify: `server/src/http/middleware/mod.rs`, `server/src/state.rs`, `server/src/app.rs`, `server/tests/support/mod.rs`

**Interfaces:**

- `pub struct RateLimiter` with `WINDOW_MS: i64 = 60_000`, `MAX_TRACKED_KEYS: usize = 10_000`, `new()`, `with_max_tracked(max_tracked: usize)`, `check(&self, window_key: &str, limit: u32, now_ms: i64) -> Option<u64>` (`None` allowed, `Some(retry_after_seconds)` rejected) and `tracked_windows(&self) -> usize` for the eviction test. State is `Mutex<HashMap<String, Window>>` with a short critical section and no `.await` inside.
- `pub async fn rate_limit(State(state): State<AppState>, request: Request, next: Next) -> Response`: reads `APIPrincipal` from request extensions, skips principals without a key record or with `rate_limit == 0`, and on rejection returns the `429` envelope with `Retry-After` set.
- `SecurityState` gains `pub rate_limiter: Arc<RateLimiter>`; `unconfigured()` and `new(...)` construct one.

**Steps:**

- [ ] Write inline unit tests: `limit_zero_is_unlimited`, `requests_up_to_the_limit_pass`, `the_request_over_the_limit_returns_the_retry_after`, `the_window_resets_after_sixty_seconds`, `windows_are_isolated_per_key_and_address`, `expired_windows_are_evicted_above_the_cap` (uses `with_max_tracked(2)`, then asserts `tracked_windows()` dropped the expired entries).
- [ ] Run `cargo test --lib rate_limit` and confirm failure.
- [ ] Implement `RateLimiter` and the middleware; add unit tests for the `"{id}:{address}"` key and the `unknown` fallback.
- [ ] Write `server/tests/rate_limit.rs`: `requests_beyond_the_key_limit_return_429_with_retry_after` (`Retry-After` parses to `1..=60`), `an_unlimited_key_is_never_rate_limited`, `admin_session_and_anonymous_requests_are_not_rate_limited`, `rate_limiting_runs_before_body_validation` (malformed JSON: first request `400`, next `429`), `auth_runs_before_the_rate_limit` (unknown key stays `401`, never `429`).
- [ ] Wire the layer in `app.rs` as `.layer(from_fn_with_state(state.clone(), rate_limit))` immediately before the auth layer (the last layer added runs first, so auth stays outermost).
- [ ] Run `cargo test --test rate_limit`, then `cargo test`, `cargo fmt --check`, `git diff --check`.
- [ ] Commit: `feat(server): enforce fixed-window api key rate limits`.
- [ ] Append the `.local/CONTEXT.md` entry and format `.local/`.

## Task 5: Enforce API-key model allowlists

**Files:**

- Create: `server/src/features/api_keys/access.rs`, `server/tests/model_access.rs`
- Modify: `server/src/features/api_keys/mod.rs`, `server/src/features/gateway/chat.rs`, `server/tests/support/mod.rs`

**Interfaces:**

- `pub fn normalize_model_id(model: &str) -> String` (strip exact `srouter/`, then lowercase), `pub fn is_model_allowed(allowed_models: Option<&[String]>, model: &str) -> bool`, `pub fn ensure_model_allowed(api_key: Option<&APIKeyRecord>, model: &str) -> Result<(), APIError>` returning the frozen `403 model_not_allowed` envelope.
- `create_completion` takes `principal: Option<Extension<APIPrincipal>>` (kept optional so direct handler calls stay valid) and calls `ensure_model_allowed(principal.as_ref().and_then(|p| p.api_key.as_ref()), &chat_request.model)?` right after `parse_chat_completion_request`, before the streaming branch and provider resolution.

**Steps:**

- [ ] Write inline unit tests mirroring `apps/api/tests/api-keys-allowed-models.test.ts`: `null`/empty list allows everything, membership enforcement, `srouter/` prefix both directions, bare vs provider-qualified both directions, `openai/gpt-4o` does not match `anthropic/gpt-4o`, `openai/gpt-4o` does not match `openai/gpt-4o-mini`, case-insensitive matching, empty model skipped.
- [ ] Run `cargo test --lib access` and confirm failure.
- [ ] Implement `access.rs` and wire the handler call.
- [ ] Write `server/tests/model_access.rs`: `a_disallowed_model_returns_403_model_not_allowed`, `an_allowed_model_reaches_the_provider` (allowlist `space-bunny-free`, request `opencode_zen/space-bunny-free` through the fake upstream returns `200`), `an_admin_session_is_not_restricted`, `an_unrestricted_key_is_not_restricted`, `invalid_json_fails_before_the_model_check` (missing `messages` with a disallowed model returns `400`, not `403`).
- [ ] Run `cargo test --test model_access`, then `cargo test`, `cargo fmt --check`, `git diff --check`.
- [ ] Commit: `feat(server): enforce api key model allowlists on chat completions`.
- [ ] Append the `.local/CONTEXT.md` entry and format `.local/`.

## Task 6: Back the stores with SQLx — BLOCKED, do not start

Gated by the parent plan: Task 2 step 3 ("For every field/relation required by Rust, cite an allowed independent source … If the existing database schema cannot be established this way, stop persistence implementation and ask for an independent schema contract") and Task 5. Nothing in Tasks 1–5 depends on it.

**Blocking decision:** an approved schema contract for the key/session tables (an explicit contract, or a disposable database created through the Node public API and inspected out of band). `packages/db` schema source remains off-limits.

**Planned deliverable once unblocked:** `SQLxAPIKeyStore` and `SQLxAdminSessionStore` in `server/src/infrastructure/database/`, implementing the exact traits from Task 2 against `AppDatabase` for both SQLite and PostgreSQL, decoding `rate_limit` as an integer and the credit/quota/usage counters as `f64` (Node stores JS numbers; fractional credit values exist), parsing `allowed_models` as a JSON string into `Option<Vec<String>>` (empty array → `None`), and comparing session expiry against `now_ms`. `main.rs` then builds `SecurityState::new(...)` from `AppDatabase` and the startup warning disappears.

**Tests to add when unblocked:** repository round-trips against an isolated temporary database (never `~/.srouter/srouter.db`), `require_api_key` on/off, disabled/expired rows, and a rerun of the Task 3–5 behavior tests with the SQLx stores to prove envelope parity.

**Commit:** `feat(server): back api key auth with sqlx stores`.

## Follow-ups (explicitly out of scope)

- Reuse these layers when `/v1/messages`, `/v1/images/generations`, `/v1/logs/events`, and `/v1/models` land; `models` additionally filters its list by the same allowlist.
- The OAuth listener (`:1455`) proxies `/v1` chat/messages in Node; it must reuse this same gateway router so the middleware applies there too.
- Admin login throttling (five failures per address → 15-minute block), CSRF origin guard, CORS, and the global 25 MiB body limit stay with their parent-plan tasks.
- Key CRUD (`/v1/keys`) and usage/quota accounting (reservation and settlement) belong to `features/api_keys/` in later slices.

## Review Focus

The failure modes the frozen contract implies, each owned by a task's tests:

1. Spoofed identity: `Host`, `X-Forwarded-For`, and `X-SRouter-Client` must never change an auth or rate-limit decision (Tasks 1 and 3).
2. Ordering: `401` beats `429`, `429` beats `400`, and `400` beats `403` (Tasks 3–5).
3. Envelope exactness for the two `insufficient_quota` cases (`402`/`429`) whose `type` overrides the status default (Task 3).
4. Limiter state: isolation per key ID and address, eviction bound, unlimited `0`, and admin/anonymous exemption (Task 4).
5. Allowlist semantics: `srouter/` stripping, bare vs provider-qualified matching in both directions, cross-provider rejection, case-insensitivity, and empty model (Task 5).
