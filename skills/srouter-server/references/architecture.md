# Architecture

## What this crate is

`srouter-server` — a self-hosted, multi-provider LLM gateway. It accepts OpenAI-style (`/v1/chat/completions`, `/v1/chat`), Anthropic-style (`/v1/messages`), and image (`/v1/images/generations`) requests, authenticates the caller, resolves the model onto a per-vendor provider driver, forwards upstream, streams SSE back, logs every request to SQLite, and exposes an operator API plus an optional SPA.

It is a behavioural port of a deleted Node `apps/api`. Comments cite `apps/api/src/...:line` as the oracle; where behaviour deviates, the module comment records the deviation. A `docs/` directory does **not** exist — comments citing `docs/*.md` are stale pointers.

## Boot order (`server/src/main.rs`)

```text
dotenvy::dotenv()                                        # reads .env from the CWD
telemetry::init()                                        # tracing subscriber, RUST_LOG
APIConfig::from_env_map(env)                             # the only env parser
AppDatabase::connect(&config)                            # refuses DATABASE_URL, runs migrations
bootstrap_admin_account_from_env(...)                    # create on first boot, reset every boot
SecurityState::with_repository(..).with_admin_auth(..)   # Arc<dyn> stores
ProviderRegistry::with_database(Some(db))                # the 9 built-in drivers
register_custom_providers(&registry, &db)                # DB rows; failure only warns
spawn: maybe_refresh_catalogs(false)                     # warm-up, off the boot path
spawn: sweep_tokens() after 5 s, then every 60 s          # OAuth refresh
listeners::serve_main(create_router(state), 0.0.0.0:PORT)
```

`serve_main` (`http/listeners.rs`) binds the wildcard address, wraps the router in `into_make_service_with_connect_info::<SocketAddr>()` — that is what makes `ConnectInfo` available to `client_address` — and shuts down gracefully on Ctrl-C.

## Module map

| Path                                       | Responsibility                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/main.rs`                              | Composition root: everything above                                                    |
| `src/lib.rs`                               | Module list + the flat re-export surface                                              |
| `src/app.rs`                               | `create_router()` — the only router assembly; `ApiInfo`, `/health`, `route_not_found` |
| `src/state.rs`                             | `AppState`, `SecurityState`, builders, `Empty*` stores                                |
| `src/config.rs`                            | `APIConfig::from_env_map`; `Debug` redacts secrets                                    |
| `src/error.rs`                             | `APIError`, `ErrorEnvelope`, `invalid_json()`                                         |
| `src/constants.rs`                         | All client-visible copy, codes, error types, header names                             |
| `src/request.rs`                           | `MAX_BODY_BYTES`, `client_address`, `is_loopback_address`, `cookie_value`             |
| `src/clock.rs`                             | `now_ms()` — Node `Date.now()` parity                                                 |
| `src/bindings.rs` + `src/bin/export_ts.rs` | specta registry and the writer for both TS copies                                     |
| `src/http/`                                | `middleware/`, `listeners.rs`, `static_files.rs`                                      |
| `src/infrastructure/`                      | `database/`, `upstream/`, `telemetry.rs`                                              |
| `src/features/`                            | One directory per feature, each exposing `create_*_router()`                          |
| `src/protocol/`                            | Leaf wire types: `model`, `usage`, `sse`, `image` — no business logic                 |

Features: `gateway/` (chat, messages, images, translation, interception, search, token_saver), `providers/` (registry, adapters, per-vendor drivers, `custom/`, `management/`), `catalog/` (models, pricing, quota), `api_keys/`, `admin_auth/`, `provider_auth/` (OAuth logins), `logs.rs`, `settings.rs`, `database_transfer/`.

## Request path

```text
axum Router (app.rs)
  → global layers:      log_access → log_failed_requests → security_headers → cors
  → nest layer:         body_limit → csrf_origin_guard
  → per-mount guard:    api_key_auth  |  require_admin_session  |  none
  → handler
      → read_json_body / typed extractors
      → (gateway) ensure_model_allowed_any → token_saver → reserve_api_key_quota
      → ProviderRegistry::resolve(model) → ProviderAdapter → driver → UpstreamClient
      → Json(response)  |  sse::sse_response(mpsc + ReceiverStream)
  → interception/logging.rs: insert_request_log, quota settle/release (best-effort)
```

**DI is manual.** `AppState` and `SecurityState` (`state.rs`) hold `Arc<dyn Trait>` stores; middleware attaches `Extension<APIPrincipal>`; handlers extract `State`, `Extension`, `Path`/`Query`, `HeaderMap`, `Request`, or raw `Bytes`. There is no container and no builder framework.

## Layer boundaries

| Layer                          | Owns                                                    | Must not                              |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------- |
| `app.rs`                       | which guard sits on which mount, and global layer order | contain handler logic                 |
| `http/middleware/`             | cross-cutting request/response concerns                 | know about a specific feature         |
| `features/<x>/routes.rs`       | the route table and handlers for one feature            | mount itself into the app             |
| `features/providers/<vendor>/` | one upstream protocol end to end                        | know about HTTP routes of the gateway |
| `infrastructure/database/`     | SQL and row decoding behind traits                      | know about HTTP                       |
| `protocol/`                    | wire types and SSE framing helpers                      | hold state or I/O                     |

Cross-feature calls go through `AppState` (registry, security, database) or a small `pub fn` in the owning module — never by reaching into another feature's internals.

## State

`AppState` carries `config`, `providers` (the registry), `security`, `database: Option<AppDatabase>`, `search`, and a quota cache. `SecurityState` holds `api_keys`, `admin_sessions`, `key_repository`, `admin_auth`, `login_throttle`, `rate_limiter`.

Both are `Clone` (everything inside is `Arc`), which is why middleware clones the state rather than borrowing it. `SecurityState::unconfigured()` returns empty stores so a database-less boot still serves — and `is_persistence_configured()` exists so startup can warn instead of looking production-ready.

## Cross-cutting invariants

- **`/v1` nests own their 404.** Each nest has `.fallback(route_not_found)`, so an unmatched API path answers JSON instead of falling through to the SPA shell.
- **Root routes and the SPA fallback are registered before the global layers**, because `Router::layer` only wraps routes that already exist.
- **Last-added layer is outermost.** The chain is written in the order Node ran it.
- **`client_address` never trusts headers.** Loopback auth comes from `ConnectInfo` only, so `X-Forwarded-For`/`Host` cannot claim localhost.
- **SQLite is the only backend.** `DATABASE_URL` is refused before any file is touched.
