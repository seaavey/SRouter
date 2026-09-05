import type { ModelUsageSummaryRow } from "./logs.js";

export interface LiveModelQuotaItem {
    name: string;
    used: number;
    limit: number;
    percentage: string;
    percentageValue: number;
    resetIn: string;
    resetTime?: string;
    status: "ok" | "warning" | "exhausted";
}

export type ProviderUsageMetric = Pick<
    ModelUsageSummaryRow,
    "model" | "totalRequests" | "totalTokens" | "promptTokens" | "completionTokens"
> & {
    lastUsedAt: string | null;
};

export interface ProviderQuotaAccount {
    id: string;
    provider: string;
    account: string;
    enabled: boolean;
    quotaType: "live_provider_quota" | "usage_logged";
    totalQuotas?: number;
    quotas?: LiveModelQuotaItem[];
    usageMetrics?: ProviderUsageMetric[];
}

export interface QuotaResponse {
    object: "quota";
    totalAccounts: number;
    providers: ProviderQuotaAccount[];
}
