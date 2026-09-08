import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
    DEFAULT_DB_PATH,
    SROUTER_DIR,
    closeSqliteDb,
    getDatabasePath,
    getOpenDatabasePath,
    reopenSqliteDb
} from "./sqlite.js";
import { isPostgres } from "./db.js";

const TRANSFER_SCHEMA_VERSION = "1";
const SCHEMA_TABLES = {
    providers: ["id", "provider_id", "name", "alias", "category", "protocol", "base_url", "api_key", "access_token", "refresh_token", "account_id", "organization_id", "provider_specific_data", "custom_headers", "token_expires_at", "last_refreshed_at", "enabled", "created_at"],
    api_keys: ["id", "key", "name", "enabled", "rate_limit", "quota_limit", "usage_tokens", "credit_limit", "usage_cost", "allowed_models", "created_at"],
    request_logs: ["id", "api_key_id", "ip_address", "user_agent", "provider_id", "model", "prompt_tokens", "completion_tokens", "total_tokens", "status_code", "latency_ms", "cached_tokens", "cache_creation_tokens", "reasoning_tokens", "estimated_cost", "fallback_occurred", "fallback_path", "fallback_reason", "resolved_model", "created_at"],
    oauth_sessions: ["state", "code_verifier", "client_id", "redirect_uri", "created_at"],
    fallback_rules: ["id", "source_model", "target_model", "priority", "enabled", "trigger_on_status", "max_retries", "created_at"],
    system_settings: ["key", "value"],
    custom_models: ["provider_id", "model_id", "created_at"],
    admin_account: ["id", "password_hash", "created_at", "updated_at"],
    admin_sessions: ["token_hash", "created_at", "expires_at"],
    srouter_schema_meta: ["key", "value"]
} as const;
const REQUIRED_TABLES = Object.keys(SCHEMA_TABLES) as Array<keyof typeof SCHEMA_TABLES>;

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
let testOwnerProbe: "eperm" | null = null;
let testReleaseReplacement: string | null = null;

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

function schemasMatch(candidate: Map<string, SchemaColumn[]>): boolean {
    return REQUIRED_TABLES.every((table) => {
        const candidateColumns = candidate.get(table);
        if (!candidateColumns || candidateColumns.length !== SCHEMA_TABLES[table].length) {
            return false;
        }
        return SCHEMA_TABLES[table].every((column, index) => candidateColumns[index]?.name === column);
    });
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

        const candidateSchema = readSchema(candidate);
        const missing = REQUIRED_TABLES.filter((table) => !candidateSchema.has(table));
        const marker = candidateSchema.has("srouter_schema_meta")
            ? (candidate
                  .prepare("SELECT value FROM srouter_schema_meta WHERE key = ?")
                  .get("schema_version") as { value?: string } | undefined)
            : undefined;
        if (missing.length > 0 || !schemasMatch(candidateSchema) || marker?.value !== TRANSFER_SCHEMA_VERSION) {
            throw new IncompatibleDatabaseError(
                missing.length > 0
                    ? `Missing required SRouter tables: ${missing.join(", ")}.`
                    : `The import database schema does not match transfer schema version ${TRANSFER_SCHEMA_VERSION}.`
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
        if (testReleaseReplacement) {
            fs.writeFileSync(
                `${activePath}.transfer.lock`,
                `${JSON.stringify({ pid: process.pid, start: processStartIdentity(), token: testReleaseReplacement })}\n`
            );
            testReleaseReplacement = null;
        }
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
    const releaseLock = acquireTransferLock();
    try {
        return readValidation(candidate);
    } finally {
        releaseLock();
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
    const owner = { pid: process.pid, start: processStartIdentity(), token: randomUUID() };
    fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    for (;;) {
        try {
            const descriptor = fs.openSync(lockPath, "wx", 0o600);
            fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, { encoding: "utf8" });
            fs.closeSync(descriptor);
            return () => {
                try {
                    const current = JSON.parse(fs.readFileSync(lockPath, "utf8")) as typeof owner;
                    if (current.token === owner.token) fs.rmSync(lockPath, { force: true });
                } catch {
                    // The lock is already gone or malformed; never remove an unknown owner.
                }
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            let lockOwner: { pid: number; start: string; token: string };
            try {
                lockOwner = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
                    pid: number;
                    start: string;
                    token: string;
                };
            } catch {
                throw new DatabaseImportBusyError();
            }
            if (lockOwner.pid) {
                try {
                    if (testOwnerProbe === "eperm") {
                        const error = new Error("operation not permitted") as NodeJS.ErrnoException;
                        error.code = "EPERM";
                        throw error;
                    }
                    process.kill(lockOwner.pid, 0);
                    if (processStartIdentityFor(lockOwner.pid) !== lockOwner.start) {
                        fs.rmSync(lockPath, { force: true });
                        continue;
                    }
                    throw new DatabaseImportBusyError();
                } catch (ownerError) {
                    if (ownerError instanceof DatabaseImportBusyError) throw ownerError;
                    if ((ownerError as NodeJS.ErrnoException).code === "EPERM") {
                        throw new DatabaseImportBusyError();
                    }
                    fs.rmSync(lockPath, { force: true });
                }
            } else {
                throw new DatabaseImportBusyError();
            }
        }
    }
}

function processStartIdentity(): string {
    return processStartIdentityFor(process.pid);
}

function processStartIdentityFor(pid: number): string {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
        return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? "unknown";
    } catch {
        return "unknown";
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
        const validation = readValidation(candidate);
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
        if (testReleaseReplacement) {
            fs.writeFileSync(
                `${activePath}.transfer.lock`,
                `${JSON.stringify({ pid: process.pid, start: processStartIdentity(), token: testReleaseReplacement })}\n`
            );
            testReleaseReplacement = null;
        }
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

export function setDatabaseTransferTestOwnerProbe(probe: "eperm" | null): void {
    testOwnerProbe = probe;
}

export function setDatabaseTransferTestReleaseReplacement(token: string | null): void {
    testReleaseReplacement = token;
}

export { DEFAULT_DB_PATH };
