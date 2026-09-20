import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "@srouter/db";
import { migrateCommand } from "../src/commands/migrate.js";

test("9Router database migration imports SQLite tables safely", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "srouter-migrate-test-"));
    const sourceDbPath = path.join(tempDir, "9router-mock.db");

    const sourceDb = new DatabaseSync(sourceDbPath);
    sourceDb.exec(`
        CREATE TABLE providers (
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
        INSERT INTO providers (id, provider_id, name, category, protocol, api_key, enabled, created_at)
        VALUES ('prov_1', 'openai', 'OpenAI Main', 'general', 'openai', 'sk-test', 1, 1700000000);
    `);
    sourceDb.close();

    await migrateCommand("9router", {
        source: sourceDbPath,
        yes: true
    });

    // Isolated test database (redirected by tests/setup.ts) — never production.
    const targetDbPath = getDatabasePath();
    assert.equal(fs.existsSync(targetDbPath), true);

    const targetDb = new DatabaseSync(targetDbPath);
    const row = targetDb.prepare("SELECT * FROM providers WHERE id = ?").get("prov_1") as Record<string, unknown>;
    targetDb.close();

    assert.ok(row);
    assert.equal(row.name, "OpenAI Main");
    assert.equal(row.api_key, "sk-test");

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test("9Router JSON backup export imports providers, apiKeys and customModels safely", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "srouter-migrate-json-"));
    const jsonPath = path.join(tempDir, "9router-backup.json");

    const sampleBackup = {
        providerConnections: [
            {
                id: "conn-123",
                provider: "node-456",
                name: "My OpenAI Node",
                apiKey: "sk-sample-key",
                isActive: true,
                createdAt: "2026-07-30T03:36:31.214Z"
            },
            {
                id: "conn-antigravity",
                provider: "antigravity",
                name: "Antigravity OAuth",
                accessToken: "ya29.sample",
                refreshToken: "1//sample",
                isActive: true,
                createdAt: "2026-07-31T15:11:20.567Z"
            }
        ],
        providerNodes: [
            {
                id: "node-456",
                name: "LegacyGateway",
                baseUrl: "https://legacy-gateway.example/v1",
                apiType: "chat"
            }
        ],
        apiKeys: [
            {
                id: "key-1",
                key: "nr_live_12345",
                name: "Main Key",
                isActive: true,
                createdAt: "2026-07-28T22:11:04.103568"
            }
        ],
        customModels: [
            {
                providerAlias: "legacygateway",
                id: "deepseek-v4",
                name: "deepseek-v4"
            }
        ]
    };

    fs.writeFileSync(jsonPath, JSON.stringify(sampleBackup, null, 2));

    await migrateCommand("9router", {
        source: jsonPath,
        yes: true
    });

    // Isolated test database (redirected by tests/setup.ts) — never production.
    const targetDbPath = getDatabasePath();
    const targetDb = new DatabaseSync(targetDbPath);

    const provider1 = targetDb.prepare("SELECT * FROM providers WHERE id = ?").get("conn-123") as Record<string, unknown>;
    const provider2 = targetDb.prepare("SELECT * FROM providers WHERE id = ?").get("conn-antigravity") as Record<string, unknown>;
    const apiKey = targetDb.prepare("SELECT * FROM api_keys WHERE id = ?").get("key-1") as Record<string, unknown>;
    const model = targetDb.prepare("SELECT * FROM custom_models WHERE model_id = ?").get("deepseek-v4") as Record<string, unknown>;

    targetDb.close();

    assert.ok(provider1);
    assert.equal(provider1.provider_id, "legacygateway");
    assert.equal(provider1.base_url, "https://legacy-gateway.example/v1");
    assert.equal(provider1.api_key, "sk-sample-key");

    assert.ok(provider2);
    assert.equal(provider2.provider_id, "antigravity");
    assert.equal(provider2.access_token, "ya29.sample");

    assert.ok(apiKey);
    assert.equal(apiKey.key, "nr_live_12345");

    assert.ok(model);
    assert.equal(model.provider_id, "legacygateway");

    fs.rmSync(tempDir, { recursive: true, force: true });
});
