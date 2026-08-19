#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.join(__dirname, "../dist/index.js");
const srcEntry = path.join(__dirname, "../src/index.ts");

if (fs.existsSync(distEntry)) {
    await import("../dist/index.js");
} else {
    const require = createRequire(import.meta.url);
    let tsxCli = "";
    try {
        const tsxPkg = require.resolve("tsx/package.json");
        const distCli = path.join(path.dirname(tsxPkg), "dist/cli.mjs");
        if (fs.existsSync(distCli)) {
            tsxCli = distCli;
        }
    } catch {
        const localBin = path.join(__dirname, "../node_modules/.bin/tsx");
        if (fs.existsSync(localBin)) {
            tsxCli = localBin;
        }
    }

    if (tsxCli && fs.existsSync(tsxCli)) {
        const child = spawn(process.execPath, [tsxCli, srcEntry, ...process.argv.slice(2)], {
            stdio: "inherit"
        });
        child.on("exit", (code) => {
            process.exit(code ?? 0);
        });
    } else {
        const child = spawn(
            "pnpm",
            ["--filter", "@srouter/cli", "exec", "tsx", srcEntry, ...process.argv.slice(2)],
            {
                stdio: "inherit"
            }
        );
        child.on("exit", (code) => {
            process.exit(code ?? 0);
        });
    }
}
