import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
    DEFAULT_DB_PATH,
    SROUTER_DIR,
    closeSqliteDb,
    getDatabasePath,
    reopenSqliteDb
} from "./sqlite.js";
import { isPostgres } from "./db.js";

const REQUIRED_TABLES = [
    "providers",
    "api_keys",
    "request_logs",
    "oauth_sessions",
    "fallback_rules",
    "system_settings",
    "custom_models",
    "admin_account",
    "admin_sessions"
] as const;

export interface DatabaseTransferExportResult {
    format: "sqlite";
    path: string;
    size: number;
}

export interface DatabaseTransferValidation {
    requiredTables: string[];
    schemaCompatible: boolean;
    integrityOk: boolean;
}

export interface DatabaseTransferImportResult {
    backupPath: string;
    restartRequired: boolean;
}

export class UnsupportedDatabaseError extends Error {
    constructor() {
        super("Database transfer is supported only for SQLite storage.");
        this.name = "UnsupportedDatabaseError";
    }
}

export class InvalidDatabaseImportError extends Error {
    constructor(message = "The import file is not a valid SQLite database.") {
        super(message);
        this.name = "InvalidDatabaseImportError";
    }
}

export class IncompatibleDatabaseError extends Error {
    constructor(message = "The import database is incompatible with SRouter.") {
        super(message);
        this.name = "IncompatibleDatabaseError";
    }
}

export class DatabaseImportBusyError extends Error {
    constructor() {
        super("Another database import is already in progress.");
        this.name = "DatabaseImportBusyError";
    }
}

export class DatabaseRecoveryError extends Error {
    constructor(message = "Database replacement failed and recovery was required.") {
        super(message);
        this.name = "DatabaseRecoveryError";
    }
}

let importActive = false;
let testFailure: "after-backup" | null = null;
let testHook: (() => void) | null = null;

function assertSqlite(): void {
    if (isPostgres()) throw new UnsupportedDatabaseError();
}

function resolvePath(filePath: string): string {
    return path.resolve(filePath);
}

function setPrivateFileMode(filePath: string): void {
    fs.chmodSync(filePath, 0o600);
}

function readValidation(candidatePath: string): DatabaseTransferValidation {
    let candidate: DatabaseSync;
    try {
        candidate = new DatabaseSync(candidatePath, { readOnly: true, timeout: 5000 });
    } catch {
        throw new InvalidDatabaseImportError();
    }

    try {
        const integrity = candidate.prepare("PRAGMA integrity_check").get();
        if (!integrity || integrity.integrity_check !== "ok") {
            throw new InvalidDatabaseImportError("The SQLite integrity check failed.");
        }

        const rows = candidate
            .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ?")
            .all("table", "sqlite_%") as Array<{ name: string }>;
        const tableNames = new Set(rows.map((row) => row.name));
        const missing = REQUIRED_TABLES.filter((table) => !tableNames.has(table));
        if (missing.length > 0) {
            throw new IncompatibleDatabaseError(`Missing required SRouter tables: ${missing.join(", ")}.`);
        }

        return {
            requiredTables: [...REQUIRED_TABLES],
            schemaCompatible: true,
            integrityOk: true
        };
    } catch (error) {
        if (error instanceof InvalidDatabaseImportError || error instanceof IncompatibleDatabaseError) {
            throw error;
        }
        throw new InvalidDatabaseImportError();
    } finally {
        candidate.close();
    }
}

export function exportDatabaseSnapshot(outputPath: string): DatabaseTransferExportResult {
    assertSqlite();
    const targetPath = resolvePath(outputPath);
    const activePath = resolvePath(getDatabasePath());
    if (targetPath === activePath) {
        throw new Error("The export path cannot be the active database path.");
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath);
    const snapshotConnection = new DatabaseSync(activePath, { timeout: 5000 });
    try {
        snapshotConnection.exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`);
    } finally {
        snapshotConnection.close();
    }
    setPrivateFileMode(targetPath);
    return { format: "sqlite", path: targetPath, size: fs.statSync(targetPath).size };
}

export function validateDatabaseImport(candidatePath: string): DatabaseTransferValidation {
    assertSqlite();
    const candidate = resolvePath(candidatePath);
    if (candidate === resolvePath(getDatabasePath())) {
        throw new InvalidDatabaseImportError("The import file cannot be the active database.");
    }
    return readValidation(candidate);
}

function backupPath(): string {
    fs.mkdirSync(path.join(SROUTER_DIR, "backups"), { recursive: true, mode: 0o700 });
    return path.join(SROUTER_DIR, "backups", `import-backup-${Date.now()}.db`);
}

function removeSidecars(databasePath: string): void {
    for (const suffix of ["-wal", "-shm"]) {
        fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
}

export function replaceDatabaseFromFile(candidatePath: string): DatabaseTransferImportResult {
    assertSqlite();
    if (importActive) throw new DatabaseImportBusyError();
    importActive = true;
    const activePath = resolvePath(getDatabasePath());
    let targetTempPath = "";
    let savedBackupPath: string | null = null;
    try {
        const candidate = resolvePath(candidatePath);
        const validation = validateDatabaseImport(candidate);
        if (!validation.schemaCompatible || !validation.integrityOk) {
            throw new IncompatibleDatabaseError();
        }

        targetTempPath = `${activePath}.import-${process.pid}-${Date.now()}`;
        savedBackupPath = backupPath();
        closeSqliteDb();
        fs.copyFileSync(activePath, savedBackupPath);
        setPrivateFileMode(savedBackupPath);
        if (testFailure === "after-backup") throw new Error("Injected replacement failure.");
        fs.copyFileSync(candidate, targetTempPath);
        setPrivateFileMode(targetTempPath);
        fs.renameSync(targetTempPath, activePath);
        removeSidecars(activePath);
        reopenSqliteDb();
        return { backupPath: savedBackupPath, restartRequired: false };
    } catch (error) {
        fs.rmSync(targetTempPath, { force: true });
        if (!savedBackupPath) throw error;
        if (savedBackupPath) {
            try {
                closeSqliteDb();
                fs.copyFileSync(savedBackupPath, activePath);
                setPrivateFileMode(activePath);
                removeSidecars(activePath);
                reopenSqliteDb();
            } catch {
                throw new DatabaseRecoveryError(
                    `Database replacement failed; restore the retained backup at ${savedBackupPath}.`
                );
            }
        }
        throw new DatabaseRecoveryError(
            error instanceof Error ? error.message : "Database replacement failed."
        );
    } finally {
        fs.rmSync(targetTempPath, { force: true });
        testFailure = null;
        const hook = testHook;
        testHook = null;
        hook?.();
        importActive = false;
    }
}

export function setDatabaseTransferTestFailure(failure: "after-backup" | null): void {
    testFailure = failure;
}

export function setDatabaseTransferTestHook(hook: (() => void) | null): void {
    testHook = hook;
}

export { DEFAULT_DB_PATH };
