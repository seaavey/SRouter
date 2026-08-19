import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkServerHealth, fetchAvailableModels } from "../src/lib/srouterClient.ts";

test("srouterClient - checkServerHealth and fetchAvailableModels", async () => {
    const server = http.createServer((req, res) => {
        if (req.url === "/v1/models") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    data: [
                        { id: "claude-3-7-sonnet", object: "model" },
                        { id: "gpt-4o", object: "model" }
                    ]
                })
            );
            return;
        }
        res.writeHead(404);
        res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://localhost:${port}`;

    const health = await checkServerHealth(baseUrl);
    assert.equal(health.healthy, true);
    assert.equal(health.modelsCount, 2);

    const models = await fetchAvailableModels(baseUrl);
    assert.deepEqual(models, ["claude-3-7-sonnet", "gpt-4o"]);

    server.close();
});

test("srouterClient - handles unreachable server gracefully", async () => {
    const health = await checkServerHealth("http://localhost:59999", undefined, 500);
    assert.equal(health.healthy, false);
    assert.equal(health.modelsCount, 0);

    const models = await fetchAvailableModels("http://localhost:59999");
    assert.deepEqual(models, []);
});
