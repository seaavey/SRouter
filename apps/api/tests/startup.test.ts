import assert from "node:assert/strict";
import { test } from "node:test";
import { RunStartupTasks } from "../src/services/startup.js";

test("RunStartupTasks initializes Postgres before required startup tasks", async () => {
    const events: string[] = [];
    const backgroundError = new Error("tunnel unavailable");
    let rejectTunnel: ((error: Error) => void) | undefined;
    const tunnelPromise = new Promise<void>((_, reject) => {
        rejectTunnel = reject;
    });

    const startup = RunStartupTasks({
        isPostgres: true,
        initDatabase: async () => {
            events.push("database");
        },
        bootstrapAdmin: async () => {
            events.push("admin");
        },
        autostartTunnel: () => tunnelPromise,
        startProviderRegistry: async () => {
            events.push("providers");
        },
        onBackgroundError: (error) => {
            events.push(error === backgroundError ? "tunnel-error" : "wrong-error");
        }
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    rejectTunnel?.(backgroundError);
    await startup;

    assert.deepEqual(events, ["database", "admin", "providers", "tunnel-error"]);
});

test("RunStartupTasks preserves SQLite ordering without database initialization", async () => {
    const events: string[] = [];

    await RunStartupTasks({
        isPostgres: false,
        initDatabase: async () => {
            events.push("database");
        },
        bootstrapAdmin: async () => {
            events.push("admin");
        },
        autostartTunnel: async () => {
            events.push("tunnel");
        },
        startProviderRegistry: async () => {
            events.push("providers");
        },
        onBackgroundError: () => {
            events.push("error");
        }
    });

    assert.deepEqual(events, ["admin", "tunnel", "providers"]);
});
