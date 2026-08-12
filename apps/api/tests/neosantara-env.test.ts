import assert from "node:assert/strict";
import { after, test } from "node:test";

const originalFetch = globalThis.fetch;
const originalKey = process.env.NEOSANTARA_API_KEY;
const originalBaseUrl = process.env.NEOSANTARA_BASE_URL;

after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.NEOSANTARA_API_KEY;
    else process.env.NEOSANTARA_API_KEY = originalKey;
    if (originalBaseUrl === undefined) delete process.env.NEOSANTARA_BASE_URL;
    else process.env.NEOSANTARA_BASE_URL = originalBaseUrl;
});

test("environment Neosantara connection honors the configured base URL", async () => {
    const fixtureKey = "fixture-env-key-not-a-secret";
    process.env.NEOSANTARA_API_KEY = fixtureKey;
    process.env.NEOSANTARA_BASE_URL = "https://neosantara.test/v1";

    let requestUrl = "";
    let hasBearerHeader = false;
    globalThis.fetch = async (input, init) => {
        requestUrl = String(input);
        const authorization = new Headers(init?.headers).get("authorization") ?? "";
        hasBearerHeader = authorization.startsWith("Bearer ") && authorization.endsWith(fixtureKey);
        return Response.json({ data: [] });
    };

    const { registry } = await import("../src/services/registry.js");
    const provider = registry.getProvider("neosantara");
    assert.ok(provider);
    await provider.listModels();

    assert.equal(requestUrl, "https://neosantara.test/v1/models");
    assert.equal(hasBearerHeader, true);
    registry.unregisterProvider("neosantara");
});
