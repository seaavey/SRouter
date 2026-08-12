import assert from "node:assert/strict";
import test from "node:test";
import type {
    FreebuffRequestOptions,
    FreebuffSessionResponse,
    FreebuffUpstreamClientContract,
} from "./upstream.js";
import {
    FreebuffSessionManager,
    FreebuffWaitingRoomError,
    type FreebuffSessionLease,
    type FreebuffSessionSnapshot,
} from "./session.js";

class FakeUpstream implements FreebuffUpstreamClientContract {
    creates = 0;
    gets = 0;
    ends = 0;
    createDelayMs = 0;
    responses: FreebuffSessionResponse[] = [{ status: "active", instanceId: "inst-1", expiresAt: Date.now() + 60_000 }];
    getResponses: FreebuffSessionResponse[] = [];

    async createSession(_options?: FreebuffRequestOptions): Promise<FreebuffSessionResponse> {
        this.creates += 1;
        if (this.createDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.createDelayMs));
        return this.responses[Math.min(this.creates - 1, this.responses.length - 1)] ?? { status: "active", instanceId: "inst-1" };
    }
    async getSession(_instanceId: string, _options?: FreebuffRequestOptions): Promise<FreebuffSessionResponse> {
        this.gets += 1;
        return this.getResponses[Math.min(this.gets - 1, this.getResponses.length - 1)] ?? { status: "active", instanceId: "inst-1", expiresAt: Date.now() + 60_000 };
    }
    async endSession(_instanceId: string, _options?: FreebuffRequestOptions): Promise<void> { this.ends += 1; }
    async startRun(_agentId: string, _options?: FreebuffRequestOptions): Promise<string> { return "run-1"; }
    async finishRun(_runId: string, _totalSteps: number, _options?: FreebuffRequestOptions): Promise<void> { return undefined; }
    async chatCompletions(): Promise<Response> { return new Response(""); }
}

const activeResponse = (instanceId = "inst-1"): FreebuffSessionResponse => ({
    status: "active",
    instanceId,
    expiresAt: Date.now() + 60_000,
});

function lease(manager: FreebuffSessionManager): Promise<FreebuffSessionLease> {
    return manager.ensureSession();
}

test("creates an active session and reuses it before expiry margin", async () => {
    const upstream = new FakeUpstream();
    upstream.responses = [activeResponse()];
    const manager = new FreebuffSessionManager(upstream, { expiryMarginMs: 5_000 });
    const first = await lease(manager);
    const second = await lease(manager);
    assert.equal(first.instanceId, "inst-1");
    assert.equal(second.instanceId, "inst-1");
    assert.equal(upstream.creates, 1);
    assert.equal(manager.snapshot().status, "active");
});

test("refreshes an expired session", async () => {
    const upstream = new FakeUpstream();
    upstream.responses = [
        { status: "active", instanceId: "old", expiresAt: Date.now() - 1 },
        activeResponse("new"),
    ];
    const manager = new FreebuffSessionManager(upstream, { expiryMarginMs: 5_000 });
    const first = await lease(manager);
    const second = await lease(manager);
    assert.equal(first.instanceId, "old");
    assert.equal(second.instanceId, "new");
    assert.equal(upstream.creates, 2);
});

test("shares one in-flight refresh among concurrent callers", async () => {
    const upstream = new FakeUpstream();
    upstream.createDelayMs = 20;
    const manager = new FreebuffSessionManager(upstream);
    const leases = await Promise.all(Array.from({ length: 12 }, () => lease(manager)));
    assert.equal(upstream.creates, 1);
    assert.equal(new Set(leases.map((item) => item.instanceId)).size, 1);
});

test("surfaces queued retry metadata and polls after retry time", async () => {
    const upstream = new FakeUpstream();
    upstream.responses = [{ status: "queued", instanceId: "queued-1", position: 2, queueDepth: 7, estimatedWaitMs: 1 }];
    upstream.getResponses = [activeResponse("ready")];
    const manager = new FreebuffSessionManager(upstream, { minimumRetryMs: 1 });
    await assert.rejects(() => lease(manager), (error: Error) => {
        assert.ok(error instanceof FreebuffWaitingRoomError);
        assert.equal(error.position, 2);
        assert.equal(error.queueDepth, 7);
        return true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await lease(manager);
    assert.equal(result.instanceId, "ready");
    assert.equal(upstream.gets, 1);
});

test("recreates ended and superseded sessions", async () => {
    const upstream = new FakeUpstream();
    upstream.responses = [{ status: "ended" }, activeResponse("fresh")];
    const manager = new FreebuffSessionManager(upstream);
    const result = await lease(manager);
    assert.equal(result.instanceId, "fresh");
    assert.equal(upstream.creates, 2);
});

test("supports invalidation, disabled sessions, and cleanup", async () => {
    const upstream = new FakeUpstream();
    upstream.responses = [{ status: "disabled" }, activeResponse("after-invalidate")];
    const manager = new FreebuffSessionManager(upstream);
    const disabled = await lease(manager);
    assert.equal(disabled.instanceId, undefined);
    assert.equal(manager.snapshot().status, "disabled");
    manager.invalidate();
    const active = await lease(manager);
    assert.equal(active.instanceId, "after-invalidate");
    await manager.end();
    assert.equal(upstream.ends, 1);
    assert.equal(manager.snapshot().status, "none");
});

test("returns a stable snapshot without exposing token material", async () => {
    const upstream = new FakeUpstream();
    const manager = new FreebuffSessionManager(upstream);
    await lease(manager);
    const snapshot: FreebuffSessionSnapshot = manager.snapshot();
    assert.deepEqual(Object.keys(snapshot).sort(), ["expiresAt", "instanceId", "position", "queueDepth", "retryAt", "status"]);
    assert.equal(JSON.stringify(snapshot).includes("freebuff"), false);
});
