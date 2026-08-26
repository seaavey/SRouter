import type { DatabaseSync } from "node:sqlite";
import { db } from "./db.js";
import { num, str } from "./row-utils.js";

export interface AdminSession {
    tokenHash: string;
    createdAt: number;
    expiresAt: number;
}

interface AdminAccountRow {
    password_hash?: unknown;
}

interface AdminSessionRow {
    token_hash?: unknown;
    created_at?: unknown;
    expires_at?: unknown;
}

export class AdminAuthStore {
    public constructor(private readonly database: DatabaseSync = db) {
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS admin_account (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
        `);
    }

    public hasAdminAccount(): boolean {
        const Row = this.database
            .prepare("SELECT 1 AS present FROM admin_account WHERE id = 1")
            .get();

        return Boolean(Row);
    }

    public createAdminAccount(passwordHash: string, now = Date.now()): boolean {
        const Result = this.database
            .prepare(
                `INSERT OR IGNORE INTO admin_account (id, password_hash, created_at, updated_at)
                 VALUES (1, ?, ?, ?)`
            )
            .run(passwordHash, now, now);

        return num(Result.changes) > 0;
    }

    public getPasswordHash(): string | null {
        const Row = this.database
            .prepare("SELECT password_hash FROM admin_account WHERE id = 1")
            .get() as AdminAccountRow | undefined;

        return Row?.password_hash ? str(Row.password_hash) : null;
    }

    public updatePasswordHash(passwordHash: string, now = Date.now()): boolean {
        const Result = this.database
            .prepare(
                `UPDATE admin_account
                 SET password_hash = ?, updated_at = ?
                 WHERE id = 1`
            )
            .run(passwordHash, now);

        return num(Result.changes) > 0;
    }

    public createSession(tokenHash: string, createdAt: number, expiresAt: number): void {
        this.database
            .prepare(
                `INSERT INTO admin_sessions (token_hash, created_at, expires_at)
                 VALUES (?, ?, ?)`
            )
            .run(tokenHash, createdAt, expiresAt);
    }

    public getSession(tokenHash: string, now = Date.now()): AdminSession | null {
        this.database.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);

        const Row = this.database
            .prepare(
                `SELECT token_hash, created_at, expires_at
                 FROM admin_sessions
                 WHERE token_hash = ? AND expires_at > ?`
            )
            .get(tokenHash, now) as AdminSessionRow | undefined;

        if (!Row) return null;

        return {
            tokenHash: str(Row.token_hash),
            createdAt: num(Row.created_at),
            expiresAt: num(Row.expires_at)
        };
    }

    public deleteSession(tokenHash: string): boolean {
        const Result = this.database
            .prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
            .run(tokenHash);

        return num(Result.changes) > 0;
    }
}

export const adminAuthStore = new AdminAuthStore();
