import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "srouter-db-transfer-"));
const targetPath = path.join(testDirectory, "target.db");
process.env.DATABASE_PATH = targetPath;
process.env.NODE_ENV = "test";

const database = await import("../src/index.js");
const transferTestHooks = await import("../src/databaseTransfer.js");

function createDatabase(filePath: string): DatabaseSync {
    const db = new DatabaseSync(filePath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
        CREATE TABLE providers (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, name TEXT NOT NULL, alias TEXT, category TEXT NOT NULL, protocol TEXT NOT NULL, base_url TEXT, api_key TEXT, access_token TEXT, refresh_token TEXT, account_id TEXT, organization_id TEXT, provider_specific_data TEXT, custom_headers TEXT, token_expires_at INTEGER, last_refreshed_at INTEGER, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
        CREATE TABLE api_keys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, rate_limit INTEGER DEFAULT 0, quota_limit INTEGER DEFAULT 0, usage_tokens INTEGER DEFAULT 0, credit_limit REAL DEFAULT 0, usage_cost REAL DEFAULT 0, allowed_models TEXT, created_at INTEGER NOT NULL);
        CREATE TABLE request_logs (id TEXT PRIMARY KEY, api_key_id TEXT, ip_address TEXT, user_agent TEXT, provider_id TEXT NOT NULL, model TEXT NOT NULL, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, status_code INTEGER NOT NULL, latency_ms INTEGER NOT NULL, cached_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost REAL NOT NULL DEFAULT 0, fallback_occurred INTEGER NOT NULL DEFAULT 0, fallback_path TEXT, fallback_reason TEXT, resolved_model TEXT, created_at INTEGER NOT NULL);
        CREATE TABLE oauth_sessions (state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE fallback_rules (id TEXT PRIMARY KEY, source_model TEXT NOT NULL, target_model TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, trigger_on_status TEXT, max_retries INTEGER DEFAULT 1, created_at INTEGER NOT NULL);
        CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE custom_models (provider_id TEXT NOT NULL, model_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (provider_id, model_id));
        CREATE TABLE admin_account (id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE srouter_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO srouter_schema_meta (key, value) VALUES ('schema_version', '1');
    `);
    return db;
}

function addProvider(filePath: string, providerId: string, apiKey: string): void {
    const db = new DatabaseSync(filePath);
    db.prepare(
        "INSERT INTO providers (id, provider_id, name, category, protocol, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(providerId, providerId, providerId, "chat", "openai", apiKey, Date.now());
    db.close();
}

test.after(() => {
    database.closeSqliteDb();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test("exports a valid snapshot while WAL mode is active", () => {
    database.getSqliteDb().prepare(
        "INSERT INTO providers (id, provider_id, name, category, protocol, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("target", "target", "Target", "chat", "openai", "target-key", Date.now());
    const exportPath = path.join(testDirectory, "export.db");

    const result = database.exportDatabaseSnapshot(exportPath);

    assert.equal(result.format, "sqlite");
    assert.equal(result.path, exportPath);
    assert.ok(result.size > 0);
    const exported = new DatabaseSync(exportPath, { readOnly: true });
    assert.equal(exported.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(exported.prepare("SELECT COUNT(*) AS count FROM providers").get().count, 1);
    exported.close();
    assert.equal(fs.statSync(exportPath).mode & 0o777, 0o600);
});

test("rejects invalid sqlite and missing required tables", () => {
    const invalidPath = path.join(testDirectory, "invalid.db");
    fs.writeFileSync(invalidPath, "not a database");
    assert.throws(() => database.validateDatabaseImport(invalidPath), database.InvalidDatabaseImportError);

    const incompletePath = path.join(testDirectory, "incomplete.db");
    const incomplete = new DatabaseSync(incompletePath);
    incomplete.exec("CREATE TABLE providers (id TEXT)");
    incomplete.close();
    assert.throws(
        () => database.validateDatabaseImport(incompletePath),
        database.IncompatibleDatabaseError
    );

    const incompatiblePath = path.join(testDirectory, "incompatible.db");
    const incompatible = createDatabase(incompatiblePath);
    incompatible.exec("ALTER TABLE providers RENAME TO providers_old");
    incompatible.exec(
        "CREATE TABLE providers (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, protocol TEXT NOT NULL, created_at INTEGER NOT NULL)"
    );
    incompatible.close();
    assert.throws(
        () => database.validateDatabaseImport(incompatiblePath),
        database.IncompatibleDatabaseError
    );
});

test("uses the stable transfer contract instead of a drifted target schema", () => {
    const canonicalPath = path.join(testDirectory, "canonical-schema.db");
    const canonical = createDatabase(canonicalPath);
    canonical.close();
    database.getSqliteDb().exec("ALTER TABLE providers ADD COLUMN target_only_drift TEXT");

    assert.equal(database.validateDatabaseImport(canonicalPath).schemaCompatible, true);

    const wrongMarker = path.join(testDirectory, "wrong-marker.db");
    const marked = createDatabase(wrongMarker);
    marked.prepare("UPDATE srouter_schema_meta SET value = ? WHERE key = ?").run("2", "schema_version");
    marked.close();
    assert.throws(
        () => database.validateDatabaseImport(wrongMarker),
        database.IncompatibleDatabaseError
    );
});

test("does not remove an existing export when snapshot creation fails", () => {
    const outputPath = path.join(testDirectory, "existing-export.db");
    fs.writeFileSync(outputPath, "keep this file");
    transferTestHooks.setDatabaseTransferTestFailure("export-before-rename");

    assert.throws(() => database.exportDatabaseSnapshot(outputPath));
    assert.equal(fs.readFileSync(outputPath, "utf8"), "keep this file");
});

test("backs up and replaces every target table", () => {
    const sourcePath = path.join(testDirectory, "source.db");
    const source = createDatabase(sourcePath);
    source.close();
    addProvider(sourcePath, "source", "source-key");
    addProvider(targetPath, "target-only", "target-key");

    const result = database.replaceDatabaseFromFile(sourcePath);
    const target = database.getSqliteDb();

    assert.ok(fs.existsSync(result.backupPath));
    assert.equal(target.prepare("SELECT api_key FROM providers").get().api_key, "source-key");
    assert.equal(target.prepare("SELECT id FROM providers WHERE id = ?").get("target-only"), undefined);
    assert.equal(result.restartRequired, false);
});

test("restores the original target when replacement fails", () => {
    const sourcePath = path.join(testDirectory, "failing-source.db");
    const source = createDatabase(sourcePath);
    source.close();
    addProvider(sourcePath, "replacement", "replacement-key");
    transferTestHooks.setDatabaseTransferTestFailure("after-backup");

    assert.throws(
        () => database.replaceDatabaseFromFile(sourcePath),
        database.DatabaseRecoveryError
    );
    assert.equal(
        database.getSqliteDb().prepare("SELECT api_key FROM providers").get().api_key,
        "source-key"
    );
});

test("restores the original target when reopening the replacement fails", () => {
    const sourcePath = path.join(testDirectory, "reopen-failure-source.db");
    const source = createDatabase(sourcePath);
    source.close();
    addProvider(sourcePath, "reopen-failure", "reopen-failure-key");
    transferTestHooks.setDatabaseTransferTestFailure("after-reopen");

    assert.throws(
        () => database.replaceDatabaseFromFile(sourcePath),
        database.DatabaseRecoveryError
    );
    assert.equal(
        database.getSqliteDb().prepare("SELECT api_key FROM providers").get().api_key,
        "source-key"
    );
});

test("rejects an import while another process owns the transfer lock", () => {
    const sourcePath = path.join(testDirectory, "busy-source.db");
    const source = createDatabase(sourcePath);
    source.close();
    addProvider(sourcePath, "busy-source", "busy-key");
    const lockPath = `${targetPath}.transfer.lock`;
    fs.writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600 });

    assert.throws(() => database.replaceDatabaseFromFile(sourcePath), database.DatabaseImportBusyError);
    fs.rmSync(lockPath);
});

test("treats EPERM from the owner probe as busy", () => {
    const lockPath = `${targetPath}.transfer.lock`;
    fs.writeFileSync(
        lockPath,
        `${JSON.stringify({ pid: process.pid + 1, start: "owner-start", token: "owner-token" })}\n`,
        { mode: 0o600 }
    );
    transferTestHooks.setDatabaseTransferTestOwnerProbe("eperm");

    assert.throws(
        () => database.exportDatabaseSnapshot(path.join(testDirectory, "eperm-export.db")),
        database.DatabaseImportBusyError
    );
    assert.equal(fs.existsSync(lockPath), true);
    fs.rmSync(lockPath);
    transferTestHooks.setDatabaseTransferTestOwnerProbe(null);
});

test("public validation respects an active transfer lock", () => {
    const sourcePath = path.join(testDirectory, "validation-lock-source.db");
    const source = createDatabase(sourcePath);
    source.close();
    const lockPath = `${targetPath}.transfer.lock`;
    const stat = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    fs.writeFileSync(
        lockPath,
        `${JSON.stringify({ pid: process.pid, start, token: "validation-owner" })}\n`,
        { mode: 0o600 }
    );

    assert.throws(
        () => database.validateDatabaseImport(sourcePath),
        database.DatabaseImportBusyError
    );
    fs.rmSync(lockPath);
});

test("does not release a lock replaced by another owner", () => {
    const outputPath = path.join(testDirectory, "release-owner-export.db");
    const stat = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    transferTestHooks.setDatabaseTransferTestFailure("export-before-rename");
    transferTestHooks.setDatabaseTransferTestReleaseReplacement("new-owner-token");

    assert.throws(() => database.exportDatabaseSnapshot(outputPath));
    assert.equal(
        fs.readFileSync(`${targetPath}.transfer.lock`, "utf8"),
        `${JSON.stringify({ pid: process.pid, start, token: "new-owner-token" })}\n`
    );
    fs.rmSync(`${targetPath}.transfer.lock`);
});
