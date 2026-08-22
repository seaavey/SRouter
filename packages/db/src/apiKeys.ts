import type { DBAPIKey } from "@srouter/types";
import { db } from "./db.js";
import { randomUUID } from "node:crypto";
import { generateId, num, str } from "./row-utils.js";

export function getAllAPIKeysDB(): DBAPIKey[] {
    const query = db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC");
    const rows = query.all();

    return rows.map(mapAPIKeyRow);
}

export function getAPIKeyByKeyDB(key: string): DBAPIKey | null {
    const query = db.prepare("SELECT * FROM api_keys WHERE key = ? AND enabled = 1");
    const row = query.get(key);

    if (!row) return null;

    return mapAPIKeyRow(row);
}

function mapAPIKeyRow(row: Record<string, unknown>): DBAPIKey {
    return {
        id: str(row.id),
        key: str(row.key),
        name: str(row.name),
        enabled: Boolean(row.enabled),
        rateLimit: num(row.rate_limit),
        quotaLimit: num(row.quota_limit),
        usageTokens: num(row.usage_tokens),
        createdAt: num(row.created_at)
    };
}

export function createAPIKeyDB(data: {
    name: string;
    rateLimit?: number;
    quotaLimit?: number;
}): DBAPIKey {
    const id = generateId("key");
    const randomHex = randomUUID().replace(/-/g, "").slice(0, 16);
    const key = `sr-live-${randomHex}`;
    const createdAt = Date.now();

    const query = db.prepare(`
        INSERT INTO api_keys (id, key, name, enabled, rate_limit, quota_limit, usage_tokens, created_at)
        VALUES (?, ?, ?, 1, ?, ?, 0, ?)
    `);

    query.run(id, key, data.name, data.rateLimit ?? 0, data.quotaLimit ?? 0, createdAt);

    return {
        id,
        key,
        name: data.name,
        enabled: true,
        rateLimit: data.rateLimit ?? 0,
        quotaLimit: data.quotaLimit ?? 0,
        usageTokens: 0,
        createdAt
    };
}

export function incrementAPIKeyUsageDB(keyId: string, tokens: number): void {
    const query = db.prepare("UPDATE api_keys SET usage_tokens = usage_tokens + ? WHERE id = ?");
    query.run(tokens, keyId);
}

export function deleteAPIKeyDB(id: string): boolean {
    const query = db.prepare("DELETE FROM api_keys WHERE id = ?");
    const result = query.run(id);
    return (result.changes ?? 0) > 0;
}
