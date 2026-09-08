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

test("rejects a second import while an import is active", () => {
    const sourcePath = path.join(testDirectory, "busy-source.db");
    const source = createDatabase(sourcePath);
    source.close();
    addProvider(sourcePath, "busy-source", "busy-key");
    transferTestHooks.setDatabaseTransferTestHook(() => database.replaceDatabaseFromFile(sourcePath));

    assert.throws(
        () => database.replaceDatabaseFromFile(sourcePath),
        database.DatabaseImportBusyError
    );
});
