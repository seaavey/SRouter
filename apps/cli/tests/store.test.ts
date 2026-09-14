import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConfigStore } from "../src/lib/store.js";

test("ConfigStore - load and save config", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-cli-test-"));
    try {
        const store = new ConfigStore(tempDir);
        const initial = await store.loadConfig();
        assert.equal(initial.default_base_url, "http://localhost:3000/v1");
        assert.deepEqual(initial.backups, []);

        await store.saveConfig({
            default_base_url: "http://localhost:4000/v1",
            default_api_key: "sk-test-123"
        });

        const updated = await store.loadConfig();
        assert.equal(updated.default_base_url, "http://localhost:4000/v1");
        assert.equal(updated.default_api_key, "sk-test-123");
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("ConfigStore - backup and restore workflow", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-cli-test-"));
    try {
        const store = new ConfigStore(tempDir);
        const sampleConfigFile = path.join(tempDir, "mock-tool.json");

        // 1. Create a dummy original config
        await fs.writeFile(
            sampleConfigFile,
            JSON.stringify({ original: true, model: "old-model" })
        );

        // 2. Backup
        const backup_path = await store.createBackup("mock-tool", sampleConfigFile);
        assert.ok(backup_path);
        assert.ok(backup_path.includes("mock-tool-"));

        // 3. Mutate original
        await fs.writeFile(
            sampleConfigFile,
            JSON.stringify({ modified: true, model: "srouter-model" })
        );

        // 4. Restore
        const restored = await store.restoreLatestBackup("mock-tool");
        assert.equal(restored, true);

        const content = JSON.parse(await fs.readFile(sampleConfigFile, "utf-8"));
        assert.equal(content.original, true);
        assert.equal(content.model, "old-model");
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
