import { db } from "./db.js";
import { str } from "./row-utils.js";

interface SettingRow {
    key?: unknown;
    value?: unknown;
}

export function getSettingDB(key: string, defaultValue = ""): string {
    const Stmt = db.prepare("SELECT value FROM system_settings WHERE key = ?");
    const Row = Stmt.get(key) as SettingRow | undefined;
    return Row?.value ? str(Row.value) : defaultValue;
}

export function setSettingDB(key: string, value: string): void {
    const Stmt = db.prepare(`
        INSERT INTO system_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    Stmt.run(key, value);
}

export function getAllSettingsDB(): Record<string, string> {
    const Stmt = db.prepare("SELECT key, value FROM system_settings");
    const Rows = Stmt.all() as SettingRow[];
    const Result: Record<string, string> = {};
    for (const r of Rows) {
        if (r.key) {
            Result[str(r.key)] = str(r.value);
        }
    }
    return Result;
}

export function getRequireApiKeyDB(): boolean {
    const Val = getSettingDB("require_api_key", "false");
    return Val === "true" || Val === "1";
}

export function setRequireApiKeyDB(required: boolean): void {
    setSettingDB("require_api_key", required ? "true" : "false");
}
