---
layout: ../../../layouts/DocsLayout.astro
title: Database
description: Understand SQLite defaults, PostgreSQL support, schema initialization, and transfer.
section: Project
---

## Defaults

SRouter uses SQLite at `~/.srouter/srouter.db` by default and enables WAL mode. Set `DATABASE_PATH` to use another SQLite file or `DATABASE_URL` to use PostgreSQL.

The database package handles initialization, queries, and transfer helpers. The declarative schema lives in `packages/db/src/db.ts`.

## Database transfer

The API exposes admin-protected database export and import operations under `/v1/admin/database/*`. The CLI exposes the same operational surface through its nested `database export` and `database import` commands.

```bash
srouter database export ./backup.json
srouter database import ./backup.json
```

Import is validated and protected by an upload-size guard before the candidate replaces the active database. Do not copy a live SQLite file while it is being written; use the transfer path or a SQLite-aware backup process.

## Schema changes

Schema initialization is declarative. Non-automatic changes must be documented in `DB-MIGRATION.md` and include a safe migration or compatibility path. Keep production data handling separate from test databases by using the repository test setup.

## Source map

- Database entrypoint: `packages/db/src/index.ts`
- Schema and initialization: `packages/db/src/db.ts`
- SQLite adapter: `packages/db/src/sqlite.ts`
- Transfer: `packages/db/src/databaseTransfer.ts`
- API route: `apps/api/src/routes/v1/database.ts`
- CLI command: `apps/cli/src/commands/database.ts`
