# Repository Guidelines

## Project Overview

SRouter — a self-hosted, multi-provider **LLM gateway** ("Multi-Provider OpenAI & Anthropic Compatible LLM Gateway", `server/src/app.rs:54`). It exposes OpenAI-style (`/v1/chat/completions`, `/v1/chat`), Anthropic-style (`/v1/messages`), and image (`/v1/images/generations`) endpoints, authenticates callers, routes each model id onto a per-vendor provider driver, streams SSE back, logs every request to SQLite, and serves an operator API plus an optional SPA dashboard.

Two independently-toolchained halves in one repo, sharing only generated TypeScript bindings:

| Half      | Stack                                                                                               | Notes                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `server/` | Rust edition 2024, axum 0.8, tokio, sqlx 0.9 (SQLite only), specta                                  | The real product; behaviorally ported from a deleted Node `apps/api`                      |
| `client/` | Bun + Vite + React 19, TanStack Router/Query, Tailwind v4, shadcn (`base-mira` on `@base-ui/react`) | Early-stage SPA: auth spine (login/first-run setup) is done; dashboard surfaces are stubs |

There is **no workspace root manifest, no CI (`.github/` does not exist), no Dockerfile, no Makefile**. `cargo` is the whole server build system.

## Architecture & Data Flow

**Boot** (`server/src/main.rs`): `dotenvy::dotenv()` → `telemetry::init()` → `APIConfig::from_env_map` → `AppDatabase::connect` (runs migrations to `SCHEMA_VERSION = 4`) → `bootstrap_admin_account_from_env` → `ProviderRegistry::with_database` + `register_custom_providers` → `AppState::with_security(...).with_database(...)` → spawns catalog warm-up and a 60 s OAuth token sweeper → `listeners::serve_main(create_router(state), 0.0.0.0:PORT)`.

**Request**: axum router (`server/src/app.rs` `create_router`) → per-mount guards → feature handler → model resolution → provider driver → `UpstreamClient` (reqwest) → SSE/JSON back out; `interception/logging.rs` writes the request log and settles quota best-effort.

**Composition root / DI**: manual, no container. `AppState` + `SecurityState` (`server/src/state.rs`) hold `Arc<dyn Trait>` stores; middleware attaches `Extension<APIPrincipal>`; handlers extract `State`, `Extension`, `Path`/`Query`, `Request`. `Empty*` store impls + `SecurityState::unconfigured()` keep a DB-less boot coherent.

**Gateway pipeline** (`server/src/features/gateway/`): `routes.rs` → `chat.rs` / `messages.rs` / `images.rs` → body parse (`protocol/model.rs`) → `ensure_model_allowed_any` (`api_keys/access.rs`) → `token_saver` → `reserve_api_key_quota` → `ProviderRegistry::resolve(model)` → `ProviderAdapter`/`ProviderExecutor` → upstream call. Streaming uses `mpsc` + `ReceiverStream`; provider failures become **in-stream SSE error events** (`adapter.rs`), never stream errors. `interceptor.rs` intercepts built-in search tool calls the client did not declare.

**Router layering rules** (critical, in `app.rs`): guards are applied **per mount** — read surfaces get `api_key_auth`, operator surfaces get `require_admin_session` + CSRF, OAuth callbacks are public, admin-auth routes enforce session per handler. `/v1` and `/v1/v1` nests each own a JSON `404` fallback so they never fall through to the SPA. Global layers, last-added = outermost: `log_access` → `log_failed_requests` → `security_headers` → `cors`. Root route + SPA fallback must be registered **before** the layers (`Router::layer` only wraps existing routes).

**Bindings flow**: Rust wire types derive `Serialize + specta::Type` → `server/src/bindings.rs` registry → `cargo run --bin export_ts` → writes **both** `server/bindings.ts` and `client/src/generated/typed.ts`. The client imports them through `client/src/api/types.ts`.

## Non-Negotiable Rules

Read this before touching a file. Nothing here is enforced by tooling; it is enforced by review. Standard is a senior engineer who owns the code for the next six months, not one who ships the fastest diff.

**Scope**

1. **Do the requested change, completely, and nothing else.** No unrequested features, refactors, dependencies, or "while I'm here" tidy-ups. Reduce scope only with explicit approval; never silently.
2. **A diff is the unit of work.** It compiles, runs, and is verifiable on its own. Rename a symbol → every callsite lands in the same change, and the obsolete version leaves with it. No shims, re-exports, or deprecation aliases.
3. **Leave no scaffolding.** No `TODO`/`FIXME` marker, stub, mock, placeholder, or unreachable branch in shipped code. `server/src` and `client/src` contain zero today — keep it that way. (Four comments in `features/provider_auth/` cite a `TODO.md` deleted in `233b7a6`; that is a stale pointer, not a marker — the same class as the dead `docs/*.md` citations, and not a pattern to copy.)

**Design**

4. **No over-engineering.** The entire server defines **5 traits** (`APIKeyStore`, `APIKeyRepository`, `AdminSessionStore`, `AdminAuthRepository`, `ProviderExecutor`) and no DI container; the client has **14 runtime dependencies**. Do not add an abstraction, generic parameter, trait, registry, plugin point, feature flag, or dependency until a second concrete caller exists. Three repeated lines beat a premature helper.
5. **Reuse the vocabulary that exists.** `client/src/components/ui/` (shadcn/Base UI), the gauge kit for dials, `APIError` + `constants.rs` on the server, `TestDatabase` in tests, `create_*_router` for mounts. A second convention for a job that already has one is the defect — even when the new one is nicer.
6. **Match the file you are in.** Same naming, module layout, error style, and comment style as its neighbours. Read the surrounding 50 lines before adding to anything.
7. **Comments explain why, never what.** Record the trap that motivated the line (see `client/vite.config.ts` on `changeOrigin`, `state.rs` on `unconfigured`). No narration, no section banners, no restating the next line.

**Correctness**

8. **No `unwrap()` on a production path.** The codebase has exactly one (`providers/registry.rs:282`) and clippy will not flag yours. Propagate with `?` into `APIError`; use `expect("...")` only where failure is provably impossible (static parse, literal) and always with a message. Lock poisoning is recovered, not unwrapped: `.unwrap_or_else(|e| e.into_inner())`.
9. **One error type.** `APIError` with builders, propagated by `?`. No `anyhow`, `thiserror`, `Box<dyn Error>` outside `main`, and no per-module error enums.
10. **Every client-visible string, code, and header name comes from `server/src/constants.rs`.** Never inline a message in a handler; interpolated messages become functions.
11. **Frozen behaviour stays frozen.** Node-parity semantics, generated files, `[profile.dev] debug = 1`, per-mount guard placement, global layer order, and the frozen test contracts are all deliberate. If a change seems to require altering one, stop and report it rather than "fixing" it.

**Evidence**

12. **Verify by running, not by reasoning.** Every behavioural change gets exercised on the real path — the handler, the CLI, or the browser. Tests alone are not proof. A green `cargo check` or `tsc` proves only that it compiles.
13. **State exactly what you ran.** Never claim coverage you did not exercise, never describe an untested path as working, and never report success from a command you skipped. Unverified is a valid answer; "probably fine" is not.
14. **Report a blocker; do not route around it.** If the requested change cannot be made safely, say which invariant it breaks and what you tried — do not silently weaken a guard, widen a scope, or delete a test to make the change fit.

For server work, [`skills/srouter-server/SKILL.md`](skills/srouter-server/SKILL.md) is the detailed companion to the rules above; for client work, the companion is [`skills/srouter-frontend/SKILL.md`](skills/srouter-frontend/SKILL.md).

## Key Directories

| Path                         | Contents                                                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/app.rs`          | The only router assembly; `ApiInfo`, `/health`, `route_not_found`                                                                                                                                                                                                                                   |
| `server/src/state.rs`        | `AppState`, `SecurityState`, builders                                                                                                                                                                                                                                                               |
| `server/src/error.rs`        | `APIError` + `IntoResponse` → OpenAI `ErrorEnvelope`                                                                                                                                                                                                                                                |
| `server/src/constants.rs`    | Every client-visible message, `code`, `error_type`, header name                                                                                                                                                                                                                                     |
| `server/src/features/`       | One dir per feature: `gateway/` (chat, messages, images, translation, interception, search), `providers/` (registry, executors, per-vendor drivers, `custom/`, `management/`, `rotation`), `catalog/`, `api_keys/`, `admin_auth/`, `provider_auth/`, `logs.rs`, `settings.rs`, `database_transfer/` |
| `server/src/http/`           | `middleware/` (api_key_auth, admin_session, rate_limit, csrf, cors, body_limit, access_log, failure_log, security_headers), `listeners.rs`, `static_files.rs`                                                                                                                                       |
| `server/src/infrastructure/` | `database/` (sqlite handle, migrations, stores), `upstream/` (client + SSRF guards), `telemetry.rs`                                                                                                                                                                                                 |
| `server/src/protocol/`       | Leaf wire types: `model`, `usage`, `sse`, `image`                                                                                                                                                                                                                                                   |
| `server/migrations/`         | `NNNN snake_case.sql`, DDL only, embedded via `include_str!`; no sqlx-cli                                                                                                                                                                                                                           |
| `server/tests/`              | 42 integration suites + the 3.1k-line `support/` harness                                                                                                                                                                                                                                            |
| `client/src/routes/`         | TanStack file routes; protected screens belong under `_authenticated/`                                                                                                                                                                                                                              |
| `client/src/api/`            | The only network layer (`client.ts` wrapper + `queryOptions` factories)                                                                                                                                                                                                                             |
| `server/src/benchmark/`      | k6 scenarios — external k6 binary, not part of `cargo test`                                                                                                                                                                                                                                         |

## Development Commands

Run from the repo root. Server (verbatim from `CONTRIBUTING.md:12-37`):

```bash
cargo run --manifest-path server/Cargo.toml                     # listens on :3000
cargo test --manifest-path server/Cargo.toml --test chat_completions   # one suite
cargo test --manifest-path server/Cargo.toml --locked           # everything
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo run --manifest-path server/Cargo.toml --bin export_ts     # regenerate bindings (commit both files)
cargo test --manifest-path server/Cargo.toml --test opencode_live -- --ignored --nocapture  # network test
```

Client, with Bun from `client/`:

```bash
bun run dev        # vite; proxies /v1 → SROUTER_API_URL ?? http://127.0.0.1:3000, changeOrigin:false
bun run typecheck  # tsr generate && tsc --noEmit
bun run lint       # eslint .
bun run format     # prettier --write "**/*.{ts,tsx}"
bun run build      # tsr generate && tsc -b && vite build
```

Two runtime gotchas:

- `dotenvy` reads `.env` relative to the **current working directory**, so run the server with cwd `server/` (or export vars) for `server/.env` to apply.
- `resolve_web_dist` does **not** search `client/dist`; serving the built SPA needs `WEB_DIST_PATH=client/dist` (dev builds proxy instead, so this only matters for production-ish runs).

Pricing snapshot maintenance (Python 3 stdlib, not a required dev step): `python3 server/scripts/update_models_dev_pricing.py --update|--check`.

## Code Conventions & Common Patterns

**Rust (`server/`)** — 4-space indent, rustfmt defaults; no `rustfmt.toml`, so `cargo fmt` output is the law.

- Errors: one custom `APIError { status, message, error_type, code, param }` with builders and `impl IntoResponse`; propagate with `?` in `Result<_, APIError>`. No `anyhow`/`thiserror` (zero hits). `Box<dyn Error>` only in `main`.
- **Wire fields are `snake_case`, both directions.** All 234 fields in `client/src/generated/typed.ts` are snake_case and the client depends on it. Do not add `#[serde(rename_all = "camelCase")]`, and use `#[serde(rename)]` only for a name that is not a valid Rust identifier (`error.type`). Enum _values_ mirror their protocol instead (`UPPERCASE` method, `lowercase` object kind, `kebab-case` SSE tags) — follow the enum next to yours. Regenerate with `export_ts` and `git diff` the generated file so a camelCase field cannot slip through: a Rust type change is a wire contract change.
- All client-visible strings/codes/headers come from `server/src/constants.rs` — never inline literals in handlers; interpolated messages become functions.
- Async: tokio multi-thread. Traits stay dyn-compatible by returning `BoxFuture<'_, …>` instead of `async fn` (see the rationale in `providers/executor.rs`). Shared state is `Arc<..>` + `RwLock`/`Mutex` with poison recovery; streams flow through `mpsc`/`broadcast`.
- Provider drivers: implement `ProviderExecutor` in the vendor module, register one constructor — no central dispatch match. File set per vendor: `mod.rs` + `executor.rs`/`translate.rs`/`types.rs`/`auth.rs`/`catalog.rs`/`tests.rs`. Runtime-registered drivers are `Arc<dyn>`-based; catalog order lives in `SEED_PROVIDERS`.
- Naming: `snake_case` modules grouped by feature with `mod.rs` re-exports; handlers are verbs (`create_completion`, `list_quota`); router factories are `create_*_router`; stores are `SQLx*Store` with traits in `store.rs`/`repository.rs` and `Empty*` fallbacks.
- Docs: module-level `//!` comments explain **why** and cite the Node `apps/api/src/...:line` oracle. Match that style; a `docs/` directory does **not** exist — comments citing `docs/api-v1-contract.md` etc. are stale pointers from the Node port, and the contract really lives in the Rust types plus the route tests.
- JSON shapes: pair `#[serde(skip_serializing_if)]` with `#[specta(optional)]`; `bindings.rs` renders a custom `WireShapes` format that strips the skip attributes so no `_Serialize`/`_Deserialize` splits appear.

**TypeScript (`client/`)** — prettier: `semi: false`, double quotes, `printWidth: 80`, `trailingComma: es5`, tailwind class sorting with `tailwindFunctions: [cn, cva]`.

- `strict` + `noUnusedLocals`/`noUnusedParameters` + `verbatimModuleSyntax` + `erasableSyntaxOnly` → use `import type` / inline `type` imports.
- Path alias `@/*` → `client/src/*` (Vite + tsconfig). Files kebab-case; components PascalCase, named exports.
- All network access goes through `request<T>()` in `client/src/api/client.ts` (`credentials: 'include'`, verbs limited to GET/POST/PATCH/DELETE, no PUT). Never add a cross-origin API base URL or strip the `Origin` header: the game is same-origin + HttpOnly `SameSite=Lax` cookie + server-side `Origin` CSRF guard.
- Server state via TanStack Query `queryOptions` factories declared next to their endpoint (`client/src/api/<domain>.ts`); the shared `['admin','status']` cache entry is load-bearing for the auth guard and login page. Local state via `useState`; no Redux/Zustand/immer, no form library, no toast library.
- `cn` is re-exported from `client/src/lib/utils.ts` (the `cn` package, not clsx+tailwind-merge); UI primitives live in `client/src/components/ui/` (shadcn generated over `@base-ui/react`); the unreferenced `client/src/components/gauge/` kit is the sanctioned dial/chart vocabulary — reuse it rather than adding a chart dep.

**Never hand-edit generated files**: `client/src/generated/**`, `server/bindings.ts` (regenerate via `export_ts`; `server/tests/bindings.rs` fails on drift) and `client/src/routeTree.gen.ts` (`tsr generate` / the Vite plugin; committed on purpose).

## Important Files

- `server/src/main.rs` — composition root; `server/src/lib.rs` — module list + flat re-exports.
- `server/src/app.rs` — `create_router()`; the single place route guards and layer order are decided.
- `server/src/config.rs` — `APIConfig::from_env_map`, the only env parser; its `Debug` redacts secrets.
- `server/src/bindings.rs` + `server/src/bin/export_ts.rs` — specta registry and writer.
- `server/src/infrastructure/database/migrations.rs` — hand-written runner, `SCHEMA_VERSION = 4`, `PRAGMA user_version` carrier, refuses newer versions.
- `server/tests/support/mod.rs` — `TestDatabase`, fake upstreams, fixture stores, request builders; every new suite should start here.
- `client/src/api/client.ts`, `client/src/api/admin.ts`, `client/src/routes/__root.tsx` (queryClient singleton), `client/src/routes/_authenticated.tsx` (auth gate).
- `server/.env.example` — the authoritative env surface; `CONTRIBUTING.md`, `SECURITY.md` — process and security rules.

## Runtime/Tooling Preferences

- **Server**: Rust `stable` (edition 2024 ⇒ ≥1.85), pinned only to the channel by `server/rust-toolchain.toml`; commit `server/Cargo.lock` and use `--locked` for checks. No cargo features table; all dep features are inline. `[profile.dev]`/`[profile.test] debug = 1` with dependencies at `debug = false` is a deliberate disk-footprint decision — do not "fix" it to 2.
- **Client**: Bun is the package manager (`client/bun.lock` is the only lockfile); no `engines`/`packageManager` pins, no `VITE_*` vars — the only client env var is `SROUTER_API_URL` (Vite config). Never add npm/pnpm/yarn lockfiles.
- **Database**: SQLite is the only supported backend. `DATABASE_URL` is **refused at boot** (owner ruling 2026-10-08) and must stay unset. All SQL is runtime `sqlx::query(...).bind(...)` — no `query!` macros, no `.sqlx` offline cache, so no database is needed to build or test.
- **Server env vars** (names only; parsed once at boot, grouped by concern): listener/storage `PORT`, `DATABASE_PATH` (default `$HOME/.srouter/srouter.db`), `WEB_DIST_PATH`; URLs/auth `SROUTER_PUBLIC_URL`, `SROUTER_CORS_ORIGINS`, `SROUTER_SECURE_COOKIES`, `SROUTER_ADMIN_PASSWORD`; runtime/logging `NODE_ENV` (`development` is the only non-production value), `SROUTER_ACCESS_LOG`, `SROUTER_FILE_LOG`, `RUST_LOG`; search fallbacks `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `SEARXNG_URL`; read outside `APIConfig`: `CLAUDE_OAUTH_CLIENT_ID`, `CODEBUDDY_PRODUCT_JSON`, `HOME`.
- **Runtimes needed anyway**: Python 3 only for the pricing script; Node is not needed at all; k6 only for the optional benchmark scenarios.
- History lives on branches `backup/pre-packages-removal` and `backup/pre-apps-api-removal` (the removed `apps/`, `packages/*`, CLI, docs site); `CONTRIBUTING.md` still claims "no Node toolchain" — stale, `client/` is live.

## Testing & QA

- Framework: plain `cargo test` only. Single dev-dependency: `tower` (`util`, for `oneshot`). No nextest, serial_test, testcontainers, wiremock, insta, or coverage tooling anywhere.
- Shape: 42 integration suites in `server/tests/*.rs` (~466 test fns) + ~67 in-crate `#[cfg(test)]` modules for provider translation/middleware/db units. Requests are driven either through `Router::oneshot` with an injected `ConnectInfo(SocketAddr)` peer (most suites) or over a real `127.0.0.1:0` socket with `reqwest` (`logs.rs`, `pricing.rs`).
- Isolation: every suite builds its own temp SQLite file via `TestDatabase` and fakes upstreams (`Fake{Upstream,Qoder,CodeBuddy,Cline,Grok,Antigravity,Claude,Codex}` in `tests/support/`, all bound to random loopback ports and aborted on `Drop`). **Tests must never open `~/.srouter/srouter.db` or reach a real provider.** The only global lock is `EVENT_TEST_LOCK` in `logs.rs` around process-global log-event broadcasts; prefer dependency injection over new globals.
- Expectations: no coverage thresholds and no CI — run the full suite yourself before pushing (`cargo test --manifest-path server/Cargo.toml --locked`), then `fmt --check` and `clippy -D warnings`. Client-side verification is `bun run typecheck && bun run lint && bun run build`; there is no client test runner.
- Frozen contracts a change must keep green: `server/tests/bindings.rs` (generated TS), `server/tests/schema.rs` (`user_version = 4`, newer refused), `server/tests/http_runtime.rs` (six frozen response headers incl. `X-Version`), `server/tests/database.rs` (`DATABASE_URL` refused before any SQLite file is touched). Route tests pin status codes and error bodies, so the contract is the Rust types + tests — there is no separate contract document to update.
- Stated policy (`CONTRIBUTING.md`): Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `perf:`, `chore:`), imperative subject, and say what you ran in the PR description.
- Security constraints to respect (`SECURITY.md`): provider credentials are cleartext JSON inside the SQLite file and in exports — treat the DB like a `.env`; gateway keys store only sha256 + prefix (unrecoverable); request logs keep metadata only, never prompt/completion text; report vulnerabilities privately to `security@srouter.web.id`, never via a public issue.
