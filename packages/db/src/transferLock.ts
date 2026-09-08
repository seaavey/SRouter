import fs from "node:fs";
import path from "node:path";
import { getDatabasePath } from "./sqlite.js";

export function assertDatabaseTransferAvailable(): void {
    const lockPath = `${path.resolve(getDatabasePath())}.transfer.lock`;
    if (!fs.existsSync(lockPath)) return;

    let owner: { pid?: number };
    try {
        const raw = fs.readFileSync(lockPath, "utf8").trim();
        const parsed: unknown = JSON.parse(raw);
        owner = typeof parsed === "number" ? { pid: parsed } : parsed as { pid?: number };
    } catch {
        throw new Error("A database transfer is already in progress.");
    }
    if (owner.pid === process.pid) return;
    throw new Error("A database transfer is already in progress.");
}
