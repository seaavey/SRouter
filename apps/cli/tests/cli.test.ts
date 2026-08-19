import test from "node:test";
import assert from "node:assert/strict";
import { createCli } from "../src/index.js";

test("CLI - command registration and metadata", () => {
    const program = createCli();

    assert.equal(program.name(), "srouter");
    assert.equal(program.version(), "0.1.1-rc.1");

    const commandNames = program.commands.map((cmd) => cmd.name());
    assert.ok(commandNames.includes("setup"));
    assert.ok(commandNames.includes("link"));
    assert.ok(commandNames.includes("unlink"));
    assert.ok(commandNames.includes("status"));
    assert.ok(commandNames.includes("env"));
    assert.ok(commandNames.includes("run"));
});
