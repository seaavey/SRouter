import type { ProviderCategory, ProviderConfig, ProviderProtocol } from "@srouter/types";
import { db } from "./db.js";
import { num, optStr, str } from "./row-utils.js";

interface ProviderRow {
    id: string;
    provider_id: string;
    name: string;
    alias: string | null;
    category: string | null;
    protocol: string | null;
    base_url: string | null;
    api_key: string | null;
    access_token: string | null;
    refresh_token: string | null;
    account_id: string | null;
    organization_id: string | null;
    token_expires_at: number | null;
    last_refreshed_at: number | null;
    custom_headers: string | null;
    provider_specific_data: string | null;
    enabled: number;
    created_at: number;
}

export async function getAllProvidersDB(): Promise<ProviderConfig[]> {
    const Rows = (await db
        .prepare("SELECT * FROM providers ORDER BY created_at DESC")
        .all()) as unknown as ProviderRow[];
    return Rows.map(mapProviderRow);
}

export async function getProviderByIdDB(id: string): Promise<ProviderConfig | null> {
    const Row = (await db
        .prepare("SELECT * FROM providers WHERE id = ?")
        .get(id)) as unknown as ProviderRow | undefined;

    if (!Row) return null;
    return mapProviderRow(Row);
}

export async function upsertProviderDB(
    config: ProviderConfig & { category: string; protocol: string }
): Promise<ProviderConfig> {
    await db.prepare(`
        INSERT INTO providers (
            id, provider_id, name, alias, category, protocol, base_url, api_key,
            access_token, refresh_token, account_id, organization_id,
            token_expires_at, last_refreshed_at, custom_headers,
            provider_specific_data, enabled, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            provider_id = excluded.provider_id,
            name = excluded.name,
            alias = excluded.alias,
            category = excluded.category,
            protocol = excluded.protocol,
            base_url = excluded.base_url,
            api_key = excluded.api_key,
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            account_id = excluded.account_id,
            organization_id = excluded.organization_id,
            token_expires_at = excluded.token_expires_at,
            last_refreshed_at = excluded.last_refreshed_at,
            custom_headers = excluded.custom_headers,
            provider_specific_data = excluded.provider_specific_data,
            enabled = excluded.enabled,
            created_at = excluded.created_at;
    `).run(
        config.id,
        config.providerId,
        config.name,
        config.alias ?? null,
        config.category,
        config.protocol,
        config.base_url ?? null,
        config.apiKey ?? null,
        config.accessToken ?? null,
        config.refreshToken ?? null,
        config.accountId ?? null,
        config.organizationId ?? null,
        config.tokenExpiresAt ?? null,
        config.lastRefreshedAt ?? null,
        config.customHeaders ? JSON.stringify(config.customHeaders) : null,
        config.providerSpecificData ? JSON.stringify(config.providerSpecificData) : null,
        config.enabled ? 1 : 0,
        config.createdAt
    );

    return config;
}

export function createProviderDB(
    config: ProviderConfig & { category: string; protocol: string }
): Promise<ProviderConfig> {
    return upsertProviderDB(config);
}

export async function deleteProviderDB(id: string): Promise<boolean> {
    const Result = await db.prepare("DELETE FROM providers WHERE id = ?").run(id);
    return num(Result.changes) > 0;
}

export interface UpdateProviderTokensInput {
    id: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: number;
    lastRefreshedAt?: number;
}

export async function updateProviderTokensDB(input: UpdateProviderTokensInput): Promise<void> {
    await db.prepare(
        `UPDATE providers SET
            access_token = ?,
            refresh_token = ?,
            token_expires_at = ?,
            last_refreshed_at = ?
         WHERE id = ?`
    ).run(
        input.accessToken,
        input.refreshToken ?? null,
        input.tokenExpiresAt ?? null,
        input.lastRefreshedAt ?? null,
        input.id
    );
}

export async function getConnectionsByProviderIdDB(providerId: string): Promise<ProviderConfig[]> {
    const PId = providerId.toLowerCase();
    const Rows = (await db
        .prepare("SELECT * FROM providers WHERE LOWER(provider_id) = ? OR LOWER(id) = ? ORDER BY created_at DESC")
        .all(PId, PId)) as unknown as ProviderRow[];
    return Rows.map(mapProviderRow);
}

function mapProviderRow(row: ProviderRow): ProviderConfig {
    return {
        id: str(row.id),
        providerId: str(row.provider_id),
        name: str(row.name),
        alias: optStr(row.alias),
        category: optStr(row.category) as ProviderCategory | undefined,
        protocol: optStr(row.protocol) as ProviderProtocol | undefined,
        base_url: optStr(row.base_url),
        apiKey: optStr(row.api_key),
        accessToken: optStr(row.access_token),
        refreshToken: optStr(row.refresh_token),
        accountId: optStr(row.account_id),
        organizationId: optStr(row.organization_id),
        tokenExpiresAt: row.token_expires_at ? num(row.token_expires_at) : undefined,
        lastRefreshedAt: row.last_refreshed_at ? num(row.last_refreshed_at) : undefined,
        customHeaders: row.custom_headers ? JSON.parse(str(row.custom_headers)) : undefined,
        providerSpecificData: row.provider_specific_data
            ? JSON.parse(str(row.provider_specific_data))
            : undefined,
        enabled: Boolean(row.enabled),
        createdAt: num(row.created_at)
    };
}