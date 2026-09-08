import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { AdminAuthStore } from "../../../packages/db/src/adminAuth.js";
import { SqliteClient } from "../../../packages/db/src/client.js";
import { InvalidDatabaseImportError } from "../../../packages/db/src/databaseTransfer.js";
import { CreateDatabaseRouter } from "../src/routes/v1/database.js";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../src/services/adminAuth.js";

async function createTestApp(options: { validateDatabase?: () => never } = {}) {
    const store = new AdminAuthStore(new SqliteClient(new DatabaseSync(":memory:")));
    await store.createAdminAccount("hash");
    const directory = await mkdtemp(path.join(os.tmpdir(), "srouter-database-route-"));
    const sourcePath = path.join(directory, "source.db");
    await writeFile(sourcePath, "sqlite export");

    const app = new Hono();
    app.route(
        "/v1",
        CreateDatabaseRouter({
            store,
            exportDatabase: () => ({ format: "sqlite", path: sourcePath, size: 13 }),
            validateDatabase: options.validateDatabase ?? (() => ({
                requiredTables: ["providers"],
                schemaCompatible: true,
                integrityOk: true
            })),
            replaceDatabase: () => ({
                backupPath: path.join(os.homedir(), ".srouter/backups/import-backup-1.db"),
                restartRequired: false
            })
        })
    );

    return {
        app,
        session: `${ADMIN_SESSION_COOKIE}=${await createAdminSession(store)}`,
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
            restart_required: false
        });
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
        assert.equal(oversized.status, 413);
    } finally {
        await cleanup();
    }
});
