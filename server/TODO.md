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
- Cloudflare Tunnel (`/v1/tunnel/*`, `services/cloudflareTunnel.ts`) is removed by owner ruling
  2026-10-08 --- 15-07 WIB: the feature is deleted outright, not merely excluded. Rust never had
  the routes (they answer `404`) and migration `0004_remove_tunnel_settings.sql` deletes its four
  settings keys (`cloudflare_tunnel_token`, `cloudflare_tunnel_domain`,
  `cloudflare_tunnel_autostart`, `cloudflared_path`), so schema is now v4. The Node side
  (`apps/api` route/controller/service/tests, `apps/web/src/hooks/useTunnel.ts`,
  `packages/types` `TunnelConfigSchema`, docs) is NOT touched yet: the owner scoped this slice to
  `server/` + `docs/` and explicitly excluded `apps/`. Until that lands, the byte-identical rule
  above still protects `apps/api`.
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
- [x] Startup ordering: Node awaits PostgreSQL schema init, then admin bootstrap, then provider
      registry, then serves; model warmup runs after the listener is up, and the token-refresh
      sweeper starts last (`docs/api-v1-contract.md`, "Legacy baseline"). Rust `main.rs` matches this
      sequence: DB migrations run, admin bootstrap completes before the listener starts, and both
      the model warmup and background token-refresh sweeper (5-second initial delay, 60-second ticker)
      run as background tasks.

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
- [x] CSRF origin guard coverage for every cookie-authenticated mutation after the new routes land
      (body limit applies on the main listener, admin/database routes included). Every landed mutation
      route under `/v1` (admin password change, logout, setup, login; API key create, update, delete,
      credit; settings POST and PATCH; provider management PATCH; provider device/poll/connect/token/callback
      flows; gateway chat/messages mutations and `/v1/v1` compat routes) rejects cross-origin cookie-authenticated
      mutations with `403` + `code=csrf_origin_rejected`, verifies foreign `Referer` fallback, accepts
      same-origin (including bracketed IPv6 hosts), CORS allowlist origins, and non-browser clients, while
      API-key traffic and safe GET requests pass untouched. Global 25 MiB body limit on `/v1` rejects
      oversized payloads (`413` + `code=request_too_large`) across admin, settings, providers, keys, and gateway
      routes while permitting normal payloads. Covered by `server/tests/csrf.rs` (17 integration tests).

---

## 4. Providers: management, registry, catalog

Current Rust scope (documented deviation): nine drivers served from the `SEED_PROVIDERS` slice
(`opencode_zen`, `qoder`, `cline`, `grok-web`, `openai_codex`, `codebuddy`, `codebuddy-cn`,
`antigravity`, `claude`), read routes `GET /v1/providers`, `GET /v1/providers/catalog`,
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
- [x] Custom models are managed at `/v1/models` (not the provider path): `POST /v1/models`
      registers one (`model_id`, `201`/`200`), `PUT /v1/models/{*model}` upserts, and
      `DELETE /v1/models/{*model}` removes it.
- [x] `PATCH /v1/providers/{providerId}/round-robin` — `enabled` flag. Served by
      `features/providers/management/routes.rs` behind the admin guard: `400` for an unknown
      provider or an `enabled` value that is not a real boolean, and the provider detail entry is
      read back after the write so the response reports stored state. The list, catalog, and
      detail payloads all carry `round_robin`.
      Rotation itself is Rust-native, not a port: `features/providers/rotation.rs` holds one
      `AccountRotator` per provider executor (shared through `Arc`, because the registry stores a
      clone per lookup key) and picks the connection where the credentials load for `qoder`,
      `cline`, and `grok-web`. Candidates are enabled rows newest-first; a row that answered `429`
      is passed over for 60 seconds, and an all-cooling provider still serves the newest row
      rather than failing locally. A missing settings row reads as **on**, a deliberate divergence
      from Node (`packages/db/src/settings.ts` defaults it off): with one connection rotation is a
      no-op, so the flag exists as an escape hatch rather than as a setup step.
      Failover loops live inside each executor's pre-stream phase (`send_with_failover`,
      `chat_response`, `establish`), bounded by the candidate count, so the client never sees a
      `429` that another account could absorb.
      Legacy evidence: `apps/api/tests/round-robin-endpoint.test.ts`. Rust evidence:
      `rotation.rs` unit tests, `tests/qoder_provider.rs` and `tests/cline_provider.rs` failover
      cases, `tests/providers.rs` toggle cases.
- [x] Second driver registered: `qoder` (`features/providers/qoder/`), COSY-signed chat with the
      envelope-to-OpenAI translation, and a model list that exists only after `model/list` has
      answered, on a 5-minute TTL. Nothing is seeded: a build without a Qoder connection advertises
      no `qd` model. A confirmed key is advertised twice, as itself and as the `display_name`
      upstream gave it (`qd/qfmodel` plus `qd/qwen3.8-flash`), and the two ids are one model to
      the hidden list, favorites and `allowed_models`. Independent provenance for every constant
      is recorded in the `qoder/types.rs` module doc; protocol analysis and decisions live in
      `docs/superpowers/plans/2026-09-30-rust-provider-qoder.md`.
- [x] Bare model ids advertised by multiple drivers rotate deterministically across matching
      adapters in `ProviderRegistry::resolve`; provider-prefixed requests remain pinned to the
      requested driver. Per-model selection state is shared across registry clones.
- [x] Every model-level operation lives under `/v1/models`, so a model is managed there and nowhere
      else: `GET /v1/models` (list), `GET /v1/models/{*model}`, `POST` (register a custom model,
      `201`/`200`), `PUT /{*model}` (idempotent upsert), `PATCH /{*model}` (`favorite`/`hidden`),
      and `DELETE /{*model}` (remove a custom model, `404` when absent). The provider is inferred
      from the id prefix (`claude/...`, `zen/...`); a custom model is stored bare and re-prefixed
      with the provider alias when the catalog merges it, and the entry carries `custom: true`,
      mirroring Node's `MergeCustomModels`. Reads keep the API-key guard, writes the admin session
      (`features/gateway/{models,routes}.rs`, `server/tests/{models,providers}.rs`). This replaces
      the former `/v1/favorites*`, `/v1/providers/{id}/hidden-models*`, and provider-model routes;
      the provider `PATCH` stays the provider-level surface (`enabled`) and the provider detail
      still carries the per-model `hidden`/`favorite` flags.
- [x] Catalog provenance: record an allowed independent source for every built-in provider entry
      and model list (`docs/api-v1-contract.md` "Scope"). The `qoder` entry is recorded, and its
      models are read from upstream; `features/providers/qoder/types.rs` keeps only the alias table
      for requests before the first fetch or under a retired name. `opencode_zen` sources are
      recorded in `features/providers/opencode/types.rs`; its seven seeded ids were checked against
      OpenCode's public catalog and remain an intentional subset.
- [x] Antigravity provenance: `features/providers/antigravity/types.rs` records an independent
      source for every constant and model id — reverse engineering of the official client binary
      `agy` (2026-10-04: the OAuth authorize/token endpoints, the embedded client id/secret pair
      verified byte-equal against `packages/constants/src/providers/antigravity.ts`, the
      `cloudcode-pa` / `daily-cloudcode-pa` hosts, the `v1internal:streamGenerateContent` /
      `v1internal:loadCodeAssist` endpoints, the envelope literals, the pinned IDE user agent, and
      13 of the 17 catalog ids), credential-free live probes (2026-10-05: Google accepts only
      loopback redirect URIs for this client, the token endpoint requires `client_secret` for both
      grants, and no unauthenticated model endpoint exists), and the public OmniRoute repository
      (the `gemini-3.x-flash-tiered` alias table, the `claude-opus-4-x-thinking` family, and the
      always-stream endpoint). The static 17-id catalog is a necessity, not a choice (probe `401`).
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
      catalog; the lazy per-request refresh already worked.
      Vendor allow-list note: `auth.openai.com` accepts only the Codex redirects
      `http://127.0.0.1:{1455,1457}/auth/callback`, not the Rust default `/v1/auth/openai/callback`
      (or a `localhost` host). The browser-facing page route `GET|POST /auth/callback` (plus the
      `/auth/openai/callback` alias) is mounted at the application root, outside `/v1`, and
      auto-finishes the flow with an HTML result once the vendor redirect reaches the server (a
      local run on port 1455, or an `ssh -L 1455:127.0.0.1:3001` tunnel from the client). Without
      that route reachable, the flow still finishes through `POST /v1/auth/openai/callback` with
      the pasted `callback_url`. The scope constant includes
      `api.connectors.read api.connectors.invoke` (`openai/codex` `codex-rs/login/src/server.rs`).
- [x] Model-registry warmup after the main listener starts (`warmModelRegistry` in Node): the live
      catalogs (`qoder`, Cline, and dynamic Codex) are warmed in a background task spawned at boot
      (`server/src/main.rs`).
- [x] Registry lifecycle for live model catalogs: successful Qoder, Cline, Codex, and Grok Web
      connection writes force-refresh their existing shared catalog; a forced refresh after the
      last connection is removed clears its cached models. No registry rebuild is needed because
      adapters read credentials from the database and retain catalog state in shared handles.

---

## 5. Provider auth (OAuth, device flows, token import) — `features/provider_auth/`

Qoder, Cline, OpenAI, Antigravity, and Claude routes exist in Rust. Source of truth for the route list:
`docs/api-v1-contract.md`
"Retained route inventory" (rows 57-65) and `apps/api/src/routes/v1/auth.ts` (34 routes).

- [x] Cline device flow: `/v1/auth/cline/device` (GET) and `/v1/auth/cline/poll` (GET, POST),
      guarded by the admin session. `/v1/auth/cline/token` (contract row 58) remains deliberately
      deferred; the OAuth-only scope is recorded in the Cline plan.
- [x] Custom providers and the protocol enum: the per-provider `/token` imports
      (`commandcode`, `anthropic`, `atria`, `tokenrouter`, `qoder`) are replaced by one generic
      custom-provider surface. The protocol enum landed:
      `ProviderProtocol { OpenAI, Anthropic, Custom }` in `features/providers/model.rs`, serialized
      lowercase, carried by `ProviderMetadata.protocol` and by the `ProviderEntry` response type, with
      the connect responses re-exporting it as `Protocol`. Every driver names a variant instead of a
      string. Three variants, matching what the build serves: Node's `ProviderProtocol` union also
      lists `gemini` (`packages/types/src/provider.ts:13`), but that value is dead and was not carried
      over, since its only user was the `gemini_cli` provider deleted with
      `packages/providers/src/catalog.ts` in `e248528` and nothing declares or branches on it since
      (`apps/api/src/logic/providers.logic.ts:50` still accepts it in the union check). `custom` is
      live in Node (`packages/constants/src/providers/kiro.ts:7`), so it stays.
      Custom-provider routes are now served (`features/providers/management/custom_routes.rs`):
      `POST /v1/providers` (create, UUID v4 id, `category`/`protocol` validation, `api_key` required
      for `api_key`/`custom_provider`, SSRF-guarded base URL), `DELETE /v1/providers/{provider_id}`
      (`404` when missing), `POST /v1/providers/verify`, and `POST /v1/providers/connections/verify`.
      The driver is the generic `features/providers/custom/executor.rs` (`CustomProvider`), which
      serves `openai` and `anthropic` from the stored row: the registry gained runtime registration
      (`register_runtime`/`unregister`) and the row is re-registered on boot and after each write, so
      its models resolve at the gateway and a deleted provider stops resolving immediately. The
      `ProviderEntry` id/name/category/`default_base_url` became owned `String`s so a stored row fits
      the same response type. Covered by `server/tests/custom_providers.rs` (10 integration tests).
      Landed already: `openai` (`GET /v1/auth/openai/login`, `POST /v1/auth/openai/token`),
      `claude` (login, `token`, the `CLAUDE_OAUTH_CLIENT_ID` override), and the CodeBuddy
      OAuth-only flow (`/v1/auth/{codebuddy,codebuddy-cn}/login` and `/poll`, one
      `CodeBuddyExecutor` over `Flavor { Global, China }`, catalog from `GET /v3/config`, no
      `/token`, no refresh). Tests: `server/tests/codebuddy_auth.rs`,
      `codebuddy_provider.rs`, `claude_auth.rs` (fake upstream only).
- [x] `antigravity` privileged routes: `GET /v1/auth/antigravity/login` (supports `client_id`,
      `redirect_uri`, `prompt`, `format=json`) and `POST /v1/auth/antigravity/token` (validated
      token import, `201`) in `features/provider_auth/antigravity.rs`, both admin-guarded. D3: the
      login pins the redirect to loopback because Google rejects any non-loopback redirect for this
      client (`SROUTER_PUBLIC_URL` is ignored); a remote completion uses the `callback_url` paste
      path. Tests: `server/tests/antigravity_auth.rs` (fake upstream only).
- [x] `antigravity` executor: `features/providers/antigravity/` ports the Gemini-native
      `v1internal:streamGenerateContent` envelope (static 17-id catalog, D2), the request/SSE
      translation, the `loadCodeAssist` project bootstrap (D5), the Codex-pattern token refresh
      (D6), and the registry registration (D10, `SEED_PROVIDERS` 7 → 8). Covered by
      `server/tests/antigravity_provider.rs` and the in-file unit tests.
- [x] `claude` executor: `features/providers/claude/` ports the Anthropic Messages transport over
      a stored Claude Code OAuth session: the request builder (`system` hoisted, `max_tokens`
      default `4096`), the buffered response translation, the Anthropic-SSE → OpenAI re-framer, the
      OAuth headers (`anthropic-version`, the `anthropic-beta` set with the opus/sonnet heavy-agent
      flags, the CLI fingerprint, `anthropic-organization-id`), the live `/models` catalog gated on
      the connection, and the Codex-pattern lazy refresh. Registry registration
      (`SEED_PROVIDERS` 8 → 9). Provenance is recorded in `features/providers/claude/types.rs`
      (official binary 2.1.291 + four independent public OAuth reimplementations) and
      `docs/superpowers/plans/2026-10-06-rust-provider-claude.md`. Covered by
      `server/tests/claude_provider.rs` and the in-file unit tests.
- [x] `antigravity` not-ported paths, reviewed 2026-10-06: none of them is reachable or contract
      material yet, so this is not pending work. The `image_gen` branch (`requestType: "image_gen"`,
      non-stream `generateContent`) fires only for a model whose id matches `/image|imagen/`, and the
      oracle's `ANTIGRAVITY_MODELS` (17 ids) contains none: the Node branch is dead code, and the plan
      already gates the port on "once an image model is advertised". The OpenAI-compatible fallback
      executor and per-connection `base_url` exist only for local proxies or `AIzaSy` keys on an
      `/openai` base, which the owner scope excludes (static chat endpoint, D7). Revisit only when an
      image model appears upstream or the owner reverses that scope.
- [x] `qoder` privileged routes: `GET /v1/auth/qoder/login` (supports `client_id`, `redirect_uri`,
      `format=json`, otherwise redirects to the device URL) and `/v1/auth/qoder/poll` (GET, POST,
      `state` from query or JSON body) in `features/provider_auth/qoder.rs`, mounted behind
      `require_admin_session` (`server/tests/provider_auth.rs`).
- [x] Public route: `/v1/auth/qoder/callback` (GET, POST) reading `code` and `state` from query,
      JSON body, or `callback_url`; missing values → `400`. The browser page
      `GET|POST /auth/qoder/callback` is mounted at the application root (`qoder.rs`) and shares the
      generic `success_page`/`error_page` helpers in `provider_auth/mod.rs` with `openai`.
- [x] Public routes: `openai` and `claude` landed — `/v1/auth/openai/callback` and
      `/v1/auth/claude/callback` (GET, POST) share `parse_callback` with `qoder` and read
      `code` and `state` from query, JSON body, or `callback_url`; missing values → `400`,
      unknown state → `500` (`Invalid or expired OAuth state parameter`). The browser pages
      `GET|POST /auth/{openai,claude}/callback` are mounted at the application root. Covered by
      `server/tests/claude_auth.rs` (fake upstream only).
- [x] `antigravity` public route: `/v1/auth/antigravity/callback` (GET, POST) shares
      `parse_callback` and reads `code` and `state` from query, JSON body, or `callback_url`;
      missing values → `400`, unknown state → `500`. The browser page
      `GET|POST /auth/antigravity/callback` is mounted at the application root beside the OpenAI
      and Qoder pages (D4, single port). Covered by `server/tests/antigravity_auth.rs`.
- [x] `qoder` `/token` import is deliberately deferred: the slice is OAuth only (plan decision,
      web PAT tab returns `404` until it lands).
- [x] Callback URL selection: callbacks are hosted on the main listener (single-port ruling,
      section 1.4). `SROUTER_PUBLIC_URL` supplies the public base; user-supplied non-local callback
      URLs pass through unchanged (`apps/api/src/utils/callbackUrl.ts`). The Node local-mode branch
      that handed callbacks to the `:1455` listener is intentionally not ported.
- [x] PKCE + state lifecycle: state creation, replay/expiry rejection, device-poll state read from
      query or JSON body. One lifecycle serves every flow
      (`infrastructure/database/oauth_sessions.rs`: save, claim, release, delete, 15-minute sweep):
      `claim_session` returns `None` for an unknown, expired, or already-claimed state, so a
      replayed callback cannot exchange the same code twice, and the row is deleted once the tokens
      are stored. PKCE verifier saved and challenged, then sent to the token leg from
      `session.code_verifier`: `openai`, `claude`, `antigravity`, `qoder`. `codebuddy` saves an
      empty verifier (state only), matching the Node oracle's `codeVerifier: ""`, and `cline` stores
      a device code instead; `grok_web` is a cookie connect with no OAuth flow at all.
      Covered by `server/tests/provider_auth.rs`
      (`a_session_can_be_claimed_once_released_and_reclaimed`,
      `an_expired_session_cannot_be_claimed`, `openai_callback_with_an_unknown_state_is_rejected`),
      plus `callback_rejects_missing_params_and_unknown_state` in `claude_auth.rs` and
      `antigravity_auth.rs`, the `claim_session` case in `codebuddy_auth.rs`, and the device-poll
      cases (`poll_without_a_state_is_rejected`,
      `cline_poll_handles_pending_denied_unknown_and_missing_state`).
- [x] Token refresh sweeper and scheduling (`apps/api/src/services/tokenRefresh.ts`), started only
      after database/provider state is ready: implemented via `ProviderRegistry::sweep_tokens`
      invoking each provider's `sweep_tokens()` method (Codex, Cline, Antigravity) with a 5-second
      initial delay and 60-second background ticker in `main.rs`. Verified in
      `server/tests/codex_provider.rs`.
- [x] Env override `CLAUDE_OAUTH_CLIENT_ID`: honored by the `claude` login route (falls back to the
      constant), since the provider now lands. Covered by the in-file `claude` route tests.
- Policy, not a work item: tests for this slice use fake upstreams only
  (`server/tests/provider_auth.rs`), never real provider credentials.
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
- [x] `POST /v1/images/generations` — validated image-generation JSON (`prompt`, `model`), API-key
      auth + rate limit + model access, provider image output, unsupported image model → `400`.
      Mounted under `/v1` and `/v1/v1` compat alias. Enforces prompt requirement, `n` bound (1..=10),
      capability checks (`is_image_generation_supported` and image editing input checks), allowlist filtering,
      provider resolution and delegation via `ProviderExecutor::generate_image`, zero-token request log
      accounting in `request_logs`, and API key usage increment.
      Legacy evidence: `apps/api/tests/images-route.test.ts`, `images-fallback.test.ts`.
      Covered by `server/tests/images.rs` (11 tests).
- [x] Owner ruling 2026-10-04: Fallback policy (`/v1/settings/fallbacks` CRUD and gateway cascade
      execution) is deliberately dropped and excluded from the Rust build. Gateway handlers
      (`chat.rs`, `messages.rs`, `images.rs`) keep `fallback_occurred = false`, `fallback_path = None`,
      and `fallback_reason = None` without multi-model retry loops. The `fallback_rules` DB table
      is preserved across migrations for data safety without active routes.
- [x] Protocol translation module (`features/gateway/translation.rs` in the plan, landed as
      `server/src/features/gateway/translation.rs`): OpenAI ⇄ Anthropic request/response mapping,
      tool calls, usage extraction, malformed payload handling.
      Request: system (string or blocks, joined with `\n\n`, `cache_control` dropped), string
      content keeps `role`, block content folds non-assistant into `user`/`tool`, assistant blocks
      collapse to one `\n`-joined string (`null` when only tool calls), `tool_choice`
      `auto`→`auto`/`any`→`required`/`tool`→`{"type":"function","function":{...}}` (nameless
      dropped), `thinking` `enabled|adaptive`→`reasoning:{effort:"high"}` / `disabled`→
      `reasoning_effort:"none"` (`budget_tokens` never forwarded), OpenAI-only fields (`top_k`,
      `metadata`, `n`, `user`, penalties, `stream_options`, `response_format`) dropped (probed
      key set). Response: `content` array collapses to one `\n`-joined text block, `finish_reason`
      `tool_calls|function_call`→`tool_use` / `length`→`max_tokens` / everything else (`stop`,
      `stop_sequence`, `content_filter`, null)→`end_turn`, usage = exactly `input_tokens` +
      `output_tokens`, `msg_` id (prefix stripped, uuid fallback). Stream: `message_start` reads
      `prompt_tokens` before emitting, `output_tokens` counts deltas (never `completion_tokens`),
      empty stream emits only `message_delta`+`message_stop` (no backfill). Validation:
      `validate_anthropic_request` reproduces the probed Zod messages — union failures
      (content/system/tool_result blocks) collapse to `Invalid input`, scalars keep their
      `Expected ..., received ...` / enum texts, `Required`, `Missing required field '...'`.
      Covered by 25 pure-function tests in the module's `tests` block frozen against probes
      `probe3`–`probe15`, plus `server/tests/messages.rs` (13 integration tests), and
      `apps/api/tests/opencode-compat.test.ts` passes as the black-box oracle (1/1).
- [x] Client-cancellation semantics: disconnect cancels the upstream request, no full-response
      buffering, and partial-output billing rules
      (`apps/api/tests/` streaming cases, `docs/api-v1-contract.md` "Streaming").
      Both stream loops (`chat.rs`, `messages.rs`) now race `tx.closed()` against
      `stream.next()`: when the client drops the response body the task returns at once and
      dropping the upstream stream cancels the in-flight request (Node, probed as probe16,
      instead keeps draining the generator after a disconnect — a deliberate Rust deviation
      required by the migration plan's "verify client disconnect cancels the upstream request").
      No full-response buffering was already true and is now pinned: forwarded chunks arrive
      while the fake upstream is still inside a 600-second stall.
      Partial-output billing rules: (1) an in-stream failure after partial output bills
      nothing — the log row carries the failure status with zero usage and any reservation is
      released (`stream_error_payload` decodes `{"error":...}` frames; messages surfaces them
      as an `event: error`, chat forwards the envelope verbatim, neither emits `message_stop`
      or `[DONE]` after a failure), mirroring Node's
      `api-keys-usage-deduction.test.ts` "does not bill a stream that errors after partial
      output without usage"; (2) a disconnect settles the reservation to the usage observed
      before the cancel (partial output), never to the response it never waited for.
      Covered by `server/tests/client_cancellation.rs` (delivery-before-completion and
      upstream cancellation via a drop-guarded fake body), two billing tests in
      `server/tests/chat_completions.rs`, and the `mid_stream_failure_*` case in
      `server/tests/messages.rs`; Node oracle tests
      `api-keys-usage-deduction.test.ts` (3/3) and `messages.test.ts` (3/3) pass.
- [x] `/v1/v1/*` alias covers every gateway path (`/chat/completions`, `/chat/completion`, `/chat`,
      `/messages`, `/messages/count_tokens`, `/images/generations`, `/models`, `/models/{model}`)
      and stays absent for provider/auth/keys/logs/settings routes. Covered by `server/tests/csrf.rs`,
      `images.rs`, `models.rs`, and `providers.rs`.
- [x] Token Saver: always-on compression of noisy tool output (ANSI, whitespace, diff metadata,
      repeated log lines) plus one fixed terse-output directive, applied once per top-level
      chat/messages request before model resolution. No settings row, no toggle, no threshold;
      native gateway design, no Node parity:
      `docs/superpowers/plans/2026-10-01-token-saver.md`.

---

## 7. Catalog: models, pricing, quota

- [x] `GET /v1/models` with `Cache-Control: public, max-age=60, stale-while-revalidate=300`,
      `refresh`/`force` params, `no-cache`/`no-store` revalidation, allowlist filtering, hidden and
      disabled-provider filtering, favorite flag (`features/catalog/models.rs`). A filter applies to the
      model, so a Qoder name pair shares one verdict: `model_id_variants` expands a request or a stored
      hidden/favorite id into every id that reaches the same upstream key, and `names_of` expands the
      sets read from the database. Closed 2026-10-04: the two clauses that lacked Rust evidence are now
      pinned in `server/tests/models.rs` — `no_cache_and_no_store_revalidate_the_catalog_without_blocking`
      (the background fetch runs behind a 300 ms fake while the response answers in under 150 ms, the
      geometry of the Node fixture in `apps/api/tests/models-endpoint.test.ts`) and
      `an_allowlist_entry_under_one_qoder_name_lists_both_names` (one allowlist entry under either name
      serves the whole Qoder pair, on the list and the single route).
- [ ] `/v1/models` response shape: `ModelObject` carries `{id, object, owned_by}` only, so upstream
      metadata that `model/list` does return (`display_name`, `is_vl`, `format`, `max_input_tokens`,
      `price_factor`, `is_free`) is parsed away today. Adding it is a contract change and needs a
      consumer first.
- [x] `GET /v1/models/pricing` — `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`,
      `refresh`/`force`/`no-cache` forcing a refresh (`features/catalog/pricing.rs`). Legacy evidence:
      `apps/api/tests/pricing-route.test.ts`. Sourced independently from official Models.dev data
      (`features/catalog/data/models-dev-pricing.json` and `.manifest.json`, maintained via
      `server/scripts/update_models_dev_pricing.py`). Pre-parsed into memory at startup via `LazyLock`,
      providing sub-millisecond responses without allocations, and drives token cost estimation in
      `estimate_cost` linked to `request_logs`. Covered by `server/tests/pricing.rs`.
- [x] `GET /v1/quota` and the retained misspelling alias `GET /v1/qouta` — provider OAuth quota data,
      `refresh`/`force` refresh. Legacy evidence: `apps/api/tests/quota-oauth-filter.test.ts`.
      Implemented in `features/catalog/quota.rs` and mounted in `app.rs`: 60-second in-memory cache,
      coalesced concurrent requests, filters out non-OAuth providers, parses live ChatGPT rate limit
      windows (`wham/usage`), and handles upstream errors gracefully. Covered by `server/tests/quota.rs`.
- [x] Create `features/catalog/` per the plan layout and move the model/pricing/quota routes there:
      `models.rs` relocated from `features/gateway/` to `features/catalog/models.rs`, and all catalog
      subsystems (`models`, `pricing`, `quota`) are cleanly exported from `features/catalog/mod.rs`
      and mounted into the application router. Covered by `server/tests/models.rs` and `pricing.rs`.

## 8. Dashboard: logs, analytics, settings

- [x] `GET /v1/logs` (paginated + recent), `GET /v1/logs/{id}`, `GET /v1/logs/events` SSE with
      `connected`/`usage.updated`/`request.logged` and 25 s heartbeats, 16-stream cap with `429`
      (`features/logs.rs`, `server/tests/logs.rs`).
- [x] Log records expose token, cost, resolved-model, fallback, and creation-time columns; stats
      `cost.label` uses four decimals. `estimated_cost` remains `0.0` until the pricing catalog lands
      (`infrastructure/database/request_logs.rs`, `server/tests/logs.rs`).
- [x] `GET /v1/logs/stats` — aggregate usage statistics (`usage_stats` in
      `infrastructure/database/request_logs/analytics.rs`, now served directly instead of only through
      the `usage.updated` SSE payload). The report is grouped rather than flat:
      `{ object, data: { totals: { requests: { total, success, failed }, tokens: { input, output, total, reasoning, cache: { write, read } }, cost: { total, label, estimated } }, by_model: [] } }`.
      `cost` carries a single `total` because `request_logs` stores one `estimated_cost` per request,
      not a per-category breakdown. Serializes snake_case, as does the SSE `usage.updated` payload
      (documented deviation, `docs/api-v1-contract.md` "Logs in the Rust build"). Web calls this
      endpoint (`apps/web/src` → `/v1/logs/stats`) and still reads the frozen flat shape, so it is
      stale until the web refactor (#150) maps `data.totals`.
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

- [x] `GET /v1/admin/database/export` — admin session **only** (API keys and loopback do not
      qualify), streams a snapshot as `application/octet-stream` with an attachment filename.
      `server/src/features/database_transfer/routes.rs` (`export_handler`) via `export_snapshot`;
      admin guard applied in `server/src/app.rs`. Covered by `server/tests/database_transfer.rs`
      (`export_requires_an_admin_session_and_rejects_api_keys_and_loopback`,
      `export_filename_is_the_fourteen_digit_utc_stamp`).
- [x] `POST /v1/admin/database/import` — exactly one multipart file in field `database`, max 25 MiB
      (`413` from the global limit for oversized `Content-Length`, `400` + `upload_too_large` for an
      oversized chunked upload), stream to a private temp file (`0700` dir / `0600` file, cleaned up
      on success and failure), validate before replacement, make a recoverable backup, replace
      atomically where the platform allows, restore on failure, clear the admin cookie, and return
      `ok`, `backup_path`, `restart_required`, `reauth_required`.
      `multipart.rs` (streaming + field-shape rules), `transfer.rs` (validate/replace/lock), and
      `routes.rs` (`import_handler`). Covered by the remaining `server/tests/database_transfer.rs`
      cases (auth, happy path with post-swap visibility, duplicate/missing parts, size guards,
      validation rules, legacy migration, cleanup + backup, live-lock `409`).
- [x] Legacy evidence: `apps/api/tests/database-route.test.ts`, `apps/api/src/controllers/database.controller.ts`,
      `docs/api-database-contract.md`. The Rust deviations (version carrier, legacy migration,
      streaming parser, lock owner modes) are recorded in `docs/api-database-contract.md`
      §"Database transfer in the Rust build" and `docs/api-v1-contract.md`.

## 10. Persistence gaps

- [x] SQLite schema v4 via `server/migrations/0002_v2_schema.sql`, `0003_request_logs.sql`,
      `0004_remove_tunnel_settings.sql` (v4 = the v3 tables plus the tunnel-settings cleanup;
      owner ruling 2026-10-08). The v3 steps (`0003` ALTERs + the legacy id upgrade) are now
      gated to `version < 3`, because a file already at v3 must not replay them: the ALTERs fail
      on a duplicate column and the id upgrade would stamp `legacy_id` on every current row.
      Covered by `server/tests/schema.rs`, including the two new
      `tunnel_settings_rows_are_deleted_*` cases (v3 file and the v1 transform path) and the
      existing row-preservation cases.
      PostgreSQL is refused at boot (owner ruling 2026-10-05): the backend has no schema carrier
      and no repository statements, so a `DATABASE_URL` boot used to come up with no tables and
      answer every request from empty defaults (settings/favorites/hidden/disabled returned
      defaults, admin and request-log stores answered `500`). `AppDatabase::connect` now returns
      `500` naming the backend before SQLite is touched, the unused `postgres` module and its
      error constant are deleted, and `server/.env.example` records that `DATABASE_URL` is not
      supported yet. Covered by `server/tests/database.rs`
      (`a_configured_database_url_is_refused_before_any_sqlite_file_is_touched`).
- [ ] PostgreSQL support, if it is wanted: add the schema carrier plus the missing statements
      (`settings.rs`, `catalog_flags.rs`, `providers/connections.rs`, `request_logs/store.rs`,
      `admin_auth.rs`), then relax the boot refusal. The defensive "reads empty / writes fail"
      behavior is still pinned by `a_postgres_backend_reads_empty_and_refuses_provider_writes`
      and `postgres_request_log_repository_fails_explicitly`.
- [x] Migration ownership check: audited 2026-10-06 against `docs/schemas-database.md`, the allowed
      independent contract. All ten tables match it column for column, and the eight `request_logs` v3
      columns in `0003_request_logs.sql` are the documented ones (contract section 4). The only
      destructive statements are `DROP TABLE IF EXISTS` on six legacy shapes, each with a reason
      (shape changed and recreated from the captured rows, renamed, or the provenance marker). The only
      row-deleting statement is `0004_remove_tunnel_settings.sql` (four Cloudflare Tunnel settings
      keys), an explicit owner ruling 2026-10-08 to remove the feature including its stored state; there is
      no `TRUNCATE`, `DROP COLUMN`, or any other `DELETE`. Row-level preservation is pinned by
      `server/tests/schema.rs`: the v1 transform, v1 with missing optional columns, v2 request logs, the
      newer-version refusal, the second-connect no-op, and the two `tunnel_settings_rows_are_deleted_*`
      cases that also pin `require_api_key` surviving. The invariant stands: a migration that drops
      user data outside an explicit owner ruling is a defect, and any new statement here must keep that
      property.
- [x] Field/relation citations for every table Rust touches: satisfied 2026-10-06 by
      `docs/schemas-database.md`, which records the independent provenance (disposable-probe dump of the
      observed v1 schema plus API-visible behavior) and carries a `CREATE TABLE` for every one of the
      ten tables plus the v3 `request_logs` additions. A programmatic diff of that contract against
      `server/migrations/0002_v2_schema.sql` shows every column present on both sides and no table on
      either side alone.
- [ ] Optional PostgreSQL integration test behind an isolated CI database URL (skip when unset);
      it belongs with the "PostgreSQL support" item above.

## 11. Contract publication (TypeScript bindings)

- [x] `server/src/bindings.rs` + `server/src/bin/export_ts.rs` + `server/bindings.ts`: the
      TypeScript view of the JSON wire shapes, rendered with `specta` (`=2.0.0-rc.25`, features
      `derive`, `collect`, `uuid`) and `specta-typescript` (`=0.0.12`). `bindings::types()` registers
      29 response roots and the render pulls in every type they reference; `bindings::export()`
      renders them through `specta-serde` (`=0.0.12`) so the serde attributes that shape the wire
      (`rename_all`, `skip_serializing_if`, flattening) are reflected. Output: 92 exported types,
      703 lines, JSDoc taken from the Rust doc comments.
- [x] Integer handling: `specta-typescript` refuses `i64`/`u64`/`usize`/`isize`/`i128`/`u128`
      outright, so each of the 57 such fields carries a `#[specta(type = …)]` override to the exact
      TypeScript number type (`Number`, `Option<Number>`, `Vec<Number>`), which keeps nullability and
      optionality intact. The `HttpMethod` fallback lives in `FromStr` instead of `#[serde(other)]`,
      which `specta-serde` only accepts on tagged enums.
- [x] Every conditional field is optional (`?:`), not merely nullable: the 44 fields the server omits
      when they are null carry `#[specta(optional)]`, and so do the request fields a handler defaults
      (`POST` fills `enabled: true` and zeroes) or leaves untouched (`PATCH`). `UpdateAPIKeyInput` was
      reporting every field as required while the Rust type is all-`Option`.
- [x] Closed unions where the build decides the value: `ProviderStatus.state` renders
      `"connected" | "no_connections"` and `LiveModelQuotaItem.status` renders
      `"exhausted" | "warning" | "ok"`, both through private `Type` impls that return
      `specta_typescript::define`. `ProviderConnectionView.protocol`/`category` and
      `ProviderEntry.category` deliberately stay `string`: the database import writes those columns
      from a payload, so a closed union would misdescribe imported data.
- [x] No opaque holes: the document carries no `unknown` and no `any`. `usage_metrics` is
      `ProviderUsageMetric[] | null`, a typed struct whose shape is Node's
      (`packages/types/src/quota.ts`); no driver in this build fills the field, but a client can read
      it without casting.
- [x] One shape per type, not one per direction. `skip_serializing_if` makes `specta-serde` export
      `X_Serialize` and `X_Deserialize` for every type reaching such a field, plus
      `X = X_Serialize | X_Deserialize`, which doubled the document (93 names, duplicated JSDoc) even
      though a response reader only ever sees one shape. `bindings.rs` therefore renders through a
      `WireShapes` formatter: it hands `specta_serde::Format` a copy of the graph with the
      `serde:field:skip_serializing_if` runtime attribute removed from the fields, so the unified
      formatter accepts it and emits a single shape. Output is 47 types in 451 lines, and `LiveEvent`
      loses the `& { log?: never; stats?: never }` phase noise.
      This changes the exported document only: the serializers still omit the field, the source keeps
      every `#[serde(skip_serializing_if)]`, and `server/tests/wire.rs` reads live responses to pin
      that an omitted field is absent rather than null, that a present one carries the shape the
      document describes, and that required fields are always present.
- [x] `server/tests/bindings.rs` (8 tests): byte-identical double render, the committed file matches a
      regeneration, the document carries only type exports, every registered root is present, one
      shape per type, the closed values are union literals, no opaque holes, and the integer overrides
      still render as the right number type. CI (`rust-test`) regenerates and runs
      `git diff --exit-code -- server/bindings.ts`.
- Deviation: this document has no route, method, or security-scheme information, so the OpenAPI
  sweep that a route change used to fail (`every_route_literal_in_the_source_is_documented`) has no
  replacement here. Which endpoint answers a shape is documented in the `bindings.rs` table and
  pinned by the route tests, not by this file.
- Removed 2026-10-07 by owner ruling: the Rust build no longer publishes an OpenAPI document.
  Deleted `server/src/openapi.rs`, `server/src/bin/export_openapi.rs`, `server/openapi.json`, and
  `server/tests/openapi.rs`, plus the `schemars` dependency (and the 51 model derives it fed).
- [ ] `apps/web` still imports the frozen `apps/web/src/generated/api.ts` (52 files) that
      `openapi-typescript` generated from the deleted `server/openapi.json` (`api:generate` /
      `api:check` in `apps/web/package.json`). Kept on purpose for the web refactor (issue #150): the
      `api:check` job is already parked (`bf01134`), and nothing reads `server/bindings.ts` yet.

## 12. CI, Docker, cutover plumbing

- [x] `.github/workflows/ci.yml`: added a `rust-lint` job with the stable Rust toolchain,
      `cargo fmt --check`, and `cargo clippy --all-targets --all-features --locked -- -D warnings`.
      The Node/pnpm job (`build-and-test`) sat beside it until `bf01134` parked it: its
      `pnpm --filter web api:check` step fails on every server-side contract change until
      `apps/web` regenerates its types, which belongs to the web refactor (issue #150). The
      workflow file carries the parking note and the command that restores it from `795ecd1`.
      The crate is clippy-clean: no `allow` attributes were needed, and the long-standing warnings
      (`collapsible_if`, `manual_div_ceil`, `unnecessary_cast`, `new_without_default`,
      `assertions_on_constants`, `large_enum_variant`, `result_large_err`) are fixed at the source.
- [~] `.github/workflows/ci.yml`: the `rust-test` job runs
  `cargo test --manifest-path server/Cargo.toml --locked`, so the suite is guarded
  on every push/PR and a `Cargo.toml` edit that skips `server/Cargo.lock` fails the job. The
  bindings drift check runs in that job (regenerate `server/bindings.ts` + `git diff --exit-code`);
  it covers types only, not the routes. The Node job's `pnpm --filter web api:check` half is parked
  with the job itself (`bf01134`), so `apps/web/src/generated/api.ts` is frozen. Still missing: the
  PostgreSQL service job.
- [x] `Dockerfile`: four stages. `web-builder` (Node/pnpm, `pnpm --filter web build`), `server-builder`
      (`rust:1.98-alpine` plus `build-base` and `perl`; aws-lc-sys compiles its C and assembly with
      gcc/make, no cmake or nasm needed), `runner` (Node-free `alpine:3.22` with ca-certificates,
      tzdata, and wget, carrying the binary and the web dist, health-checked with `wget`), and the
      legacy `node-builder`/`node-runner`. The Node runtime stays the last stage, so a plain
      `docker build` keeps producing the Node image until cutover and `--target runner` selects the
      Rust build. Built and smoke-tested here (see the no-Node item below); the Node target still boots
      both listeners. `.dockerignore` now excludes `server/target`, `server/logs`, and `.local`.
- [x] `docker-compose.yml`: the default `srouter` service builds `target: runner`, publishes only
      `${PORT:-3000}:3000` (the `:1455` mapping is gone), sets `WEB_DIST_PATH=/app/web/dist`, and
      health-checks with `wget`, so the container needs no Node. The Node service is kept as
      `srouter-node` behind a `node` profile: a plain `docker compose up` starts only the Rust
      service, and `docker compose up -d srouter-node` is the rollback. `docker compose config`
      confirms one published port and one default service.
- [ ] Root `Procfile` (`web: node apps/api/dist/index.js`) → Docker-based Rust deployment; root
      `heroku.yml` does not exist yet although the plan creates/keeps one. `apps/api/heroku.yml`
      becomes obsolete with `apps/api`.
- [x] Verified the Rust runtime image contains no Node executable (`node`, `npm`, and `nodejs` are
      absent) and smoke-tested it on a disposable volume: `/health` 200, `/` serves the SPA shell, an
      asset carries the immutable cache header, an unmatched route falls back to the shell without one,
      `/v1` reports version `0.2.0`, and `logs/srouter-server.log` is written. A plain `docker build`
      still lands on the Node runtime, so the production default is unchanged until cutover.
- [~] `docs/api-migration.md`: drafted 2026-10-08. Carries the parity matrix from static evidence
  (per-area Rust test vs Node oracle, verdicts marked served/deviation/not served), the
  owner-approved deviation list, the tunnel removal write-up, staging steps, the backup/rollback
  procedure (including the schema-ownership caveat: after a Rust migration Node boot recreates
  `admin_account`/`system_settings` empty and can no longer query `api_keys.key`, so a full
  rollback restores the pre-migration backup), and an empty benchmark table with its measurement
  protocol - no numbers, no claims. Still open: the live A/B parity run, measured benchmarks,
  and owner sign-off; those keep this item partial.
- [ ] Staging cutover + 24 h monitoring + rollback rehearsal (plan Task 15).

---

## 13. Delete `apps/api` (final step, gated)

- Deviation approval (2026-10-02 --- 13-43 WIB): the provider-management route gaps
  (create/delete connection, verify, custom models, round-robin, hidden-models, favorites,
  `enabled`) and the field-naming differences are owner-approved as the Rust build's
  contract, so no provider route needs a Node-parity port before cutover.
  Since that ruling the ground moved: hidden-models and favorites are served again under
  `/v1/models`, round-robin is served by `PATCH /providers/{provider_id}/round-robin`
  (section 4), and the custom-provider routes are served too: `POST /v1/providers`,
  `DELETE /v1/providers/{provider_id}`, and both verify routes
  (`features/providers/management/custom_routes.rs`, section 4). What remains unported is
  `/v1/providers/:id/enabled` as a separate route (its flag lives on the provider `PATCH`).

Do not start until every section above is checked, the parity matrix passes, and the rollback window
has closed. Then delete, in one commit:

- Web coupling: `apps/web` writes to the Rust-only surfaces — favorites, hidden models, custom
  models, and the provider `enabled` flag go through `/v1/models` and the provider `PATCH`. Four
  surfaces stay Node-shaped because Rust deliberately drops them: `/v1/settings/fallbacks`
  (`apps/web/src/hooks/useFallbacks.ts`, consumed by the `/combo` page), both verify routes
  (`providers.connection-form.tsx`, `providers.custom-provider-dialog.tsx`,
  `routes/providers/$providerId.tsx`), and `/v1/tunnel/*` (`apps/web/src/hooks/useTunnel.ts`, no
  importer today). Those calls answer `404` on the Rust build, so a rollback to `apps/api` has to
  ship the web bundle from the same commit; the reverse is free. Tunnel note: the feature itself is
  deleted by the owner ruling 2026-10-08 (see the ground rules), so removing `useTunnel.ts` and the
  Node tunnel routes joins this retirement step when `apps/` comes into scope.

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
cargo run --manifest-path server/Cargo.toml --bin export_ts && git diff --exit-code -- server/bindings.ts
git diff --check
```
