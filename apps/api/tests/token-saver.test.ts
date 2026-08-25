import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Hono } from "hono";
import {
    DEFAULT_TOKEN_SAVER_SETTINGS,
    getTokenSaverSettingsDB,
    setTokenSaverSettingsDB
} from "@srouter/db";
import type { TokenSaverSettings } from "@srouter/types";
import { TokenSaverController } from "../src/controllers/tokenSaver.controller.js";

afterEach(() => {
    // Reset to defaults
    setTokenSaverSettingsDB(DEFAULT_TOKEN_SAVER_SETTINGS);
});

test("TokenSaver DB gets defaults and updates settings cleanly", () => {
    const initial = getTokenSaverSettingsDB();
    assert.equal(initial.enabled, true);
    assert.equal(initial.compressToolOutput.compressGit, true);
    assert.equal(initial.lazySeniorDev.mode, "balanced");

    const updated = setTokenSaverSettingsDB({
        enabled: false,
        compressToolOutput: {
            ...initial.compressToolOutput,
            compressGit: false
        },
        lazySeniorDev: {
            enabled: true,
            mode: "strict"
        }
    });

    assert.equal(updated.enabled, false);
    assert.equal(updated.compressToolOutput.compressGit, false);
    assert.equal(updated.lazySeniorDev.mode, "strict");

    const retrieved = getTokenSaverSettingsDB();
    assert.equal(retrieved.enabled, false);
    assert.equal(retrieved.compressToolOutput.compressGit, false);
    assert.equal(retrieved.lazySeniorDev.mode, "strict");
});

test("TokenSaverController getSettings and updateSettings endpoints", async () => {
    const testApp = new Hono();
    testApp.get("/settings/token-saver", TokenSaverController.GetSettings);
    testApp.patch("/settings/token-saver", TokenSaverController.UpdateSettings);

    const getRes = await testApp.request("/settings/token-saver");
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as { settings: TokenSaverSettings };
    assert.equal(getBody.settings.enabled, true);

    const patchRes = await testApp.request("/settings/token-saver", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            enabled: true,
            compressLlmOutput: {
                enabled: true,
                mode: "ultra_terse",
                stripPleasantries: true
            }
        })
    });
    assert.equal(patchRes.status, 200);
    const patchBody = (await patchRes.json()) as { settings: TokenSaverSettings };
    assert.equal(patchBody.settings.compressLlmOutput.mode, "ultra_terse");
});

test("TokenSaverController preview endpoint simulates tool output and prompt savings", async () => {
    const testApp = new Hono();
    testApp.post("/settings/token-saver/test", TokenSaverController.Preview);

    const diffSample = `diff --git a/test.ts b/test.ts
index abcdef1..1234567 100644
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
 line 1
+added line 2
 line 3`;

    const res = await testApp.request("/settings/token-saver/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            type: "tool_output",
            text: diffSample
        })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
        originalText: string;
        transformedText: string;
        tokensSavedEstimate: number;
        percentageSaved: number;
    };
    assert.equal(body.originalText, diffSample);
    assert.ok(body.transformedText.length < body.originalText.length);
    assert.ok(body.tokensSavedEstimate > 0);
});
