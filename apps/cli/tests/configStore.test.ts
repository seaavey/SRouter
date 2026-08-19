import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConfigStore } from "../src/lib/configStore.js";

test("ConfigStore - load and save config", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-cli-test-"));
    try {
        const store = new ConfigStore(tempDir);
        const initial = await store.loadConfig();
        assert.equal(initial.defaultBaseUrl, "http://localhost:3000/v1");
        assert.deepEqual(initial.backups, []);

        await store.saveConfig({
            defaultBaseUrl: "http://localhost:4000/v1",
            defaultApiKey: "sk-test-123"
        });

        const updated = await store.loadConfig();
        assert.equal(updated.defaultBaseUrl, "http://localhost:4000/v1");
        assert.equal(updated.defaultApiKey, "sk-test-123");
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
        const backupPath = await store.createBackup("mock-tool", sampleConfigFile);
        assert.ok(backupPath);
        assert.ok(backupPath.includes("mock-tool-"));

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
