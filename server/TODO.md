# TODO — Rust API parity and Node API retirement

Working backlog for the Rust migration (`server/`). Every unchecked item is a behavior that
`apps/api` (Node/Hono) still serves and that `server/` does not implement yet, or migration
plumbing that is still missing before `apps/api` can be deleted.

Sources of truth:

- Design: `docs/superpowers/specs/2026-09-24-srouter-api-rust-migration-design.md`
- Plan: `docs/superpowers/plans/2026-09-24-srouter-api-rust-migration.md`
- Frozen contract: `docs/api-v1-contract.md`
- Persistence contract: `docs/api-database-contract.md`
- Repo rules: `AGENTS.md` (no `pnpm dev` / `pnpm build` / `turbo`, focused tests only)

Status legend: `[x]` done and covered by a Rust test, `[ ]` missing, `[~]` partial (see note).

## Ground rules

- `apps/api/**` stays byte-identical until the parity gates below pass. It is the oracle and the
  rollback path; nothing may be deleted because a feature "looks" migrated.
- No Rust file, migration, migration fixture, build script, or codegen input may read, import, or
  copy code or data from `packages/*`. Ports are built from `apps/api` route/controller/service
  source, `apps/api/tests`, and independent protocol documentation only.
- Cloudflare Tunnel (`/v1/tunnel/*`, `services/cloudflareTunnel.ts`) is a deliberate exclusion:
  Rust must return not-found for it after cutover, and that removal is a documented contract change.
- Tests always use disposable databases (`server/tests/support/mod.rs`); never `~/.srouter/srouter.db`
  and never a production `DATABASE_URL`.
- Verify a slice only with `cargo test --manifest-path server/Cargo.toml --test <file>`,
  `cargo fmt --check`, `cargo clippy -- -D warnings`, plus the matching Node test file read as
  black-box evidence. Do not run root `pnpm test` / `pnpm build`.

---

## 1. HTTP runtime shell

### 1.1 Static web serving and SPA fallback

- [x] `server/src/http/static_files.rs` mounted from `server/src/app.rs`.
      Node evidence: `apps/api/src/index.ts:148-170` (`resolveWebDistPath()`, `serveStatic`,
      SPA fallback to `index.html`), `apps/api/src/services/webDist.ts`,
      `apps/api/tests/web-dist.test.ts`.
      `resolve_web_dist` resolves `WEB_DIST_PATH` when set, otherwise searches the repository- and
      app-relative `dist` candidates, and requires `<dist>/index.html`; when it resolves, `app.rs`
      mounts `serve_static` as the router fallback and `GET /` and unmatched GETs serve the SPA
      shell, while `GET /` keeps the API info object when no dist exists. `safe_join` rejects
      traversal, and non-GET/HEAD fall through to `404`.
      Documented deviation: unmatched `/v1/*` paths stay JSON `404` (the `/v1` nest owns its
      fallback), where Node's global `GET *` would serve `index.html`; recorded in the module doc.
      Covered by `server/tests/static_files.rs` (asset, SPA fallback, root dual behavior, health
      and `/v1` not swallowed, traversal) and the in-file unit tests.
- [x] Asset cache header rule: paths ending in
      `js|css|map|woff|woff2|ttf|otf|png|svg|ico|webp|avif|jpg|jpeg|gif` get
      `Cache-Control: public, max-age=31536000, immutable` (`IMMUTABLE_CACHE_CONTROL`).
      `an_asset_is_served_with_the_immutable_cache_header` pins presence on a fixture asset and
      `an_unmatched_route_falls_back_to_the_spa_shell_without_a_cache_header` pins its absence on
      the SPA fallback.

### 1.2 Global body limit

- [x] Only the gateway handlers capped body size (`features/gateway/chat.rs:289`,
      `features/gateway/messages.rs:347`). Node applies a global middleware on `/v1/*` that rejects
      `Content-Length > 25 MiB` with `413` + `code=request_too_large` before buffering the body
      (`apps/api/src/middleware/BodyLimit.ts`, `apps/api/tests/request-limits.test.ts`).
- [x] Add `http/middleware/body_limit.rs`, layer it on `/v1` and `/v1/v1`, and cover it with
      `server/tests/http_runtime.rs` cases for oversized `Content-Length` (413) returning
      `invalid_request_error` envelope.

### 1.3 Error envelope completion

- [x] Unhandled `SyntaxError`-equivalent JSON parse failures produce `400` with
      `code=invalid_json` and message `Malformed JSON in request body`
      (`apps/api/src/index.ts:88-99`, `apps/api/tests/malformed-json.test.ts`). `error.rs` owns the
      canonical `invalid_json()` and its text lives in `constants::json` (`server/src/constants.rs`
      is the single catalog for every client-facing message); the gateway body reader uses it, and
      the envelope is pinned by `server/src/error.rs` and `server/tests/chat_completions.rs`.
- [x] Status→type mapping matches the contract exactly: `invalid_request_error` for
      `400/404/409/422`, `authentication_error` for `401`, `permission_error` for `403`,
      `rate_limit_error` for `429`, `api_error` otherwise; handlers may override `type` and attach
      `code`/`param` (`docs/api-v1-contract.md`, "Error envelopes"). Covered by the table-driven
      `server/src/error.rs` mapping test, which also asserts the HTTP status per row.

- [x] Owner ruling 2026-10-03 --- 10-30 WIB: the Rust server ships a single listener on `PORT`
      (default `3000`) and mounts provider callbacks on the main listener under `/v1/auth/...`.
      The Node secondary listener (`:1455`) is **not ported** — the Rust target has no OAuth
      listener. `OAUTH_PORT` / `OAUTH_HOST` are no longer read at all (see `server/.env.example`),
      and both Node-only callback branches (`local mode uses the OAuth listener`,
      `SROUTER_PUBLIC_URL` suppresses the secondary listener) are dropped rather than reproduced.
      Force-reimplementing two listeners later would mean reversing this ruling.
      Consequence: `server/src/http/listeners.rs` keeps only `serve_main`, and any doc/plan text
      that still describes a `:1455` Rust listener is stale for `server/`.

### 1.5 Version and info fields

- [x] Owner ruling 2026-10-02 --- 16-16 WIB: the Rust build follows `server/Cargo.toml`
      (`package.version`, currently `0.2.0`) everywhere Node reports `API_VERSION = "0.1.8"`
      (`packages/constants/src/version.ts`). `X-Version`, `GET /`, and `GET /v1` all carry the
      crate version; releasing the Rust API means bumping `server/Cargo.toml` and nothing else.
      `GET /v1` was not mounted at all (404) and now serves the same api info object as `GET /`.
      No consumer breaks: the web UI renders its own `APP_VERSION` constant and the CLI reports
      `CLI_VERSION`, so neither reads the version from the API. Recorded in
      `docs/api-v1-contract.md` "Version in the Rust build"; covered by
      `server/tests/http_runtime.rs` (`get_root_returns_api_info_json`,
      `get_v1_returns_api_info_json`, `get_v1_v1_root_stays_out_of_the_compat_alias`,
      `FROZEN_HEADERS`) and `server/tests/cors.rs` (preflight `X-Version`).

### 1.6 Telemetry

- [x] `server/src/infrastructure/telemetry.rs` (tracing subscriber) per the target layout and the
      plan's tech stack: `tracing` + `tracing-subscriber` (`env-filter`), one subscriber with two
      fmt layers, stdout (ANSI) and `<cwd>/logs/srouter-server.log` (append, no ANSI). File
      logging is unconditional so every run leaves a visible trail in `logs/` for non-production
      debugging (owner requirement 2026-10-02); `RUST_LOG` overrides the default `info`, and an
      unopenable folder falls back to stdout-only. `main()` installs it before anything else, and
      the `listeners.rs` startup/shutdown lines moved from `println!`/`eprintln!` onto `tracing`.
      Format: plain text with `key=value` fields (owner decision 2026-10-02: `txt` over `json`
      until a log pipeline needs machine parsing).
- [x] Request-failure logging matching Node's `console.error` in its error handlers: the
      outermost `http/middleware/failure_log.rs` layer logs every final status (`error` for 5xx,
      `warn` for 4xx, with method and path but never the query string, which carries OAuth
      `code`/`state`), and `error.rs` logs the error detail behind every 5xx envelope. Covered by
      `server/tests/telemetry.rs` (file output, 404 request log, 5xx detail, 4xx silence) plus a
      live smoke run: startup line and 404 line both land in `logs/srouter-server.log`.
- [x] Per-request access log (`http/middleware/access_log.rs`), a Rust-native addition with no Node
      parity: one `info` event per request carrying method, path, redacted query, status, duration,
      redacted headers, a redacted request-body summary, and the response type/size. Sensitive
      headers, query keys, and JSON fields render as `[REDACTED]`; bodies above 64 KiB or chunked
      are forwarded untouched and reported as uncaptured. Mounted outermost in `app.rs` so it sees
      the final status and full duration. On by default outside production; `NODE_ENV=production`
      turns it off and `SROUTER_ACCESS_LOG=on|off` overrides either way (`APIConfig::access_log`,
      `server/.env.example`). Covered by `server/tests/telemetry.rs`
      (`access_log_records_successes_and_redacts_credentials`, `access_log_is_off_in_production`),
      `server/tests/configuration.rs` (`production_turns_the_access_log_off`,
      `access_log_can_be_forced_on_or_off`), and the in-file unit tests.

---

## 2. Admin auth

- [x] `GET /v1/admin/status`, `POST /v1/admin/setup` (loopback-only, `201`, `403` remote, `409`
      repeated), `POST /v1/admin/login` (cookie, `401`, five failures → 15-minute `429`),
      `POST /v1/admin/change-password`, `POST /v1/admin/logout` (`204`, invalid session `401` +
      cookie clear) — `features/admin_auth/`, `server/tests/admin_auth.rs`.
- [x] Admin bootstrap from the environment at startup: `features/admin_auth/bootstrap.rs`
      (`bootstrap_admin_account_from_env`) applies `SROUTER_ADMIN_PASSWORD` during boot exactly
      like `bootstrapAdminAccountFromEnv` (`apps/api/src/services/adminAuth.ts`, invoked from
      `boot()`): hash the password, create the account when missing, otherwise reset the hash on
      every boot. A missing or empty value leaves the database untouched, so first-run setup still
      goes through `POST /v1/admin/setup`. `main.rs` calls it after the database opens and before
      the listener starts.
      Covered by `server/tests/startup.rs`: `the_env_password_creates_the_account_and_logs_in`
      (boots with the env var, `setup_required` false, login succeeds and sets the session
      cookie), `a_later_boot_resets_the_password` (recovery path), and
      `without_the_env_password_the_install_stays_fresh`.
- [x] Cookie flags parity: `HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` only when
      `SROUTER_SECURE_COOKIES=true`, max age seven days (`docs/api-v1-contract.md`).
      `session_cookie()`/`cleared_cookie()` already set all five; three `server/tests/admin_auth.rs`
      cases now pin them (`session_cookie_carries_the_frozen_flags`,
      `secure_cookies_flag_adds_secure_to_session_and_cleared_cookies`,
      `cleared_cookie_carries_the_frozen_flags`), backed by `support::test_secure_config`.
      Documented deviation, owner ruling 2026-10-03 --- 10-30 WIB: an `https://`
      `SROUTER_PUBLIC_URL` also turns `Secure` on without the flag (production is correct by
      validation alone), and under `https://` the flag cannot turn it off. Node oracle stays
      exact-true-only until cutover; pinned by `server/tests/configuration.rs`
      (`https_public_url_enables_secure_cookies_without_the_flag`,
      `http_public_url_does_not_enable_secure_cookies`,
      `https_public_url_keeps_secure_cookies_on_when_the_flag_is_false`).
- [~] Startup ordering: Node awaits PostgreSQL schema init, then admin bootstrap, then provider
  registry, then serves; model warmup runs after the listener is up, and the token-refresh
  sweeper starts last (`docs/api-v1-contract.md`, "Legacy baseline"). Rust `main.rs` now runs
  the admin bootstrap before the listener starts; the model-registry warmup and the token-refresh
  sweeper remain open (sections 4 and 5).

---

## 3. API keys and request authorization

- [x] `/v1/keys` CRUD + credit (`features/api_keys/`), admin-session guard, API-key auth middleware,
      rate limiter, model allowlist filtering on catalog/gateway (`server/tests/api_keys.rs`,
      `api_key_auth.rs`, `model_access.rs`, `rate_limit.rs`).
- [x] Case-by-case verification against the four Node files (2026-10-02): all six cases hold in
      Rust. disabled key → `401` (`a_disabled_key_returns_api_key_disabled` covers requirement off
      and loopback; `a_disabled_key_returns_api_key_disabled_when_the_requirement_is_on`, added
      here, covers the enforced branch); exhausted credit → `402`
      (`exhausted_credit_returns_402_insufficient_credit`, `credit_is_checked_before_quota`);
      exhausted token quota → `429` (`exhausted_quota_returns_429_quota_exceeded`); missing key on
      non-loopback → `401` (`remote_requests_need_a_key_even_when_the_requirement_is_off`);
      `rate_limit = 0` → unlimited (`an_unlimited_key_is_never_rate_limited`); `429` carries
      `code=rate_limit_exceeded` + `Retry-After` in 1..=60
      (`requests_beyond_the_key_limit_return_429_with_retry_after`). Every rejection message is
      byte-equal to Node (`ApiKeyAuth.ts`, `RateLimit.ts`, both singular/plural rate-limit forms),
      compared programmatically. File mapping: quota-credit T1/T2/T3 → the credit, quota, and
      added `usage_below_both_limits_passes` tests; credit-route + credit-db create/top-up/
      non-positive cases → bullet 1 (`api_keys.rs`); usage-deduction (write-back) → the next
      bullet, still open.
      Case-1 nuance (Node oracle): `getAPIKeyByKeyDB` selects `enabled = 1` only, so Node's
      gateway answers `401 invalid_api_key` for a disabled key when auth is required and passes
      the request when it is not; its `api_key_disabled` branch (`ApiKeyAuth.ts:73-78`) never
      runs. Rust reads disabled rows itself and always answers `401 api_key_disabled`, matching
      the contract line "A disabled key returns `401`" in every context. Owner ruling
      2026-10-02: keep the Rust behavior; the note is recorded in `docs/api-v1-contract.md`
      under "Authentication, CSRF, rate limits, and request size".
      Scope finding beyond the six (fixed): Node runs `EnforceRateLimit` on chat/messages/images
      only, while Rust rate-limited the whole gateway including `GET /v1/models`, whose contract
      row lists API-key auth only. Owner ruling 2026-10-02: the catalog is not rate limited.
      `create_models_router()` now carries only the API-key guard, pinned by
      `the_model_catalog_is_not_rate_limited` (red on the old wiring, green on the new), and the
      contract's rate-limit bullet records the scope.
- [x] Reserved `max_tokens` budget for API-key requests (default `4096`) and usage write-back on
      completion. `chat::create_completion` reserves `max_tokens` (or `4096`) before any upstream
      call through `APIKeyRepository::reserve_quota`, reproducing the Node controller's atomic
      `UPDATE ... WHERE quota_limit = 0 OR usage_tokens + ? <= quota_limit`
      (`apps/api/src/controllers/chat.controller.ts`, `reserveAPIKeyQuotaDB` in
      `packages/db/src/apiKeys.ts`); a refused reservation is `429` + `code=quota_exceeded` with
      `Token quota exceeded. The requested budget is unavailable.` The reservation is settled to
      the real token count on a completed request (`settle_quota`) and released in full on any
      failure, from the shared `log_request` path (`apps/api/src/logic/chat.logic.ts`). Cost is
      written through `increment_usage` but stays `0` until pricing lands (section 8 notes the same
      gap). Documented deviation: a `200` with zero total tokens settles to zero and returns the
      budget, where Node's `LogCompletion` skips the settle and leaves the reservation charged.
      Covered by `server/tests/chat_completions.rs` (a refused-budget admission test, a settle test,
      and a release-on-failure test, backed by a recording `APIKeyRepository`) and by
      `quota_reservation_settlement_and_increment_update_usage` and
      `an_unlimited_key_reserves_any_budget` in `server/tests/api_keys.rs`, which exercise the SQLx
      store.
- [ ] CSRF origin guard coverage for every cookie-authenticated mutation after the new routes land
      (body limit applies on the main listener, admin/database routes included).

---

## 4. Providers: management, registry, catalog

Current Rust scope (documented deviation): two drivers `opencode_zen` and `qoder` served from
the `SEED_PROVIDERS` slice, read routes `GET /v1/providers`, `GET /v1/providers/catalog`,
`GET /v1/providers/{provider_id}`, one write route `PATCH /v1/providers/{provider_id}` with
`enabled|hide|restore|favorite|unfavorite` (`features/providers/management/routes.rs`).
Everything below is still Node-only.

> Owner ruling 2026-10-02 --- 13-43 WIB: provider management (#1) is ruled done and its boxes
> are checked without new route code. The wire-level differences stay documented as deviations
> in `docs/api-v1-contract.md` ("Providers in the Rust build"), and the standing approval for
> those deviations is recorded under section 13.

- [x] `POST /v1/providers` — create a provider connection (admin session, validated provider JSON).
- [x] `DELETE /v1/providers/{id}` — delete a connection (`404` when missing), refresh live registry.
- [x] `POST /v1/providers/verify` — connection verification with SSRF protection
      (`apps/api/tests/verify-connection.test.ts`; blocked targets: non-HTTP(S), unresolved,
      private, loopback, link-local, CGNAT, multicast, metadata service; redirects must not bypass).
- [x] `POST /v1/providers/connections/verify` — body `connection_id`; `400` invalid, `404` missing.
- [x] `POST /v1/providers/{providerId}/models` — add custom model (`model_id`, `201`).
- [x] `DELETE /v1/providers/{providerId}/models/{modelId}` — remove custom model.
- [x] `PATCH /v1/providers/{providerId}/round-robin` — `enabled` flag.
      (`apps/api/tests/round-robin-endpoint.test.ts`.)
- [x] Second driver registered: `qoder` (`features/providers/qoder/`), COSY-signed chat with the
      envelope-to-OpenAI translation, and a model list that exists only after `model/list` has
      answered, on a 5-minute TTL. Nothing is seeded: a build without a Qoder connection advertises
      no `qd` model. A confirmed key is advertised twice, as itself and as the `display_name`
      upstream gave it (`qd/qfmodel` plus `qd/qwen3.8-flash`), and the two ids are one model to
      the hidden list, favorites and `allowed_models`. Independent provenance for every constant
      is recorded in the `qoder/types.rs` module doc; protocol analysis and decisions live in
      `docs/superpowers/plans/2026-09-30-rust-provider-qoder.md`.
- [ ] Round-robin/selection policy in the registry itself, if the driver set grows past one.
- [x] `GET /v1/providers/{providerId}/hidden-models` — Node returns `{models:[...]}`. Rust folded
      this into the detail payload; the route is not served. Either implement the route for parity or
      get the deviation explicitly approved, like the tunnel exclusion. Same call for
      `/v1/favorites` (`GET` API-key, `POST` admin `201`, `DELETE /{modelId}` `404`)
      (`apps/api/src/controllers/favorites.controller.ts`, web calls both — `favorites.ts`,
      `favorites` mutations today only work through the provider PATCH).
- [ ] Catalog provenance: record an allowed independent source for every built-in provider entry
      and model list (`docs/api-v1-contract.md` "Scope"). The `qoder` entry is recorded, and its
      models are read from upstream; `features/providers/qoder/types.rs` keeps only the alias table
      for requests before the first fetch or under a retired name. `opencode_zen` still needs its
      own record.
- [x] Cline provider registered: WorkOS device-flow auth, lazy token refresh, OpenAI-compatible
      chat, and a connection-gated live `/api/v1/models` catalog. No Cline model is seeded.
- [x] Cline provenance: protocol details are sourced from the official Cline binary, official
      documentation, credential-free live probes, `apps/api` oracle, web flow, and frozen API
      contract. `features/providers/cline/types.rs` records the sources. The official client uses
      `recommended-models` instead, a recorded catalog deviation in the Cline plan.
- [x] Codex provider registered: `openai_codex` (`features/providers/codex/`) with ChatGPT OAuth
      credentials read from the `providers` row, a lazy refresh against the vendor token endpoint,
      the Responses API request encoder, and the Responses-SSE → OpenAI chat translation shared by
      the streaming and the buffered path (which always calls upstream with `stream: true`).
      Provenance for every constant — the carved vendor catalog, the token endpoint and client id,
      the header names, the `apps/api` oracle — is recorded in `features/providers/codex/types.rs`.
      Covered by `server/tests/codex_provider.rs` (fake upstream: headers, fragmented SSE, tool
      calls, refresh, 401 retry) and the in-file unit tests.
- [x] Codex model catalog: live-only dynamic catalog fetched directly from ChatGPT
      (`GET {base}/models?client_version=0.160.0`), matching the user ruling to eliminate all
      hardcoded models. Implemented in `features/providers/codex/catalog.rs` and `executor.rs`:
      5-minute TTL (`CATALOG_TTL_MS`), 30-second retry window (`CATALOG_RETRY_MS`), coalesced fetch
      lock, in-memory `SharedCatalog`, filtering of `visibility: "hide"` models (such as
      `codex-auto-review` and `gpt-reserve`), and retention of rotated `account_id`. Covered by
      `server/tests/codex_provider.rs` and in-file unit tests in `catalog.rs` and `executor.rs`.
- [x] Codex OAuth connect route: `features/provider_auth/openai.rs` ports
      `/v1/auth/openai/login`, `/callback`, and `/token` on the shared `features/provider_auth/`
      helpers (PKCE, callback parsing, `SROUTER_PUBLIC_URL` resolution). A successful callback or
      token import writes the row `upsert_codex_connection` stores and force-refreshes the Codex
      catalog; the lazy per-request refresh already worked. The background sweeper remains open
      for every provider (section 5).
      Vendor allow-list note: `auth.openai.com` accepts only the Codex redirects
      `http://127.0.0.1:{1455,1457}/auth/callback`, not the Rust default `/v1/auth/openai/callback`
      (or a `localhost` host). The browser-facing page route `GET|POST /auth/callback` (plus the
      `/auth/openai/callback` alias) is mounted at the application root, outside `/v1`, and
      auto-finishes the flow with an HTML result once the vendor redirect reaches the server (a
      local run on port 1455, or an `ssh -L 1455:127.0.0.1:3001` tunnel from the client). Without
      that route reachable, the flow still finishes through `POST /v1/auth/openai/callback` with
      the pasted `callback_url`. The scope constant includes
      `api.connectors.read api.connectors.invoke` (`openai/codex` `codex-rs/login/src/server.rs`).
- [ ] Model-registry warmup after the main listener starts (`warmModelRegistry` in Node). The live
      `qoder` and Cline catalogs are already warmed at boot (`server/src/main.rs`); DB-backed catalogs
      stay empty until their connection exists.
- [ ] Registry lifecycle on write: Node refreshes the live registry after connection
      create/delete; Rust writes rows but never rebuilds `ProviderRegistry`. `qoder` needs no
      rebuild: the device-flow connection force-refreshes the catalog in place.

---

## 5. Provider auth (OAuth, device flows, token import) — `features/provider_auth/`

Qoder, Cline, and OpenAI routes exist in Rust. Source of truth for the route list:
`docs/api-v1-contract.md`
"Retained route inventory" (rows 57-65) and `apps/api/src/routes/v1/auth.ts` (34 routes).

- [x] Cline device flow: `/v1/auth/cline/device` (GET) and `/v1/auth/cline/poll` (GET, POST),
      guarded by the admin session. `/v1/auth/cline/token` (contract row 58) remains deliberately
      deferred; the OAuth-only scope is recorded in the Cline plan.
- [~] Privileged routes: `openai` landed (`features/provider_auth/openai.rs`):
  `GET /v1/auth/openai/login` (supports `client_id`, `redirect_uri`, `prompt`,
  `format=json`) and `POST /v1/auth/openai/token` (validated token import, `201`), both
  admin-guarded. Still open:
  `/v1/auth/{antigravity,claude}/login`, `/v1/auth/{codebuddy,codebuddy-cn}/login` (GET) and
  `/poll` (GET, POST), and every other `/token` route
  (`antigravity, commandcode, anthropic, atria, claude, tokenrouter, codebuddy,
codebuddy-cn, qoder`) → validated token import, `201`.
- [x] `qoder` privileged routes: `GET /v1/auth/qoder/login` (supports `client_id`, `redirect_uri`,
      `format=json`, otherwise redirects to the device URL) and `/v1/auth/qoder/poll` (GET, POST,
      `state` from query or JSON body) in `features/provider_auth/qoder.rs`, mounted behind
      `require_admin_session` (`server/tests/provider_auth.rs`).
- [x] Public route: `/v1/auth/qoder/callback` (GET, POST) reading `code` and `state` from query,
      JSON body, or `callback_url`; missing values → `400`. The browser page
      `GET|POST /auth/qoder/callback` is mounted at the application root (`qoder.rs`) and shares the
      generic `success_page`/`error_page` helpers in `provider_auth/mod.rs` with `openai`.
- [~] Public routes: `openai` landed — `/v1/auth/openai/callback` (GET, POST) shares
  `parse_callback` with `qoder` and reads `code` and `state` from query, JSON body, or
  `callback_url`; missing values → `400`, unknown state → `500`
  (`Invalid or expired OAuth state parameter`). Still open:
  `/v1/auth/{antigravity,claude}/callback`.
- [x] `qoder` `/token` import is deliberately deferred: the slice is OAuth only (plan decision,
      web PAT tab returns `404` until it lands).
- [x] Callback URL selection: callbacks are hosted on the main listener (single-port ruling,
      section 1.4). `SROUTER_PUBLIC_URL` supplies the public base; user-supplied non-local callback
      URLs pass through unchanged (`apps/api/src/utils/callbackUrl.ts`). The Node local-mode branch
      that handed callbacks to the `:1455` listener is intentionally not ported.
- [~] PKCE + state lifecycle: state creation, replay/expiry rejection, device-poll state read from
  query or JSON body. Done for `qoder` and Cline (`infrastructure/database/oauth_sessions.rs`:
  PKCE/device-code save, claim, release, delete, 15-minute sweep); other providers still need it.
- [ ] Token refresh sweeper and scheduling (`apps/api/src/services/tokenRefresh.ts`), started only
      after database/provider state is ready, stopped on shutdown. Cline's lazy per-request refresh
      path landed in `features/providers/cline/executor.rs`; the sweeper remains open.
- [ ] Env override `CLAUDE_OAUTH_CLIENT_ID`.
- [ ] Fake-upstream tests only (`server/tests/provider_auth.rs`); never real provider credentials.
      Legacy evidence to read as oracle: `auth-providers.test.ts`, `token-refresh.test.ts`,
      `antigravity-provider.test.ts`, `codebuddy-provider.test.ts`, `qoder-provider.test.ts`,
      `tokenrouter-provider.test.ts`, `kiro-provider.test.ts`, `bai-provider.test.ts`,
      `neosantara-provider.test.ts`, `experientiallabs-provider.test.ts`.

---

## 6. Gateway

- [x] `/v1/chat/completions`, `/v1/chat/completion`, `/v1/messages`, `/v1/messages/count_tokens`,
      `/v1/models`, `/v1/models/{model}`, SSE framing, tool interceptor, usage recording
      (`features/gateway/`, `server/tests/chat_completions.rs`, `messages.rs`,
      `reasoning_stream.rs`, `models.rs`).
- [x] Streamed chat and Messages requests write one request-log row after output completes, on
      upstream/model errors, and on client disconnect; successful rows include accumulated SSE usage
      (`features/gateway/chat.rs`, `messages.rs`, `server/tests/chat_completions.rs`, `messages.rs`).
- [ ] `POST /v1/images/generations` — validated image-generation JSON (`prompt`, `model`), API-key
      auth + rate limit + model access, provider image output, unsupported image model → `400`.
      Legacy evidence: `apps/api/tests/images-route.test.ts`, `images-fallback.test.ts`.
- [ ] Fallback policy: `/v1/settings/fallbacks` CRUD (`GET` API-key, `POST` admin `201`, `PUT/PATCH`
      admin, `DELETE` admin `404`) **and** its execution in the gateway
      (`apps/api/src/logic/fallbackRunner.ts`, `fallback.policy.ts`, `fallbacks-cascade.test.ts`).
      Rust structs already carry `fallback_occurred` / `fallback_path` / `fallback_reason` fields but
      they are hard-coded `false`/`None` (`features/gateway/chat.rs:120`, `messages.rs:158`).
- [ ] Protocol translation module (`features/gateway/translation.rs` in the plan): OpenAI ⇄ Anthropic
      request/response mapping, tool calls, usage extraction, malformed payload handling;
      pure-function tests plus `apps/api/tests/opencode-compat.test.ts` as the black-box oracle.
- [ ] Client-cancellation semantics: disconnect cancels the upstream request, no full-response
      buffering, and partial-output billing rules
      (`apps/api/tests/` streaming cases, `docs/api-v1-contract.md` "Streaming").
- [ ] `/v1/v1/*` alias must cover every gateway path once images/fallbacks land, and must stay
      absent for provider/auth/keys/logs/settings routes.
- [x] Token Saver: always-on compression of noisy tool output (ANSI, whitespace, diff metadata,
      repeated log lines) plus one fixed terse-output directive, applied once per top-level
      chat/messages request before model resolution. No settings row, no toggle, no threshold;
      native gateway design, no Node parity:
      `docs/superpowers/plans/2026-10-01-token-saver.md`.

---

## 7. Catalog: models, pricing, quota

- [~] `GET /v1/models` with `Cache-Control: public, max-age=60, stale-while-revalidate=300`,
  `refresh`/`force` params, `no-cache`/`no-store` revalidation, allowlist filtering, hidden and
  disabled-provider filtering, favorite flag (`features/gateway/models.rs`). A filter applies to the
  model, so a Qoder name pair shares one verdict: `model_id_variants` expands a request or a stored
  hidden/favorite id into every id that reaches the same upstream key, and `names_of` expands the
  sets read from the database.
- [ ] `/v1/models` response shape: `ModelObject` carries `{id, object, owned_by}` only, so upstream
      metadata that `model/list` does return (`display_name`, `is_vl`, `format`, `max_input_tokens`,
      `price_factor`, `is_free`) is parsed away today. Adding it is a contract change and needs a
      consumer first.
- [ ] `GET /v1/pricing/models` — `Cache-Control: public, max-age=3600,
stale-while-revalidate=86400`, `refresh`/`force`/`no-cache` forcing a refresh.
      Legacy evidence: `apps/api/tests/pricing-route.test.ts`.
      Blocked on provenance: the Node catalog data comes from `packages/pricing`; an independent
      allowed source must be recorded before implementing (design doc "Static catalog/pricing").
- [ ] `GET /v1/quota` and the retained misspelling alias `GET /v1/qouta` — provider OAuth quota data,
      `refresh`/`force` refresh. Legacy evidence: `apps/api/tests/quota-oauth-filter.test.ts`.
      Depends on section 5 (quota reads provider OAuth state).
- [ ] Create `features/catalog/` per the plan layout and move the model/pricing/quota routes there
      when they land (today they live in `features/gateway/models.rs`).

## 8. Dashboard: logs, analytics, settings

- [x] `GET /v1/logs` (paginated + recent), `GET /v1/logs/{id}`, `GET /v1/logs/events` SSE with
      `connected`/`usage.updated`/`request.logged` and 25 s heartbeats, 16-stream cap with `429`
      (`features/logs.rs`, `server/tests/logs.rs`).
- [x] Log records expose token, cost, resolved-model, fallback, and creation-time columns; stats
      `cost_label` uses four decimals. `estimated_cost` remains `0.0` until the pricing catalog lands
      (`infrastructure/database/request_logs.rs`, `server/tests/logs.rs`).
- [x] `GET /v1/logs/stats` — aggregate usage statistics (`usage_stats` in
      `infrastructure/database/request_logs.rs`, now served directly instead of only through the
      `usage.updated` SSE payload). Serializes snake_case, as does the SSE `usage.updated` payload
      (documented deviation, `docs/api-v1-contract.md` "Logs in the Rust build"). Web calls this
      endpoint (`apps/web/src` → `/v1/logs/stats`).
- [x] `GET /v1/logs/analytics` — `window` param (default `24h`), invalid window → `400` +
      `code=invalid_request`. `parse_analytics_window` pairs each window with its bucket geometry
      (`1h`→60 s ×60, `24h`→1 h ×24, `7d`→6 h ×28, `30d`→24 h ×30) and `analytics_report`
      reproduces `getAnalyticsDB`: bucketed totals, zero-filled buckets, p95 latency,
      rolling-60 s RPS, top models/agents, and provider split. The report serializes
      snake_case rather than Node's camelCase (documented deviation, `docs/api-v1-contract.md`
      "Logs in the Rust build"). Legacy evidence: `apps/api/tests/analytics.test.ts`.
- [x] `GET /v1/settings` response: owner ruling 2026-10-02 --- Rust keeps the `require_api_key`-only
      shape and does **not** add Node's `requireApiKey`/`settings` echo
      (`apps/api/src/controllers/settings.controller.ts` is the Node reference). Deviation recorded
      in `docs/api-v1-contract.md` "Settings in the Rust build". Covered by the shape assertions in
      `server/tests/settings.rs`.
- [x] `POST|PATCH /v1/settings` accept the same payload: boolean `require_api_key` and a
      string-valued `settings` object, persisted as key/value rows via `set_setting()` (decision:
      persist, not drop). The response stays `{require_api_key}` — no echo, per the same ruling.
      Non-string/non-object values → `400` + `Invalid settings payload`
      (`update_settings_persists_a_string_settings_map_without_echoing_it`,
      `update_settings_rejects_non_string_settings_maps` in `server/tests/settings.rs`).
- [x] `GET`/write authorization parity: read = API-key auth, write = admin session + CSRF (already
      layered; re-verified when the `settings` map landed — `update_settings_requires_admin_session`
      pins 401 for anonymous and API-key-only mutations).

## 9. Database transfer

- [ ] `GET /v1/admin/database/export` — admin session **only** (API keys and loopback do not
      qualify), streams a snapshot as `application/octet-stream` with an attachment filename.
- [ ] `POST /v1/admin/database/import` — exactly one multipart file in field `database`, max 25 MiB
      (`413` from the global limit for oversized `Content-Length`, `400` + `upload_too_large` for an
      oversized chunked upload), stream to a private temp file (`0700` dir / `0600` file, cleaned up
      on success and failure), validate before replacement, make a recoverable backup, replace
      atomically where the platform allows, restore on failure, clear the admin cookie, and return
      `ok`, `backup_path`, `restart_required`, `reauth_required`.
- [ ] Legacy evidence: `apps/api/tests/database-route.test.ts`, `apps/api/src/controllers/database.controller.ts`,
      `docs/api-database-contract.md`.

## 10. Persistence gaps

- [x] SQLite schema v3 via `server/migrations/0002_v2_schema.sql`, `0003_request_logs.sql`;
      PostgreSQL connection support in `infrastructure/database/postgres.rs`.
- [ ] PostgreSQL parity for the newer repositories: `infrastructure/database/settings.rs` and the
      request-log queries call `sqlite_pool()` and silently return defaults/500 when the process runs
      on PostgreSQL. Either add the PostgreSQL statements or fail loudly at startup.
      Also confirm PostgreSQL schema init actually runs at boot (`docs/api-v1-contract.md`
      "SQLite is initialized before `boot()`...").
- [ ] Migration ownership check: the Rust migration files must stay forward-compatible with an
      existing user database (`docs/api-database-contract.md`); never drop or recreate user data.
- [ ] Field/relation citations for every table Rust touches (plan Task 2 item still unchecked:
      "For every field/relation required by Rust, cite an allowed independent source").
- [ ] Optional PostgreSQL integration test behind an isolated CI database URL (skip when unset).

## 11. Contract publication (OpenAPI → web types)

- [ ] `server/src/openapi.rs` + `server/src/bin/export_openapi.rs` + `server/openapi.json`:
      deterministic document generated from Rust models only, covering every retained route and auth
      scheme, the `/v1/v1` aliases, and excluding tunnel routes. Nothing exists today (no Utoipa
      dependency in `Cargo.toml`).
- [ ] `apps/web`: add `openapi-typescript`, generate `apps/web/src/generated/api.ts` from
      `../../server/openapi.json`, add `api:generate` / `api:check` scripts, and switch API contract
      types to that module. No workspace alias, no cross-app imports.
- [ ] Determinism test: two consecutive generations leave both files byte-identical; wire the drift
      check into CI.

## 12. CI, Docker, cutover plumbing

- [x] `.github/workflows/ci.yml`: added a `rust-lint` job with the stable Rust toolchain,
      `cargo fmt --check`, and `cargo clippy --all-targets --all-features --locked -- -D warnings`,
      as an addition to the existing Node/pnpm job (which still runs `pnpm build` + `pnpm test`).
      The crate is clippy-clean: no `allow` attributes were needed, and the long-standing warnings
      (`collapsible_if`, `manual_div_ceil`, `unnecessary_cast`, `new_without_default`,
      `assertions_on_constants`, `large_enum_variant`, `result_large_err`) are fixed at the source.
- [ ] `.github/workflows/ci.yml`: still missing `cargo test --locked`, the OpenAPI export drift
      check, and the PostgreSQL service job.
- [ ] `Dockerfile`: add a Rust builder stage and a Rust runtime target (binary, web dist, CA
      certificates, tzdata, non-Node health check), keeping the Node target selectable for rollback.
      Root `Dockerfile:21` still copies `apps/api/package.json` and `pnpm build` builds the Node API.
- [ ] `docker-compose.yml`: drop the `:1455` port mapping and rewrite the `node -e` healthcheck for
      the Rust target, which exposes `PORT` only (single-port ruling, section 1.4). Keep the Node
      service definition intact for rollback until cutover.
- [ ] Root `Procfile` (`web: node apps/api/dist/index.js`) → Docker-based Rust deployment; root
      `heroku.yml` does not exist yet although the plan creates/keeps one. `apps/api/heroku.yml`
      becomes obsolete with `apps/api`.
- [ ] Verify the Rust runtime image contains no Node executable; smoke-test with a disposable
      volume (health + static serving).
- [ ] `docs/api-migration.md`: parity matrix results, tunnel exclusion write-up, staging steps,
      backup/rollback procedure, benchmark table (startup, idle/active memory, CPU/throughput, image
      size) measured under identical limits. No claimed improvement without numbers.
- [ ] Staging cutover + 24 h monitoring + rollback rehearsal (plan Task 15).

---

## 13. Delete `apps/api` (final step, gated)

- Deviation approval (2026-10-02 --- 13-43 WIB): the provider-management route gaps
  (create/delete connection, verify, custom models, round-robin, hidden-models, favorites,
  `enabled`) and the field-naming differences are owner-approved as the Rust build's
  contract, so no provider route needs a Node-parity port before cutover.

Do not start until every section above is checked, the parity matrix passes, and the rollback window
has closed. Then delete, in one commit:

- [ ] `apps/api/src/**/*.ts`, `apps/api/tests/**/*.ts`, `apps/api/package.json`,
      `apps/api/tsconfig.json`, `apps/api/tsup.config.ts`, `apps/api/heroku.yml`,
      `apps/api/.gitignore`, and root `Procfile`.
- [ ] Regenerate `pnpm-lock.yaml` with the pinned pnpm version after the workspace package is gone.
- [ ] Update references that point at the deleted tree: - `Dockerfile` (builder stage copies, `pnpm build`, `pnpm deploy`), - `CONTRIBUTING.md:53` (verify block), - `apps/docs/src/lib/docs.ts` and `apps/docs/src/pages/**` (`source:` paths, architecture,
      request-lifecycle, keys-observability, integrations, development/database, installation), - `apps/docs/README.md:82`, `apps/docs/src/pages/index.astro:122`.
      There is no root `README.md`; skip it if it stays absent.
- [ ] Keep `packages/*`, `apps/web`, `apps/cli`, `apps/docs` — they are retired in separate issues.
- [ ] Final boundary checks:

```bash
rg -n 'packages/|@srouter/' server/Cargo.toml server/src server/migrations --glob '*.rs' --glob '*.sql' --glob 'Cargo.toml'
cargo tree --manifest-path server/Cargo.toml --locked
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path server/Cargo.toml --locked
cargo run --manifest-path server/Cargo.toml --bin export_openapi && git diff --exit-code -- server/openapi.json
git diff --check
```
