# SRouter Rust API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Rust/Axum API in the repository-root `server/` directory, verify it against the existing Node API, then cut over without using code or data from `packages/*`.

**Architecture:** Keep `apps/api` unchanged as the Node/Hono oracle and rollback runtime while Rust is built in `server/`. Organize Rust by API feature, with shared HTTP behavior under `http/` and technical adapters under `infrastructure/`. Preserve the current API contract except for Cloudflare Tunnel, which is intentionally excluded from Rust and will disappear at cutover.

**Tech Stack:** Rust stable, Axum, Tokio, Reqwest, Serde, SQLx (SQLite and PostgreSQL), Tower/Tower HTTP, Tracing, Utoipa, rustls, `openapi-typescript`, pnpm, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-srouter-api-rust-migration-design.md`

## Global Constraints

- Rust lives in the standalone root directory `server/`; do not place its Cargo project in `apps/api/`.
- Keep `apps/api/` unchanged until the Rust candidate passes parity and cutover verification.
- Do not add `server/` to `pnpm-workspace.yaml`; Cargo owns the Rust project and lockfile.
- Rust source, build, runtime, migrations, OpenAPI, and generated TypeScript must not read, copy, import, or depend on code or data from `packages/*`.
- `packages/*` remain in the repository because other applications still consume them.
- Preserve all current API behavior except the explicitly retired Cloudflare Tunnel endpoints and tasks.
- Use temporary databases and fake upstreams for tests. Never access `~/.srouter/srouter.db` or a production `DATABASE_URL`.
- Use the existing Node API only as a black-box oracle and temporary fallback; do not use its internals or outputs as Rust source, seed data, or generated input.
- The production Rust image must not include or run Node. Node may remain in the Docker build stage for the existing Vite web assets.
- Generate OpenAPI from Rust and TypeScript API types directly into `apps/web/src/generated/api.ts`; frontend code imports that local file directly.

---

## Current API Map to Rust Features

This map follows the current `apps/api` source layout. It is for traceability only; do not copy implementation or data from `packages/*`.

| Current API source                                                                                                                                                                           | Rust destination                                                                                                            | Existing behavior tests                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                                                                                                                                                               | `server/src/main.rs`, `app.rs`, `http/listeners.rs`                                                                         | `startup.test.ts`, `web-dist.test.ts`                                                                                           |
| `routes/v1/admin.ts`, `controllers/admin.controller.ts`, `services/adminAuth.ts`                                                                                                             | `features/admin_auth/`                                                                                                      | `admin-auth-route.test.ts`, `admin-auth-service.test.ts`, `admin-auth-store.test.ts`                                            |
| `routes/v1/keys.ts`, `controllers/keys.controller.ts`, `middleware/ApiKeyAuth.ts`, `middleware/ModelAccess.ts`                                                                               | `features/api_keys/` plus `http/middleware/`                                                                                | `api-keys*.test.ts`, `admin-auth-middleware.test.ts`, `api-keys-allowed-models.test.ts`                                         |
| `routes/v1/auth.ts`, `controllers/auth.controller.ts`, `logic/auth.logic.ts`, `services/authHandlers.ts`, `services/tokenRefresh.ts`                                                         | `features/provider_auth/`                                                                                                   | `auth-providers.test.ts`, `token-refresh.test.ts`, provider auth tests                                                          |
| `routes/v1/providers.ts`, `controllers/providers.controller.ts`, `controllers/favorites.controller.ts`, `logic/providers.logic.ts`, `services/registry.ts`                                   | `features/providers/`                                                                                                       | `custom-provider-uuid.test.ts`, `round-robin-endpoint.test.ts`, `verify-connection.test.ts`                                     |
| `routes/v1/chat.ts`, `messages.ts`, `images.ts`; matching controllers and `logic/chat.logic.ts`, `images.logic.ts`, `fallbackRunner.ts`, `fallback.policy.ts`; `services/toolInterceptor.ts` | `features/gateway/`                                                                                                         | `messages.test.ts`, `opencode-compat.test.ts`, `images-*.test.ts`, fallback and tool-interceptor tests                          |
| `routes/v1/models.ts`, `pricing.ts`, `quota.ts`; matching controllers and `logic/models.logic.ts`, `pricing.logic.ts`, `quota.logic.ts`                                                      | `features/catalog/`                                                                                                         | `models-endpoint.test.ts`, `pricing-route.test.ts`, `quota-oauth-filter.test.ts`                                                |
| `routes/v1/logs.ts`, `settings.ts`; matching controllers and `logic/logs.logic.ts`                                                                                                           | `features/dashboard/`                                                                                                       | `analytics.test.ts`, `logs-pagination.test.ts`, `settings-auth.test.ts`                                                         |
| `routes/v1/database.ts`, `controllers/database.controller.ts`                                                                                                                                | `features/database_transfer/`                                                                                               | `database-route.test.ts`                                                                                                        |
| `middleware/*.ts`                                                                                                                                                                            | Shared request behavior in `http/middleware/`; feature authorization remains in its owning feature                          | `cors-allowlist.test.ts`, `csrf-origin-guard.test.ts`, `rate-limit.test.ts`, `request-limits.test.ts`, `malformed-json.test.ts` |
| `utils/response.ts`, `utils/ssrf.ts`, `utils/callbackUrl.ts`; `services/webDist.ts`, `services/startup.ts`, `services/usageEvents.ts`                                                        | `error.rs`, `infrastructure/upstream/`, `features/provider_auth/`, `http/static_files.rs`, `app.rs`, and the owning feature | Relevant HTTP, OAuth, startup, streaming, and web-dist tests                                                                    |
| `routes/v1/tunnel.ts`, `controllers/tunnel.controller.ts`, `services/cloudflareTunnel.ts`                                                                                                    | **No Rust destination.** Explicitly excluded from parity and retired at cutover.                                            | `tunnel-auth.test.ts` remains a legacy-only baseline until `apps/api` is retired.                                               |

Most provider executors, shared database code, pricing data, translator code, and shared schemas currently enter the API through workspace package imports. Rebuild the required behavior independently from allowed API-level evidence, protocol documentation, and synthetic fixtures. Do not inspect package source or copy package data.

## Target Rust Layout

```text
server/
  Cargo.toml
  Cargo.lock
  rust-toolchain.toml
  migrations/
  src/
    main.rs                  # process entry and graceful shutdown
    lib.rs                   # testable application crate exports
    app.rs                   # compose routers and shared state
    config.rs                # validated environment configuration
    error.rs                 # shared API error and response mapping
    state.rs                 # shared runtime dependencies
    openapi.rs               # Rust-owned OpenAPI document
    http/
      listeners.rs           # main and OAuth listener wiring
      middleware/             # cross-feature HTTP middleware
      static_files.rs         # web dist and SPA fallback
    features/
      admin_auth/             # admin setup, login, sessions, password changes
      api_keys/               # key management and key authorization
      provider_auth/          # provider OAuth, PKCE, token import/refresh
      providers/              # provider management, registry, favorites, adapters
      gateway/                # chat, messages, images, fallback, translation, SSE
      catalog/                # models, pricing, quota
      dashboard/              # logs, analytics, settings
      database_transfer/      # export, import, validation, recovery
    infrastructure/
      database/               # SQLx pools, backend setup, repository adapters
      upstream/               # HTTP client, timeout policy, SSRF protection
      telemetry.rs            # tracing/logging setup
    bin/export_openapi.rs     # deterministic OpenAPI export command
  tests/
    support/                  # isolated database and fake upstream helpers
```

Feature folders may contain `routes.rs`, `service.rs`, `model.rs`, or `repository.rs` when the feature needs them. Do not create empty files or a global layer of `routes/`, `controllers/`, `logic/`, and `services/`. Keep route handling and feature behavior close together; put only genuinely shared adapters in `infrastructure/` or `http/`.

## Implementation Tasks

## Milestone 1: Freeze the migration boundary

### Task 1: Record route contract, source mapping, and parity cases

**Files:**

- Create: `docs/api-v1-contract.md`
- Read only: `apps/api/src/index.ts`, `apps/api/src/routes/v1/*.ts`, `apps/api/src/controllers/*.ts`, `apps/api/src/logic/*.ts`, `apps/api/src/services/*.ts`, `apps/api/src/middleware/*.ts`, `apps/api/src/utils/*.ts`, and `apps/api/tests/*.test.ts`

**Steps:**

- [x] Inventory each route's method, path, authentication, input/output, status/error shape, middleware, and persistence effects from allowed API source and tests.
- [x] Record listener behavior, `/v1/v1/*` aliases, OAuth callback routes, static web serving, environment variables, headers, errors, SSE behavior, and startup ordering.
- [x] Mark `/v1/tunnel/*` and its event routes as intentionally excluded. Record that Rust returning not-found for these paths is an approved contract change, not a parity failure.
- [x] Map every retained route group to the destination feature and current regression-test filenames using the table above. Do not make `tunnel-auth.test.ts` a Rust parity requirement.
- [x] Run representative legacy baseline tests one file at a time from `apps/api/`:

```bash
pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/opencode-compat.test.ts
pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/messages.test.ts
pnpm exec tsx --test --test-concurrency=1 --import ./tests/database-route.test.ts
pnpm exec tsx --test --test-concurrency=1 --import ./tests/startup.test.ts
pnpm exec tsx --test --test-concurrency=1 --import ./tests/web-dist.test.ts
```

- [x] Record pre-existing failures and format/commit the contract:

```bash
pnpm exec prettier --check docs/api-v1-contract.md
git diff --check
git add docs/api-v1-contract.md
git commit -m "docs: freeze API contract for Rust migration"
```

### Task 2: Gate database work on an allowed compatibility contract

**Files:**

- Create: `docs/api-database-contract.md`
- Read only: `apps/api/src/controllers/database.controller.ts`, `apps/api/src/routes/v1/database.ts`, `apps/api/tests/database-route.test.ts`, and the database-visible behavior in Task 1's contract

**Steps:**

- [x] Document persistent operations and outcomes observable through allowed API routes, SQLite path behavior, `DATABASE_PATH`, PostgreSQL `DATABASE_URL`, transaction expectations, and database transfer behavior.
- [x] Use only a disposable test database and synthetic records created through public API operations. Do not open a real user database or inspect package source/schema.
- [ ] For every field/relation required by Rust, cite an allowed independent source. If the existing database schema cannot be established this way, stop persistence implementation and ask for an independent schema contract. Do not guess or use `packages/*`.
- [x] Review and commit the observable database contract as a gate before writing SQLx migrations. The schema evidence requirement above remains blocked.

```bash
pnpm exec prettier --check docs/api-database-contract.md
git diff --check
git add docs/api-database-contract.md
git commit -m "docs: define API database compatibility contract"
```

## Milestone 2: Establish the standalone Rust server

### Task 3: Create the root Cargo project and configuration core

**Files:**

- Create: `server/Cargo.toml`, `server/Cargo.lock`, `server/rust-toolchain.toml`, `server/.gitignore`
- Create: `server/src/lib.rs`, `server/src/main.rs`, `server/src/config.rs`, `server/src/error.rs`, `server/src/state.rs`
- Create: `server/tests/configuration.rs`
- Do not modify: `apps/api/`, `pnpm-workspace.yaml`

**Interfaces:**

- `APIConfig::from_env_map(...) -> Result<APIConfig, ConfigError>` parses configuration deterministically.
- `APIError` maps typed application failures into the frozen API error envelope.
- `AppState` owns shared dependencies and is constructed by the composition root, not by individual handlers.

**Steps:**

- [x] Write config tests for defaults (`PORT=3000`, OAuth port `1455`, OAuth host `0.0.0.0`, default SQLite path) and valid/invalid overrides for supported environment variables.
- [ ] Run the focused test and confirm it fails because the Rust crate/config types do not exist. This pre-crate RED was not reproducible after the session restart; later focused regression cases recorded RED/GREEN in `task-3-report.md`:

```bash
cargo test --manifest-path server/Cargo.toml --test configuration
```

- [x] Add the standalone Cargo package, lockfile, stable toolchain, and `target/` ignore rule. Keep all Cargo dependencies registry/git based; do not use paths into the monorepo.
- [x] Implement configuration, typed errors, and the testable library root. Read only environment values passed to the parser in unit tests.
- [x] Verify the package is independent of pnpm and package directories:

```bash
cargo test --manifest-path server/Cargo.toml --test configuration
cargo metadata --manifest-path server/Cargo.toml --format-version 1 --no-deps
cargo tree --manifest-path server/Cargo.toml --locked
cargo fmt --manifest-path server/Cargo.toml -- --check
```

- [x] Commit only the Rust project foundation:

```bash
git add server/Cargo.toml server/Cargo.lock server/rust-toolchain.toml server/.gitignore server/src/lib.rs server/src/main.rs server/src/config.rs server/src/error.rs server/src/state.rs server/tests/configuration.rs
git commit -m "feat: scaffold standalone Rust API server"
```

### Task 4: Build the HTTP composition root and listeners

**Files:**

- Create: `server/src/app.rs`, `server/src/http/listeners.rs`, `server/src/http/middleware/`
- Create: `server/src/http/static_files.rs`, `server/tests/http_runtime.rs`
- Modify: `server/src/main.rs`, `server/src/state.rs`, `server/src/lib.rs`
- Do not modify: `apps/api/src/index.ts`

**Steps:**

- [ ] Test `/health`, `/v1`, API-only `/`, common error responses, security/version headers, CORS, CSRF for cookie-authenticated mutations, body limits, and malformed JSON against the frozen contract.
- [ ] Test the main listener and the conditional OAuth listener without binding fixed test ports. Verify `SROUTER_PUBLIC_URL` suppresses the secondary listener.
- [ ] Test `/v1/v1/{chat/completions,messages,models}` mounting and web static/SPA fallback when `WEB_DIST_PATH` contains `index.html`.
- [ ] Implement router composition in `app.rs`; keep feature routes in their feature modules. Put only cross-feature HTTP middleware and static serving in `http/`.
- [ ] Run Rust HTTP tests and existing legacy tests `web-dist.test.ts`, `cors-allowlist.test.ts`, `csrf-origin-guard.test.ts`, `request-limits.test.ts`, and `malformed-json.test.ts` separately from `apps/api/`.
- [ ] Run `cargo test --manifest-path server/Cargo.toml --test http_runtime`, `cargo fmt --manifest-path server/Cargo.toml -- --check`, and `git diff --check`, then commit the runtime shell.

Shadow runs use alternate ports such as `PORT=3001` and `OAUTH_PORT=1456`; production defaults remain `3000` and `1455`.

### Task 5: Implement Rust persistence after the schema gate

**Files:**

- Create: `server/src/infrastructure/database/{mod.rs,sqlite.rs,postgres.rs}`
- Create: `server/migrations/0001_initial.sql`, using only `docs/api-database-contract.md`
- Create: `server/tests/support/mod.rs`, `server/tests/database.rs`
- Modify: `server/src/state.rs`, `server/src/config.rs`

**Interfaces:**

- `AppDatabase::connect(&APIConfig) -> Result<AppDatabase, APIError>` selects SQLite or PostgreSQL.
- Repository adapters expose typed domain operations; feature handlers do not embed SQL queries.
- `TestDatabase::sqlite()` creates a unique temporary database and removes it after the test.

**Steps:**

- [ ] Write lifecycle tests for opening an isolated SQLite database, running the approved migration, committing a transaction, and reopening persisted synthetic data.
- [ ] Assert the test helper never resolves to `~/.srouter/srouter.db` and ignores production `DATABASE_URL` values.
- [ ] Implement SQLx pools and migrations from the reviewed database contract. Validate existing storage before applying migrations; never drop/recreate user data.
- [ ] Add optional PostgreSQL integration coverage using an isolated CI-only database/schema. Skip when no test service is configured.
- [ ] Run `cargo test --manifest-path server/Cargo.toml --test database`, format, review the migration diff, then commit.

## Milestone 3: Move API features by ownership

### Task 6: Port admin login and API key management

**Files:**

- Create: `server/src/features/admin_auth/`, `server/src/features/api_keys/`
- Create: `server/tests/admin_auth.rs`, `server/tests/api_keys.rs`
- Use shared DB and HTTP middleware from Tasks 4–5

**Steps:**

- [ ] Write tests for admin setup/login/logout/change-password, cookie flags, session expiry/revocation, password bootstrap, and unauthorized access.
- [ ] Write API-key tests for create/list/update/delete/credit, invalid-key rejection, model restrictions, usage/quota checks, and separation between admin and API-key privileges.
- [ ] Implement route, handler, and feature service code inside each feature directory. Keep cookie/session mechanics in `admin_auth`; keep key validation and key operations in `api_keys`.
- [ ] Add regression coverage for CSRF, rate limit, and model access based on current `apps/api/tests/` behavior.
- [ ] Run the focused Rust tests and corresponding existing API auth/key tests one file at a time; commit the feature slice.

### Task 7: Port provider management and registry behavior

**Files:**

- Create: `server/src/features/providers/`
- Create: `server/src/features/providers/adapters/` for provider-specific integration modules as they are implemented
- Create: `server/tests/providers.rs`

**Steps:**

- [ ] Write synthetic-provider tests for list/catalog/detail, add/update/delete, ID stability, favorites, verify authorization, enabled state, and round-robin selection.
- [ ] Record an allowed, independent provenance for every built-in provider/catalog value Rust needs. Do not use package-owned constants or registry data.
- [ ] Implement provider domain models, management routes, registry lifecycle, and repository use inside `features/providers/`.
- [ ] Compare behavior with the Node API using black-box requests and fake upstreams; do not inspect package implementation.
- [ ] Run Rust provider tests and existing `custom-provider-uuid.test.ts`, `round-robin-endpoint.test.ts`, and `verify-connection.test.ts` individually; commit.

### Task 8: Port provider OAuth and token refresh

**Files:**

- Create: `server/src/features/provider_auth/`
- Create: `server/tests/provider_auth.rs`
- Modify: `server/src/http/listeners.rs` only for callback mounting

**Steps:**

- [ ] Write fake-upstream tests for OAuth state creation, PKCE, callback URI selection, expired/replayed state, device polling, token import, and refresh success/failure.
- [ ] Implement provider OAuth adapters, callback handling, and token-refresh scheduling inside `features/provider_auth/`. Keep provider login separate from admin login.
- [ ] Start refresh work only after required database/provider state is ready; store task handles and stop them on graceful shutdown.
- [ ] Test local OAuth listener behavior and public URL mode using alternate shadow ports; do not use real provider credentials.
- [ ] Run Rust tests and existing `auth-providers.test.ts`, `token-refresh.test.ts`, `antigravity-provider.test.ts`, `codebuddy-provider.test.ts`, and `qoder-provider.test.ts` one file at a time; commit.

### Task 9: Implement provider adapters and protocol translation

**Files:**

- Create: `server/src/features/providers/adapters/`
- Create: `server/src/features/gateway/translation.rs`
- Create: `server/tests/provider_adapters.rs`
- Create: `server/src/infrastructure/upstream/{mod.rs,client.rs,ssrf.rs}`

**Interfaces:**

- Provider adapters accept a typed inference request and return either a typed response or a streamed body.
- `infrastructure/upstream` owns generic HTTP transport, timeouts, and SSRF checks; provider-specific request mapping remains with its adapter.
- `features/gateway/translation.rs` owns OpenAI/Anthropic contract translation.

**Steps:**

- [ ] Add local fake-upstream tests for URL, method, headers, auth, request body, timeout, error decoding, and response mapping for each retained protocol/provider family.
- [ ] Add pure translation tests for OpenAI and Anthropic request/response bodies, tool calls, usage extraction, and malformed payloads.
- [ ] Implement only behavior evidenced by allowed API contracts or independent protocol documentation. The Node service may provide black-box parity responses; package source and data remain prohibited.
- [ ] Test blocked loopback/private upstream targets and client cancellation.
- [ ] Run `cargo test --manifest-path server/Cargo.toml --test provider_adapters`, format, and commit.

### Task 10: Port gateway requests and streaming

**Files:**

- Create: `server/src/features/gateway/{mod.rs,routes.rs,chat.rs,messages.rs,images.rs,fallback.rs,sse.rs,tool_interceptor.rs}` as needed
- Create: `server/tests/gateway.rs`
- Modify: `server/src/app.rs` to mount the gateway router

**Steps:**

- [ ] Write request tests for `/v1/chat/completions`, `/v1/messages`, image generation, API-key auth, request validation, model selection, fallback order, and compatibility aliases.
- [ ] Write stream tests for event order/framing, headers, terminal events, upstream errors, and incremental delivery before the upstream finishes.
- [ ] Verify client disconnect cancels the upstream request and that the server does not buffer the complete stream.
- [ ] Implement gateway handlers using the provider registry/adapters, API-key checks, fallback policy, usage accounting, and protocol translation.
- [ ] Run Rust gateway tests and existing `messages.test.ts`, `opencode-compat.test.ts`, `malformed-json.test.ts`, `fallback-policy.test.ts`, `fallbacks-cascade.test.ts`, `tool-interceptor.test.ts`, `images-route.test.ts`, and `images-fallback.test.ts` individually; commit.

### Task 11: Port catalog and dashboard API features

**Files:**

- Create: `server/src/features/catalog/`
- Create: `server/src/features/dashboard/`
- Create: `server/tests/catalog.rs`, `server/tests/dashboard.rs`

**Steps:**

- [ ] In `catalog`, test models list/detail, hidden/custom model filtering, pricing, quota and the legacy `/v1/qouta` alias, plus any retained image capability metadata.
- [ ] In `dashboard`, test logs pagination/detail/stats/events, analytics windows, and settings read/update authorization.
- [ ] Assign favorites to `features/providers/` because their routes are mounted under `/providers`; assign fallback settings to `features/gateway/` because gateway execution consumes them.
- [ ] Establish independent provenance for pricing and static catalog data before implementation. Stop and ask for an allowed source if parity requires unavailable package data.
- [ ] Implement feature-local routes and services; keep shared SQL in repository adapters.
- [ ] Run the corresponding existing `models-endpoint.test.ts`, `pricing-route.test.ts`, `quota-oauth-filter.test.ts`, `analytics.test.ts`, `logs-pagination.test.ts`, `settings-auth.test.ts`, and fallback tests individually; commit.

### Task 12: Port database export and import

**Files:**

- Create: `server/src/features/database_transfer/`
- Create: `server/tests/database_transfer.rs`
- Use: `server/src/infrastructure/database/` and `features/admin_auth/`

**Steps:**

- [ ] Write tests for admin-session-only access, export headers, multipart field `database`, single-file restriction, 25 MiB limit, invalid/incompatible input, busy/recovery errors, reauthentication cookie behavior, and cleanup.
- [ ] Assert temporary directory/file permissions are `0700`/`0600`; verify paths are removed on success and failure.
- [ ] Stream uploads to private temporary storage, validate before replacement, create a recoverable backup, replace atomically where supported, and restore on failure.
- [ ] Run `database-route.test.ts` as a black-box legacy check and `cargo test --manifest-path server/Cargo.toml --test database_transfer`; commit.

## Milestone 4: Publish the Rust contract and candidate runtime

### Task 13: Generate OpenAPI from Rust and TypeScript types in Vite

**Files:**

- Create: `server/src/openapi.rs`, `server/src/bin/export_openapi.rs`, `server/openapi.json`
- Generate: `apps/web/src/generated/api.ts`
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`, and API type consumers in `apps/web/src/`

**Steps:**

- [ ] Annotate Rust handlers and public request/response models with Utoipa. Exclude tunnel endpoints from OpenAPI.
- [ ] Add a deterministic exporter that writes `server/openapi.json` from Rust types only.
- [ ] Add a Rust test for retained route coverage, auth schemes, schemas, compatibility aliases, and exclusion of tunnel routes.
- [ ] Add `openapi-typescript` to the web app and scripts that generate/check `apps/web/src/generated/api.ts` from `../../server/openapi.json` when run in `apps/web/`.
- [ ] Replace only API contract types in the web with direct imports from its generated module. Do not add a workspace alias or import across app boundaries.
- [ ] Verify two consecutive generations leave both generated files unchanged and `pnpm --filter web run lint` passes; commit.

### Task 14: Add Rust CI and a candidate Docker runtime

**Files:**

- Modify: `.github/workflows/ci.yml`, `.github/workflows/docker-publish.yml`
- Modify: `Dockerfile`, `docker-compose.yml`
- Do not cut over the default production command yet.

**Steps:**

- [ ] Add stable Rust setup and run `cargo fmt`, Clippy with warnings denied, locked tests, OpenAPI export drift, and generated web type checks in CI.
- [ ] Keep current Node/pnpm workspace checks for the web, CLI, and packages. Do not add the root `server/` to `pnpm-workspace.yaml`.
- [ ] Add PostgreSQL integration service with an isolated CI database URL.
- [ ] Add a Rust builder stage for `server/Cargo.toml`. Keep the Node builder only for existing Vite assets.
- [ ] Add a candidate Rust runtime image/target that contains the Rust binary, web dist, CA certificates, timezone data, and a non-Node health check. Keep the currently deployed Node target selectable for rollback.
- [ ] Smoke-test the Rust candidate with a disposable volume and verify health/static serving. Inspect the final Rust runtime to confirm it contains no Node executable.
- [ ] Commit CI and candidate-image changes without switching production deployment.

## Milestone 5: Cut over and retire the old API

### Task 15: Verify parity, staging rollout, and production cutover

**Files:**

- Create: `docs/api-migration.md`
- Update: `docs/api-v1-contract.md`, `docs/api-database-contract.md`, deployment files as needed

**Steps:**

- [ ] Run the retained-route parity matrix against Node and Rust with separate temporary databases and fake upstreams. Compare status, required headers, JSON/error bodies, state changes, and SSE event sequence; normalize only documented nondeterministic fields.
- [ ] Verify tunnel endpoints are the only intentional route exclusion and record the user-approved behavior change in migration docs.
- [ ] Run Rust tests, PostgreSQL tests, OpenAPI drift, web type checks, and remaining workspace checks through CI.
- [ ] Benchmark Node and Rust under identical resource limits, database fixtures, upstream fixtures, and request mixes. Record startup, memory, CPU/throughput, and production image size without claiming an unmeasured improvement.
- [ ] Back up staging data, deploy the Rust candidate on production ports, and verify health, both listener modes, OAuth callbacks, static assets, SQLite/PostgreSQL, auth, gateway streaming, dashboard routes, and database transfer.
- [ ] Exercise rollback to the existing Node image and verify the backup can be restored. Keep Node as the active production runtime until the staging gate passes.
- [ ] After approval of the rollout gate, switch Docker/Heroku production configuration to the Rust target and monitor critical route probes and data integrity for at least 24 hours.

### Task 16: Retire the Node API after the rollback window

**Files:**

- Delete after production verification: `apps/api/src/**/*.ts`, `apps/api/tests/**/*.ts`, `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsup.config.ts`, `apps/api/heroku.yml`, and root `Procfile`
- Create or retain: root `heroku.yml` for the Docker-based Rust deployment
- Modify: root `package.json`, `pnpm-lock.yaml`, Docker and workflow references
- Keep: all `packages/*`, `apps/web`, `apps/cli`, and `apps/docs`

**Steps:**

- [ ] Confirm the rollback window has passed with no critical parity or data-integrity regression; retain the old image for rollback according to the deployment policy.
- [ ] Remove the Node API workspace package and API-only scripts/deployment references. Regenerate `pnpm-lock.yaml` from remaining manifests with the repository's pinned pnpm version.
- [ ] Keep the web, CLI, docs app, and package directories. Do not remove package source or package data as part of this task.
- [ ] Run final boundary and quality checks:

```bash
rg -n 'packages/|@srouter/' server/Cargo.toml server/src server/migrations --glob '*.rs' --glob '*.sql' --glob 'Cargo.toml'
cargo tree --manifest-path server/Cargo.toml --locked
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path server/Cargo.toml --locked
cargo run --manifest-path server/Cargo.toml --bin export_openapi
git diff --exit-code -- server/openapi.json
pnpm --filter web run api:check
pnpm --filter web run lint
git diff --check
```

- [ ] Verify the Rust boundary scan has no matches, the Cargo tree is standalone, generated contracts are current, and the production image runs without Node.
- [ ] Commit the Rust cutover and Node API retirement.

## Plan Self-Review

- Current `apps/api` folders map explicitly to feature destinations and existing tests.
- Rust is a root-level Cargo project; it does not replace or modify `apps/api` during the parity phase.
- Feature code stays co-located. Shared HTTP and infrastructure concerns have separate homes; no global `routes/controllers/logic/services` duplication is planned.
- Tunnel is explicitly excluded from Rust parity and called out as an intentional post-cutover behavior change.
- SQLite/PostgreSQL compatibility remains gated on a schema contract from allowed sources; no schema is guessed or copied from `packages/*`.
- OpenAPI is Rust-owned; generated TypeScript is written directly into the Vite frontend.
- The plan separates candidate-image verification, production cutover, and Node API retirement.
