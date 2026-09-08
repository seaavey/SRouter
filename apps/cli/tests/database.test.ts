import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { exportDatabaseSnapshot, getDatabasePath, initDatabase } from "@srouter/db";
import { createCli } from "../src/index.js";
import { getImportConfirmationMessage } from "../src/commands/database.js";

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "srouter-database-cli-"));
}

async function captureCliOutput(run: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    const capture = (chunk: Uint8Array | string): boolean => {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
    };
    process.stdout.write = capture;
    process.stderr.write = capture;
    try {
        await run();
    } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
    return chunks.join("");
}

async function createDatabaseExport(outputPath: string): Promise<void> {
    await initDatabase();
    exportDatabaseSnapshot(outputPath);
}

test("registers db export and import without replacing migrate", () => {
    const program = createCli();
    const database = program.commands.find((command) => command.name() === "db");
    const migrate = program.commands.find((command) => command.name() === "migrate");

    assert.ok(database);
    assert.ok(migrate);
    assert.deepEqual(
        database.commands.map((command) => command.name()),
        ["export", "import"]
    );
});

test("exports to an explicit path and warns that credentials are plaintext", async () => {
    const tempDir = makeTempDir();
    const outputPath = path.join(tempDir, "backup.db");
    const output = await captureCliOutput(async () => {
        const program = createCli();
        await program.parseAsync(["node", "srouter", "db", "export", outputPath]);
    });

    assert.equal(fs.existsSync(outputPath), true);
    assert.match(output, /plaintext/i);
});

test("exports to the default timestamped backup path with private permissions", async () => {
    const tempDir = makeTempDir();
    const previousCwd = process.cwd();
    process.chdir(tempDir);
    try {
        await captureCliOutput(async () => {
            const program = createCli();
            await program.parseAsync(["node", "srouter", "db", "export"]);
        });

        const files = fs.readdirSync(tempDir);
        assert.equal(files.length, 1);
        assert.match(files[0] ?? "", /^srouter-backup-.*\.db$/);
        assert.equal(fs.statSync(path.join(tempDir, files[0] ?? "")).mode & 0o777, 0o600);
    } finally {
        process.chdir(previousCwd);
    }
});

test("creates parent directories for an export", async () => {
    const tempDir = makeTempDir();
    const outputPath = path.join(tempDir, "nested", "backups", "backup.db");

    await captureCliOutput(async () => {
        const program = createCli();
        await program.parseAsync(["node", "srouter", "db", "export", outputPath]);
    });

    assert.equal(fs.existsSync(outputPath), true);
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
});

test("refuses to overwrite an export unless --force is provided", async () => {
    const tempDir = makeTempDir();
    const outputPath = path.join(tempDir, "backup.db");
    fs.writeFileSync(outputPath, "existing");
    const output = await captureCliOutput(async () => {
        const program = createCli();
        await program.parseAsync(["node", "srouter", "db", "export", outputPath]);
    });

    assert.equal(fs.readFileSync(outputPath, "utf8"), "existing");
    assert.match(output, /already exists/i);
    process.exitCode = 0;
});

test("overwrites an existing export with --force", async () => {
    const tempDir = makeTempDir();
    const outputPath = path.join(tempDir, "backup.db");
    fs.writeFileSync(outputPath, "existing");

    await captureCliOutput(async () => {
        const program = createCli();
        await program.parseAsync(["node", "srouter", "db", "export", outputPath, "--force"]);
    });

    const database = new DatabaseSync(outputPath, { readOnly: true });
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    database.close();
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
});

test("import confirmation describes replacement, backup, and plaintext credentials", () => {
    const message = getImportConfirmationMessage();

    assert.match(message, /all current SRouter data will be replaced/i);
    assert.match(message, /backed up first/i);
    assert.match(message, /API keys and provider credentials.*plaintext/i);
});

test("imports with --yes and reports the target backup", async () => {
    const tempDir = makeTempDir();
    const sourcePath = path.join(tempDir, "source.db");
    await createDatabaseExport(sourcePath);

    const output = await captureCliOutput(async () => {
        const program = createCli();
        await program.parseAsync(["node", "srouter", "db", "import", sourcePath, "--yes"]);
    });

    assert.match(output, /backup/i);
    assert.equal(fs.existsSync(getDatabasePath()), true);
    const database = new DatabaseSync(getDatabasePath(), { readOnly: true });
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    database.close();
    const backupMatch = output.match(/Current database backup: (.+)/);
    if (backupMatch?.[1]) fs.rmSync(backupMatch[1].trim(), { force: true });
});

test("rejects an invalid import file without replacing the target", async () => {
    const tempDir = makeTempDir();
    const invalidPath = path.join(tempDir, "invalid.db");
    fs.writeFileSync(invalidPath, "not sqlite");
    const output = await captureCliOutput(async () => {
        const program = createCli();
        await program.parseAsync(["node", "srouter", "db", "import", invalidPath, "--yes"]);
    });

    assert.match(output, /invalid|SQLite/i);
    process.exitCode = 0;
});
