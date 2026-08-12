import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import test from "node:test";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import {
    FreebuffUpstreamClient,
    buildChatEnvelope,
    createFreebuffTransport,
    type FreebuffChatOptions,
    type FreebuffTransportConfig,
} from "./upstream.js";
import { FreebuffAuthError, FreebuffRateLimitError } from "./errors.js";

interface CapturedRequest {
    method: string;
    path: string;
    headers: Record<string, string | undefined>;
    body: string;
}

interface MockResponse {
    status: number;
    headers?: Record<string, string>;
    body: string;
    encodedBody?: Uint8Array;
    delayMs?: number;
}

interface MockState {
    requests: CapturedRequest[];
    responses: Record<string, MockResponse>;
}

function headerValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function readRequest(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
    });
}

async function startMockServer(): Promise<{ server: Server; baseUrl: string; state: MockState }> {
    const state: MockState = { requests: [], responses: {} };
    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
        const body = await readRequest(request);
        const path = request.url ?? "/";
        const headers: Record<string, string | undefined> = {
            authorization: headerValue(request.headers.authorization),
            "content-type": headerValue(request.headers["content-type"]),
            accept: headerValue(request.headers.accept),
            "x-freebuff-model": headerValue(request.headers["x-freebuff-model"]),
            "x-freebuff-instance-id": headerValue(request.headers["x-freebuff-instance-id"]),
            "user-agent": headerValue(request.headers["user-agent"]),
        };
        state.requests.push({ method: request.method ?? "", path, headers, body });
        const configured = state.responses[`${request.method ?? ""} ${path}`] ?? { status: 200, body: "{}" };
        if (configured.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, configured.delayMs));
        response.writeHead(configured.status, configured.headers ?? { "content-type": "application/json" });
        response.end(configured.encodedBody ?? configured.body);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return { server, baseUrl: `http://127.0.0.1:${address.port}`, state };
}

async function closeServer(server: Server): Promise<void> {
    server.close();
    await once(server, "close");
}

function config(baseUrl: string, overrides: Partial<FreebuffTransportConfig> = {}): FreebuffTransportConfig {
    return {
        baseUrl,
        accessToken: "freebuff-test-token",
        timeoutMs: 1_000,
        ...overrides,
    };
}

function client(baseUrl: string, overrides: Partial<FreebuffTransportConfig> = {}): FreebuffUpstreamClient {
    return new FreebuffUpstreamClient(createFreebuffTransport(config(baseUrl, overrides)));
}

function parseJson(body: string): Record<string, string | boolean | Record<string, string> | string[]> {
    return JSON.parse(body) as Record<string, string | boolean | Record<string, string> | string[]>;
}

test("buildChatEnvelope is pure, forces streaming, denies collection, and preserves nested model IDs", () => {
    const input = {
        model: "provider/namespace/model",
        messages: [{ role: "user", content: "hello" }],
        stop: ["custom-stop"],
        provider: { data_collection: "allow" },
    };
    const first = buildChatEnvelope(input, { runId: "run-1", clientId: "client-1", instanceId: "instance-1" });
    const second = buildChatEnvelope(input, { runId: "run-1", clientId: "client-1", instanceId: "instance-1" });
    assert.deepEqual(first, second);
    assert.equal(first.model, input.model);
    assert.equal(first.stream, true);
    assert.deepEqual(first.stop, input.stop);
    assert.deepEqual(first.provider, { data_collection: "deny" });
    assert.deepEqual(first.codebuff_metadata, {
        run_id: "run-1",
        client_id: "client-1",
        freebuff_instance_id: "instance-1",
    });
});

test("runs the complete lifecycle with exact paths, methods, auth, and metadata headers", async () => {
    const fixture = await startMockServer();
    try {
        fixture.state.responses["POST /api/v1/freebuff/session"] = { status: 200, body: JSON.stringify({ status: "ready", instanceId: "instance-1" }) };
        fixture.state.responses["GET /api/v1/freebuff/session"] = { status: 200, body: JSON.stringify({ status: "ready", instanceId: "instance-1" }) };
        fixture.state.responses["DELETE /api/v1/freebuff/session"] = { status: 204, body: "" };
        fixture.state.responses["POST /api/v1/agent-runs"] = { status: 200, body: JSON.stringify({ runId: "run-1" }) };

        const upstream = client(fixture.baseUrl);
        const created = await upstream.createSession();
        const fetched = await upstream.getSession("instance-1");
        await upstream.endSession("instance-1");
        const runId = await upstream.startRun("agent-1");
        await upstream.finishRun(runId, 3);

        assert.equal(created.status, "ready");
        assert.equal(fetched.instanceId, "instance-1");
        assert.equal(runId, "run-1");
        assert.deepEqual(fixture.state.requests.map((request) => `${request.method} ${request.path}`), [
            "POST /api/v1/freebuff/session",
            "GET /api/v1/freebuff/session",
            "DELETE /api/v1/freebuff/session",
            "POST /api/v1/agent-runs",
            "POST /api/v1/agent-runs",
        ]);
        for (const request of fixture.state.requests) {
            assert.equal(request.headers.authorization, "Bearer freebuff-test-token");
            assert.equal(request.headers["content-type"], "application/json");
        }
        assert.deepEqual(parseJson(fixture.state.requests[3].body), { action: "START", agentId: "agent-1" });
        assert.deepEqual(parseJson(fixture.state.requests[4].body), {
            action: "FINISH",
            runId: "run-1",
            status: "completed",
            totalSteps: 3,
            directCredits: 0,
            totalCredits: 0,
        });
    } finally {
        await closeServer(fixture.server);
    }
});

test("captures chat envelope, exact headers, and returns the SSE body", async () => {
    const fixture = await startMockServer();
    try {
        const sse = "data: {\"id\":\"chunk-1\"}\n\ndata: [DONE]\n\n";
        fixture.state.responses["POST /api/v1/chat/completions"] = { status: 200, headers: { "content-type": "text/event-stream" }, body: sse };
        const upstream = client(fixture.baseUrl);
        const options: FreebuffChatOptions = { model: "vendor/nested/model", runId: "run-1", clientId: "client-1", instanceId: "instance-1" };
        const response = await upstream.chatCompletions({ model: options.model ?? "", messages: [{ role: "user", content: "hello" }] }, options);
        assert.equal(await response.text(), sse);
        const request = fixture.state.requests[0];
        assert.equal(request.path, "/api/v1/chat/completions");
        assert.equal(request.headers.authorization, "Bearer freebuff-test-token");
        assert.equal(request.headers["x-freebuff-model"], options.model);
        assert.equal(request.headers["x-freebuff-instance-id"], "instance-1");
        assert.match(request.headers["user-agent"] ?? "", /./);
        const body = JSON.parse(request.body) as {
            model: string;
            stream: boolean;
            stop: string[];
            provider: { data_collection: string };
            codebuff_metadata: { run_id: string; client_id: string; freebuff_instance_id: string };
        };
        assert.equal(body.model, options.model);
        assert.equal(body.stream, true);
        assert.deepEqual(body.stop, ["cb_easp"]);
        assert.deepEqual(body.provider, { data_collection: "deny" });
        assert.deepEqual(body.codebuff_metadata, { run_id: "run-1", client_id: "client-1", freebuff_instance_id: "instance-1" });
    } finally {
        await closeServer(fixture.server);
    }
});

test("does not overwrite an explicitly supplied stop value and omits optional instance header", async () => {
    const fixture = await startMockServer();
    try {
        fixture.state.responses["POST /api/v1/chat/completions"] = { status: 200, body: "{}" };
        const upstream = client(fixture.baseUrl);
        await (await upstream.chatCompletions({ model: "m", messages: [], stop: ["user-stop"] }, { model: "m", runId: "r", clientId: "c" })).text();
        const request = fixture.state.requests[0];
        assert.equal(request.headers["x-freebuff-instance-id"], undefined);
        const body = JSON.parse(request.body) as { stop: string[]; codebuff_metadata: Record<string, string> };
        assert.deepEqual(body.stop, ["user-stop"]);
        assert.deepEqual(body.codebuff_metadata, { run_id: "r", client_id: "c" });
    } finally {
        await closeServer(fixture.server);
    }
});

test("classifies bounded upstream errors", async () => {
    const fixture = await startMockServer();
    try {
        fixture.state.responses["POST /api/v1/chat/completions"] = { status: 401, body: "freebuff-secret-token" + "x".repeat(5000) };
        await assert.rejects(
            () => client(fixture.baseUrl).chatCompletions({ model: "m", messages: [] }, { model: "m", runId: "r", clientId: "c" }),
            (error: Error) => error instanceof FreebuffAuthError && !error.message.includes("freebuff-secret-token"),
        );
        fixture.state.responses["POST /api/v1/chat/completions"] = { status: 429, headers: { "retry-after": "12" }, body: JSON.stringify({ error: "quota" }) };
        await assert.rejects(
            () => client(fixture.baseUrl).chatCompletions({ model: "m", messages: [] }, { model: "m", runId: "r", clientId: "c" }),
            (error: Error) => error instanceof FreebuffRateLimitError && error.retryAfterSeconds === 12,
        );
    } finally {
        await closeServer(fixture.server);
    }
});

test("honors caller abort and per-call timeout", async () => {
    const fixture = await startMockServer();
    try {
        fixture.state.responses["GET /api/v1/freebuff/session"] = { status: 200, body: "{}", delayMs: 100 };
        const controller = new AbortController();
        const aborted = client(fixture.baseUrl).getSession("instance-1", { signal: controller.signal });
        controller.abort();
        await assert.rejects(aborted, (error: Error) => error.name === "AbortError");

        const timeoutFixture = await startMockServer();
        try {
            timeoutFixture.state.responses["GET /api/v1/freebuff/session"] = { status: 200, body: "{}", delayMs: 100 };
            await assert.rejects(
                () => client(timeoutFixture.baseUrl, { timeoutMs: 10 }).getSession("instance-1"),
                (error: Error) => error.name === "TimeoutError" || error.name === "AbortError",
            );
        } finally {
            await closeServer(timeoutFixture.server);
        }
    } finally {
        await closeServer(fixture.server);
    }
});
