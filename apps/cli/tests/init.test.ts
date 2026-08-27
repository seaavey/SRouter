import test from "node:test";
import assert from "node:assert/strict";
import { createCli } from "../src/index.js";

test("CLI - init command registration", () => {
    const program = createCli();
    const initCmd = program.commands.find((c) => c.name() === "init");
    assert.ok(initCmd, "Init command should be registered");

    const optionFlags = initCmd.options.map((o) => o.long);
    assert.ok(optionFlags.includes("--mode"));
    assert.ok(optionFlags.includes("--port"));
    assert.ok(optionFlags.includes("--dir"));
    assert.ok(optionFlags.includes("--yes"));
    assert.ok(optionFlags.includes("--detached"));
});
