import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConfigStore } from "../src/lib/configStore.ts";
import { ClaudeAdapter } from "../src/adapters/claude.ts";

test("ClaudeAdapter - link and unlink lifecycle", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-claude-test-"));
    try {
        const store = new ConfigStore(tempDir);
        const customConfigPath = path.join(tempDir, ".claude.json");

        // Create initial config
        await fs.writeFile(
            customConfigPath,
            JSON.stringify({ model: "claude-orig", hasCompletedOnboarding: true })
        );

        const adapter = new ClaudeAdapter(store, customConfigPath);

        const statusBefore = await adapter.getStatus();
        assert.equal(statusBefore.linked, false);
        assert.equal(statusBefore.currentModel, "claude-orig");

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
        assert.equal(env.ANTHROPIC_BASE_URL, "http://localhost:3000/v1");
        assert.equal(env.ANTHROPIC_API_KEY, "sk-srouter-key");

        // Unlink & restore
        const unlinked = await adapter.unlink();
        assert.equal(unlinked, true);

        const restoredContent = JSON.parse(await fs.readFile(customConfigPath, "utf-8"));
        assert.equal(restoredContent.model, "claude-orig");
        assert.equal(restoredContent.ANTHROPIC_BASE_URL, undefined);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
