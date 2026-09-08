# SRouter Database Export and Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow administrators to export and fully replace an SRouter SQLite database from both the dashboard and CLI, with automatic target backups and strict admin-session protection.

**Architecture:** Put SQLite snapshot, validation, backup, replacement, recovery, and connection lifecycle logic in `@srouter/db`. Add a thin admin-only API route/controller around that service, reuse the same package from a local CLI `db` command, and add dedicated database migration controls beside the existing LocalStorage controls in the web Settings page.

**Tech Stack:** Node.js 22 `node:sqlite`, Hono 4, native multipart handling, Commander.js, `@clack/prompts`, React 19, TanStack Query, existing admin session cookie, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-08-database-export-import-design.md`

## Global Constraints

- API endpoints mount under `/v1` and use `RequireAdmin`; API keys, virtual keys, and loopback bypass are never accepted.
- SQLite is the only supported backend for this feature; PostgreSQL returns an explicit unsupported-storage error.
- Import is replace-only, creates a target backup first, and never executes SQL supplied by the uploaded file.
- Provider credentials and API keys are included in the export; UI and CLI warn that the artifact is sensitive plaintext data.
- Temporary files and database backups use restrictive file permissions and are removed only after success or recovery.
- Routes stay thin; database I/O stays in `packages/db`; controllers adapt HTTP to domain/service calls.
- Use parameterized SQL for values and quote validated table identifiers when operating on SQLite metadata.
- Do not run root or whole-monorepo build, lint, or test commands. Verify only touched packages/apps.
- Preserve the existing client-side LocalStorage JSON import/export as a separate feature.

## File Map

- Create `packages/db/src/databaseTransfer.ts`: SQLite-only export, validation, backup, replacement, recovery, import lock, and result/error contracts.
- Modify `packages/db/src/sqlite.ts`: expose safe connection lifecycle and active SQLite path helpers needed by transfer operations.
- Modify `packages/db/src/index.ts`: export the transfer service and public types.
- Create `packages/db/tests/databaseTransfer.test.ts`: isolated database export/import/recovery tests.
- Create `apps/api/src/controllers/database.controller.ts`: admin HTTP adapter for download and multipart import.
- Create `apps/api/src/routes/v1/database.ts`: admin-only database routes.
- Modify `apps/api/src/index.ts`: mount the new database router.
- Create `apps/api/tests/database-route.test.ts`: auth, headers, upload validation, and round-trip endpoint tests.
- Create `apps/cli/src/commands/database.ts`: `db export` and `db import` command handlers.
- Modify `apps/cli/src/index.ts`: register the `db` command group.
- Create or extend `apps/cli/tests/database.test.ts`: local CLI command behavior and confirmation tests.
- Modify `apps/web/src/lib/api.ts`: authenticated database export and import helpers.
- Modify `apps/web/src/components/settings/settings.data.tsx`: database migration controls, warning, file picker, loading, success, and error states.
- Modify the Settings route/container that constructs `DataSettings`: pass the new database handlers without mixing them into LocalStorage state.
- Add or extend the relevant web test file near the Settings components: download trigger, file validation, confirmation, mutation states, and existing LocalStorage regression.

---

### Task 1: Build the SQLite Transfer Service

**Files:**
- Create: `packages/db/src/databaseTransfer.ts`
- Modify: `packages/db/src/sqlite.ts:87-133`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/databaseTransfer.test.ts`

**Interfaces:**
- Produces `exportDatabaseSnapshot(outputPath: string): DatabaseTransferExportResult`.
- Produces `validateDatabaseImport(candidatePath: string): DatabaseTransferValidation`.
- Produces `replaceDatabaseFromFile(candidatePath: string): DatabaseTransferImportResult`.
- Produces typed errors for unsupported backend, invalid SQLite, incompatible schema, busy import, and recovery failure.
- `DatabaseTransferImportResult` contains `backupPath: string` and `restartRequired: boolean`.
- `DatabaseTransferValidation` contains `requiredTables: string[]`, `schemaCompatible: boolean`, and `integrityOk: boolean`.

- [ ] **Step 1: Write failing isolated database tests**

Create a temporary `DATABASE_PATH` database using the existing test setup pattern. Initialize representative rows in providers, API keys, settings, custom models, fallbacks, and logs. Cover these cases:

```ts
test("exports a valid snapshot while WAL mode is active", () => {
    const result = exportDatabaseSnapshot(exportPath);
    assert.equal(result.format, "sqlite");
    assert.ok(fs.existsSync(exportPath));
    const exported = new DatabaseSync(exportPath);
    assert.equal(exported.prepare("PRAGMA integrity_check").get(), { integrity_check: "ok" });
    assert.equal(exported.prepare("SELECT COUNT(*) AS count FROM providers").get().count, 1);
});

test("rejects invalid sqlite and missing required tables", () => {
    fs.writeFileSync(invalidPath, "not a database");
    assert.throws(() => validateDatabaseImport(invalidPath), InvalidDatabaseImportError);

    const incomplete = createSqlite(incompletePath, "CREATE TABLE providers (id TEXT)");
    assert.throws(() => validateDatabaseImport(incomplete), IncompatibleDatabaseError);
});

test("backs up and replaces every target table", () => {
    const result = replaceDatabaseFromFile(sourcePath);
    assert.ok(fs.existsSync(result.backupPath));
    assert.equal(readProviderApiKey(), sourceApiKey);
    assert.equal(readTargetOnlyRow(), undefined);
});

test("restores the original target when replacement fails", () => {
    injectReplacementFailure();
    assert.throws(() => replaceDatabaseFromFile(sourcePath), DatabaseRecoveryError);
    assert.equal(readProviderApiKey(), targetApiKey);
});

test("rejects a second import while an import is active", async () => {
    const first = startImportWithBarrier(sourcePath);
    assert.throws(() => replaceDatabaseFromFile(otherPath), DatabaseImportBusyError);
    releaseBarrier(first);
});
```

Use the actual existing schema table names discovered in `packages/db/src/db.ts`; do not invent fixture tables. The test helper for injected failure must be test-only dependency injection or a narrowly scoped internal hook, not production behavior.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd packages/db && pnpm exec tsx --test tests/databaseTransfer.test.ts`

Expected: FAIL because the transfer functions and result/error types do not exist yet.

- [ ] **Step 3: Add connection lifecycle primitives**

In `packages/db/src/sqlite.ts`, add a public function that closes the singleton and a function that reopens the current database path through the existing lazy path resolution. Ensure transfer code never copies the active file while its connection is open. Preserve the test guard that prevents tests from targeting `~/.srouter/srouter.db`.

- [ ] **Step 4: Implement a consistent SQLite snapshot**

Implement `exportDatabaseSnapshot` using a SQLite-supported snapshot operation such as `VACUUM INTO` on a read-safe connection or an equivalent backup path. Resolve the output path, refuse an output equal to the active database path, create the parent directory, write with mode `0600`, and do not create a user-visible WAL/SHM artifact. Return the output path and file size.

- [ ] **Step 5: Implement import validation**

Open candidates read-only, run `PRAGMA integrity_check`, enumerate non-system tables, verify every required SRouter table from the initialized schema, and compare the schema/migration marker used by this repository. Reject malformed, incomplete, oversized-at-service-boundary, or incompatible files with typed errors. Never execute candidate SQL text.

- [ ] **Step 6: Implement backup, atomic replace, reopen, and recovery**

Serialize imports with a module-level lock. Validate first, close the shared connection, copy the current database to `~/.srouter/backups/import-backup-<timestamp>.db` with mode `0600`, atomically replace the target using a same-directory temporary/rename sequence, remove only target WAL/SHM sidecars after the replacement, reopen and initialize the shared connection, and remove the upload/candidate temporary file. On any post-close failure, restore the backup and reopen it before throwing a recovery error.

- [ ] **Step 7: Export package APIs and run focused tests**

Export only the public transfer functions/types from `packages/db/src/index.ts`. Run:

```bash
cd packages/db && pnpm run build
cd packages/db && pnpm exec tsx --test tests/databaseTransfer.test.ts
```

Expected: build passes and all transfer tests pass, including WAL, invalid file, replacement, recovery, lock, permissions, and cleanup cases.

- [ ] **Step 8: Commit the package deliverable**

```bash
git add packages/db/src/sqlite.ts packages/db/src/databaseTransfer.ts packages/db/src/index.ts packages/db/tests/databaseTransfer.test.ts
git commit -m "feat: add sqlite database transfer service"
```

### Task 2: Add Admin-Only API Endpoints

**Files:**
- Create: `apps/api/src/controllers/database.controller.ts`
- Create: `apps/api/src/routes/v1/database.ts`
- Modify: `apps/api/src/index.ts:123-137`
- Test: `apps/api/tests/database-route.test.ts`

**Interfaces:**
- `GET /v1/admin/database/export` returns a SQLite attachment.
- `POST /v1/admin/database/import` accepts one multipart field named `database`.
- Both routes use `RequireAdmin` and never use `ApiKeyAuth`.
- Import returns `{ ok: true, backup_path: string, restart_required: boolean }`.

- [ ] **Step 1: Write failing route tests**

Add tests for:

```ts
test("database export requires an admin session", async () => {
    assert.equal((await app.request("/v1/admin/database/export")).status, 401);
    assert.equal((await requestWithApiKey("/v1/admin/database/export")).status, 401);
    const response = await requestWithAdminSession("/v1/admin/database/export");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/octet-stream/);
    assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
});

test("database import replaces data through an admin session only", async () => {
    const form = new FormData();
    form.set("database", new File([await readFile(exportPath)], "source.db"));
    const response = await requestWithAdminSession("/v1/admin/database/import", {
        method: "POST",
        body: form
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        ok: true,
        backup_path: assert.any(String),
        restart_required: false
    });
});
```

Also test missing field, non-SQLite file, missing required table, oversized body, API-key auth, and loopback without admin session. Use the existing API auth/test setup and do not bypass middleware by calling the controller directly for auth cases.

- [ ] **Step 2: Run the focused route test and confirm failure**

Run: `cd apps/api && pnpm exec tsx --test tests/database-route.test.ts`

Expected: FAIL because the route is not mounted.

- [ ] **Step 3: Implement the controller adapter**

The export controller calls the database package, sets `Content-Type`, `Content-Length`, and a sanitized timestamped `Content-Disposition`, then returns the file bytes/stream. The import controller reads only the `database` multipart file, writes it to a private temporary path with bounded size, calls package validation/replacement, removes the temporary file in a `finally` block, and maps typed package errors to `400`, `409`, or `500` without exposing credentials or arbitrary filesystem details.

- [ ] **Step 4: Implement and mount the route**

Create a dedicated `DatabaseRouter`, attach `RequireAdmin` directly to both routes, and mount it with `app.route("/v1", DatabaseRouter)`. Apply the specific upload limit before buffering multipart content. Keep the route free of SQL and filesystem replacement logic.

- [ ] **Step 5: Run API verification**

Run:

```bash
cd apps/api && pnpm exec tsx --test tests/database-route.test.ts
cd apps/api && pnpm run build
```

If a local API instance is available, smoke-test the mounted path with an unauthenticated request and confirm it returns unauthorized rather than a file or database detail.

- [ ] **Step 6: Commit the API deliverable**

```bash
git add apps/api/src/controllers/database.controller.ts apps/api/src/routes/v1/database.ts apps/api/src/index.ts apps/api/tests/database-route.test.ts
git commit -m "feat: expose admin database transfer endpoints"
```

### Task 3: Add CLI Database Commands

**Files:**
- Create: `apps/cli/src/commands/database.ts`
- Modify: `apps/cli/src/index.ts:158-166`
- Test: `apps/cli/tests/database.test.ts`

**Interfaces:**
- `srouter db export [path] [--force]` writes a local SQLite snapshot.
- `srouter db import <path> [--yes]` validates and replaces the local database.
- CLI uses `@clack/prompts` for confirmation and the shared `@srouter/db` transfer service.

- [ ] **Step 1: Write failing command tests**

Cover default timestamped output, explicit output path, refusal to overwrite without `--force`, import confirmation, `--yes`, invalid file rejection, target backup reporting, and plaintext credential warning. Use an isolated `DATABASE_PATH` and capture CLI output instead of touching the production home database.

- [ ] **Step 2: Run the focused CLI test and confirm failure**

Run: `cd apps/cli && pnpm exec tsx --test tests/database.test.ts`

Expected: FAIL because the `db` command group is not registered.

- [ ] **Step 3: Implement export and import handlers**

Use the database package functions rather than copying SQLite files directly. Resolve relative paths against the current working directory, create parent directories, use `0600`, reject overwrite unless `--force`, and print only paths/status, never database content. Import confirmation must state that all target data is replaced and credentials are included. `--yes` is the explicit automation override.

- [ ] **Step 4: Register the Commander command group**

Register `db` with nested `export` and `import` commands while leaving the existing `migrate` command unchanged for legacy/9Router migration.

- [ ] **Step 5: Run CLI verification**

Run:

```bash
cd apps/cli && pnpm exec tsx --test tests/database.test.ts
cd apps/cli && pnpm run build
```

- [ ] **Step 6: Commit the CLI deliverable**

```bash
git add apps/cli/src/commands/database.ts apps/cli/src/index.ts apps/cli/tests/database.test.ts
git commit -m "feat: add database transfer cli commands"
```

### Task 4: Add Dashboard Database Migration Controls

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/settings/settings.data.tsx`
- Modify: the Settings route/container that constructs `DataSettings`
- Test: the existing Settings component test location, or create `apps/web/tests/settings-data.test.tsx` if no current component test exists

**Interfaces:**
- `api.exportDatabase(): Promise<Blob>` performs an authenticated admin-session download.
- `api.importDatabase(file: File): Promise<{ ok: true; backup_path: string; restart_required: boolean }>` uploads one `.db` file.
- `DataSettings` receives database export/import callbacks independently from LocalStorage callbacks.

- [ ] **Step 1: Write failing web tests**

Test that:

- `Export Database` calls the API and triggers a browser download.
- `Import Database` accepts `.db` only and rejects missing/non-`.db` files.
- Confirmation explicitly describes full replacement and plaintext credentials.
- Import disables controls during upload and prevents duplicate submissions.
- Success shows backup and restart information.
- API failure shows an error toast/state.
- Existing LocalStorage JSON export/import still works.

Use mocked API methods and the existing UI test setup. Do not add a second generic fetch state machine.

- [ ] **Step 2: Run the focused web test and confirm failure**

Run the repository's existing web test command for the single test file, for example:

```bash
cd apps/web && pnpm exec vitest run tests/settings-data.test.tsx
```

Expected: FAIL because database controls and API methods do not exist.

- [ ] **Step 3: Add API client helpers**

Use the existing normalized `/v1` API client and browser credentials behavior. Export must preserve the binary response as a `Blob`; import must send `FormData` without manually setting a multipart boundary. Map non-2xx responses to the client's existing error shape.

- [ ] **Step 4: Add a separate database migration block to Settings**

Keep the current LocalStorage section and JSON dialog unchanged. Add a clearly separated server database area with `Export Database` and `Import Database` controls. The purpose is operational data migration, so copy should be concise and factual, not marketing copy. Use existing semantic tokens and dialog/button primitives.

- [ ] **Step 5: Add import confirmation and all UI states**

Use a keyboard-accessible dialog with Escape close, explicit destructive wording, selected file name/size, loading state, success state with backup path and restart instruction, and actionable error state. Keep controls usable on mobile without horizontal overflow. Do not expose the admin password, setup token, API key, or database contents in the UI.

- [ ] **Step 6: Run web verification**

Run the focused test and the touched web build:

```bash
cd apps/web && pnpm exec vitest run tests/settings-data.test.tsx
cd apps/web && pnpm run build
```

Manually verify the Settings section in both themes and a narrow mobile viewport if a browser runner is available. Record export, invalid import, confirmation cancel, successful import, and server error behavior.

- [ ] **Step 7: Commit the web deliverable**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/settings/settings.data.tsx <settings-container-file> <settings-test-file>
git commit -m "feat: add database transfer controls to settings"
```

### Task 5: End-to-End Verification and Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-database-export-import-design.md` only if implementation decisions differ from the approved spec
- Modify: the relevant CLI/API usage documentation if the repository has a current command reference
- Test: touched package test files from Tasks 1-4

- [ ] **Step 1: Run all touched package tests individually**

Run only the package/app suites affected by this feature:

```bash
cd packages/db && pnpm test
cd apps/api && pnpm exec tsx --test tests/database-route.test.ts
cd apps/cli && pnpm exec tsx --test tests/database.test.ts
cd apps/web && pnpm exec vitest run tests/settings-data.test.tsx
```

- [ ] **Step 2: Build only touched packages/apps**

```bash
cd packages/db && pnpm run build
cd apps/api && pnpm run build
cd apps/cli && pnpm run build
cd apps/web && pnpm run build
```

- [ ] **Step 3: Run the API smoke check**

Against a running local instance, verify:

```bash
curl -i http://localhost:3000/v1/admin/database/export
curl -i -H "x-api-key: sr-live-test" http://localhost:3000/v1/admin/database/export
```

Both must be unauthorized without a valid admin session. With an authenticated admin session, export must return a download response and import must return backup metadata.

- [ ] **Step 4: Review security and diff**

Run `git diff --check`, inspect that no credentials or database artifacts were added to the repository, confirm temporary files are cleaned, and verify routes use `RequireAdmin` directly. Check the UI in light/dark mode and mobile layout.

- [ ] **Step 5: Commit documentation/verification updates**

```bash
git add docs/superpowers/specs/2026-09-08-database-export-import-design.md <updated-doc-files>
git commit -m "docs: document database transfer workflow"
```

## Self-Review Checklist

- [ ] Every spec section has a corresponding task: SQLite format, validation, backup/recovery, API, CLI, web, admin auth, security, and tests.
- [ ] No task asks the implementer to invent a file path, function name, or error contract; all cross-task interfaces are named above.
- [ ] No merge behavior or PostgreSQL support is accidentally introduced.
- [ ] API key auth and loopback bypass are explicitly tested as rejected.
- [ ] Existing `migrate` and LocalStorage import/export behavior remains separate.
- [ ] Verification commands are package-scoped and comply with SRouter resource limits.
