import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { sqliteDb } from "./sqlite.js";
import { type DbClient, type DbResult, getDbClient } from "./client.js";

/** Directory holding the SRouter database (and backups) in the user's home directory. */
export const SROUTER_DIR = path.join(os.homedir(), ".srouter");

/** Default database location: ~/.srouter/srouter.db */
export const DEFAULT_DB_PATH = path.join(SROUTER_DIR, "srouter.db");

/** Legacy database locations checked for backward compatibility (relative to cwd). */
export const LEGACY_DB_LOCATIONS = [
    path.resolve(process.cwd(), "apps/api/srouter.db"),
    path.resolve(process.cwd(), "srouter.db")
];

export function getDatabasePath(): string {
    // Allow explicit override via DATABASE_PATH environment variable
    if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;

    // Fallback for legacy installations (keep existing for backward compatibility)
    for (const legacyPath of LEGACY_DB_LOCATIONS) {
        if (fs.existsSync(legacyPath)) return legacyPath;
    }

    // Return new default path and create directory if needed
    return DEFAULT_DB_PATH;
}

// ─────────────────────────────────────────────────────────────
// Compat wrapper — mirrors the node:sqlite statement API but is
// async, so existing query modules only need `await` added.
// For SQLite it wraps DatabaseSync synchronously; for Postgres
// it funnels into PgClient.
// ─────────────────────────────────────────────────────────────

export class CompatStatement {
    constructor(
        private readonly client: DbClient,
        private readonly sql: string
    ) {}

    all(...params: unknown[]): Promise<unknown[]> {
        return this.client.all(this.sql, ...params);
    }

    get(...params: unknown[]): Promise<unknown> {
        return this.client.get(this.sql, ...params);
    }

    run(...params: unknown[]): Promise<DbResult> {
        return this.client.run(this.sql, ...params);
    }
}

export class CompatDb {
    constructor(private readonly client: DbClient) {}

    prepare(sql: string): CompatStatement {
        return new CompatStatement(this.client, sql);
    }

    exec(sql: string): Promise<void> {
        return this.client.exec(sql);
    }
}

// Lazily resolve the client (env may change between import and boot in tests).
function makeCompatDb(): CompatDb {
    return new CompatDb(getDbClient());
}

export const db = makeCompatDb();

// ─────────────────────────────────────────────────────────────
// SQLite connection lifecycle (synchronous — preserves legacy
// boot semantics and avoids test races).
// ─────────────────────────────────────────────────────────────

// Wait up to 5s instead of failing immediately when another connection
// (e.g. a parallel test process or the CLI) holds the write lock.
sqliteDb.exec("PRAGMA busy_timeout = 5000;");

// Enable WAL mode for high performance concurrency.
// Retry briefly — concurrent processes initializing on the same DB file
// (CI runs app test suites in parallel) can transiently hold the lock.
function execWithRetry(sql: string, attempts = 5): void {
    for (let i = 0; i < attempts; i++) {
        try {
            sqliteDb.exec(sql);
            return;
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === "SQLITE_BUSY" && i < attempts - 1) {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (i + 1));
                continue;
            }
            throw error;
        }
    }
}

execWithRetry("PRAGMA journal_mode = WAL;");
execWithRetry("PRAGMA foreign_keys = ON;");
execWithRetry("PRAGMA synchronous = NORMAL;");
execWithRetry("PRAGMA temp_store = MEMORY;");
execWithRetry("PRAGMA cache_size = -20000;");

// ─────────────────────────────────────────────────────────────
// Schema — dialect-aware so PG timestamps use BIGINT (INTEGER
// overflows at ~2.1B; Date.now() is ~1.7T).
// ─────────────────────────────────────────────────────────────

export function isPostgres(): boolean {
    return Boolean(process.env.DATABASE_URL);
}

type ColumnDef = { name: string; definition: string };
type TableDef = { name: string; columns: ColumnDef[] };
type IndexDef = { sql: string };

function tableSql(table: TableDef, pg: boolean): string {
    const cols = table.columns
        .map((c) => `${c.name} ${pg && c.definition.includes("INTEGER") ? "BIGINT" : c.definition}`)
        .join(",\n    ");
    return `CREATE TABLE IF NOT EXISTS ${table.name} (\n    ${cols}\n);`;
}

const TABLES: TableDef[] = [
    {
        name: "providers",
        columns: [
            { name: "id", definition: "TEXT PRIMARY KEY" },
            { name: "provider_id", definition: "TEXT NOT NULL" },
            { name: "name", definition: "TEXT NOT NULL" },
            { name: "alias", definition: "TEXT" },
            { name: "category", definition: "TEXT NOT NULL" },
            { name: "protocol", definition: "TEXT NOT NULL" },
            { name: "base_url", definition: "TEXT" },
            { name: "api_key", definition: "TEXT" },
            { name: "access_token", definition: "TEXT" },
            { name: "refresh_token", definition: "TEXT" },
            { name: "account_id", definition: "TEXT" },
            { name: "organization_id", definition: "TEXT" },
            { name: "provider_specific_data", definition: "TEXT" },
            { name: "custom_headers", definition: "TEXT" },
            { name: "token_expires_at", definition: "INTEGER" },
            { name: "last_refreshed_at", definition: "INTEGER" },
            { name: "enabled", definition: "INTEGER NOT NULL DEFAULT 1" },
            { name: "created_at", definition: "INTEGER NOT NULL" }
        ]
    },
    {
        name: "api_keys",
        columns: [
            { name: "id", definition: "TEXT PRIMARY KEY" },
            { name: "key", definition: "TEXT UNIQUE NOT NULL" },
            { name: "name", definition: "TEXT NOT NULL" },
            { name: "enabled", definition: "INTEGER NOT NULL DEFAULT 1" },
            { name: "rate_limit", definition: "INTEGER DEFAULT 0" },
            { name: "quota_limit", definition: "INTEGER DEFAULT 0" },
            { name: "usage_tokens", definition: "INTEGER DEFAULT 0" },
            { name: "credit_limit", definition: "REAL DEFAULT 0" },
            { name: "usage_cost", definition: "REAL DEFAULT 0" },
            { name: "allowed_models", definition: "TEXT" },
            { name: "created_at", definition: "INTEGER NOT NULL" }
        ]
    },
    {
        name: "request_logs",
        columns: [
            { name: "id", definition: "TEXT PRIMARY KEY" },
            { name: "api_key_id", definition: "TEXT" },
            { name: "provider_id", definition: "TEXT NOT NULL" },
            { name: "model", definition: "TEXT NOT NULL" },
            { name: "prompt_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "completion_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "total_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "status_code", definition: "INTEGER NOT NULL" },
            { name: "latency_ms", definition: "INTEGER NOT NULL" },
            { name: "cached_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "cache_creation_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "reasoning_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "estimated_cost", definition: "REAL NOT NULL DEFAULT 0" },
            { name: "fallback_occurred", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "fallback_path", definition: "TEXT" },
            { name: "fallback_reason", definition: "TEXT" },
            { name: "resolved_model", definition: "TEXT" },
            { name: "created_at", definition: "INTEGER NOT NULL" }
        ]
    },
    {
        name: "oauth_sessions",
        columns: [
            { name: "state", definition: "TEXT PRIMARY KEY" },
            { name: "code_verifier", definition: "TEXT NOT NULL" },
            { name: "client_id", definition: "TEXT NOT NULL" },
            { name: "redirect_uri", definition: "TEXT NOT NULL" },
            { name: "created_at", definition: "INTEGER NOT NULL" }
        ]
    },
    {
        name: "fallback_rules",
        columns: [
            { name: "id", definition: "TEXT PRIMARY KEY" },
            { name: "source_model", definition: "TEXT NOT NULL" },
            { name: "target_model", definition: "TEXT NOT NULL" },
            { name: "priority", definition: "INTEGER NOT NULL DEFAULT 1" },
            { name: "enabled", definition: "INTEGER NOT NULL DEFAULT 1" },
            { name: "trigger_on_status", definition: "TEXT" },
            { name: "max_retries", definition: "INTEGER DEFAULT 1" },
            { name: "created_at", definition: "INTEGER NOT NULL" }
        ]
    },
    {
        name: "system_settings",
        columns: [
            { name: "key", definition: "TEXT PRIMARY KEY" },
            { name: "value", definition: "TEXT NOT NULL" }
        ]
    },
    {
        name: "custom_models",
        columns: [
            { name: "provider_id", definition: "TEXT NOT NULL" },
            { name: "model_id", definition: "TEXT NOT NULL" },
            { name: "created_at", definition: "INTEGER NOT NULL" },
            { name: "PRIMARY KEY (provider_id, model_id)", definition: "" }
        ]
    }
];

const INDEXES: IndexDef[] = [
    { sql: "CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at DESC);" },
    { sql: "CREATE INDEX IF NOT EXISTS idx_request_logs_provider_created ON request_logs(provider_id, created_at DESC);" },
    { sql: "CREATE INDEX IF NOT EXISTS idx_request_logs_provider_model ON request_logs(provider_id, model);" },
    { sql: "CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs(model);" },
    { sql: "CREATE INDEX IF NOT EXISTS idx_fallback_rules_priority ON fallback_rules(priority ASC, created_at ASC);" },
    { sql: "CREATE INDEX IF NOT EXISTS idx_providers_provider_id ON providers(provider_id);" },
    { sql: "CREATE INDEX IF NOT EXISTS idx_custom_models_provider ON custom_models(provider_id, created_at ASC);" }
];

const ADMIN_TABLES = (pg: boolean) => {
    const integer = pg ? "BIGINT" : "INTEGER";
    return `
    CREATE TABLE IF NOT EXISTS admin_account (
        id ${integer} PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        created_at ${integer} NOT NULL,
        updated_at ${integer} NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at ${integer} NOT NULL,
        expires_at ${integer} NOT NULL
    );
`;
};

/**
 * Adds columns to a table if they do not already exist.
 * Declarative replacement for repeated try/catch ALTER TABLE blocks.
 */
async function ensureColumns(table: string, columns: ColumnDef[]): Promise<void> {
    const client = getDbClient();
    const existing = new Set(await client.tableColumns(table));
    for (const col of columns) {
        if (existing.has(col.name)) continue;
        try {
            await client.exec(`ALTER TABLE ${table} ADD COLUMN ${col.definition};`);
            existing.add(col.name);
        } catch (error) {
            const message = (error as Error).message || "";
            if (!message.includes("duplicate column")) {
                throw error;
            }
        }
    }
}

/**
 * Initialize database schema tables if they do not exist.
 * For SQLite this runs synchronously at import (legacy semantics);
 * for Postgres callers await `initDatabase()`.
 */
export function initDatabase(): Promise<void> | void {
    if (isPostgres()) {
        return initPostgresSchema();
    }
    initSqliteSchemaSync();
}

function initSqliteSchemaSync(): void {
    const raw = sqliteDb;
    for (const table of TABLES) {
        raw.exec(tableSql(table, false));
    }
    for (const index of INDEXES) {
        raw.exec(index.sql);
    }
    raw.exec(ADMIN_TABLES(false));

    const ensureSync = (table: string, columns: ColumnDef[]): void => {
        const existing = new Set(
            (raw.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(
                (col) => col.name
            )
        );
        for (const col of columns) {
            if (existing.has(col.name)) continue;
            try {
                raw.exec(`ALTER TABLE ${table} ADD COLUMN ${col.definition};`);
                existing.add(col.name);
            } catch (error) {
                const message = (error as Error).message || "";
                if (!message.includes("duplicate column")) {
                    throw error;
                }
            }
        }
    };

    ensureSync("providers", [
        { name: "alias", definition: "alias TEXT" },
        { name: "refresh_token", definition: "refresh_token TEXT" },
        { name: "account_id", definition: "account_id TEXT" },
        { name: "provider_specific_data", definition: "provider_specific_data TEXT" },
        { name: "token_expires_at", definition: "token_expires_at INTEGER" },
        { name: "last_refreshed_at", definition: "last_refreshed_at INTEGER" },
        { name: "organization_id", definition: "organization_id TEXT" }
    ]);
    ensureSync("api_keys", [
        { name: "allowed_models", definition: "allowed_models TEXT" },
        { name: "credit_limit", definition: "credit_limit REAL DEFAULT 0" },
        { name: "usage_cost", definition: "usage_cost REAL DEFAULT 0" }
    ]);
    ensureSync("request_logs", [
        { name: "cached_tokens", definition: "cached_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "cache_creation_tokens", definition: "cache_creation_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "reasoning_tokens", definition: "reasoning_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "estimated_cost", definition: "estimated_cost REAL NOT NULL DEFAULT 0" },
        { name: "fallback_occurred", definition: "fallback_occurred INTEGER NOT NULL DEFAULT 0" },
        { name: "fallback_path", definition: "fallback_path TEXT" },
        { name: "fallback_reason", definition: "fallback_reason TEXT" },
        { name: "resolved_model", definition: "resolved_model TEXT" }
    ]);
}

async function initPostgresSchema(): Promise<void> {
    const client = getDbClient();
    for (const table of TABLES) {
        await client.exec(tableSql(table, true));
    }
    for (const index of INDEXES) {
        await client.exec(index.sql);
    }
    await client.exec(ADMIN_TABLES(true));
    await ensureColumns("providers", [
        { name: "alias", definition: "alias TEXT" },
        { name: "refresh_token", definition: "refresh_token TEXT" },
        { name: "account_id", definition: "account_id TEXT" },
        { name: "provider_specific_data", definition: "provider_specific_data TEXT" },
        { name: "token_expires_at", definition: "token_expires_at INTEGER" },
        { name: "last_refreshed_at", definition: "last_refreshed_at INTEGER" },
        { name: "organization_id", definition: "organization_id TEXT" }
    ]);
    await ensureColumns("api_keys", [
        { name: "allowed_models", definition: "allowed_models TEXT" },
        { name: "credit_limit", definition: "credit_limit REAL DEFAULT 0" },
        { name: "usage_cost", definition: "usage_cost REAL DEFAULT 0" }
    ]);
    await ensureColumns("request_logs", [
        { name: "cached_tokens", definition: "cached_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "cache_creation_tokens", definition: "cache_creation_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "reasoning_tokens", definition: "reasoning_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "estimated_cost", definition: "estimated_cost REAL NOT NULL DEFAULT 0" },
        { name: "fallback_occurred", definition: "fallback_occurred INTEGER NOT NULL DEFAULT 0" },
        { name: "fallback_path", definition: "fallback_path TEXT" },
        { name: "fallback_reason", definition: "fallback_reason TEXT" },
        { name: "resolved_model", definition: "resolved_model TEXT" }
    ]);
}

// Schema init: synchronous for SQLite (legacy), async for Postgres (fired and awaited by boot).
// For Postgres, boot code must explicitly await initDatabase() before serving.
if (!isPostgres()) {
    initDatabase();
}