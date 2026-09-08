import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
    DEFAULT_DB_PATH,
    SROUTER_DIR,
    closeSqliteDb,
    getDatabasePath,
    getOpenDatabasePath,
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

type SchemaColumn = {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
};

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
let testFailure: "after-backup" | "after-reopen" | "export-before-rename" | null = null;

function assertSqlite(): void {
    if (isPostgres()) throw new UnsupportedDatabaseError();
}

function resolvePath(filePath: string): string {
    return path.resolve(filePath);
}

function setPrivateFileMode(filePath: string): void {
    fs.chmodSync(filePath, 0o600);
}

function readSchema(database: DatabaseSync): Map<string, SchemaColumn[]> {
    const schema = new Map<string, SchemaColumn[]>();
    const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ?")
        .all("table", "sqlite_%") as Array<{ name: string }>;
    for (const table of tables) {
        schema.set(
            table.name,
            database.prepare(`PRAGMA table_info("${table.name.replaceAll('"', '""')}")`).all() as SchemaColumn[]
        );
    }
    return schema;
}

function schemasMatch(expected: Map<string, SchemaColumn[]>, candidate: Map<string, SchemaColumn[]>): boolean {
    return REQUIRED_TABLES.every((table) => {
        const expectedColumns = expected.get(table);
        const candidateColumns = candidate.get(table);
        if (!expectedColumns || !candidateColumns || expectedColumns.length !== candidateColumns.length) {
            return false;
        }
        return expectedColumns.every((expectedColumn, index) => {
            const candidateColumn = candidateColumns[index];
            return (
                expectedColumn.name === candidateColumn.name &&
                expectedColumn.type === candidateColumn.type &&
                expectedColumn.notnull === candidateColumn.notnull &&
                expectedColumn.dflt_value === candidateColumn.dflt_value &&
                expectedColumn.pk === candidateColumn.pk
            );
        });
    });
}

function readValidation(candidatePath: string, expectedSchema: Map<string, SchemaColumn[]>): DatabaseTransferValidation {
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

        const candidateSchema = readSchema(candidate);
        const missing = REQUIRED_TABLES.filter((table) => !candidateSchema.has(table));
        if (missing.length > 0 || !schemasMatch(expectedSchema, candidateSchema)) {
            throw new IncompatibleDatabaseError(
                missing.length > 0
                    ? `Missing required SRouter tables: ${missing.join(", ")}.`
                    : "The import database schema does not match the initialized SRouter schema."
            );
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
    const releaseLock = acquireTransferLock();
    const targetPath = resolvePath(outputPath);
    const activePath = resolvePath(getDatabasePath());
    if (targetPath === activePath) {
        releaseLock();
        throw new Error("The export path cannot be the active database path.");
    }

    const temporaryPath = `${targetPath}.snapshot-${process.pid}-${Date.now()}`;
    try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
        createConsistentSnapshot(activePath, temporaryPath);
        if (testFailure === "export-before-rename") throw new Error("Injected export failure.");
        fs.renameSync(temporaryPath, targetPath);
        setPrivateFileMode(targetPath);
        return { format: "sqlite", path: targetPath, size: fs.statSync(targetPath).size };
    } finally {
        fs.rmSync(temporaryPath, { force: true });
        if (testFailure === "export-before-rename") testFailure = null;
        releaseLock();
    }
}

function closeSharedConnection(): void {
    closeSqliteDb();
    if (getOpenDatabasePath() !== null) {
        throw new Error("The shared SQLite connection could not be closed safely.");
    }
}

export function validateDatabaseImport(candidatePath: string): DatabaseTransferValidation {
    assertSqlite();
    const candidate = resolvePath(candidatePath);
    if (candidate === resolvePath(getDatabasePath())) {
        throw new InvalidDatabaseImportError("The import file cannot be the active database.");
    }
    const active = new DatabaseSync(getDatabasePath(), { readOnly: true, timeout: 5000 });
    try {
        return readValidation(candidate, readSchema(active));
    } finally {
        active.close();
    }
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

function createConsistentSnapshot(sourcePath: string, outputPath: string): void {
    const source = new DatabaseSync(sourcePath, { timeout: 5000 });
    try {
        source.exec(`VACUUM INTO '${outputPath.replaceAll("'", "''")}'`);
    } finally {
        source.close();
    }
    setPrivateFileMode(outputPath);
}

function acquireTransferLock(): () => void {
    const lockPath = `${resolvePath(getDatabasePath())}.transfer.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    for (;;) {
        try {
            const descriptor = fs.openSync(lockPath, "wx", 0o600);
            fs.writeFileSync(descriptor, `${process.pid}\n`, { encoding: "utf8" });
            fs.closeSync(descriptor);
            return () => fs.rmSync(lockPath, { force: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            let ownerPid: number | null = null;
            try {
                ownerPid = Number.parseInt(fs.readFileSync(lockPath, "utf8"), 10);
            } catch {
                throw new DatabaseImportBusyError();
            }
            if (ownerPid && ownerPid !== process.pid) {
                try {
                    process.kill(ownerPid, 0);
                    throw new DatabaseImportBusyError();
                } catch (ownerError) {
                    if (ownerError instanceof DatabaseImportBusyError) throw ownerError;
                    fs.rmSync(lockPath, { force: true });
                }
            } else {
                throw new DatabaseImportBusyError();
            }
        }
    }
}

export function replaceDatabaseFromFile(candidatePath: string): DatabaseTransferImportResult {
    assertSqlite();
    if (importActive) throw new DatabaseImportBusyError();
    const releaseLock = acquireTransferLock();
    importActive = true;
    const activePath = resolvePath(getDatabasePath());
    let targetTempPath = "";
    let savedBackupPath: string | null = null;
    let replacementStarted = false;
    try {
        const candidate = resolvePath(candidatePath);
        const validation = validateDatabaseImport(candidate);
        if (!validation.schemaCompatible || !validation.integrityOk) {
            throw new IncompatibleDatabaseError();
        }

        targetTempPath = `${activePath}.import-${process.pid}-${Date.now()}`;
        savedBackupPath = backupPath();
        closeSharedConnection();
        createConsistentSnapshot(activePath, savedBackupPath);
        if (testFailure === "after-backup") throw new Error("Injected replacement failure.");
        createConsistentSnapshot(candidate, targetTempPath);
        fs.renameSync(targetTempPath, activePath);
        replacementStarted = true;
        removeSidecars(activePath);
        reopenSqliteDb();
        if (testFailure === "after-reopen") throw new Error("Injected reopen failure.");
        return { backupPath: savedBackupPath, restartRequired: false };
    } catch (error) {
        fs.rmSync(targetTempPath, { force: true });
        if (!savedBackupPath || !replacementStarted) {
            throw new DatabaseRecoveryError(
                error instanceof Error ? error.message : "Database replacement could not start safely."
            );
        }
        if (savedBackupPath) {
            try {
                closeSharedConnection();
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
        importActive = false;
        releaseLock();
    }
}

export function setDatabaseTransferTestFailure(
    failure: "after-backup" | "after-reopen" | "export-before-rename" | null
): void {
    testFailure = failure;
}

export { DEFAULT_DB_PATH };
