import fs from "node:fs";
import path from "node:path";
import { getDatabasePath } from "./sqlite.js";

type LockOwner = { pid: number; mode: "transfer" | "operation"; token: string };

let transferActive = false;

function readLockOwner(filePath: string): LockOwner | null {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8").trim());
        if (typeof parsed !== "object" || parsed === null) return null;
        const owner = parsed as Partial<LockOwner>;
        if (typeof owner.pid !== "number" || typeof owner.token !== "string") return null;
        return { pid: owner.pid, mode: owner.mode === "operation" ? "operation" : "transfer", token: owner.token };
    } catch {
        return null;
    }
}

export function beginDatabaseTransfer(): void {
    transferActive = true;
}

export function endDatabaseTransfer(): void {
    transferActive = false;
}

export function acquireDatabaseOperationLock(): () => void {
    if (transferActive) throw new Error("A database transfer is already in progress.");
    const lockPath = `${path.resolve(getDatabasePath())}.transfer.lock`;
    const owner: LockOwner = { pid: process.pid, mode: "operation", token: `${process.pid}-${Date.now()}-${Math.random()}` };
    fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 500; attempt += 1) {
        try {
            const descriptor = fs.openSync(lockPath, "wx", 0o600);
            fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
            fs.closeSync(descriptor);
            return () => {
                const current = readLockOwner(lockPath);
                if (current?.token === owner.token) fs.rmSync(lockPath, { force: true });
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const current = readLockOwner(lockPath);
            if (current?.mode === "transfer" && current.pid === process.pid) {
                throw new Error("A database transfer is already in progress.");
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
    }
    throw new Error("A database transfer is already in progress.");
}
