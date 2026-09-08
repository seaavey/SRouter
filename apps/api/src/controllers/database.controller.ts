import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import {
    DatabaseImportBusyError,
    DatabaseRecoveryError,
    IncompatibleDatabaseError,
    InvalidDatabaseImportError,
    UnsupportedDatabaseError,
    exportDatabaseSnapshot,
    replaceDatabaseFromFile,
    SROUTER_DIR,
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

class DatabaseUploadTooLargeError extends Error {
    constructor() {
        super("The database upload is too large.");
        this.name = "DatabaseUploadTooLargeError";
    }
}

class InvalidMultipartDatabaseError extends Error {
    constructor(
        public readonly code: "invalid_multipart" | "missing_database_file" | "invalid_database_field" = "invalid_multipart"
    ) {
        super(code === "missing_database_file"
            ? "A database file is required in the database field."
            : code === "invalid_database_field"
              ? "A single database file is required in the database field."
              : "A valid multipart database upload is required.");
        this.name = "InvalidMultipartDatabaseError";
    }
}

async function streamMultipartDatabase(request: Request, outputPath: string): Promise<void> {
    // Node's built-in Request.formData() buffers multipart parts. Keep the
    // upload bounded and disk-backed by parsing only this fixed file field.
    const contentType = request.headers.get("content-type") ?? "";
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]?.trim();
    if (!boundary || !request.body) throw new InvalidMultipartDatabaseError("missing_database_file");

    const marker = Buffer.from(`--${boundary}`);
    const separator = Buffer.from(`\r\n--${boundary}`);
    const reader = Readable.fromWeb(request.body);
    const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
    let buffer = Buffer.alloc(0);
    let total = 0;
    let partCount = 0;
    let filePart = false;
    let fileBytes = 0;
    let started = false;
    let finished = false;

    const write = async (chunk: Buffer): Promise<void> => {
        if (!filePart || chunk.length === 0) return;
        fileBytes += chunk.length;
        if (fileBytes > MAX_DATABASE_UPLOAD_BYTES) throw new DatabaseUploadTooLargeError();
        if (!output.write(chunk)) await new Promise<void>((resolve) => output.once("drain", resolve));
    };

    try {
        for await (const chunk of reader) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += bytes.length;
            if (total > MAX_DATABASE_UPLOAD_BYTES) throw new DatabaseUploadTooLargeError();
            buffer = Buffer.concat([buffer, bytes]);

            while (!finished) {
                if (!started) {
                    const start = buffer.indexOf(marker);
                    if (start < 0) {
                        buffer = buffer.subarray(Math.max(0, buffer.length - marker.length));
                        break;
                    }
                    buffer = buffer.subarray(start + marker.length);
                    started = true;
                }
                if (!filePart) {
                    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"));
                    if (headerEnd < 0) break;
                    const headers = buffer.subarray(0, headerEnd).toString("utf8").toLowerCase();
                    buffer = buffer.subarray(headerEnd + 4);
                    partCount += 1;
                    const disposition = /content-disposition:([^\r\n]*)/.exec(headers)?.[1] ?? "";
                    const parameters = new Map<string, string>();
                    for (const parameter of disposition.split(";").slice(1)) {
                        const match = /^\s*([^=]+)="([^"]*)"\s*$/.exec(parameter);
                        if (match) parameters.set(match[1].trim(), match[2]);
                    }
                    const isDatabaseField = parameters.get("name") === "database";
                    filePart = isDatabaseField && parameters.has("filename");
                    if (partCount > 1 || (isDatabaseField && !filePart)) {
                        throw new InvalidMultipartDatabaseError("invalid_database_field");
                    }
                }
                const end = buffer.indexOf(separator);
                if (end < 0) {
                    const safeLength = Math.max(0, buffer.length - separator.length);
                    await write(buffer.subarray(0, safeLength));
                    buffer = buffer.subarray(safeLength);
                    break;
                }
                await write(buffer.subarray(0, end));
                buffer = buffer.subarray(end + separator.length);
                if (buffer.subarray(0, 2).equals(Buffer.from("--"))) {
                    finished = true;
                } else {
                    filePart = false;
                    if (!buffer.subarray(0, 2).equals(Buffer.from("\r\n"))) {
                        throw new InvalidMultipartDatabaseError();
                    }
                    buffer = buffer.subarray(2);
                }
                break;
            }
        }
        if (!finished || partCount !== 1 || fileBytes === 0) throw new InvalidMultipartDatabaseError();
        await new Promise<void>((resolve, reject) => {
            output.end(() => resolve());
            output.on("error", reject);
        });
    } catch (error) {
        output.destroy();
        throw error;
    }
}

async function createPrivateTransferDirectory(): Promise<string> {
    await mkdir(SROUTER_DIR, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(path.join(SROUTER_DIR, "transfer-temp-"), { encoding: "utf8" });
    await chmod(directory, 0o700);
    return directory;
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
            if (!c.req.raw.body) {
                return Err(c, "The database upload is too large.", 400, { code: "upload_too_large" });
            }

            directory = await createPrivateTransferDirectory();
            const candidatePath = path.join(directory, "database.db");
            await streamMultipartDatabase(c.req.raw, candidatePath);
            transfer.validateDatabase(candidatePath);
            const result = transfer.replaceDatabase(candidatePath);
            deleteCookie(c, "srouter_admin_session", { path: "/" });
            return Ok(c, {
                ok: true,
                backup_path: formatBackupPath(result.backupPath),
                restart_required: result.restartRequired,
                reauth_required: result.reauthRequired
            });
        } catch (error) {
            if (error instanceof DatabaseUploadTooLargeError) {
                return Err(c, "The database upload is too large.", 400, { code: "upload_too_large" });
            }
            if (error instanceof InvalidMultipartDatabaseError) {
                return Err(c, error.message, 400, { code: error.code });
            }
            return mapTransferError(c, error);
        } finally {
            if (directory) await rm(directory, { recursive: true, force: true });
        }
    }
}
