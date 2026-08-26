import type { DBAPIKey } from "@srouter/types";
import { db } from "./db.js";
import { randomUUID } from "node:crypto";
import { generateId, num, str } from "./row-utils.js";

interface APIKeyRow {
    id: string;
    key: string;
    name: string;
    enabled: number;
    rate_limit: number;
    quota_limit: number;
    usage_tokens: number;
    created_at: number;
}

export function getAllAPIKeysDB(): DBAPIKey[] {
    const Query = db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC");
    const Rows = Query.all() as unknown as APIKeyRow[];

    return Rows.map(mapAPIKeyRow);
}

export function getAPIKeyByKeyDB(key: string): DBAPIKey | null {
    const Query = db.prepare("SELECT * FROM api_keys WHERE key = ? AND enabled = 1");
    const Row = Query.get(key) as unknown as APIKeyRow | undefined;

    if (!Row) return null;

    return mapAPIKeyRow(Row);
}

function mapAPIKeyRow(row: APIKeyRow): DBAPIKey {
    return {
        id: row.id,
        key: row.key,
        name: row.name,
        enabled: Boolean(row.enabled),
        rateLimit: row.rate_limit,
        quotaLimit: row.quota_limit,
        usageTokens: row.usage_tokens,
        createdAt: row.created_at
    };
}

export function createAPIKeyDB(data: {
    name: string;
    rateLimit?: number;
    quotaLimit?: number;
}): DBAPIKey {
    const Id = generateId("key");
    const RandomHex = randomUUID().replace(/-/g, "").slice(0, 16);
    const Key = `sr-live-${RandomHex}`;
    const CreatedAt = Date.now();

    const Query = db.prepare(`
        INSERT INTO api_keys (id, key, name, enabled, rate_limit, quota_limit, usage_tokens, created_at)
        VALUES (?, ?, ?, 1, ?, ?, 0, ?)
    `);

    Query.run(Id, Key, data.name, data.rateLimit ?? 0, data.quotaLimit ?? 0, CreatedAt);

    return {
        id: Id,
        key: Key,
        name: data.name,
        enabled: true,
        rateLimit: data.rateLimit ?? 0,
        quotaLimit: data.quotaLimit ?? 0,
        usageTokens: 0,
        createdAt: CreatedAt
    };
}

export function incrementAPIKeyUsageDB(keyId: string, tokens: number): void {
    const Query = db.prepare("UPDATE api_keys SET usage_tokens = usage_tokens + ? WHERE id = ?");
    Query.run(tokens, keyId);
}

export function deleteAPIKeyDB(id: string): boolean {
    const Query = db.prepare("DELETE FROM api_keys WHERE id = ?");
    const Result = Query.run(id);
    return num(Result.changes) > 0;
}
