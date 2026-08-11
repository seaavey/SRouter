import type { ProviderCategory, ProviderConfig, ProviderProtocol } from "@srouter/types";
import { db } from "./db.js";

export function getAllProvidersDB(): ProviderConfig[] {
    const query = db.prepare("SELECT * FROM providers ORDER BY created_at DESC");
    const rows = query.all();

    return rows.map((row) => ({
        id: String(row.id ?? ""),
        providerId: String(row.provider_id ?? ""),
        name: String(row.name ?? ""),
        category: row.category ? (String(row.category) as ProviderCategory) : undefined,
        protocol: row.protocol ? (String(row.protocol) as ProviderProtocol) : undefined,
        baseUrl: row.base_url ? String(row.base_url) : undefined,
        apiKey: row.api_key ? String(row.api_key) : undefined,
        accessToken: row.access_token ? String(row.access_token) : undefined,
        refreshToken: row.refresh_token ? String(row.refresh_token) : undefined,
        accountId: row.account_id ? String(row.account_id) : undefined,
        organizationId: row.organization_id ? String(row.organization_id) : undefined,
        customHeaders: row.custom_headers ? JSON.parse(String(row.custom_headers)) : undefined,
        enabled: Boolean(row.enabled),
        createdAt: Number(row.created_at ?? 0),
    }));
}

export function getProviderByIdDB(id: string): ProviderConfig | null {
    const query = db.prepare("SELECT * FROM providers WHERE id = ?");
    const row = query.get(id);

    if (!row) return null;

    return {
        id: String(row.id ?? ""),
        providerId: String(row.provider_id ?? ""),
        name: String(row.name ?? ""),
        category: row.category ? (String(row.category) as ProviderCategory) : undefined,
        protocol: row.protocol ? (String(row.protocol) as ProviderProtocol) : undefined,
        baseUrl: row.base_url ? String(row.base_url) : undefined,
        apiKey: row.api_key ? String(row.api_key) : undefined,
        accessToken: row.access_token ? String(row.access_token) : undefined,
        refreshToken: row.refresh_token ? String(row.refresh_token) : undefined,
        accountId: row.account_id ? String(row.account_id) : undefined,
        organizationId: row.organization_id ? String(row.organization_id) : undefined,
        customHeaders: row.custom_headers ? JSON.parse(String(row.custom_headers)) : undefined,
        enabled: Boolean(row.enabled),
        createdAt: Number(row.created_at ?? 0),
    };
}

export function upsertProviderDB(config: ProviderConfig & { category: string; protocol: string }): ProviderConfig {
    const query = db.prepare(`
        INSERT INTO providers (id, provider_id, name, category, protocol, base_url, api_key, access_token, refresh_token, account_id, organization_id, custom_headers, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            provider_id = excluded.provider_id,
            name = excluded.name,
            category = excluded.category,
            protocol = excluded.protocol,
            base_url = excluded.base_url,
            api_key = excluded.api_key,
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            account_id = excluded.account_id,
            organization_id = excluded.organization_id,
            custom_headers = excluded.custom_headers,
            enabled = excluded.enabled,
            created_at = excluded.created_at;
    `);

    query.run(config.id, config.providerId, config.name, config.category, config.protocol, config.baseUrl ?? null, config.apiKey ?? null, config.accessToken ?? null, config.refreshToken ?? null, config.accountId ?? null, config.organizationId ?? null, config.customHeaders ? JSON.stringify(config.customHeaders) : null, config.enabled ? 1 : 0, config.createdAt);

    return config;
}

export function createProviderDB(config: ProviderConfig & { category: string; protocol: string }): ProviderConfig {
    return upsertProviderDB(config);
}

export function deleteProviderDB(id: string): boolean {
    const query = db.prepare("DELETE FROM providers WHERE id = ?");
    const result = query.run(id);
    return (result.changes ?? 0) > 0;
}

export function getConnectionsByProviderIdDB(providerId: string): ProviderConfig[] {
    const pId = providerId.toLowerCase();
    const query = db.prepare(
        "SELECT * FROM providers WHERE LOWER(provider_id) = ? OR LOWER(id) = ? ORDER BY created_at DESC"
    );
    const rows = query.all(pId, pId);

    return rows.map((row) => ({
        id: String(row.id ?? ""),
        providerId: String(row.provider_id ?? ""),
        name: String(row.name ?? ""),
        category: row.category ? (String(row.category) as ProviderCategory) : undefined,
        protocol: row.protocol ? (String(row.protocol) as ProviderProtocol) : undefined,
        baseUrl: row.base_url ? String(row.base_url) : undefined,
        apiKey: row.api_key ? String(row.api_key) : undefined,
        accessToken: row.access_token ? String(row.access_token) : undefined,
        refreshToken: row.refresh_token ? String(row.refresh_token) : undefined,
        accountId: row.account_id ? String(row.account_id) : undefined,
        organizationId: row.organization_id ? String(row.organization_id) : undefined,
        customHeaders: row.custom_headers ? JSON.parse(String(row.custom_headers)) : undefined,
        enabled: Boolean(row.enabled),
        createdAt: Number(row.created_at ?? 0),
    }));
}
