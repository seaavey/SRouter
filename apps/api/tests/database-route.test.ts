import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import {
    adminAuthStore,
    DatabaseImportBusyError,
    DatabaseRecoveryError,
    IncompatibleDatabaseError,
    InvalidDatabaseImportError,
    SROUTER_DIR,
    UnsupportedDatabaseError
} from "../../../packages/db/src/index.js";
import { CreateDatabaseRouter } from "../src/routes/v1/database.js";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../src/services/adminAuth.js";

async function createTestApp(options: {
    validateDatabase?: (candidatePath: string) => never;
    replaceDatabase?: (candidatePath: string) => never;
} = {}) {
    await adminAuthStore.createAdminAccount("hash");
    const directory = await mkdtemp(path.join(os.tmpdir(), "srouter-database-route-"));
    const sourcePath = path.join(directory, "source.db");
    await writeFile(sourcePath, "sqlite export");

    const app = new Hono();
    app.route(
        "/v1",
        CreateDatabaseRouter({
            exportDatabase: () => ({ format: "sqlite", path: sourcePath, size: 13 }),
            validateDatabase: options.validateDatabase ?? (() => ({
                requiredTables: ["providers"],
                schemaCompatible: true,
                integrityOk: true
            })),
            replaceDatabase: options.replaceDatabase ?? (() => ({
                backupPath: path.join(os.homedir(), ".srouter/backups/import-backup-1.db"),
                restartRequired: false,
                reauthRequired: true
            }))
        })
    );

    return {
        app,
        session: `${ADMIN_SESSION_COOKIE}=${await createAdminSession(adminAuthStore)}`,
        cleanup: () => rm(directory, { recursive: true, force: true })
    };
}

test("database export requires an admin session and rejects API keys and loopback", async () => {
    const { app, session, cleanup } = await createTestApp();
    try {
        assert.equal((await app.request("/v1/admin/database/export")).status, 401);
        assert.equal(
            (await app.request("/v1/admin/database/export", { headers: { "x-api-key": "sr-live-test" } })).status,
            401
        );
        assert.equal(
            (await app.request("/v1/admin/database/export", { headers: { "x-forwarded-for": "127.0.0.1" } })).status,
            401
        );

        const response = await app.request("/v1/admin/database/export", { headers: { Cookie: session } });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type") ?? "", /application\/octet-stream/);
        assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
    } finally {
        await cleanup();
    }
});

test("database import accepts one database file for an admin session", async () => {
    const { app, session, cleanup } = await createTestApp();
    try {
        assert.equal((await app.request("/v1/admin/database/import", { method: "POST" })).status, 401);
        assert.equal(
            (await app.request("/v1/admin/database/import", {
                method: "POST",
                headers: { "x-api-key": "sr-live-test" }
            })).status,
            401
        );
        assert.equal(
            (await app.request("/v1/admin/database/import", {
                method: "POST",
                headers: { "x-forwarded-for": "127.0.0.1" }
            })).status,
            401
        );

        const form = new FormData();
        form.set("database", new File(["valid sqlite bytes"], "source.db"));
        const response = await app.request("/v1/admin/database/import", {
            method: "POST",
            headers: { Cookie: session },
            body: form
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            ok: true,
            backup_path: "~/.srouter/backups/import-backup-1.db",
            restart_required: false,
            reauth_required: true
        });
    } finally {
        await cleanup();
    }
});

test("database import rejects duplicate database files and values", async () => {
    const { app, session, cleanup } = await createTestApp();
    try {
        const duplicateFiles = new FormData();
        duplicateFiles.append("database", new File(["first"], "first.db"));
        duplicateFiles.append("database", new File(["second"], "second.db"));
        const duplicateFileResponse = await app.request("/v1/admin/database/import", {
            method: "POST",
            headers: { Cookie: session },
            body: duplicateFiles
        });
        assert.equal(duplicateFileResponse.status, 400);
        assert.equal((await duplicateFileResponse.json()).error.code, "invalid_database_field");

        const duplicateValues = new FormData();
        duplicateValues.append("database", "first");
        duplicateValues.append("database", "second");
        const duplicateValueResponse = await app.request("/v1/admin/database/import", {
            method: "POST",
            headers: { Cookie: session },
            body: duplicateValues
        });
        assert.equal(duplicateValueResponse.status, 400);
        assert.equal((await duplicateValueResponse.json()).error.code, "invalid_database_field");
    } finally {
        await cleanup();
    }
});

test("database import rejects missing, invalid, and oversized uploads", async () => {
    const { app, session, cleanup } = await createTestApp({
        validateDatabase: () => {
            throw new InvalidDatabaseImportError();
        }
    });
    try {
        const missing = await app.request("/v1/admin/database/import", {
            method: "POST",
            headers: { Cookie: session }
        });
        assert.equal(missing.status, 400);

        const invalid = new FormData();
        invalid.set("database", new File(["not sqlite"], "source.db"));
        const invalidResponse = await app.request("/v1/admin/database/import", {
            method: "POST",
            headers: { Cookie: session },
            body: invalid
        });
        assert.equal(invalidResponse.status, 400);

        const oversized = await app.request("/v1/admin/database/import", {
            method: "POST",
            headers: {
                Cookie: session,
                "content-type": "multipart/form-data; boundary=test",
                "content-length": String(25 * 1024 * 1024 + 1)
            },
            body: "--test\r\n"
        });
        assert.equal(oversized.status, 400);
    } finally {
        await cleanup();
    }
});

test("database import bounds chunked multipart bodies with the documented 400 response", async () => {
    const { app, session, cleanup } = await createTestApp();
    try {
        const boundary = "database-upload";
        const body = `--${boundary}\r\nContent-Disposition: form-data; name="database"; filename="source.db"\r\nContent-Type: application/octet-stream\r\n\r\n${"x".repeat(25 * 1024 * 1024)}\r\n--${boundary}--\r\n`;
        const response = await app.request("/v1/admin/database/import", {
            method: "POST",
            headers: {
                Cookie: session,
                "content-type": `multipart/form-data; boundary=${boundary}`
            },
            body
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, "upload_too_large");
    } finally {
        await cleanup();
    }
});

test("database import maps typed transfer errors and cleans its private temp file", async () => {
    const errors = [
        [UnsupportedDatabaseError, 400],
        [InvalidDatabaseImportError, 400],
        [IncompatibleDatabaseError, 400],
        [DatabaseImportBusyError, 409],
        [DatabaseRecoveryError, 500]
    ] as const;

    for (const [ErrorType, status] of errors) {
        let candidatePath = "";
        let candidateDirectoryMode = 0;
        const { app, session, cleanup } = await createTestApp({
            validateDatabase: (candidate) => {
                candidatePath = candidate;
                candidateDirectoryMode = statSync(path.dirname(candidate)).mode & 0o777;
                throw new ErrorType();
            }
        });
        try {
            const form = new FormData();
            form.set("database", new File(["database"], "source.db"));
            const response = await app.request("/v1/admin/database/import", {
                method: "POST",
                headers: { Cookie: session },
                body: form
            });
            assert.equal(response.status, status);
            assert.ok(candidatePath.startsWith(path.join(SROUTER_DIR, "transfer-temp-")));
            assert.equal(candidateDirectoryMode, 0o700);
            assert.equal((await stat(candidatePath).catch(() => null)), null);
            const directory = path.dirname(candidatePath);
            assert.equal((await stat(directory).catch(() => null)), null);
        } finally {
            await cleanup();
        }
    }
});

test("database import maps replacement errors after writing a 0600 candidate", async () => {
    let candidateMode = 0;
    let candidatePath = "";
    const { app, session, cleanup } = await createTestApp({
        replaceDatabase: (candidate) => {
            candidatePath = candidate;
            candidateMode = statSync(candidate).mode & 0o777;
            throw new DatabaseRecoveryError();
        }
    });
    try {
        const form = new FormData();
        form.set("database", new File(["database"], "source.db"));
        const response = await app.request("/v1/admin/database/import", {
            method: "POST",
            headers: { Cookie: session },
            body: form
        });
        assert.equal(response.status, 500);
        assert.equal(candidateMode, 0o600);
        assert.equal((await stat(candidatePath).catch(() => null)), null);
    } finally {
        await cleanup();
    }
});
