import test from "node:test";
import assert from "node:assert/strict";
import {
    getPlatform,
    isWindows,
    isMacOS,
    isLinux,
    getOsDisplayName,
    detectShell,
    getSystemInfo,
    formatShellExport,
    getClaudeConfigPath,
    getOpenCodeConfigPath,
    isExecutableInPath
} from "../src/lib/platform.js";

test("platform - detects OS and returns valid platform information", () => {
    const platform = getPlatform();
    assert.ok(["windows", "macos", "linux", "unknown"].includes(platform));

    if (process.platform === "win32") {
        assert.equal(isWindows(), true);
        assert.equal(isMacOS(), false);
        assert.equal(isLinux(), false);
    } else if (process.platform === "darwin") {
        assert.equal(isWindows(), false);
        assert.equal(isMacOS(), true);
        assert.equal(isLinux(), false);
    } else if (process.platform === "linux") {
        assert.equal(isWindows(), false);
        assert.equal(isMacOS(), false);
        assert.equal(isLinux(), true);
    }

    const displayName = getOsDisplayName();
    assert.ok(typeof displayName === "string" && displayName.length > 0);

    const sysInfo = getSystemInfo();
    assert.equal(sysInfo.platform, platform);
    assert.ok(sysInfo.homeDir.length > 0);
    assert.ok(sysInfo.displayName.length > 0);
});

test("platform - detectShell and formatShellExport", () => {
    const shell = detectShell();
    assert.ok(["bash", "zsh", "fish", "powershell", "cmd"].includes(shell));

    assert.equal(formatShellExport("FOO", "BAR", "bash"), 'export FOO="BAR"');
    assert.equal(formatShellExport("FOO", "BAR", "zsh"), 'export FOO="BAR"');
    assert.equal(formatShellExport("FOO", "BAR", "fish"), 'set -gx FOO "BAR";');
    assert.equal(formatShellExport("FOO", "BAR", "powershell"), '$env:FOO = "BAR"');
    assert.equal(formatShellExport("FOO", "BAR", "cmd"), "set FOO=BAR");
});

test("platform - config path resolution", () => {
    const claudePath = getClaudeConfigPath();
    assert.ok(typeof claudePath === "string" && claudePath.length > 0);

    const opencodePath = getOpenCodeConfigPath();
    assert.ok(typeof opencodePath === "string" && opencodePath.length > 0);
});

test("platform - isExecutableInPath checks presence of binaries", async () => {
    // node is guaranteed to be in PATH during test execution
    const hasNode = await isExecutableInPath("node");
    assert.equal(hasNode, true);

    const hasFake = await isExecutableInPath("non_existent_binary_xyz_123");
    assert.equal(hasFake, false);
});
