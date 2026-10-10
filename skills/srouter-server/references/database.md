# Database, Migrations, Upstream

## `AppDatabase`

`infrastructure/database/mod.rs` defines an enum: `Sqlite(Arc<SqliteHandle>)` or `Postgres(PgPool)`. **Only SQLite can be constructed.** `connect()` rejects `DATABASE_URL` before touching any file (`constants::database::POSTGRES_UNSUPPORTED`), then opens the handle and runs migrations. The `Postgres` variant exists so Postgres-only paths can be pinned by tests as explicit failures, not so it can be used.

Accessors, and when to use which:

| Accessor                                               | Use                                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `sqlite_pool() -> Option<SqlitePool>`                  | reads that tolerate a missing database; returns a clone of the `Arc`, safe to hold across `.await` |
| `sqlite_required(msg) -> Result<SqlitePool, APIError>` | writes and anything that must not silently no-op; answers `500` with the caller's message          |
| `sqlite_handle()`                                      | only for the database transfer, which swaps the pool after an import                               |
| `sqlite_path()`                                        | file path, for backups/exports                                                                     |

`SqliteHandle` sets WAL, `synchronous=NORMAL`, a 5 s busy timeout, foreign keys on, and a pool of 5 connections.

## Store pattern

Two shapes exist; match the one your feature already uses.

**Trait + SQLx impl** — for anything the gateway depends on (`api_keys`, `admin_auth`, credentials). The trait lives in `features/<x>/{store,repository}.rs`, returns `BoxFuture<'_, Result<_, APIError>>` for dyn-compatibility (same reason as `ProviderExecutor`), and has an `Empty*` implementation so a database-less boot is coherent. The SQLx impl holds an `AppDatabase` and a small `fn pool()`.

**Free functions** — for settings and simple lookups (`settings.rs`, `catalog_flags.rs`). No trait; the signature takes `&AppDatabase` and returns `Result<_, APIError>`.

Conventions:

- All SQL is runtime `sqlx::query(...).bind(...)`. There are **no `query!` macros and no `.sqlx` offline cache**, so no database is needed to build or test.
- Map `sqlx::Error` with a local helper: `fn sql_error(context) -> impl FnOnce(sqlx::Error) -> APIError` → `APIError::new(500, constants::database::with_context(ctx, &error))`. Note this leaks the error text to the client by design (the Node build did the same) — never put a secret in it.
- Decode rows through `row::{text, optional_text, integer}`; a missing column becomes a `500` naming the column rather than a panic. Optional columns use `try_get(..).unwrap_or(..)`.
- Use a transaction for read-modify-write (key updates, provider patches) and atomic `WHERE` clauses for single-statement counters (quota reservation). A plain single-statement write needs no transaction.

## Migrations

Files: `server/migrations/NNNN_snake_case.sql`. Version carrier is `PRAGMA user_version`, **not** a `sqlx_migrations` table. There is no sqlx-cli and no down migration — the runner lives in `infrastructure/database/migrations.rs` and embeds each file with `include_str!`.

`run()` reads the current version, no-ops when equal, **refuses to open a database whose version is newer than `SCHEMA_VERSION`**, and applies everything in one transaction so a failure leaves the previous version intact.

The three files:

| File                              | Content                                                        | Idempotent?                                 |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `0002_v2_schema.sql`              | base DDL, every statement `IF NOT EXISTS`                      | yes — and it runs on **every** upgrade path |
| `0003_request_logs.sql`           | 8 `ALTER TABLE request_logs ADD COLUMN`                        | no — gated on `version < 3`                 |
| `0004_remove_tunnel_settings.sql` | the only data statement: `DELETE` of four tunnel settings keys | yes, so it is ungated                       |

**Adding v5:**

1. Write `server/migrations/0005_<name>.sql`. DDL only, `IF NOT EXISTS` where possible.
2. Add the `include_str!` constant next to the existing ones in `migrations.rs`.
3. Raise `SCHEMA_VERSION` and fix the comments that spell the version out (some are already stale — trust the constant, not the prose).
4. Run it inside the same transaction; gate on `version < 4` if any statement is not idempotent.
5. Update the pins in `server/tests/schema.rs`: the `user_version` assertion, the table/index sets, and any key list you touched.
6. The database import compares a candidate file's schema against a freshly built one at `SCHEMA_VERSION` — a new migration must satisfy that check.

Never put a data statement in `0002`; it executes on every upgrade. If a data statement is unavoidable, copy the `0004` style: delete exactly the named rows and nothing else.

## Upstream client and SSRF

`infrastructure/upstream/client.rs`:

- `REQUEST_TIMEOUT` 120 s, applied per request (streams get no total timeout).
- `CONNECT_TIMEOUT` 10 s.
- `STREAM_IDLE_TIMEOUT` 120 s — the shared stall threshold every stream wrapper uses.
- The client sends `srouter-server/<version>` as its user agent.

`infrastructure/upstream/ssrf.rs` guards URLs derived from user input (a custom provider's base URL). `is_blocked_address` rejects loopback, private, link-local, broadcast, documentation, unspecified, `0.x` (v4), and loopback/unspecified/`fc00::/7`/`fe80::/10` (v6). `is_blocked_host` checks a literal IP without DNS, otherwise resolves and blocks when **any** resolved address is blocked.

Built-in providers use fixed trusted base URLs and never pass through this guard — the guard exists for operator-supplied targets, and it is enforced at the create/verify routes.

## Telemetry

`infrastructure/telemetry.rs` builds the subscriber: stdout always, plus a file layer when `SROUTER_FILE_LOG` is truthy (`true`/`1`, case-insensitive), writing `logs/srouter-server.log` relative to the CWD. The filter is `RUST_LOG` with an `info` fallback. `set_global_default` means one subscriber per process, which is why tests build their own rather than re-initializing.

## Notes for a store change

- Credentials live as cleartext JSON in `providers.credentials` inside the SQLite file, and database exports carry them — treat the database like a `.env` (see `SECURITY.md`).
- Request logs store metadata only: never prompt or completion text.
- A store that writes must answer through `sqlite_required`, so a Postgres-mode process fails loudly instead of pretending to persist.
