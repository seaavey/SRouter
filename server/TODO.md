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

- [ ] Implement `server/src/http/static_files.rs` and mount it from `server/src/app.rs`.
      Node evidence: `apps/api/src/index.ts:148-170` (`resolveWebDistPath()`, `serveStatic`,
      SPA fallback to `index.html`), `apps/api/src/services/webDist.ts`,
      `apps/api/tests/web-dist.test.ts`.
      Required behavior: resolve the web dist from `WEB_DIST_PATH` when set, otherwise search the
      repository- and app-relative `dist` candidates; when `<dist>/index.html` exists, serve assets
      at `/*` and fall back to `index.html` for unmatched GETs; when it does not exist, `GET /`
      returns the API info object (already implemented in `app.rs`).
- [ ] Add the asset cache header rule: paths ending in
      `js|css|map|woff|woff2|ttf|otf|png|svg|ico|webp|avif|jpg|jpeg|gif` get
      `Cache-Control: public, max-age=31536000, immutable`.
      Accept: Rust test asserting header presence on a fixture asset and its absence on the SPA
      fallback response.

### 1.2 Global body limit

- [x] Only the gateway handlers capped body size (`features/gateway/chat.rs:289`,
  `features/gateway/messages.rs:347`). Node applies a global middleware on `/v1/*` that rejects
  `Content-Length > 25 MiB` with `413` + `code=request_too_large` before buffering the body
  (`apps/api/src/middleware/BodyLimit.ts`, `apps/api/tests/request-limits.test.ts`).
- [x] Add `http/middleware/body_limit.rs`, layer it on `/v1` and `/v1/v1`, and cover it with
  `server/tests/http_runtime.rs` cases for oversized `Content-Length` (413) returning
  `invalid_request_error` envelope.

### 1.3 Error envelope completion

- [ ] Unhandled `SyntaxError`-equivalent JSON parse failures must produce `400` with
      `code=invalid_json` and message `Malformed JSON in request body`
      (`apps/api/src/index.ts:88-99`, `apps/api/tests/malformed-json.test.ts`).
      Today `error.rs` only guarantees the generic `{error:{message,type}}` shape.
- [ ] Verify status→type mapping matches the contract exactly: `invalid_request_error` for
      `400/404/409/422`, `authentication_error` for `401`, `permission_error` for `403`,
      `rate_limit_error` for `429`, `api_error` otherwise; handlers may override `type` and attach
      `code`/`param` (`docs/api-v1-contract.md`, "Error envelopes").
      Accept: table-driven Rust test over the mapping.

### 1.4 OAuth listener (port 1455)

- [ ] Implement the secondary listener in `server/src/http/listeners.rs`: bind
      `OAUTH_HOST` (default `0.0.0.0`) on `OAUTH_PORT` (default `1455`), skip it entirely when
      `SROUTER_PUBLIC_URL` is non-empty, and log the same startup lines as Node
      (`apps/api/src/index.ts:174-248`).
      `APIConfig` already parses all three values; nothing binds them today.
- [ ] Mount `/v1/messages`, `/v1/chat/completions`, `/v1/chat/completion`, `/v1/models`,
      `/v1/models/{model}` on the OAuth listener **without** the main app's security-header, CORS,
      CSRF, and body-limit middleware (feature-level auth/validation still apply).
- [ ] Mount the OAuth callback routes on the OAuth listener:
      `GET|POST /auth/callback` (OpenAI), `/auth/antigravity/callback`, `/auth/claude/callback`,
      `/auth/qoder/callback`. Blocked by section 5 (provider auth) — the handlers do not exist yet.
- [ ] Add `server/tests/oauth_listener.rs`: bind on an ephemeral port, assert the listener is
      absent when `SROUTER_PUBLIC_URL` is set, assert gateway routes respond on it and that no
      `X-Powered-By` header is added there.

### 1.5 Version and info fields

- [ ] `X-Version` and the `GET /v1` body currently report the Cargo crate version
      (`app.rs:38`, `Cargo.toml` `version = "0.2.0"`). Node reports `API_VERSION = "0.1.8"`
      (`packages/constants/src/version.ts`) through `apps/api/tests` and the web UI.
      Decide (product call, needs owner approval): keep the Rust crate version and document the
      change, or emit the release version separately from the crate version. Record the decision in
      `docs/api-v1-contract.md` before cutover.

### 1.6 Telemetry

- [ ] Add `server/src/infrastructure/telemetry.rs` (tracing subscriber) per the target layout and
      the plan's tech stack. Node logs request failures through `console.error` in its error
      handlers; Rust currently logs only startup and shutdown lines.

---

## 2. Admin auth

- [x] `GET /v1/admin/status`, `POST /v1/admin/setup` (loopback-only, `201`, `403` remote, `409`
      repeated), `POST /v1/admin/login` (cookie, `401`, five failures → 15-minute `429`),
      `POST /v1/admin/change-password`, `POST /v1/admin/logout` (`204`, invalid session `401` +
      cookie clear) — `features/admin_auth/`, `server/tests/admin_auth.rs`.
- [ ] Admin bootstrap from the environment at startup: when `SROUTER_ADMIN_PASSWORD` is set, apply
      it during boot exactly like `bootstrapAdminAccountFromEnv`
      (`apps/api/src/services/adminAuth.ts`, invoked from `boot()`); `APIConfig.admin_password` is
      parsed but never consumed.
      Accept: `server/tests/startup.rs` case that boots with the env var and logs in with it.
- [ ] Cookie flags parity: `HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` only when
      `SROUTER_SECURE_COOKIES=true`, max age seven days (`docs/api-v1-contract.md`). Verify the
      Rust cookie builder sets all five; add a test if any flag is missing.
- [ ] Startup ordering: Node awaits PostgreSQL schema init, then admin bootstrap, then provider
      registry, then serves; model warmup runs after the listener is up, and the token-refresh
      sweeper starts last (`docs/api-v1-contract.md`, "Legacy baseline"). Rust `main.rs` currently
      does not run bootstrap, warmup, or the sweeper — re-check after sections 2 and 5 land.

---

## 3. API keys and request authorization

- [x] `/v1/keys` CRUD + credit (`features/api_keys/`), admin-session guard, API-key auth middleware,
      rate limiter, model allowlist filtering on catalog/gateway (`server/tests/api_keys.rs`,
      `api_key_auth.rs`, `model_access.rs`, `rate_limit.rs`).
- [ ] Verify the remaining Node semantics case by case against
      `apps/api/tests/api-keys-quota-credit.test.ts`, `api-keys-usage-deduction.test.ts`,
      `api-keys-credit-route.test.ts`, `api-keys-credit-db.test.ts`:
      disabled key → `401`; exhausted credit → `402`; exhausted token quota → `429`; missing key on
      non-loopback → `401`; `rate_limit = 0` → unlimited; `429` carries
      `code=rate_limit_exceeded` and `Retry-After`.
      Record per-case results; open a Rust test for every case not yet covered.
- [ ] Reserved `max_tokens` budget for API-key requests (default `4096`) and usage/cost write-back
      on request completion — confirm parity with `apps/api/src/logic/quota.logic.ts` behavior via
      black-box comparison, and add the missing assertions to `server/tests/chat_completions.rs`.
- [ ] CSRF origin guard coverage for every cookie-authenticated mutation after the new routes land
      (body limit, OAuth listener mounts do not need it, admin/database routes do).

---

## 4. Providers: management, registry, catalog

Current Rust scope (documented deviation): one driver `opencode_zen`, read routes
`GET /v1/providers`, `GET /v1/providers/catalog`, `GET /v1/providers/{provider_id}`, one write
route `PATCH /v1/providers/{provider_id}` with `enabled|hide|restore|favorite|unfavorite`
(`features/providers/management/routes.rs`). Everything below is still Node-only.

- [ ] `POST /v1/providers` — create a provider connection (admin session, validated provider JSON).
- [ ] `DELETE /v1/providers/{id}` — delete a connection (`404` when missing), refresh live registry.
- [ ] `POST /v1/providers/verify` — connection verification with SSRF protection
      (`apps/api/tests/verify-connection.test.ts`; blocked targets: non-HTTP(S), unresolved,
      private, loopback, link-local, CGNAT, multicast, metadata service; redirects must not bypass).
- [ ] `POST /v1/providers/connections/verify` — body `connection_id`; `400` invalid, `404` missing.
- [ ] `POST /v1/providers/{providerId}/models` — add custom model (`model_id`, `201`).
- [ ] `DELETE /v1/providers/{providerId}/models/{modelId}` — remove custom model.
- [ ] `PATCH /v1/providers/{providerId}/round-robin` — `enabled` flag.
      (`apps/api/tests/round-robin-endpoint.test.ts`.)
- [ ] Round-robin/selection policy in the registry itself, if the driver set grows past one.
- [ ] `GET /v1/providers/{providerId}/hidden-models` — Node returns `{models:[...]}`. Rust folded
      this into the detail payload; the route is not served. Either implement the route for parity or
      get the deviation explicitly approved, like the tunnel exclusion. Same call for
      `/v1/favorites` (`GET` API-key, `POST` admin `201`, `DELETE /{modelId}` `404`)
      (`apps/api/src/controllers/favorites.controller.ts`, web calls both — `favorites.ts`,
      `favorites` mutations today only work through the provider PATCH).
- [ ] Catalog provenance: record an allowed independent source for every built-in provider entry
      and model list before the driver set is extended (`docs/api-v1-contract.md` "Scope").
- [ ] Model-registry warmup after the main listener starts (`warmModelRegistry` in Node).
- [ ] Registry lifecycle on write: Node refreshes the live registry after connection
      create/delete; Rust writes rows but never rebuilds `ProviderRegistry`.

---

## 5. Provider auth (OAuth, device flows, token import) — `features/provider_auth/`

Nothing exists in Rust. Source of truth for the route list: `docs/api-v1-contract.md`
"Retained route inventory" (rows 57-65) and `apps/api/src/routes/v1/auth.ts` (34 routes).

- [ ] Privileged routes (admin session): `/v1/auth/cline/device` (GET), `/v1/auth/cline/poll`
      (GET, POST), `/v1/auth/{openai,antigravity,claude,qoder}/login` (GET, supports
      `client_id`, `redirect_uri`, `prompt`, `format=json`), `/v1/auth/{codebuddy,codebuddy-cn}/login`
      (GET) and `/poll` (GET, POST), and every `/token` route
      (`cline, openai, antigravity, commandcode, anthropic, atria, claude, tokenrouter, codebuddy,
codebuddy-cn, qoder`) → validated token import, `201`.
- [ ] Public routes: `/v1/auth/{openai,antigravity,claude,qoder}/callback` (GET, POST) reading
      `code` and `state` from query, JSON body, or `callback_url`; missing values → `400`.
- [ ] Callback URL selection: `SROUTER_PUBLIC_URL` switches callbacks to the main listener's
      `/v1/auth/.../callback`; local mode uses the OAuth listener; user-supplied non-local callback
      URLs pass through unchanged (`apps/api/src/utils/callbackUrl.ts`).
- [ ] PKCE + state lifecycle: state creation, replay/expiry rejection, device-poll state read from
      query or JSON body.
- [ ] Token refresh sweeper and scheduling (`apps/api/src/services/tokenRefresh.ts`), started only
      after database/provider state is ready, stopped on shutdown.
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

---

## 7. Catalog: models, pricing, quota

- [~] `GET /v1/models` with `Cache-Control: public, max-age=60, stale-while-revalidate=300`,
  `refresh`/`force` params, `no-cache`/`no-store` revalidation, allowlist filtering, hidden and
  disabled-provider filtering, favorite flag (`features/gateway/models.rs`).
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
- [ ] `GET /v1/logs/stats` — aggregate usage statistics (`usage_stats` helper exists in
      `infrastructure/database/request_logs.rs`; only the SSE path calls it).
      Web calls this endpoint (`apps/web/src` → `/v1/logs/stats`).
- [ ] `GET /v1/logs/analytics` — `window` param (default `24h`), invalid window → `400`.
      Legacy evidence: `apps/api/tests/analytics.test.ts`.
- [ ] `GET /v1/settings` response must match Node: `require_api_key` **plus** the compatibility
      field `requireApiKey` and the `settings` map (`apps/api/src/controllers/settings.controller.ts`).
      Rust returns `require_api_key` only (`features/settings.rs`).
- [ ] `POST|PATCH /v1/settings` must accept the same payload: boolean `require_api_key` and a
      string-valued `settings` object, persisted and echoed back. Rust rejects/handles only
      `require_api_key` today; decide whether the `settings` map is persisted as key/value rows or
      dropped, and document the decision in the contract.
- [ ] `GET`/write authorization parity: read = API-key auth, write = admin session + CSRF (already
      layered; re-verify after the `settings` map lands).

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

- [ ] `.github/workflows/ci.yml`: add stable Rust setup, `cargo fmt --check`,
      `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --locked`,
      OpenAPI export drift check, and a PostgreSQL service job; keep the existing Node/pnpm jobs for
      web, CLI, and packages. (Today the workflow only runs `pnpm build` + `pnpm test`.)
- [ ] `Dockerfile`: add a Rust builder stage and a Rust runtime target (binary, web dist, CA
      certificates, tzdata, non-Node health check), keeping the Node target selectable for rollback.
      Root `Dockerfile:21` still copies `apps/api/package.json` and `pnpm build` builds the Node API.
- [ ] `docker-compose.yml` healthcheck uses `node -e` — replace for the Rust target.
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
