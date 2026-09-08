import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Context } from "hono";
import {
    DatabaseImportBusyError,
    DatabaseRecoveryError,
    IncompatibleDatabaseError,
    InvalidDatabaseImportError,
    UnsupportedDatabaseError,
    exportDatabaseSnapshot,
    replaceDatabaseFromFile,
    validateDatabaseImport,
    type DatabaseTransferExportResult,
    type DatabaseTransferImportResult,
    type DatabaseTransferValidation
} from "@srouter/db";
import { Err, Ok } from "@/utils/response.js";

export const MAX_DATABASE_UPLOAD_BYTES = 25 * 1024 * 1024;

interface DatabaseControllerOptions {
    exportDatabase?: (outputPath: string) => DatabaseTransferExportResult;
    validateDatabase?: (candidatePath: string) => DatabaseTransferValidation;
    replaceDatabase?: (candidatePath: string) => DatabaseTransferImportResult;
}

const defaultOptions: Required<DatabaseControllerOptions> = {
    exportDatabase: exportDatabaseSnapshot,
    validateDatabase: validateDatabaseImport,
    replaceDatabase: replaceDatabaseFromFile
};

function mapTransferError(c: Context, error: unknown): Response {
    if (error instanceof UnsupportedDatabaseError) {
        return Err(c, "Database transfer is not supported for this storage backend.", 400, {
            code: "unsupported_storage"
        });
    }
    if (error instanceof InvalidDatabaseImportError || error instanceof IncompatibleDatabaseError) {
        return Err(c, "The uploaded database is invalid or incompatible.", 400, {
            code: "invalid_database"
        });
    }
    if (error instanceof DatabaseImportBusyError) {
        return Err(c, "Another database import is already in progress.", 409, {
            code: "database_import_busy"
        });
    }
    if (error instanceof DatabaseRecoveryError) {
        return Err(c, "The database import failed and recovery was required.", 500, {
            code: "database_recovery_failed"
        });
    }
    return Err(c, "The database transfer could not be completed.", 500, {
        code: "database_transfer_failed"
    });
}

function createExportName(): string {
    const timestamp = new Date().toISOString().replaceAll(/[^0-9]/g, "").slice(0, 14);
    return `srouter-backup-${timestamp}.db`;
}

function formatBackupPath(backupPath: string): string {
    const homeDatabaseDirectory = path.join(os.homedir(), ".srouter");
    const relativePath = path.relative(homeDatabaseDirectory, backupPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return "~/.srouter/backups/import-backup.db";
    }
    return `~/.srouter/${relativePath}`;
}

export class DatabaseController {
    public static async Export(c: Context, options: DatabaseControllerOptions = {}): Promise<Response> {
        const transfer = {
            exportDatabase: options.exportDatabase ?? defaultOptions.exportDatabase,
            validateDatabase: options.validateDatabase ?? defaultOptions.validateDatabase,
            replaceDatabase: options.replaceDatabase ?? defaultOptions.replaceDatabase
        };
        const directory = await mkdtemp(path.join(os.tmpdir(), "srouter-database-export-"));
        const outputPath = path.join(directory, "database.db");
        try {
            const result = transfer.exportDatabase(outputPath);
            const bytes = await readFile(result.path);
            c.header("Content-Type", "application/octet-stream");
            c.header("Content-Length", String(bytes.byteLength));
            c.header("Content-Disposition", `attachment; filename="${createExportName()}"`);
            return c.body(bytes);
        } catch (error) {
            return mapTransferError(c, error);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }

    public static async Import(c: Context, options: DatabaseControllerOptions = {}): Promise<Response> {
        const transfer = {
            exportDatabase: options.exportDatabase ?? defaultOptions.exportDatabase,
            validateDatabase: options.validateDatabase ?? defaultOptions.validateDatabase,
            replaceDatabase: options.replaceDatabase ?? defaultOptions.replaceDatabase
        };
        let directory: string | undefined;
        try {
            let body: Record<string, File | string | File[]>;
            try {
                body = await c.req.parseBody();
            } catch {
                return Err(c, "A valid multipart database upload is required.", 400, {
                    code: "invalid_multipart"
                });
            }
            const file = body.database;
            if (!(file instanceof File)) {
                return Err(c, "A database file is required in the database field.", 400, {
                    code: "missing_database_file"
                });
            }
            if (file.size > MAX_DATABASE_UPLOAD_BYTES) {
                return Err(c, "The database upload is too large.", 400, { code: "upload_too_large" });
            }

            directory = await mkdtemp(path.join(os.tmpdir(), "srouter-database-import-"));
            const candidatePath = path.join(directory, "database.db");
            await writeFile(candidatePath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
            transfer.validateDatabase(candidatePath);
            const result = transfer.replaceDatabase(candidatePath);
            return Ok(c, {
                ok: true,
                backup_path: formatBackupPath(result.backupPath),
                restart_required: result.restartRequired
            });
        } catch (error) {
            return mapTransferError(c, error);
        } finally {
            if (directory) await rm(directory, { recursive: true, force: true });
        }
    }
}
