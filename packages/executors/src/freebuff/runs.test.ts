import assert from "node:assert/strict";
import test from "node:test";
import type { FreebuffRequestOptions, FreebuffUpstreamClientContract } from "./upstream.js";
import {
    FreebuffRunManager,
    type FreebuffRunLease,
    type FreebuffRunSnapshot,
} from "./runs.js";

class FakeUpstream implements FreebuffUpstreamClientContract {
    starts = 0;
    finishes = 0;
    startDelayMs = 0;
    startedAgents: string[] = [];
    finishedRuns: Array<{ runId: string; totalSteps: number }> = [];

    async createSession(): Promise<{ status: "active"; instanceId: string }> { return { status: "active", instanceId: "session" }; }
    async getSession(): Promise<{ status: "active"; instanceId: string }> { return { status: "active", instanceId: "session" }; }
    async endSession(): Promise<void> { return undefined; }
    async startRun(agentId: string, _options?: FreebuffRequestOptions): Promise<string> {
        this.starts += 1;
        this.startedAgents.push(agentId);
        if (this.startDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.startDelayMs));
        return `run-${this.starts}`;
    }
    async finishRun(runId: string, totalSteps: number, _options?: FreebuffRequestOptions): Promise<void> {
        this.finishes += 1;
        this.finishedRuns.push({ runId, totalSteps });
    }
    async chatCompletions(): Promise<Response> { return new Response(""); }
}

test("lazily starts and reuses a run with inflight lease accounting", async () => {
    const upstream = new FakeUpstream();
    const manager = new FreebuffRunManager(upstream, { rotationIntervalMs: 60_000 });
    const first = await manager.acquireRun("agent-1");
    const second = await manager.acquireRun("agent-1");
    assert.equal(first.runId, second.runId);
    assert.equal(upstream.starts, 1);
    assert.equal(manager.snapshot().activeLeases, 2);
    manager.releaseRun(first);
    manager.releaseRun(second);
    assert.equal(manager.snapshot().activeLeases, 0);
});

test("converges concurrent START calls to one upstream run", async () => {
    const upstream = new FakeUpstream();
    upstream.startDelayMs = 20;
    const manager = new FreebuffRunManager(upstream);
    const leases = await Promise.all(Array.from({ length: 10 }, () => manager.acquireRun("agent-1")));
    assert.equal(upstream.starts, 1);
    assert.equal(new Set(leases.map((lease) => lease.runId)).size, 1);
    for (const lease of leases) manager.releaseRun(lease);
});

test("rotates aged runs and finishes the drained run after leases release", async () => {
    const upstream = new FakeUpstream();
    const manager = new FreebuffRunManager(upstream, { rotationIntervalMs: 1 });
    const oldLease = await manager.acquireRun("agent-1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newLease = await manager.acquireRun("agent-1");
    assert.notEqual(newLease.runId, oldLease.runId);
    assert.equal(upstream.starts, 2);
    manager.releaseRun(oldLease);
    await manager.maintain();
    assert.equal(upstream.finishes, 1);
    assert.equal(upstream.finishedRuns[0]?.runId, oldLease.runId);
    manager.releaseRun(newLease);
});

test("invalidates an agent run and starts a replacement", async () => {
    const upstream = new FakeUpstream();
    const manager = new FreebuffRunManager(upstream);
    const first = await manager.acquireRun("agent-1");
    manager.invalidateRun("agent-1");
    const second = await manager.acquireRun("agent-1");
    assert.notEqual(first.runId, second.runId);
    assert.equal(upstream.starts, 2);
    manager.releaseRun(first);
    manager.releaseRun(second);
});

test("honors cooldown and resumes after cooldown expires", async () => {
    const upstream = new FakeUpstream();
    const manager = new FreebuffRunManager(upstream);
    manager.cooldown(10);
    await assert.rejects(() => manager.acquireRun("agent-1"), /cooldown/i);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const lease = await manager.acquireRun("agent-1");
    manager.releaseRun(lease);
});

test("prewarms agents and shutdown finishes active runs", async () => {
    const upstream = new FakeUpstream();
    const manager = new FreebuffRunManager(upstream);
    await manager.prewarm(["agent-1", "agent-2"]);
    assert.equal(upstream.starts, 2);
    const snapshot: FreebuffRunSnapshot = manager.snapshot();
    assert.equal(snapshot.activeRuns, 2);
    await manager.shutdown();
    assert.equal(upstream.finishes, 2);
    assert.equal(manager.snapshot().activeRuns, 0);
});

test("release is idempotent and does not expose token material", async () => {
    const upstream = new FakeUpstream();
    const manager = new FreebuffRunManager(upstream);
    const lease: FreebuffRunLease = await manager.acquireRun("agent-1");
    manager.releaseRun(lease);
    manager.releaseRun(lease);
    assert.equal(manager.snapshot().activeLeases, 0);
    assert.equal(JSON.stringify(manager.snapshot()).includes("token"), false);
});
