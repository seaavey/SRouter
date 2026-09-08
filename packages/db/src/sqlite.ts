import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

/** Directory holding the SRouter database (and backups) in the user's home directory. */
export const SROUTER_DIR = path.join(os.homedir(), ".srouter");

/** Default database location: ~/.srouter/srouter.db */
export const DEFAULT_DB_PATH = path.join(SROUTER_DIR, "srouter.db");

/** Legacy database locations checked for backward compatibility (relative to cwd). */
export const LEGACY_DB_LOCATIONS = [
    path.resolve(process.cwd(), "apps/api/srouter.db"),
    path.resolve(process.cwd(), "srouter.db")
];

/** Resolve the SQLite file path. Reads `DATABASE_PATH` lazily so test
 * loaders (`--import tests/setup.ts`) can redirect to an isolated file
 * before the first query opens a connection. */
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

/**
 * Fail fast when a test process accidentally targets the production
 * database. Test runners must redirect via `DATABASE_PATH`
 * (see `apps/api/tests/setup.ts`); wiping `~/.srouter/srouter.db`
 * from a test run deleted real API keys before this guard existed.
 */
function assertNotProductionDatabaseInTests(dbPath: string): void {
    if (process.env.NODE_ENV !== "test") return;
    if (path.resolve(dbPath) === path.resolve(DEFAULT_DB_PATH)) {
        throw new Error(
            "Refusing to open the production database (DATABASE_PATH points at " +
                `${DEFAULT_DB_PATH}) while NODE_ENV=test. ` +
                "Run tests through `pnpm test` so tests/setup.ts redirects " +
                "to an isolated temp database."
        );
    }
}

function openDatabase(dbPath: string): DatabaseSync {
    assertNotProductionDatabaseInTests(dbPath);

    const transferLockPath = `${path.resolve(dbPath)}.transfer.lock`;
    if (fs.existsSync(transferLockPath)) {
        let owner: { pid?: number } | undefined;
        try {
            const raw = fs.readFileSync(transferLockPath, "utf8").trim();
            const parsed: unknown = JSON.parse(raw);
            owner = typeof parsed === "number" ? { pid: parsed } : parsed as { pid?: number };
        } catch {
            throw new Error("A database transfer is already in progress.");
        }
        if (owner.pid !== process.pid) throw new Error("A database transfer is already in progress.");
    }

    // Ensure parent folder exists if path contains subdirectories
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new DatabaseSync(dbPath);

    // Wait up to 5s instead of failing immediately when another connection
    // (e.g. a parallel test process or the CLI) holds the write lock.
    db.exec("PRAGMA busy_timeout = 5000;");

    // Enable WAL mode for high performance concurrency.
    // Retry briefly — concurrent processes initializing on the same DB file
    // (CI runs app test suites in parallel) can transiently hold the lock.
    for (let i = 0; i < 5; i++) {
        try {
            db.exec("PRAGMA journal_mode = WAL;");
            break;
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (code !== "SQLITE_BUSY" || i === 4) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (i + 1));
        }
    }
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA temp_store = MEMORY;");
    db.exec("PRAGMA cache_size = -20000;");
    return db;
}

// Lazy singleton: the connection opens on first use (not at import),
// so `DATABASE_PATH` set by a test loader always wins over the default.
// Re-opens when the path changes (e.g. tests redirecting mid-process).
let _sqliteDb: DatabaseSync | null = null;
let _sqliteDbPath: string | null = null;

function getSqliteDbInstance(): DatabaseSync {
    const dbPath = getDatabasePath();
    if (!_sqliteDb || _sqliteDbPath !== path.resolve(dbPath)) {
        try {
            _sqliteDb?.close();
        } catch {
            // Ignore close errors on a stale handle.
        }
        _sqliteDb = openDatabase(dbPath);
        _sqliteDbPath = path.resolve(dbPath);
    }
    return _sqliteDb;
}

/**
 * Shared SQLite connection. Lazily opened on first property access —
 * behaves like the previous eager `DatabaseSync` export.
 */
export const sqliteDb: DatabaseSync = new Proxy({} as DatabaseSync, {
    get(_target, prop) {
        const instance = getSqliteDbInstance() as unknown as Record<PropertyKey, unknown>;
        const value = instance[prop];
        return typeof value === "function" ? (value as () => unknown).bind(instance) : value;
    }
});

/** Currently opened database file, if any (for diagnostics/tests). */
export function getOpenDatabasePath(): string | null {
    return _sqliteDbPath;
}

/** Close the shared connection (test teardown / path switching). */
export function closeSqliteDb(): void {
    _sqliteDb?.close();
    _sqliteDb = null;
    _sqliteDbPath = null;
}

/** Reopen the shared connection after an operation replaces the database file. */
export function reopenSqliteDb(): DatabaseSync {
    closeSqliteDb();
    const database = getSqliteDbInstance();
    if (getOpenDatabasePath() !== path.resolve(getDatabasePath())) {
        throw new Error("SQLite connection reopened at an unexpected path.");
    }
    return database;
}
