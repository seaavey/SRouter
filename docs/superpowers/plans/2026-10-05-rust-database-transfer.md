# Database Transfer (export/import) Rust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `GET /v1/admin/database/export` and `POST /v1/admin/database/import` to `server/` so an
operator can download a snapshot of the SQLite database and replace it with an uploaded one, with the
same wire behavior, permissions, limits, error codes, and recovery semantics Node serves today.

**Architecture:** One feature module `features/database_transfer/` (the name the API contract already
reserves for this row, `docs/api-v1-contract.md:216`) owning the routes, the multipart stream, and the
snapshot/validate/replace logic. The hard part is not the routes: it is that replacing the SQLite file
must be visible to a running process that holds a pool. `AppDatabase::Sqlite` changes from a bare
`SqlitePool` into `Arc<SqliteHandle>` holding `{ path, std::sync::RwLock<SqlitePool> }`, so the importer
swaps the pool in place and every existing `sqlite_pool()` / `sqlite_required()` caller keeps its current
text: the accessors return the pool **by value** (a `SqlitePool` is an `Arc` handle, so the clone is a
refcount bump and the guard never escapes the accessor). A read guard was the first design and does not
compile — see D1 for the three independent reasons and the probes. No new crate: `std::sync::RwLock` and
`axum::extract::Multipart` are already available.

**Tech Stack:** Rust edition 2024 (stable), axum 0.8 (`multipart` feature already enabled in
`server/Cargo.toml:12`), sqlx 0.9 (SQLite), serde/serde_json, tokio 1. No new crates.

**Review status (2026-10-05):** re-derived against HEAD `10893d9` — every `file:line`, the oracle test
count (8/8, re-run), the DDL table/index/column counts, the accessor call-site count, and the two
compile claims (a `std` read guard is `!Send`; `Executor` is implemented for `&Pool<DB>` only) were
checked with real commands on this machine. D1 was rewritten, D6 and D10 corrected, D11–D14 added,
`## Validation rules` added, and the Verification block fixed. The remaining open questions need an
owner decision, not more evidence.

**Spec / provenance:** `apps/api/src/routes/v1/database.ts` and
`apps/api/src/controllers/database.controller.ts` (behavioral oracle), `apps/api/tests/database-route.test.ts`
(8 cases, the black-box oracle), `docs/api-database-contract.md` §"Database transfer contract",
`docs/api-v1-contract.md:107-108`, and `docs/schemas-database.md` §7-F/§7-K for the Rust-side version
carrier.

**Explicitly NOT provenance:** `packages/db/src/databaseTransfer.ts` is the Node implementation. It is
readable as evidence about the incumbent's behavior, and this plan cites it for that, but it must not be
copied into Rust: it validates the **v1** column set and the `srouter_schema_meta` marker, both of which
the Rust schema deliberately replaced. The Rust validator derives its expectations from Rust's own DDL
(`server/migrations/0002_v2_schema.sql`, `server/migrations/0003_request_logs.sql`) plus
`docs/schemas-database.md`.

---

## Analisis Node (independent behavioral analysis)

### Routes and guards

| Route | Guard | Evidence |
| --- | --- | --- |
| `GET /v1/admin/database/export` | admin session only | `database.ts:21,30` |
| `POST /v1/admin/database/import` | admin session only | `database.ts:21,31` |
| both | route-level `Content-Length > 25 MiB` → `400 upload_too_large` | `database.ts:22-29` |

The router is mounted at `/v1` only (`apps/api/src/index.ts:141`). It is **not** in the `/v1/v1`
compat group (`index.ts:143-146` mounts only Messages, Chat, Models there). Rust must not add it to
`v1_compat_routes`.

An API key and a loopback address do not authorize: the oracle asserts `401` for a missing cookie, for
`x-api-key`, and for `x-forwarded-for: 127.0.0.1` (`database-route.test.ts:57-65`, `:79-93`).

### Export

- Snapshot written to a temp dir, read back, returned with `Content-Type: application/octet-stream`,
  `Content-Length`, and `Content-Disposition: attachment; filename="srouter-backup-<UTC timestamp>.db"`
  (`database.controller.ts:206-214`). The timestamp is the ISO string with every non-digit stripped,
  first 14 chars: `2026-10-05T14:52:03.123Z` → `20261005145203` (`:64-67`).
- Snapshot is a `VACUUM INTO` copy, chmod `0600`, atomic rename into place (`databaseTransfer.ts:336-344`,
  `:294-296`). A transfer lock is held for the whole operation (`:274`, `:346`).
- Export path must not equal the active database path, else a plain error → `500 database_transfer_failed`
  (`:277-280`).
- PostgreSQL → `400 unsupported_storage` (`:162-163`, `databaseTransfer.ts:122-127`).

### Import

Order of operations (`database.controller.ts:222-257`): private temp dir → stream the multipart file to
`<dir>/database.db` → `validateDatabase` → `replaceDatabase` → clear the admin cookie → `200` with
`{ok, backup_path, restart_required, reauth_required}`.

- Temp dir: `$HOME/.srouter` created `0700`, then `mkdtemp($HOME/.srouter/transfer-temp-)`, chmod `0700`
  (`:192-197`). Candidate file created `0600` (`:109`). Both removed on success and failure (`:255`).
- `backup_path` is rendered relative to `$HOME/.srouter` and prefixed with `~`, e.g.
  `~/.srouter/backups/import-backup-1.db`; when the real backup path is outside that directory it
  reports the literal constant `~/.srouter/backups/import-backup.db` (`:69-76`).
- Replacement (`databaseTransfer.ts:454-529`): validate candidate → close the shared connection →
  snapshot the **current** database into `<SROUTER_DIR>/backups/import-backup-<ms>.db` → snapshot the
  candidate into `<active>.import-<pid>-<ts>` → rename over the active path → remove `-wal`/`-shm` →
  reopen → `{backupPath, restartRequired: false, reauthRequired: true}`. Every failure after the rename
  restores the retained backup; a failure to restore is `500 database_recovery_failed`.
- Concurrency: a lock file `<active>.transfer.lock` holding `{pid, start, token}`; a live owner → `409
  database_import_busy`; a dead owner's lock is quarantined and reclaimed (`:346-439`).

### Validation

`readValidation` (`databaseTransfer.ts:223-270`): open read-only (failure → invalid), `PRAGMA
integrity_check` must be `ok`, every required table present, every expected column matching
`type/notnull/dflt_value/pk`, required indexes present, a unique single-column index on `api_keys.key`,
and `srouter_schema_meta.schema_version == "1"`. Any mismatch → `400 invalid_database`
(`IncompatibleDatabaseError`).

**Rust-side expectations (D7, derived from `server/migrations/0002_v2_schema.sql` and
`0003_request_logs.sql`, both verified against the current files):**

- Required tables (10, `0002_v2_schema.sql:11,19,26,42,57,67,73,85,96,120`): `admin_accounts`,
  `admin_sessions`, `api_keys`, `providers`, `provider_model_overrides`, `favorite_models`,
  `fallback_rules`, `oauth_sessions`, `request_logs`, `settings`.
- Required indexes (5, `0002_v2_schema.sql:127-131`): `idx_api_keys_key_hash` (must also be UNIQUE and
  single-column on `key_hash`), `idx_request_logs_created`, `idx_request_logs_provider`,
  `idx_request_logs_model`, `idx_fallback_priority`.
- Required columns: the union of the `CREATE TABLE` columns in `0002_v2_schema.sql` and the eight v3
  additions in `0003_request_logs.sql` (`request_id`, `user_id`, `method`, `path`, `error_code`,
  `error_message`, `legacy_id`, `legacy_api_key_id`).
- Version gate: `PRAGMA user_version` (`docs/schemas-database.md` §"Connection pragmas and version gate",
  §7-K). Unlike Node, there is no `srouter_schema_meta` marker to read (`docs/schemas-database.md` §7-F).

## Validation rules

`validate_candidate` runs against a read-only connection on a scratch copy (D4). Every failure is
`400 invalid_database` with the frozen message `The uploaded database is invalid or incompatible.`
(`database.controller.ts:44-47`). The rules, in order:

| # | Rule | Failure |
| --- | --- | --- |
| 1 | The file opens read-only as SQLite (sqlx `SqliteConnectOptions::new().filename(path).read_only(true)`, `sqlx-sqlite-0.9.0/src/options/mod.rs:294`). A non-SQLite file fails here. | `invalid_database` |
| 2 | `PRAGMA integrity_check` returns the single row `ok` (any other value, including `database disk image is malformed`). | `invalid_database` |
| 3 | `PRAGMA user_version`: `3` = ready, `0`/`1`/`2` = migrate first (D4), `>3` = refuse. `migrations::run` already refuses a higher version (`migrations.rs:39-47`); the validator must not open a `>3` file with the migrator and treat its error as a transfer failure. | `invalid_database` |
| 4 | All 10 tables of `V3_TABLES` (`tests/schema.rs:10-21`) are present. | `invalid_database` |
| 5 | For each of those tables, every column of the v3 DDL is present with a matching `type` / `notnull` / `dflt_value` / `pk` from `pragma_table_info` — the same four fields Node compares (`databaseTransfer.ts:195-199`). The expected set is the union of `0002_v2_schema.sql` and the eight v3 additions in `0003_request_logs.sql`. | `invalid_database` |
| 6 | All 5 indexes of `V3_INDEXES` (`tests/schema.rs:23-29`) exist. | `invalid_database` |
| 7 | `idx_api_keys_key_hash` is UNIQUE and single-column on `key_hash` — `pragma_index_list` + `pragma_index_info`, not just the name. This is the one constraint Node checks separately (`databaseTransfer.ts:210-220`) and the one that actually protects key lookup. | `invalid_database` |
| 8 | No column is *added* by the candidate that the DDL does not declare? **No** — extra columns are tolerated, matching Node's `candidateColumns.length < expectedColumns.length` guard (`:192`), which only rejects a table with *fewer* columns than expected. | — |
| 9 | The candidate path is not the active database path (`databaseTransfer.ts:314-316`). | `invalid_database` |
| 10 | Validation itself does not write: the scratch copy is the only file touched, and the candidate's bytes are unchanged (assert with a hash in the test suite). | — |

`PRAGMA user_version` is read on the **same connection** used for the table/index reads, so a candidate
cannot report a different version on a second open. Legacy v1 detection is the marker table
`srouter_schema_meta` (`schemas-database.md:284-286`), read before the migrator drops it.

### Error mapping (frozen table, `docs/api-database-contract.md:66-77`)

| Condition | Status | Code |
| --- | --- | --- |
| Unsupported storage backend | 400 | `unsupported_storage` |
| Invalid or incompatible database | 400 | `invalid_database` |
| Invalid multipart body | 400 | `invalid_multipart` |
| Missing `database` file | 400 | `missing_database_file` |
| Non-file, duplicate, or invalid `database` field | 400 | `invalid_database_field` |
| Upload too large, route layer | 400 | `upload_too_large` |
| Oversized `Content-Length`, global middleware | 413 | `request_too_large` |
| Another import active | 409 | `database_import_busy` |
| Recovery required after failed replacement | 500 | `database_recovery_failed` |
| Other transfer failure | 500 | `database_transfer_failed` |

Messages are frozen by `mapTransferError` (`database.controller.ts:38-62`):
`Database transfer is not supported for this storage backend.` /
`The uploaded database is invalid or incompatible.` /
`Another database import is already in progress.` /
`The database import failed and recovery was required.` /
`The database transfer could not be completed.` /
`The database upload is too large.` /
`A database file is required in the database field.` /
`A single database file is required in the database field.` /
`A valid multipart database upload is required.`

---

## Decisions

- **D1: `AppDatabase::Sqlite` becomes an `Arc` handle with a swappable pool, and the accessors return the
  pool by value.** `SqliteHandle { path: Arc<PathBuf>, pool: RwLock<SqlitePool> }`; `sqlite_pool()` returns
  `Option<SqlitePool>` and `sqlite_required()` returns `Result<SqlitePool, APIError>`. Rationale: 92
  accessor call sites across 34 files (45 in `server/src`, 47 in `server/tests`) read the pool through
  these two accessors, and `AppState` holds `AppDatabase` by value and is `Clone`, so an in-place swap is
  only visible everywhere if the handle is shared and the pool sits behind a lock.
  - **Not a read guard.** The earlier draft returned `RwLockReadGuard`. Verified against sqlx 0.9.0:
    `Executor` is implemented for `&Pool<DB>` and nothing else (`sqlx-core/src/pool/executor.rs:12`),
    never for a `Pool` by value and never through `Deref`, so a guard does **not** coerce into
    `query(..).execute(pool)`. The 65 in-src executor calls plus the 29 in tests that pass an accessor
    result straight in (e.g. `tests/chat_completions.rs:569` `.fetch_one(database.sqlite_pool().unwrap())`)
    would each need `&*pool` / `&pool`. Worse, `futures_util::future::BoxFuture` is
    `Pin<Box<dyn Future + Send>>` and a `std` read guard is `!Send`, so a guard held across an `.await`
    inside `Box::pin(async move { .. })` in any of the 17 `BoxFuture` store methods in
    `infrastructure/database/**` (`api_keys.rs`, `admin_auth.rs`) is a hard compile error. Probe on this repo's own dependency set:
    `error: future cannot be sent between threads safely`.
  - **Owned clone instead.** `SqlitePool` is `Arc<PoolInner>` with a derived `Clone`
    (`sqlx-core/src/pool/mod.rs:573`), so returning it by value is a refcount bump and the guard dies
    inside the accessor. Every call site keeps its current text; only the two `fn pool(&self)` helpers
    (`api_keys.rs:38`, `admin_auth.rs:172`) change their return type. Probe: the owned-clone shape compiles
    with a `BoxFuture` store method unchanged.
  - **Lock flavor.** `std::sync::RwLock`, poisoned-lock recovery instead of `unwrap()`. `tokio::sync::RwLock`
    is the wrong tool here: the accessors are synchronous, and `blocking_read` panics inside a runtime
    (`tokio-1.53.1/src/future/block_on.rs:6-11`), so it would abort the request that triggers the swap.
    `arc-swap` would remove the lock but adds a crate for no benefit at this call-site count (Open
    Questions 2).
  - **Rename alternative rejected.** `sqlite_pool` → `pool()` still hands out a guard, so it buys no
    Send-safety and touches the same 34 files.
  - `Postgres(PgPool)` keeps its shape: `tests/logs.rs:390` and `tests/providers.rs:913` construct it
    directly. The importer swaps with `SqliteHandle::replace(pool) -> SqlitePool`, which takes the write
    guard and returns the old pool for the caller to `close()`; because every accessor reads the lock at
    call time, the swap is visible to every `AppDatabase` clone already held in `AppState`.
- **D2: Reopen in place, never restart the process.** `restart_required` is always `false` and
  `reauth_required` always `true`, matching Node's literals (`databaseTransfer.ts:492`), and the admin
  cookie is cleared on success. Node's `restartRequired` field is hardcoded `false` because the shared
  connection is reopened; the Rust port does the same thing for the same reason.
- **D3: The Rust version carrier is `PRAGMA user_version`, not a marker table.** `docs/schemas-database.md`
  §7-F records that `srouter_schema_meta` is dropped in v2 and the version moves to `user_version`, and
  §7-K requires gating on it. Consequence, documented as a deviation: Node rejects a v2/v3 file, and Rust
  cannot use Node's marker check.
- **D4: A legacy candidate is migrated, then validated, then swapped, on a scratch copy.** `docs/schemas-database.md`
  §7-F states Rust must recognize a v1 backup (marker present) and run the migrator before trusting it.
  The candidate file itself is never written to: validation and migration happen on a scratch copy
  (`<active>.candidate-<pid>-<ts>` next to the database, or `<dir>/candidate.db` inside the private temp
  dir), so a rejected upload leaves no trace and the original bytes survive for the operator. Flow:
  open the candidate read-only → if `user_version < 3`, copy it and run `migrations::run` against the
  copy → validate the (possibly migrated) file against the v3 expectations → snapshot that file into the
  replacement. A candidate newer than v3 is rejected (`migrations::run` refuses a higher version,
  `migrations.rs:39-47`). *(Owner decision, see Open Questions 1.)*
- **D4b: `migrations::run` must be reachable from the feature module.** `migrations` is `mod migrations;`
  (`infrastructure/database/mod.rs:13`), so the plan widens it to `pub(crate) mod migrations;`. The
  migrator stays the single schema authority; no second DDL path is written.
- **D5: The hand-rolled multipart boundary parser is NOT ported.** Node wrote one
  (`database.controller.ts:98-190`) only because `Request.formData()` buffers the whole body; axum's
  `Multipart` extractor streams, so `axum::extract::Multipart` + `field.chunk()` replaces it. The wire
  behavior is preserved (one file part named `database`, filename before or after the name, duplicates
  rejected, 25 MiB enforced while streaming), the implementation is not. Recorded as an
  implementation-detail deviation.
- **D6: Keep the transfer lock file and its two owner modes; the test seams need a decision.** The lock
  protects a multi-process deployment (the systemd service plus a CLI) and a stale lock left by a crash,
  so `{pid, start, token}` + quarantine-and-reclaim is ported. It must also honor the **operation** owner:
  `acquireDatabaseOperationLock` (`packages/db/src/transferLock.ts:29-53`) writes
  `{pid, mode: "operation", token}` and a transfer answers `database_import_busy` for it instead of
  reclaiming (`databaseTransfer.ts:371-378`); a Rust importer that treats every lock as reclaimable breaks
  the CLI's guard. The three `setDatabaseTransfer*` globals are not only test seams: `testOwnerProbe` and
  `testReleaseReplacement` exist because `reclaimStaleLock`'s token re-check (`:422-427`) and
  `replaceDatabaseFromFile`'s restore path (`:493-522`) have no failure-free trigger. This repo's topology
  makes that concrete: `TestDatabase::new` points `HOME` at the temp dir (`support/mod.rs:57-64`), so the
  transfer lock the importer takes is always the test process's own and the default lock is *reclaimable*
  (`{pid: current, start: "unknown"}` never matches a live probe). `database_import_busy` is reachable by
  writing a lock with a live pid and the real `/proc/<pid>/stat` start identity; `database_recovery_failed`
  is not reachable by env alone and needs a fault-injection hook or an explicit dropped test. *(Owner
  decision, see Open Questions 3.)*
- **D7: Validation expectations come from Rust's DDL, never from `packages/db`.** Required tables and
  columns are derived from `server/migrations/0002_v2_schema.sql` and `0003_request_logs.sql` (both already
  `include_str!`-ed by `migrations.rs:26-27`), and the required-index set from
  `docs/schemas-database.md` §4. Node's `EXPECTED_COLUMNS`/`REQUIRED_INDEXES`
  (`databaseTransfer.ts:52-94`) are v1 shapes and are off-limits as a source.
- **D8: `/v1` only.** The router is mounted inside `v1_routes` (`app.rs:129-151`) and deliberately absent
  from `v1_compat_routes` (`app.rs:152-156`), matching `index.ts:141` vs `:143-146`.
- **D9: `-wal`/`-shm` are removed after the swap.** The replacement file is a `VACUUM INTO` snapshot with
  no sidecars of its own; leaving the old WAL next to it would corrupt the result
  (`databaseTransfer.ts:330-334`, `:489`).
- **D10: Both size guards are ported; the route guard is reachable in the real app.** The global
  `body_limit` layer on `/v1` (`app.rs:151`, `MAX_BODY_BYTES` = 25 MiB, `request.rs:10`) answers `413
  request_too_large` for an oversized `Content-Length`, exactly as in Node (`apps/api/src/index.ts:57`).
  But `body_limit` only reads the header: a **chunked** upload over 25 MiB carries no `Content-Length`, so
  it reaches the handler and must be bounded while streaming to `400 upload_too_large`. That is the
  route-level guard's real job and what `database-route.test.ts:200-218` asserts. The 25 MiB
  `Content-Length` case (`:185-194`) is the only one that is `413` through the full app and `400` through
  the router alone.

- **D11: The database router sets `DefaultBodyLimit::max(25 MiB)`.** axum's `Multipart` extractor applies
  `DefaultBodyLimit` to its own body (`axum-0.8.9/src/extract/multipart.rs:78`) and the default is 2 MiB
  (`axum-core-0.5.6/src/ext_traits/request.rs:319`), so without this a legal 25 MiB upload never reaches
  the stream loop. `DefaultBodyLimit` appears nowhere in `server/` today (grep: 0 hits), so this is its
  first use; it is per-router and does not change the global `body_limit` layer.
- **D12: Field-shape rejection is decided from `Field::name()`/`Field::file_name()`, not by multer.**
  multer reports a non-file field named `database` as a valid part, and the oracle's
  `invalid_database_field` cases (`database-route.test.ts:134-161`) are the controller's own
  `partCount > 1` / `isDatabaseField && !filePart` checks (`database.controller.ts:147-158`). The Rust
  stream loop keeps exactly those two checks; the shape rules are ours, not the parser's.
- **D13: The export filename needs a UTC date formatter the crate does not have.** `format_iso8601(secs)`
  exists (`features/providers/codex/quota.rs:281`) but lives behind a provider module and stops at seconds
  precision; the name is the ISO-8601 UTC string with every non-digit stripped, first 14 chars
  (`database.controller.ts:64-67`), i.e. `YYYYMMDDHHMMSS`. Reuse that civil-date math locally rather than
  adding `chrono`/`time` (neither is a dependency).
- **D14: `$HOME/.srouter` is not derivable from `APIConfig`.** `APIConfig` exposes `database_path` and
  `database_url` only (`config.rs:20-21`); `HOME` is read once to build the default path and then dropped
  (`config.rs:27-35`). The backup directory is `<HOME>/.srouter/backups` (`databaseTransfer.ts:325-328`)
  and `backup_path` is rendered relative to `<HOME>/.srouter` (`database.controller.ts:69-76`), so the
  feature needs `HOME` or a new config field. This is the **Node** `$HOME`: Rust's `~/.srouter` is only the
  default when `DATABASE_PATH` is unset, so a deployment that points `DATABASE_PATH` elsewhere still writes
  backups under `$HOME/.srouter`. Port that as-is for wire parity. *(Owner decision, see Open Questions 5.)*

## File Structure

| File | Responsibility |
| --- | --- |
| `server/src/features/database_transfer/mod.rs` | module wiring + re-exports |
| `server/src/features/database_transfer/routes.rs` | `create_database_router()`: the two routes, the route-level size guard, module doc naming provenance |
| `server/src/features/database_transfer/multipart.rs` | stream the `database` field to a private `0600` file under a `0700` dir, enforcing 25 MiB |
| `server/src/features/database_transfer/transfer.rs` | `export_snapshot`, `validate_candidate`, `replace_database`, the transfer lock, backup path rendering |
| `server/src/infrastructure/database/mod.rs` | modify: `Sqlite(Arc<SqliteHandle>)`; `sqlite_pool`/`sqlite_required` return the pool by value; new `sqlite_path()`; widen `mod migrations;` to `pub(crate) mod migrations;` (D4b) |
| `server/src/infrastructure/database/sqlite.rs` | modify: `SqliteHandle` owns `{path, RwLock<SqlitePool>}`; `connect` returns `Arc<SqliteHandle>`; add `pool`/`replace`/`close` helpers |
| `server/src/features/admin_auth/session.rs` | modify: `session_cookie`/`cleared_cookie` move here as `pub(crate)` (they belong next to `ADMIN_SESSION_COOKIE`) |
| `server/src/features/admin_auth/routes.rs` | modify: import the cookie builders instead of defining them |
| `server/src/features/mod.rs` | modify: `pub mod database_transfer;` |
| `server/src/app.rs` | modify: merge `create_database_router()` into `v1_routes` |
| `server/src/constants.rs` | modify: the nine client-facing transfer messages + codes |
| `server/tests/support/mod.rs` | modify: an admin-session helper (the existing `sqlx_admin_security_state` takes no token, unlike `sqlx_security_state`, `support/mod.rs:2199-2222`) and a seeded-candidate helper that writes a valid v3 SQLite file |
| `server/tests/database_transfer.rs` | new: the suite below |
| `server/TODO.md` | modify: §9 checked |
| `docs/api-database-contract.md` | modify: the Rust deviations (version carrier, legacy migration, streaming parser, lock) |
| `docs/api-v1-contract.md` | modify: "Database transfer in the Rust build" note under the retained row |
| `.local/TASK.md`, `.local/NOTES.md`, `.local/CONTEXT.md` | modify: session bookkeeping |

Mechanical ripple (no logic change; accessor return type only): in `server/src` —
`infrastructure/database/{admin_auth,api_keys,catalog_flags,oauth_sessions,settings}.rs`,
`infrastructure/database/request_logs/{store,analytics}.rs`,
`infrastructure/database/providers/{connections,credentials/{codex,codebuddy,antigravity,grok_web,qoder,cline}}.rs`,
`features/providers/antigravity/tests.rs` (16 files). In `server/tests` — `antigravity_auth.rs`,
`antigravity_provider.rs`, `api_keys.rs`, `chat_completions.rs`, `codebuddy_auth.rs`, `codex_provider.rs`,
`database.rs`, `grok_web_provider.rs`, `images.rs`, `logs.rs`, `messages.rs`, `models.rs`,
`provider_auth.rs`, `providers.rs`, `qoder_provider.rs`, `quota.rs`, `schema.rs`, `settings.rs` (18 files;
the 8 `.clone()` sites are in `database.rs`, `models.rs`, `schema.rs`). 29 of these sites pass the accessor
result straight into an executor and need `&`; the rest bind the pool first and only change type.

---

### Task 1: swappable SQLite handle

- [ ] `infrastructure/database/sqlite.rs`: `pub struct SqliteHandle { path: Arc<PathBuf>, pool: RwLock<SqlitePool> }` with `connect(path) -> Result<Arc<SqliteHandle>, sqlx::Error>`, `path() -> &Path`, `pool() -> SqlitePool` (read, cloned out, poisoned lock recovered), `replace(pool) -> SqlitePool` (write, returns the old pool), `close()`. Keep the existing pragmas verbatim (`sqlite.rs:19-25`).
- [ ] `infrastructure/database/mod.rs`: `Sqlite(Arc<SqliteHandle>)`; `sqlite_pool()` → `Option<SqlitePool>`; `sqlite_required()` → `Result<SqlitePool, APIError>`; new `sqlite_path()` → `Option<&Path>`; widen `mod migrations;` to `pub(crate) mod migrations;` (D4b). Do **not** return a read guard (D1).
- [ ] Fix the two `fn pool(&self) -> Result<&SqlitePool, APIError>` helpers (`api_keys.rs:38`, `admin_auth.rs:172`) and add `&` at the 29 sites that pass the accessor result straight into an executor; leave the rest textually untouched. `cargo build` + the ripple suites must stay green with no behavior change.

### Task 2: export

- [ ] `transfer.rs`: `export_snapshot(db, output_path) -> Result<ExportResult, TransferError>`: reject a non-SQLite backend (`unsupported_storage`), reject `output_path == active path`, hold the lock, `VACUUM INTO` a temp sibling, chmod `0600`, rename into place, remove the temp on failure.
- [ ] `routes.rs`: `GET /admin/database/export` writes the snapshot into a temp dir, reads it back, and answers `application/octet-stream` + `Content-Length` + `Content-Disposition: attachment; filename="srouter-backup-<14 digits>.db"`; temp dir removed in every path.
- [ ] `transfer.rs`: `utc_stamp_14()` — the `YYYYMMDDHHMMSS` name component from `now_ms()` (D13); unit-test it against a fixed epoch value (the Node pair is `2026-10-05T14:52:03.123Z` → `20261005145203`).
- [ ] `constants.rs`: the nine messages and codes, plus the frozen envelope shape: every one of them is `{error:{message,type,code}}` with `type` from `APIError::new(status, ..)` (`error.rs:19-25`) — `invalid_request_error` for 400/409, `api_error` for 500. Assert the full envelope in at least one test per status class, not just the status.

### Task 3: import, multipart and validation

- [ ] `multipart.rs`: `stream_database_field(multipart, candidate_path)`: exactly one part, field name `database`, filename required, 25 MiB enforced while writing, file created `0600` with `create_new`, and the four failure codes mapped (`missing_database_file`, `invalid_database_field`, `invalid_multipart`, `upload_too_large`). The three oracle edge behaviors to reproduce exactly (`database.controller.ts:142-181`): a **second part of any kind** → `invalid_database_field` (`partCount > 1`); a single part named `database` **without** a filename → `invalid_database_field`; a single part **not** named `database` → nothing is written and the end-of-body check yields `invalid_multipart`.
- [ ] A request with **no body at all** is `400 upload_too_large` (`database.controller.ts:230-232`; asserted as `400` by `database-route.test.ts:170-174`). axum's `Multipart` extractor would answer its own error first, so the handler checks for an absent body/content-type and returns the frozen envelope itself.
- [ ] `transfer.rs`: `validate_candidate(path)`: read-only open (`invalid_database` on failure), `PRAGMA integrity_check` must be `ok`, required tables and columns from Rust's DDL, required indexes, and `user_version` handling per D4 (migrate below 3, refuse above 3). The check list is `## Validation rules` below; read it as the spec, not the Node `EXPECTED_COLUMNS`.
- [ ] `routes.rs`: `POST /admin/database/import`: route-level `Content-Length` guard → `400 upload_too_large`, private `0700` dir under `$HOME/.srouter` (D14), `DefaultBodyLimit::max(25 MiB)` on this router (D11), cleanup on success and failure.
- [ ] `routes.rs`: a body with **no** `Content-Type: multipart/form-data` and no content is `400 upload_too_large` (the oracle's first assertion, `database-route.test.ts:170-174`); axum's `Multipart` extractor would answer its own rejection first, so the handler checks for an absent body/content-type and returns the frozen envelope itself.

### Task 4: import, replacement

- [ ] `transfer.rs`: `replace_database(db, candidate_path)`: backup the active file to `$HOME/.srouter/backups/import-backup-<ms>.db`, snapshot the candidate to `<active>.import-<pid>-<ts>`, rename over the active path, remove `-wal`/`-shm`, reopen the pool through `SqliteHandle::replace`, restore the backup on any post-rename failure, `database_recovery_failed` when even the restore fails.
- [ ] `transfer.rs`: the lock file: create `create_new` `0600`, `{pid, start, token}`, live owner → `database_import_busy`, `mode: "operation"` owner → `database_import_busy` without reclaim (D6), dead owner → quarantine + reclaim (rename to `.stale-<pid>-<uuid>`, re-verify the token, delete). The start identity is field 22 of `/proc/<pid>/stat` — the value after the last `)`, index 19 of the remainder (`databaseTransfer.ts:445-452`); read it with `fs::read_to_string` and fall back to `"unknown"`.
- [ ] `transfer.rs`: clear a stale lock by comparing the recorded start identity with the live one; a pid that exists with a *different* start identity is a recycled pid and its lock is stale (`databaseTransfer.ts:395-397`).
- [ ] `routes.rs`: success response `{ok: true, backup_path, restart_required: false, reauth_required: true}` and a cleared admin cookie via the moved `cleared_cookie`.

### Task 5: wiring and backlog

- [ ] `app.rs`: merge the router into `v1_routes` before the `csrf_origin_guard`/`body_limit` layers, and leave `v1_compat_routes` untouched.
- [ ] `features/mod.rs`: `pub mod database_transfer;`.
- [ ] `server/TODO.md` §9 (all three bullets) checked with the landed evidence.

### Task 6: tests

`server/tests/database_transfer.rs`, using `support::TestDatabase` (which already points `HOME` and
`DATABASE_PATH` at a temp dir, `support/mod.rs:74-83`):

- [ ] export: anonymous, API key, and loopback are `401`; admin cookie is `200` with octet-stream, an `attachment` disposition, a `Content-Length`, and a body that opens as a SQLite file holding the seeded row.
- [ ] export: the filename matches `srouter-backup-<14 digits>.db`.
- [ ] import: anonymous, API key, and loopback are `401`.
- [ ] import happy path: `200` with the exact four-field body, the admin cookie cleared, and the imported data visible through an existing route **after** the swap (this is the D1 regression test: the router holds an `AppState` clone built before the import).
- [ ] import: `Content-Disposition` with `filename` before `name` is accepted.
- [ ] import: duplicate file parts and duplicate non-file values both `400 invalid_database_field`.
- [ ] import: missing body, invalid database, and oversized `Content-Length` at the route layer → `400 upload_too_large`.
- [ ] import: a chunked body over 25 MiB → `400 upload_too_large`.
- [ ] import: error mapping for `unsupported_storage` (Postgres handle), `invalid_database`, `database_transfer_failed` (the 500 default), and `database_import_busy` via a lock file written with the test process's own pid and its real `/proc/<pid>/stat` start identity (D6 — the default `TestDatabase` lock is reclaimable, so it never produces `409`).
- [ ] import: `database_recovery_failed` needs a failure that lands after the rename; `DATABASE_PATH`/`HOME` injection cannot trigger it (D6). Either add the minimal fault hook or record the dropped case in `docs/api-database-contract.md` — do not leave a test that cannot fail.
- [ ] validation: a candidate missing one required table, one required column, one required index, and one with a non-unique `idx_api_keys_key_hash` are each `400 invalid_database`; a candidate whose `PRAGMA user_version` is 99 is `400 invalid_database`.
- [ ] validation: `validate_candidate` never writes to the candidate file (hash the bytes before and after the call) and opens it read-only.
- [ ] import: temp dir mode `0700`, candidate mode `0600`, both removed on success and on every failure path.
- [ ] import: the backup file exists afterwards and is a valid snapshot of the pre-import database.
- [ ] import: a v1 candidate (legacy tables + `srouter_schema_meta`) is migrated and accepted; a `user_version = 99` candidate is rejected `400 invalid_database`.
- [ ] routing: `/v1/v1/admin/database/export` and `/v1/v1/admin/database/import` are `404`.
- [ ] routing: the global `body_limit` still answers `413 request_too_large` for an oversized `Content-Length` through the full `create_router` app.

### Task 7: quality gates

- [ ] `cargo fmt --manifest-path server/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings`
- [ ] `cargo test --manifest-path server/Cargo.toml --test database_transfer`
- [ ] `cargo test --manifest-path server/Cargo.toml --test database --test schema --test logs --test providers` (the ripple-sensitive suites; all four compile and pass on the current HEAD).
- [ ] `cargo test --manifest-path server/Cargo.toml` — the D1 accessor change touches 34 files, so the focused four are not enough evidence; the CI job runs the whole suite (`ci.yml:92`).
- [ ] `git diff --check`
- [ ] `pnpm exec prettier --check docs/superpowers/plans/2026-10-05-rust-database-transfer.md docs/api-database-contract.md docs/api-v1-contract.md` — the plan file is not prettier-clean today (table alignment) and neither is the committed `2026-10-04-rust-provider-codebuddy.md`; CI does not run prettier (`.github/workflows/ci.yml` has 0 hits), so this is a local hygiene gate, not a CI gate.

## Verification

```bash
cd /root/SRouter
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path server/Cargo.toml --test database_transfer
cargo test --manifest-path server/Cargo.toml --test database --test schema --test logs --test providers
cargo test --manifest-path server/Cargo.toml        # CI runs the whole suite (ci.yml:92)
git diff --check
```

Node oracle, read as black-box evidence only (do not run root `pnpm test`; this one file is allowed per
`AGENTS.md`):

```bash
cd /root/SRouter/apps/api && ./node_modules/.bin/tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/database-route.test.ts
```

`pnpm` is not on `PATH` on this box; `apps/api/node_modules/.bin/tsx` is the working invocation.
Verified on 2026-10-05 against the current HEAD: 8 passed, 0 failed (`docs/api-v1-contract.md:232`).

## Open questions for the owner

1. **Legacy candidate handling (D4).** Migrate a v1/v2 candidate on import (schema doc §7-F, strictly
   more useful than Node, extra tests) or accept v3 only and document the deviation (simplest, and a
   v1 Node export is then refused by both implementations)? **Recommend: migrate.**
2. **Pool-swap mechanism (D1).** *Settled by review — the guard variant does not compile.* `Executor` is
   implemented for `&Pool<DB>` only (`sqlx-core/src/pool/executor.rs:12`), a `std` read guard is `!Send`
   (so it cannot be held across an `.await` in the 17 `BoxFuture` store methods), and
   `tokio::sync::RwLock` cannot be read synchronously from a runtime (`blocking_read` panics,
   `tokio-1.53.1/src/future/block_on.rs:6-11`). Remaining choice: owned clone out of a `std::sync::RwLock`
   (no new crate, 34 files touched anyway) or `arc-swap` (no lock, new dependency). **Recommend: owned
   clone.**
3. **Transfer lock (D6).** Port the `<db>.transfer.lock` file with stale-owner reclaim, or rely on an
   in-process guard only? The file only matters for a second process touching the same database.
   **Recommend: port it.**
4. **`backup_path` when the backup lands outside `$HOME/.srouter`.** Node answers the literal constant
   `~/.srouter/backups/import-backup.db` (`database.controller.ts:72-74`), which the web UI displays
   (`apps/web/src/components/settings/settings.data.tsx:86,298`). Port the constant, or report the real
   path? **Recommend: port the constant** (wire parity, and the file is always under `$HOME/.srouter`
   unless `HOME` is redirected).
5. **Where does `$HOME/.srouter` come from in Rust (D14)?** `APIConfig` drops `HOME` after building the
   default `database_path` (`config.rs:27-35`), so the feature either re-reads `std::env::var("HOME")` or
   `APIConfig` gains a `srouter_dir` field. The second is cleaner and testable through `from_env_map`, the
   first is smaller. Note the Rust server is a systemd *user* service, so `HOME` is set and
   `<HOME>/.srouter` is the real data directory. **Recommend: a `srouter_dir` field** (one line in
   `config.rs`, and the transfer tests stop depending on process-global env).
6. **`database_recovery_failed` coverage (D6).** Add a minimal fault-injection seam (a `#[cfg(test)]`
   static the importer checks, mirroring Node's `setDatabaseTransferTestFailure`) or record the case as
   deliberately untested? **Recommend: add the seam** — it is the one branch where a bug loses operator
   data, and the oracle does not cover it either.

## Not in scope

- PostgreSQL transfer (Rust refuses PostgreSQL at boot, `docs/api-v1-contract.md:142`); a Postgres handle
  can only be constructed in a test, which is how `unsupported_storage` is covered.
- The `apps/api` controller, router, and test file stay byte-identical (oracle and rollback path).
- `packages/db/src/databaseTransfer.ts` and `packages/db/src/transferLock.ts` are read as evidence about
  the incumbent only; the Rust port cites them for behavior and copies no column list, no marker table,
  and no version constant from them (D7).
- `docs/api-database-contract.md` must gain the Rust deviations before the feature ships: the version
  carrier (`user_version` instead of `srouter_schema_meta`), legacy-candidate migration, the streaming
  parser, and the lock's two owner modes. The frozen error table in that file is unchanged.
- Any change to the schema or the migrator beyond calling the existing `migrations::run` against a
  candidate file.
