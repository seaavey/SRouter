# SRouter database export and import specification

- **Author**: Seaavey & OpenCode
- **Date**: 2026-09-08
- **Status**: Proposed

---

## 1. Purpose

Provide a safe way to move a complete SRouter database from one machine to another through both the dashboard and the CLI.

The transfer format is a SQLite database file. API keys and provider credentials are included in plaintext because the requested workflow is a complete machine migration. Import always replaces the target database after creating a recoverable backup.

This specification covers the first implementation of the feature. It does not introduce a merge mode or a partial-data export.

## 2. Goals

- Export all data owned by the active SRouter SQLite database.
- Import an export file onto another SRouter installation.
- Preserve tables and columns without manually mapping every record.
- Create a backup of the target database before every successful replacement attempt.
- Prevent invalid, incompatible, or arbitrary files from replacing the active database.
- Make the destructive nature of import explicit in the CLI and dashboard.
- Keep the existing LocalStorage backup controls separate from server database migration.

## 3. Non-goals

- PostgreSQL export/import in the first version.
- JSON export of database records.
- Merge import, conflict resolution, or per-table selection.
- Exporting files outside the database, such as provider OAuth browser state or tool configuration files.
- Encrypting the export file. The user explicitly chose plaintext API keys; the UI and CLI must warn that the file is sensitive.
- Automatic remote transfer between two SRouter servers.

If the active database is PostgreSQL, both API and CLI operations must fail with an explicit unsupported-storage error rather than producing a partial export.

## 4. Data contract

### 4.1 Export format

The export is a regular SQLite database file with a `.db` extension. It contains the complete schema and rows from the active SQLite database, including future tables that are present at export time.

The export must be generated from a consistent SQLite snapshot while the server may still be running. The implementation should use SQLite's snapshot-safe backup mechanism, such as `VACUUM INTO` or the equivalent supported database backup operation, and must account for WAL mode.

The exported file must not include temporary WAL or SHM sidecar files. A single downloaded `.db` file is the supported artifact.

### 4.2 Compatibility metadata

The SQLite file itself remains the source of truth. Before import, the implementation checks:

- The file opens successfully as SQLite.
- The file is not the same path as the active target database.
- Required SRouter tables exist.
- The schema version/migration marker is compatible with the running SRouter version.
- The file is below the configured upload limit.

Unknown extra tables are preserved during replacement. Missing required tables reject the import. No SQL script or user-supplied SQL is executed.

## 5. API design

All endpoints are mounted under `/v1` and protected with the existing `RequireAdmin` middleware.

These endpoints must not use `ApiKeyAuth`, bearer API keys, virtual `sr-live-*` keys, or loopback API-key bypass. The admin session cookie (`srouter_admin_session`) is the only supported browser credential. Requests without a valid admin session receive the existing unauthorized response and must not reveal whether a database export exists.

The CLI does not receive or expose a database export endpoint credential. It operates on the local database file and uses the same local admin confirmation policy, with `--yes` as the explicit non-interactive override.

### 5.1 Export

`GET /v1/admin/database/export`

Response on success:

- Status `200`.
- `Content-Type: application/octet-stream`.
- `Content-Disposition: attachment; filename="srouter-backup-<timestamp>.db"`.
- Body contains the SQLite export file.

Failure behavior:

- `400` when the active storage backend is unsupported.
- `500` when the snapshot cannot be produced.
- Errors use the existing `{ error: { message, type } }` envelope.

Authorization acceptance criteria:

- A valid admin session can export the database.
- A valid SRouter API key cannot export the database.
- A request with no credentials cannot export the database.
- A loopback request cannot bypass admin authentication.

### 5.2 Import

`POST /v1/admin/database/import`

Request:

- `multipart/form-data`.
- Field name: `database`.
- One file only.
- The server must not trust the filename or MIME type; SQLite validation is authoritative.

Success response:

```json
{
    "ok": true,
    "backup_path": "~/.srouter/backups/import-backup-<timestamp>.db",
    "restart_required": false
}
```

The implementation should reopen the shared SQLite connection after replacement. If the process cannot safely reopen it in the same request, it must return `restart_required: true` and the UI must clearly instruct the user to restart SRouter before continuing to use the dashboard.

Failure behavior:

- `400` for invalid multipart input, invalid SQLite, incompatible schema, unsupported backend, or oversized upload.
- `409` if an import cannot safely proceed because the database is busy or another migration is active.
- `500` for an unexpected replacement or recovery failure.
- A failed import must leave the original active database in place. If recovery cannot guarantee that, the process must fail closed and report the backup path.

Authorization acceptance criteria:

- A valid admin session can import the database.
- A valid SRouter API key cannot import the database.
- A request with no credentials cannot import the database.
- A loopback request cannot bypass admin authentication.

## 6. Import transaction and recovery flow

The import operation must follow this order:

1. Reject PostgreSQL and concurrent import attempts.
2. Stream the upload to a private temporary file under the SRouter data directory.
3. Apply restrictive permissions to the temporary file.
4. Open the temporary file read-only and validate SQLite integrity with `PRAGMA integrity_check`.
5. Validate required tables and schema compatibility.
6. Close the shared SRouter SQLite connection before changing the active file.
7. Copy or rename the active database to a timestamped backup under `~/.srouter/backups/`.
8. Atomically move the validated temporary database into the active database path.
9. Remove stale WAL/SHM files associated with the target only after the replacement is in place.
10. Reopen and initialize the shared connection.
11. If any step after step 6 fails, restore the target from the backup and reopen it.
12. Delete the temporary upload after success or recovery.

The backup must be retained after a successful import. Cleanup of older backups is out of scope for this feature.

The import lock must cover the full validate/backup/replace/reopen sequence. Export may run concurrently with normal reads, but must not run against a half-replaced target.

## 7. CLI design

Add a dedicated `db` command group:

```text
srouter db export [path]
srouter db import <path>
```

### 7.1 `srouter db export [path]`

- Default path: current directory with a timestamped `srouter-backup-<timestamp>.db` filename.
- Creates parent directories when needed.
- Refuses to overwrite an existing file unless `--force` is provided.
- Prints the output path and warns that it contains plaintext credentials.
- Rejects PostgreSQL with a clear message.

### 7.2 `srouter db import <path>`

- Requires an existing readable file.
- Creates a target backup before replacement.
- Requires an interactive confirmation describing full replacement and plaintext credentials.
- `--yes` skips the confirmation for automation.
- Prints the target backup path and import result.
- Reuses the same validation and recovery service as the API where practical; it must not implement a separate incompatible SQLite-copy algorithm.

The existing `migrate` command remains for legacy/9Router migration. It is not renamed or silently changed into the new database transfer command.

## 8. Dashboard design

Extend the existing Settings `Data` area with a separate server database migration block. Do not conflate it with the current LocalStorage JSON export/import controls.

### 8.1 Export UI

- Button label: `Export Database`.
- Starts a browser download from the authenticated export endpoint.
- Shows a warning that provider credentials and API keys are included.
- Disables the button while the download is starting.
- Shows a success or error toast.

### 8.2 Import UI

- Button label: `Import Database`.
- Accepts `.db` files only.
- Shows selected filename and size before upload.
- Requires a confirmation dialog stating:
  - All current SRouter data will be replaced.
  - API keys and provider credentials from the file will be restored.
  - The current database will be backed up first.
  - The operation cannot be undone from the dashboard.
- Shows upload/progress state and prevents duplicate submissions.
- On success, shows the backup identifier/path and whether restart is required.
- Invalid files and server errors use an actionable toast/message without exposing filesystem internals unnecessarily.

The existing client-side LocalStorage import remains available as a distinct feature with its existing JSON behavior.

## 9. Architecture and file responsibilities

### Database package

Add reusable SQLite database transfer primitives in `packages/db`:

- Resolve the active SQLite path and backend.
- Create a consistent export snapshot.
- Validate an uploaded/import candidate.
- Backup and atomically replace the active database.
- Close and reopen the shared connection after replacement.

All filesystem and SQLite side effects stay in this package or a clearly named database service. API controllers must not contain SQL or file replacement logic.

### API

- Add a database admin controller that adapts HTTP requests/responses to the database transfer service.
- Add a dedicated admin route module mounted under `/v1`.
- Keep authentication in the route via `RequireAdmin`.
- Apply a specific upload size limit appropriate for database files, not an unbounded multipart body.

### Web

- Add API client methods for database export/import.
- Add the migration controls to the existing Settings data section.
- Use TanStack Query mutation patterns for import and toast feedback.
- Do not use a manual `useEffect`/`fetch` state machine for the operation.

### CLI

- Add a small `db` command module and register it in `apps/cli/src/index.ts`.
- Reuse the database package transfer primitives.
- Preserve the existing CLI backup convention and restrictive file permissions.

## 10. Security requirements

- All API endpoints require the existing `RequireAdmin` admin-session middleware. Admin authentication is mandatory even for loopback requests.
- API keys are never accepted as authorization for database export/import. This includes `Authorization: Bearer`, `x-api-key`, virtual `sr-live-*` keys, and API-key bypass settings.
- The frontend must use the authenticated admin session cookie and must not put an admin password, setup token, or API key into an export request URL or downloaded file name.
- Import upload must be streamed or bounded before persistence; never buffer an unbounded file in memory.
- Temporary files and backups use restrictive permissions (`0600` for files, private parent directory where applicable).
- Never log API keys, provider credentials, request bodies, or database contents.
- Do not execute SQL from the uploaded file. Only SQLite opens and schema validation are allowed.
- Protect against path traversal by ignoring user-provided destination paths in the API. The CLI may accept a user path but must resolve it and apply normal filesystem checks.
- Serialize imports so two requests cannot replace the database concurrently.
- Keep the source upload and target backup separate until validation succeeds.
- Warn users that an unencrypted `.db` export is sensitive and should be deleted or protected after transfer.

## 11. Testing and acceptance criteria

### Database package tests

- Export creates a valid SQLite file containing representative provider, API key, settings, custom model, fallback, and log rows.
- Export works while the database is in WAL mode.
- Invalid SQLite files are rejected.
- A database missing a required table is rejected.
- A compatible database replaces the target and all target rows are removed/replaced.
- Target backup is created before replacement.
- Replacement failure restores the original target database.
- Temporary files are removed after success and recovery.
- Concurrent imports are rejected or serialized deterministically.
- PostgreSQL is rejected with the documented unsupported error.

### API tests

- Export requires admin authentication.
- Export response has the expected download headers.
- Import requires admin authentication.
- Import rejects missing files, oversized files, invalid SQLite, and incompatible schema.
- Import returns backup metadata and restart state.
- API keys survive an export/import round trip.

### CLI tests

- Export writes the requested/default path and refuses overwrite without `--force`.
- Import requires confirmation unless `--yes` is supplied.
- Import creates a target backup and reports its path.
- CLI and API use the same database transfer behavior.

### Web tests

- Export starts a download and reports failures.
- Import requires a file and explicit destructive confirmation.
- Loading state prevents duplicate import submissions.
- Successful import displays backup/restart information.
- The existing LocalStorage JSON import/export remains unaffected.

### Acceptance criteria

The feature is complete when a user can:

1. Export a database from machine A in the dashboard or CLI.
2. Move the single `.db` file to machine B.
3. Import it on machine B after an explicit confirmation.
4. See the previous machine B database preserved as a backup.
5. Use the restored providers, credentials, settings, custom models, and other database-backed records on machine B.
6. Receive a clear error and no destructive change when the file is invalid or incompatible.

## 12. Open implementation note

The first implementation is SQLite-only because the current transfer artifact and database runtime are SQLite-oriented. PostgreSQL support requires a separate logical dump/restore format and should be specified independently rather than silently converting PostgreSQL data into an incomplete SQLite file.
