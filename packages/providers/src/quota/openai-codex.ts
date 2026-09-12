import { isProviderBaseId } from "@srouter/constants";
import type { LiveModelQuotaItem, ProviderQuotaAccount } from "@srouter/types";
import { type IProviderQuotaFetcher, type ProviderQuotaContext, formatResetIn } from "./base.js";

interface JsonRecord {
    [key: string]: unknown;
}

interface RateLimitWindow {
    usedPercent: number;
    resetAt?: number;
    name: string;
}

function IsRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ReadNumber(record: JsonRecord, ...keys: string[]): number | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim() !== "") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return undefined;
}

function ReadWindow(value: unknown, name: string): RateLimitWindow | undefined {
    if (!IsRecord(value)) return undefined;
    const usedPercent = ReadNumber(value, "used_percent", "usedPercent");
    if (usedPercent === undefined) return undefined;
    const resetAt = ReadNumber(value, "reset_at", "resets_at", "resetAt", "resetsAt");
    return { usedPercent: Math.max(0, Math.min(100, usedPercent)), resetAt, name };
}

function GetWindows(payload: JsonRecord): RateLimitWindow[] {
    const result: RateLimitWindow[] = [];
    const candidates: Array<[string, unknown]> = [];
    const rateLimit = payload.rate_limit ?? payload.rateLimits;
    if (IsRecord(rateLimit)) {
        candidates.push(["5-hour", rateLimit.primary_window ?? rateLimit.primary]);
        candidates.push(["Weekly", rateLimit.secondary_window ?? rateLimit.secondary]);
    }
    const byLimitId = payload.rate_limits_by_limit_id ?? payload.rateLimitsByLimitId;
    if (IsRecord(byLimitId)) {
        for (const [limitId, value] of Object.entries(byLimitId)) {
            if (!IsRecord(value)) continue;
            const nested = value.primary_window ?? value.primary;
            candidates.push([limitId, nested]);
        }
    }
    for (const [name, value] of candidates) {
        const window = ReadWindow(value, name);
        if (window && !result.some((item) => item.name === window.name)) result.push(window);
    }
    return result;
}

export class OpenAICodexQuotaFetcher implements IProviderQuotaFetcher {
    public readonly providerKey = "openai_codex";

    public canHandle(providerId: string): boolean {
        return isProviderBaseId(providerId, "openai_codex");
    }

    public async fetchQuota(ctx: ProviderQuotaContext): Promise<ProviderQuotaAccount> {
        const accessToken = ctx.accessToken || "";
        if (!accessToken) throw new Error("OpenAI Codex quota requires an access token");

        const Res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
                "User-Agent": "codex_cli_rs/0.136.0",
                originator: "codex_cli_rs",
                ...(ctx.accountId ? { "ChatGPT-Account-ID": ctx.accountId } : {})
            }
        });
        if (!Res.ok) throw new Error(`OpenAI Codex quota fetch failed: HTTP ${Res.status}`);

        const Payload = await Res.json();
        if (!IsRecord(Payload)) throw new Error("OpenAI Codex quota returned an invalid response");
        const windows = GetWindows(Payload);
        if (windows.length === 0) throw new Error("OpenAI Codex quota returned no rate limits");

        const Quotas: LiveModelQuotaItem[] = windows.map((window) => {
            const remaining = 100 - window.usedPercent;
            const resetTime = window.resetAt
                ? new Date(window.resetAt * 1000).toISOString()
                : undefined;
            return {
                name: `Codex ${window.name}`,
                used: Math.round(window.usedPercent),
                limit: 100,
                percentage: `${Math.round(remaining)}%`,
                percentageValue: Math.round(remaining),
                resetIn: formatResetIn(resetTime),
                resetTime,
                status: remaining <= 5 ? "exhausted" : remaining <= 20 ? "warning" : "ok"
            };
        });

        const planType = typeof Payload.plan_type === "string" ? Payload.plan_type : undefined;
        return {
            id: ctx.id,
            provider: planType ? `OpenAI Codex (${planType})` : "OpenAI Codex",
            account: ctx.name || "OpenAI Codex Account",
            enabled: ctx.enabled,
            quotaType: "live_provider_quota",
            totalQuotas: Quotas.length,
            quotas: Quotas
        };
    }
}
