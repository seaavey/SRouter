import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatCompletionRequest } from "@srouter/types";
import type {
    FreebuffChatRequest,
    FreebuffRequestOptions,
    FreebuffSessionResponse,
    FreebuffUpstreamClientContract,
} from "./upstream.js";
import { FreebuffCoordinator } from "./coordinator.js";
import { FreebuffRunManager } from "./runs.js";
import { FreebuffSessionManager } from "./session.js";

const request: ChatCompletionRequest = {
    model: "freebuff/deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
};

class FakeUpstream implements FreebuffUpstreamClientContract {
    public readonly token: string;
    public readonly chatCalls: number[] = [];
    public readonly finishedRuns: string[] = [];
    public startRunCalls = 0;
    public sessionEnds = 0;
    public pendingStart: Promise<string> | undefined;
    public resolvePendingStart: ((runId: string) => void) | undefined;
    public pendingSession: Promise<FreebuffSessionResponse> | undefined;
    public resolvePendingSession: ((response: FreebuffSessionResponse) => void) | undefined;

    public constructor(token: string) {
        this.token = token;
    }

    public createSession(): Promise<FreebuffSessionResponse> {
        if (this.pendingSession !== undefined) return this.pendingSession;
        return Promise.resolve({ status: "active", instanceId: `instance-${this.token}` });
    }

    public getSession(): Promise<FreebuffSessionResponse> {
        return Promise.resolve({ status: "active", instanceId: `instance-${this.token}` });
    }

    public endSession(): Promise<void> {
        this.sessionEnds += 1;
        return Promise.resolve();
    }

    public startRun(): Promise<string> {
        this.startRunCalls += 1;
        if (this.token !== "slow") return Promise.resolve(`run-${this.token}`);
        this.pendingStart = new Promise<string>((resolve) => {
            this.resolvePendingStart = resolve;
        });
        return this.pendingStart;
    }

    public finishRun(runId: string): Promise<void> {
        this.finishedRuns.push(runId);
        return Promise.resolve();
    }

    public chatCompletions(): Promise<Response> {
        this.chatCalls.push(Date.now());
        if (this.token === "first") {
            let failed = false;
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: {"id":"first","model":"deepseek/deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n'));
                },
                pull(controller) {
                    if (!failed) {
                        failed = true;
                        controller.error(new Error("connection dropped after partial output"));
                    }
                },
            });
            return Promise.resolve(new Response(body, { status: 200 }));
        }
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"id":"second","model":"deepseek/deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"replacement"},"finish_reason":"stop"}]}\n'));
                controller.close();
            },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
    }
}

function config(id: string, token: string) {
    return { id, accessToken: token, baseUrl: "https://example.test", enabled: true } as const;
}

test("does not fail over after a partial SSE response", async () => {
    const upstreams: FakeUpstream[] = [];
    const coordinator = new FreebuffCoordinator({
        createUpstream(connection) {
            const upstream = new FakeUpstream(connection.accessToken);
            upstreams.push(upstream);
            return upstream;
        },
    });
    coordinator.register(config("first", "first"));
    coordinator.register(config("second", "second"));

    const chunks: unknown[] = [];
    await assert.rejects(
        (async () => {
            for await (const chunk of coordinator.chatCompletionStream(request)) chunks.push(chunk);
        })(),
        /connection dropped after partial output/,
    );

    assert.equal(chunks.length, 1);
    assert.deepEqual(upstreams.map((upstream) => upstream.chatCalls.length), [1, 0]);
});

test("does not resurrect a run whose START resolves after shutdown", async () => {
    let upstream: FakeUpstream | undefined;
    const manager = new FreebuffRunManager(
        (upstream = new FakeUpstream("slow")),
        { shutdownTimeoutMs: 100 },
    );
    const acquire = manager.acquireRun("base2-free-deepseek");
    await new Promise<void>((resolve) => setImmediate(resolve));
    const shutdown = manager.shutdown();
    upstream.resolvePendingStart?.("late-run");

    await shutdown;
    await assert.rejects(acquire, /shutdown/i);
    assert.equal(manager.snapshot().activeRuns, 0);
    assert.deepEqual(upstream.finishedRuns, ["late-run"]);
});

test("does not return a session lease after end invalidates an in-flight refresh", async () => {
    const upstream = new FakeUpstream("session");
    upstream.pendingSession = new Promise<FreebuffSessionResponse>((resolve) => {
        upstream.resolvePendingSession = resolve;
    });
    const manager = new FreebuffSessionManager(upstream);
    const ensure = manager.ensureSession();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const ending = manager.end();
    upstream.resolvePendingSession?.({ status: "active", instanceId: "late-instance" });

    await ending;
    await assert.rejects(ensure, /invalidated|ended|lifecycle/i);
    assert.equal(upstream.sessionEnds, 1);
});
