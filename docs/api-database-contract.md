# API Database Compatibility Contract

**Status:** Persistence schema gate satisfied by the independent schema contract
`docs/schemas-database.md`, implemented in `server/migrations/0002_v2_schema.sql` and
`server/src/infrastructure/database/migrations.rs`.

This document records database behavior visible through the API routes and their tests. It does not infer or reproduce the internal schema. No production database, package source, or production `DATABASE_URL` was accessed.

## Allowed evidence

The Node tree that carried these files was deleted on 2026-10-08 (owner instruction) and is preserved
at branch `backup/pre-apps-api-removal` (commit `5839f80`):

- `apps/api/src/routes/v1/database.ts`
- `apps/api/src/controllers/database.controller.ts`
- `apps/api/tests/database-route.test.ts`
- Persistent operations and response behavior recorded in `docs/api-v1-contract.md`
- Repository runtime configuration in `AGENTS.md`

The Node API and test harness can demonstrate externally visible persistence behavior with disposable storage and synthetic records. Their internal package implementations and database exports are not schema sources for Rust migrations.

## Storage configuration

<!-- prettier-ignore -->
| Setting | Contract |
| --- | --- |
| Default SQLite path | `~/.srouter/srouter.db`. |
| `DATABASE_PATH` | Overrides the SQLite path. |
| `DATABASE_URL` | Selects PostgreSQL storage when configured. Never point tests at a production URL. |
| Docker SQLite path | `/app/data/srouter.db`, stored on a persistent volume. |

Rust must validate existing storage before applying migrations and must not drop or recreate user data. Tests must use isolated temporary databases; they must never open `~/.srouter/srouter.db`.

## Persistent operations visible through the API

<!-- prettier-ignore -->
| Route group | Observable operation | Data contract established at HTTP boundary |
| --- | --- | --- |
| Admin auth | Create the first admin, create/revoke sessions, change the password, report setup/authentication state. | Request fields and cookie/session outcomes are in `docs/api-v1-contract.md`; internal stored fields and relations are not exposed. |
| API keys | Create, list, update, credit, and delete keys; enforce enabled state, model restrictions, token quota, credit, rate limits, and usage accounting. | API-visible fields include `name`, `enabled`, `rate_limit`, `quota_limit`, `credit_limit`, and `allowed_models`; the persistent schema and relations are unknown. |
| Provider auth and management | Save imported/callback credentials and manage provider connections, model visibility, enabled state, and round-robin behavior. | Route-level inputs and responses are recorded in `docs/api-v1-contract.md`; provider record layout is unknown. |
| Favorites, settings, and fallbacks | Add/remove favorite models, update API-key enforcement and string settings, create/update/delete fallback rules. | Public request and response fields are recorded in `docs/api-v1-contract.md`; table layout and relationships are unknown. |
| Gateway and usage | Reserve quota, execute requests, and expose request logs, usage statistics, analytics, and usage events. | HTTP outcomes and selected log fields are visible in route tests; exact tables, indexes, and transaction boundaries are unknown. |
| Database transfer | Export a snapshot; validate, back up, and replace storage on import. | Transfer protocol, permissions, limits, responses, and error outcomes are specified below. |

This evidence does not establish the complete SQLite or PostgreSQL schema. In particular, it does not identify every table, column, relation, index, migration version, or compatibility constraint required to preserve an existing database. Rust persistence and SQLx migrations must not proceed until an independent schema contract supplies those details and their provenance.

## Database transfer contract

### Export

- `GET /v1/admin/database/export` requires a valid admin-session cookie. An API key or loopback address does not authorize the request.
- Success returns a database snapshot as `application/octet-stream`, with `Content-Length` and an attachment name of `srouter-backup-<UTC timestamp>.db`.
- The controller writes the snapshot to a temporary directory and removes the directory after returning or handling an error.
- PostgreSQL reports transfer as unsupported storage.

### Import

- `POST /v1/admin/database/import` requires a valid admin-session cookie.
- Accept exactly one uploaded file in the multipart field `database`; a filename may appear before or after the field name in `Content-Disposition`.
- Reject a missing file, empty file, non-file value, duplicate file/value, malformed multipart body, invalid database, or incompatible database.
- Limit upload data to 25 MiB. The router's own `Content-Length` guard returns `400` with `upload_too_large`; the main listener's global size middleware returns `413` with `request_too_large` for oversized `Content-Length`; an oversized chunked upload maps to `400` with `upload_too_large`.
- Create a private temporary directory under the SRouter data directory with mode `0700`; create the candidate file with mode `0600`. Remove both on success and failure.
- Validate the candidate before replacing storage. Create a recoverable backup and report restart/reauth requirements after replacement. On success, clear the admin session cookie and return `ok`, `backup_path`, `restart_required`, and `reauth_required`.
- The compatibility expectations are validation-before-replacement, a backup before replacement, and recovery handling if replacement fails. Internal transaction boundaries and crash-recovery guarantees are not exposed by the allowed API sources.

### Transfer error mapping

<!-- prettier-ignore -->
| Condition | Status | Error code |
| --- | --- | --- |
| Unsupported storage backend | `400` | `unsupported_storage` |
| Invalid or incompatible database | `400` | `invalid_database` |
| Invalid multipart body | `400` | `invalid_multipart` |
| Missing `database` file | `400` | `missing_database_file` |
| Non-file, duplicate, or invalid `database` field | `400` | `invalid_database_field` |
| Upload too large, at the route layer | `400` | `upload_too_large` |
| Another import is active | `409` | `database_import_busy` |
| Recovery required after failed replacement | `500` | `database_recovery_failed` |
| Other transfer failure | `500` | `database_transfer_failed` |

Errors use the standard API envelope `{error:{message,type,code?}}`. The main listener's global request-size middleware can reject an oversized `Content-Length` earlier with status `413` and `request_too_large`.

### Database transfer in the Rust build

The Rust port (`server/src/features/database_transfer/`) preserves the wire contract above. Four implementation deviations are documented here because they change observable behavior on edge inputs:

- **Version carrier.** The candidate's schema version is read from `PRAGMA user_version` (4 = current; v4 changes no table shape and only deletes the removed tunnel settings keys), not from the `srouter_schema_meta` marker table, which v2 dropped (`docs/schemas-database.md` §7-F). A candidate reporting a version above 4 is `400 invalid_database`.
- **Legacy candidate migration.** A candidate below `user_version = 3` (v1/v2 marker-table shapes) is migrated on a scratch copy before validation and replacement, so a v1 export is accepted rather than refused. A v3 candidate from an earlier Rust build is validated against the current shape first, then migrated to v4 on the scratch copy. The uploaded bytes are never written to.
- **Streaming parser.** The multipart body is streamed with `axum::extract::Multipart`; Node's hand-rolled boundary parser exists only because `Request.formData()` buffers and is not ported. The wire behavior (one file part named `database`, filename before or after the name, duplicates rejected, 25 MiB enforced while streaming) is unchanged.
- **Transfer lock owner modes.** The `<db>.transfer.lock` file is ported with both owner modes: a `transfer` owner is reclaimed when its pid is dead or recycled, and an `operation` owner (the CLI) always answers `409 database_import_busy` without reclaiming.

One branch is deliberately untested in the Rust suite: the replacement path after the file rename. Exercising it needs a fault hook in the replacement sequence, which is more machinery than the branch justifies, and the Node oracle does not cover it either. The path is written to fail closed: every replacement failure answers `500 database_recovery_failed` (matching Node, `databaseTransfer.ts:495-523`), restoring the retained backup when the rename had already happened and reopening the original otherwise.

The frozen error table above is unchanged.

## Test isolation and evidence

The baseline command for `database-route.test.ts` used `tests/setup.ts`. That setup redirects SQLite to a process-specific temporary file, deletes `DATABASE_URL`, and removes the temporary database at process exit. The route test covers export authorization and headers, import authorization and response fields, multipart parameter ordering, duplicate/missing/invalid/oversized uploads, transfer error mapping, cleanup, and `0700`/`0600` permissions. All 8 baseline cases passed.

The Rust test helper must create unique temporary SQLite databases and remove them after each test. Optional PostgreSQL tests must use an isolated test service/schema and skip when no test service is configured.

## Persistence implementation gate

**Open for schema v3:** The allowed HTTP routes and tests establish operation outcomes but never
the internal schema; the independent schema contract that supplies it is
`docs/schemas-database.md` (provenance: disposable-probe dump of the observed v1 schema plus
API-visible behavior in `docs/api-v1-contract.md`). Schema application is implemented and tested
in `server/migrations/0002_v2_schema.sql`, `server/migrations/0003_request_logs.sql`,
`server/src/infrastructure/database/migrations.rs`,
and `server/tests/schema.rs`. Repository queries may now be written against schema v2 as defined
there; request-log v3 additions and legacy mapping are documented in `docs/schemas-database.md`;
any field or relation outside that contract still requires provenance before use, and
`packages/*`, database exports, and production databases remain forbidden as schema sources.
