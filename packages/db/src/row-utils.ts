import { randomUUID } from "node:crypto";

/**
 * Generates a prefixed, collision-resistant identifier for DB rows.
 * Uses crypto.randomUUID instead of Math.random for unpredictability.
 */
export function generateId(prefix: string): string {
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Safe scalar coercions for sqlite row values.
 */
export function str(value: unknown, fallback = ""): string {
    return value === null || value === undefined ? fallback : String(value);
}

export function optStr(value: unknown): string | undefined {
    return value === null || value === undefined ? undefined : String(value);
}

export function num(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
