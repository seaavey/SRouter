import { CODEBUDDY_CN_DOMAIN, CODEBUDDY_CN_USER_AGENT, isProviderBaseId } from "@srouter/constants";
import type {
    LiveModelQuotaItem,
    ProviderQuotaAccount,
    ProviderUsageMetric,
    QuotaResponse
} from "@srouter/types";
import { getProviderModelUsageDB } from "./logs.js";
import { getAllProvidersDB } from "./providers.js";

function formatResetIn(resetTimeStr?: string): string {
    if (!resetTimeStr) return "24h 0m";
    const resetTime = new Date(resetTimeStr).getTime();
    const now = Date.now();
    const diffMs = resetTime - now;
    if (diffMs <= 0) return "0m";
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (days > 0) {
        return `${days}d ${hours - days * 24}h`;
    }
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

interface CloudCodeFetchAvailableModelsResponse {
    models?: Record<
        string,
        {
            displayName?: string;
            quotaInfo?: {
                remainingFraction?: number;
                resetTime?: string;
            };
        }
    >;
}

export async function fetchAntigravityLiveQuota(
    providerId: string,
    accountName: string,
    accessToken: string,
    enabled = true
): Promise<ProviderQuotaAccount> {
    if (!accessToken || !(accessToken.startsWith("ya29.") || accessToken.length > 20)) {
        throw new Error("Antigravity quota requires a valid access token");
    }

    const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": "Antigravity/1.0 (VSCode)",
            "x-goog-api-client": "gl-node/18.0.0 gd/1.0.0"
        },
        body: JSON.stringify({})
    });

    if (!res.ok) {
        throw new Error(`Antigravity quota fetch failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as CloudCodeFetchAvailableModelsResponse;
    if (!data.models || Object.keys(data.models).length === 0) {
        throw new Error("Antigravity quota fetch returned no models");
    }

    const quotas: LiveModelQuotaItem[] = Object.entries(data.models).map(([modelId, item]) => {
        const remainingFraction = item.quotaInfo?.remainingFraction ?? 1.0;
        const percentageValue = Math.round(remainingFraction * 100);
        const limit = 1000;
        const used = Math.round((1 - remainingFraction) * limit);
        const resetIn = formatResetIn(item.quotaInfo?.resetTime);

        let status: "ok" | "warning" | "exhausted" = "ok";
        if (percentageValue <= 5) status = "exhausted";
        else if (percentageValue <= 20) status = "warning";

        return {
            name: item.displayName || modelId,
            used,
            limit,
            percentage: `${percentageValue}%`,
            percentageValue,
            resetIn,
            resetTime: item.quotaInfo?.resetTime,
            status
        };
    });

    return {
        id: providerId,
        provider: "Antigravity",
        account: accountName,
        enabled,
        quotaType: "live_provider_quota",
        totalQuotas: quotas.length,
        quotas
    };
}

interface CodeBuddyCNAccount {
    PackageName?: string;
    SubProductName?: string;
    CycleStartTime?: string;
    CycleEndTime?: string;
    DeductionEndTime?: number;
    CycleCapacityUsed?: number;
    CycleCapacityUsedPrecise?: string;
    CycleCapacitySize?: number;
    CycleCapacitySizePrecise?: string;
    CapacityUsed?: number;
    CapacityUsedPrecise?: string;
    CapacitySize?: number;
    CapacitySizePrecise?: string;
}

// Refill packs roll into a new cycle before the resource expires; bonus packs
// end exactly at expiry. >2d gap between cycle end and validity end = refill.
const CN_REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;

export async function fetchCodeBuddyCNLiveQuota(
    providerId: string,
    accountName: string,
    accessToken: string,
    enabled = true
): Promise<ProviderQuotaAccount> {
    if (!accessToken) {
        throw new Error("CodeBuddy CN quota requires an access token");
    }

    const res = await fetch("https://copilot.tencent.com/v2/billing/meter/get-user-resource", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": CODEBUDDY_CN_USER_AGENT,
            "X-Product": "SaaS",
            "X-IDE-Type": "CLI",
            "X-IDE-Name": "CLI",
            "X-Domain": CODEBUDDY_CN_DOMAIN,
            "x-requested-with": "XMLHttpRequest",
            "x-codebuddy-request": "1"
        },
        body: "{}"
    });

    if (!res.ok) {
        throw new Error(`CodeBuddy CN quota fetch failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
        code?: number;
        msg?: string;
        data?: { Response?: { Data?: { Accounts?: CodeBuddyCNAccount[] } } };
    };
    if (json.code !== 0) {
        throw new Error(`CodeBuddy CN quota error: ${json.msg || "unknown"}`);
    }

    const accounts = json.data?.Response?.Data?.Accounts ?? [];
    if (accounts.length === 0) {
        throw new Error("CodeBuddy CN quota fetch returned no credit packages");
    }

    const cycleEndMs = (acc: CodeBuddyCNAccount): number => {
        const t = acc.CycleEndTime ? new Date(acc.CycleEndTime).getTime() : NaN;
        return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    const isRefill = (acc: CodeBuddyCNAccount): boolean => {
        const ce = cycleEndMs(acc);
        const de = Number(acc.DeductionEndTime);
        return Number.isFinite(ce) && Number.isFinite(de) && de - ce > CN_REFILL_GAP_MS;
    };
    const byExpiry = (a: CodeBuddyCNAccount, b: CodeBuddyCNAccount) =>
        cycleEndMs(a) - cycleEndMs(b);

    const refills = accounts.filter(isRefill).sort(byExpiry);
    const bonuses = accounts.filter((a) => !isRefill(a)).sort(byExpiry);

    const toItem = (
        name: string,
        used: number,
        total: number,
        resetTime?: string
    ): LiveModelQuotaItem => {
        const remainingFraction = total > 0 ? (total - used) / total : 1;
        return {
            name,
            used: Math.round(used * 100) / 100,
            limit: Math.round(total * 100) / 100,
            percentage: total > 0 ? `${Math.round((used / total) * 100)}%` : "0%",
            percentageValue: total > 0 ? Math.round((used / total) * 100) : 0,
            resetIn: formatResetIn(resetTime),
            resetTime,
            status:
                remainingFraction <= 0.05
                    ? "exhausted"
                    : remainingFraction <= 0.2
                      ? "warning"
                      : "ok"
        };
    };

    const num = (precise?: string, plain?: number): number => {
        const n = Number(precise ?? plain);
        return Number.isFinite(n) ? n : 0;
    };

    const quotas: LiveModelQuotaItem[] = [];
    const seenCadence: Record<string, number> = {};
    for (const acc of refills) {
        const cycleStartMs = acc.CycleStartTime ? new Date(acc.CycleStartTime).getTime() : NaN;
        const cycleDays = (cycleEndMs(acc) - cycleStartMs) / 86400000;
        const base =
            Number.isFinite(cycleDays) && cycleDays <= 1.5
                ? "Daily"
                : Number.isFinite(cycleDays) && cycleDays <= 10
                  ? "Weekly"
                  : "Monthly";
        seenCadence[base] = (seenCadence[base] ?? 0) + 1;
        const name = seenCadence[base]! > 1 ? `${base} ${seenCadence[base]}` : base;
        quotas.push(
            toItem(
                name,
                num(acc.CycleCapacityUsedPrecise, acc.CycleCapacityUsed),
                num(acc.CycleCapacitySizePrecise, acc.CycleCapacitySize),
                acc.CycleEndTime
            )
        );
    }
    bonuses.forEach((acc, i) => {
        quotas.push(
            toItem(
                `Bonus Pack ${i + 1}`,
                num(acc.CapacityUsedPrecise, acc.CapacityUsed),
                num(acc.CapacitySizePrecise, acc.CapacitySize),
                acc.CycleEndTime
            )
        );
    });

    const basePkg = refills[0] ?? accounts[0] ?? {};
    const plan = basePkg.PackageName || basePkg.SubProductName;

    return {
        id: providerId,
        provider: plan ? `CodeBuddy CN (${plan})` : "CodeBuddy CN",
        account: accountName,
        enabled,
        quotaType: "live_provider_quota",
        totalQuotas: quotas.length,
        quotas
    };
}

export async function getProviderQuotaAccount(p: {
    id: string;
    providerId: string;
    name: string;
    apiKey?: string;
    accessToken?: string;
    enabled: boolean;
}): Promise<ProviderQuotaAccount> {
    const isAntigravity =
        isProviderBaseId(p.providerId, "antigravity") || isProviderBaseId(p.id, "antigravity");
    const isOpenAICodex =
        isProviderBaseId(p.providerId, "openai_codex") || isProviderBaseId(p.id, "openai_codex");
    const isOpenAI = isProviderBaseId(p.providerId, "openai") || isProviderBaseId(p.id, "openai");
    const isAnthropic =
        isProviderBaseId(p.providerId, "anthropic") || isProviderBaseId(p.id, "anthropic");
    const isCodeBuddyCN =
        isProviderBaseId(p.providerId, "codebuddy-cn") || isProviderBaseId(p.id, "codebuddy-cn");
    // codebuddy.ai (international) has no known live quota endpoint; showing SRouter's
    // own usage logs under a "CodeBuddy" card is misleading, so skip it entirely.
    const isCodeBuddy =
        !isCodeBuddyCN &&
        (isProviderBaseId(p.providerId, "codebuddy") || isProviderBaseId(p.id, "codebuddy"));

    const token = p.accessToken || p.apiKey || "";

    if (isCodeBuddy) {
        throw new Error("CodeBuddy (international) does not expose a live quota endpoint");
    }

    if (isCodeBuddyCN) {
        return await fetchCodeBuddyCNLiveQuota(
            p.id,
            p.name || "CodeBuddy CN Account",
            token,
            p.enabled
        );
    }

    if (isAntigravity) {
        return await fetchAntigravityLiveQuota(
            p.id,
            p.name || "seaavey@gmail.com",
            token,
            p.enabled
        );
    }

    // For OpenAI Codex, OpenAI, Anthropic, or Custom Providers:
    // Report REAL usage metrics aggregated from SRouter's database (request_logs)
    const usageRows = getProviderModelUsageDB(p.id);
    const usageMetrics: ProviderUsageMetric[] = usageRows.map((row) => ({
        model: row.model,
        totalRequests: row.totalRequests,
        totalTokens: row.totalTokens,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null
    }));

    let providerName = p.name || p.providerId || p.id;
    if (isOpenAICodex) providerName = "OpenAI Codex";
    else if (isOpenAI) providerName = "OpenAI";
    else if (isAnthropic) providerName = "Anthropic";

    return {
        id: p.id,
        provider: providerName,
        account: p.name || `${providerName} Account`,
        enabled: p.enabled,
        quotaType: "usage_logged",
        usageMetrics
    };
}

export async function getQuotaSummaryDB(): Promise<QuotaResponse> {
    const dbProviders = getAllProvidersDB();
    const providerAccounts: ProviderQuotaAccount[] = [];

    for (const p of dbProviders) {
        try {
            const account = await getProviderQuotaAccount(p);
            providerAccounts.push(account);
        } catch {
            // Skip providers whose quota cannot be fetched
        }
    }

    return {
        object: "quota",
        totalAccounts: providerAccounts.length,
        providers: providerAccounts
    };
}
