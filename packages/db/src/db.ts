import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

function getDatabasePath(): string {
    if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
    const apiDb = path.resolve(process.cwd(), "apps/api/srouter.db");
    if (fs.existsSync(apiDb)) return apiDb;
    return path.resolve(process.cwd(), "srouter.db");
}

const dbPath = getDatabasePath();

// Ensure parent folder exists if path contains subdirectories
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

// Enable WAL mode for high performance concurrency
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

/**
 * Initialize database schema tables if they do not exist
 */
export function initDatabase(): void {
    // 1. Table for Providers configuration
    db.exec(`
        CREATE TABLE IF NOT EXISTS providers (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            protocol TEXT NOT NULL,
            base_url TEXT,
            api_key TEXT,
            access_token TEXT,
            refresh_token TEXT,
            custom_headers TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        );
    `);

    // Ensure refresh_token column exists if table was created previously
    try {
        db.exec("ALTER TABLE providers ADD COLUMN refresh_token TEXT;");
    } catch {
        // column already exists
    }

    // Ensure account_id column exists for multi-account OAuth binding (e.g. Codex ChatGPT-Account-ID)
    try {
        db.exec("ALTER TABLE providers ADD COLUMN account_id TEXT;");
    } catch {
        // column already exists
    }

    // Ensure organization_id column exists (e.g. Claude OAuth organization binding)
    try {
        db.exec("ALTER TABLE providers ADD COLUMN organization_id TEXT;");
    } catch {
        // column already exists
    }

    // 2. Table for Client API Keys / Endpoint Keys
    db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            key TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            rate_limit INTEGER DEFAULT 0,
            quota_limit INTEGER DEFAULT 0,
            usage_tokens INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        );
    `);

    // 3. Table for Request Logs & Token Analytics
    db.exec(`
        CREATE TABLE IF NOT EXISTS request_logs (
            id TEXT PRIMARY KEY,
            api_key_id TEXT,
            provider_id TEXT NOT NULL,
            model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            status_code INTEGER NOT NULL,
            latency_ms INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
    `);

    // 4. Table for OAuth PKCE sessions (survive server restarts)
    db.exec(`
        CREATE TABLE IF NOT EXISTS oauth_sessions (
            state TEXT PRIMARY KEY,
            code_verifier TEXT NOT NULL,
            client_id TEXT NOT NULL,
            redirect_uri TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
    `);

    // Ensure analytics columns exist if table was created previously
    const analyticsColumns: Array<{ name: string; definition: string }> = [
        { name: "cached_tokens", definition: "cached_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "cache_creation_tokens", definition: "cache_creation_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "reasoning_tokens", definition: "reasoning_tokens INTEGER NOT NULL DEFAULT 0" },
        { name: "estimated_cost", definition: "estimated_cost REAL NOT NULL DEFAULT 0" },
    ];
    for (const col of analyticsColumns) {
        try {
            db.exec(`ALTER TABLE request_logs ADD COLUMN ${col.definition};`);
        } catch {
            // column already exists
        }
    }
}

// Auto-run schema initialization
initDatabase();
