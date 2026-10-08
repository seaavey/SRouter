# `@srouter/db` (retired)

The Node persistence layer: SQLite through `node:sqlite` and PostgreSQL through `pg`, with one
repository module per aggregate. Version 0.1.8, dependencies `pg`, `@srouter/constants`,
`@srouter/types`, 20 files and 3308 lines across `src/` and `tests/`.

Preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`).

## Modules

`db.ts`, `sqlite.ts`, `client.ts`, `adminAuth.ts`, `apiKeys.ts`, `providers.ts`, `OAuthSessions.ts`,
`settings.ts`, `fallbacks.ts`, `tokenSaver.ts`, `customModels.ts`, `hiddenModels.ts`,
`favoriteModels.ts`, `logs.ts`, `row-utils.ts`, `databaseTransfer.ts`, `transferLock.ts`.

`databaseTransfer.ts` and `transferLock.ts` carried the snapshot and replacement routines: a
consistent `VACUUM INTO` export, a header and integrity check on import, a pre-replacement backup,
and the operation lock that kept a running server from writing during a transfer.

## Who imported it

`apps/cli` only: `src/commands/init.ts` (`SROUTER_DIR`), `src/commands/migrate.ts`
(`getDatabasePath`, `initDatabase`, `LEGACY_DB_LOCATIONS`), `src/commands/database.ts`
(`exportDatabaseSnapshot`, `replaceDatabaseFromFile`, `validateDatabaseImport`), and the CLI tests.
Nothing else in the workspace read it, which is why the packages could not simply be deleted: the
CLI's database commands stood on it.

## Why it is gone

The Rust crate owns the database. `server/src/infrastructure/database/` holds the repositories, and
`migrations.rs` owns the schema: version 4 at removal, applied on connect, with legacy v1 files
transformed in one transaction. A second implementation of the same schema in TypeScript, with its
own migration path and its own default database path, is exactly the kind of drift the migration
removed (its default path still pointed at `apps/api/srouter.db`).

## Replacement

| Used to get | Now |
| --- | --- |
| Repository access | `server/src/infrastructure/database/` |
| Schema and migrations | `server/src/infrastructure/database/migrations.rs` (schema v4) |
| Database export and import | `GET`/`POST /v1/admin/database/export` and `/import`, documented in `docs/api-database-contract.md` |
| CLI database commands | `apps/cli/src/lib/database.ts` (local SQLite file handling, no schema ownership) |

## Recovery

```bash
git show backup/pre-packages-removal:packages/db/src/databaseTransfer.ts
```
