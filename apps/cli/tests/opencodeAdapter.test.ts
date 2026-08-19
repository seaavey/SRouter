import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConfigStore } from "../src/lib/configStore.js";
import { OpenCodeAdapter } from "../src/adapters/opencode.js";
import { getAllAdapters, getAdapter } from "../src/adapters/index.js";

test("OpenCodeAdapter - link and unlink lifecycle", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-opencode-test-"));
    try {
        const store = new ConfigStore(tempDir);
        const customConfigPath = path.join(tempDir, "config.json");

        // Create initial config
        await fs.writeFile(
            customConfigPath,
            JSON.stringify({ model: "default-model", auto_run: true })
        );

        const adapter = new OpenCodeAdapter(store, customConfigPath);

        const statusBefore = await adapter.getStatus();
        assert.equal(statusBefore.linked, false);
        assert.equal(statusBefore.currentModel, "default-model");

        // Link with SRouter
        const result = await adapter.link({
            baseUrl: "http://localhost:3000/v1",
            apiKey: "sk-srouter-key",
            model: "claude-3-7-sonnet"
        });

        assert.ok(result.backupPath);
        assert.equal(result.modifiedPath, customConfigPath);

        const statusAfter = await adapter.getStatus();
        assert.equal(statusAfter.linked, true);
        assert.equal(statusAfter.currentBaseUrl, "http://localhost:3000/v1");
        assert.equal(statusAfter.currentModel, "claude-3-7-sonnet");

        // Check getEnv
        const env = adapter.getEnv({
            baseUrl: "http://localhost:3000/v1",
            apiKey: "sk-srouter-key",
            model: "claude-3-7-sonnet"
        });
        assert.equal(env.OPENAI_BASE_URL, "http://localhost:3000/v1");
        assert.equal(env.OPENAI_API_KEY, "sk-srouter-key");

        // Unlink & restore
        const unlinked = await adapter.unlink();
        assert.equal(unlinked, true);

        const restoredContent = JSON.parse(await fs.readFile(customConfigPath, "utf-8"));
        assert.equal(restoredContent.model, "default-model");
        assert.equal(restoredContent.openai_base_url, undefined);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("Adapter Registry - retrieves registered adapters", () => {
    const adapters = getAllAdapters();
    assert.ok(adapters.length >= 2);

    const claude = getAdapter("claude");
    assert.ok(claude);
    assert.equal(claude?.id, "claude");

    const opencode = getAdapter("opencode");
    assert.ok(opencode);
    assert.equal(opencode?.id, "opencode");

    const nonexistent = getAdapter("nonexistent");
    assert.equal(nonexistent, undefined);
});
