import type { LiveModelQuotaItem, ProviderQuotaAccount } from "@srouter/types";

export interface ProviderQuotaContext {
    id: string;
    providerId: string;
    name: string;
    accessToken?: string;
    accountId?: string;
    enabled: boolean;
}

export interface IProviderQuotaFetcher {
    readonly providerKey: string;
    canHandle(providerId: string): boolean;
    fetchQuota(ctx: ProviderQuotaContext): Promise<ProviderQuotaAccount>;
}

export function formatResetIn(resetTimeStr?: string): string {
    if (!resetTimeStr) return "24h 0m";
    const ResetTime = new Date(resetTimeStr).getTime();
    const Now = Date.now();
    const DiffMs = ResetTime - Now;
    if (DiffMs <= 0) return "0m";
    const Days = Math.floor(DiffMs / (1000 * 60 * 60 * 24));
    const Hours = Math.floor(DiffMs / (1000 * 60 * 60));
    if (Days > 0) {
        return `${Days}d ${Hours - Days * 24}h`;
    }
    const Minutes = Math.floor((DiffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (Hours > 0) {
        return `${Hours}h ${Minutes}m`;
    }
    return `${Minutes}m`;
}
