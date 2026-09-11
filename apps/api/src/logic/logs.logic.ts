import {
    getAllAPIKeysDB,
    getAnalyticsDB,
    getBucketSizeMs,
    getBucketCount,
    getPaginatedLogsDB,
    getRecentLogsDB,
    getRequireApiKeyDB,
    getUsageByModelDB,
    getUsageSummaryDB,
    num
} from "@srouter/db";
import type {
    AnalyticsReport,
    AnalyticsBucket,
    AnalyticsWindow,
    RequestLogEntry,
    UsageStats
} from "@srouter/types";
import { formatCost, getPricingForModel, calculateCostBreakdownFromTokens } from "@srouter/pricing";

export class LogsLogic {
    public static async getRecentLogs(limit: number = 50): Promise<RequestLogEntry[]> {
        const [logs, requireApiKey, keys] = await Promise.all([
            getRecentLogsDB(limit),
            getRequireApiKeyDB().catch(() => false),
            getAllAPIKeysDB().catch(() => [])
        ]);

        const keyMap = new Map<string, string>();
        for (const k of keys) {
            keyMap.set(k.id, k.name);
        }

        return logs.map((log) => {
            const pricing = getPricingForModel(log.providerId, log.resolvedModel || log.model);
            const breakdown = calculateCostBreakdownFromTokens(
                {
                    prompt_tokens: log.promptTokens,
                    completion_tokens: log.completionTokens,
                    cached_tokens: log.cachedTokens,
                    cache_creation_input_tokens: log.cacheCreationTokens,
                    reasoning_tokens: log.reasoningTokens
                },
                pricing
            );

            const apiKeyId = requireApiKey ? log.apiKeyId : undefined;
            const apiKeyName = apiKeyId ? keyMap.get(apiKeyId) : undefined;

            return {
                ...log,
                apiKeyId,
                apiKeyName,
                costBreakdown: breakdown
            };
        });
    }

    public static async getPaginatedLogs(
        page: number = 1,
        limit: number = 50,
        status?: "all" | "success" | "error"
    ): Promise<{
        data: RequestLogEntry[];
        pagination: { page: number; limit: number; total: number; total_pages: number };
    }> {
        const [{ data: rawLogs, pagination }, requireApiKey, keys] = await Promise.all([
            getPaginatedLogsDB(page, limit, status),
            getRequireApiKeyDB().catch(() => false),
            getAllAPIKeysDB().catch(() => [])
        ]);

        const keyMap = new Map<string, string>();
        for (const k of keys) {
            keyMap.set(k.id, k.name);
        }

        const data = rawLogs.map((log) => {
            const pricing = getPricingForModel(log.providerId, log.resolvedModel || log.model);
            const breakdown = calculateCostBreakdownFromTokens(
                {
                    prompt_tokens: log.promptTokens,
                    completion_tokens: log.completionTokens,
                    cached_tokens: log.cachedTokens,
                    cache_creation_input_tokens: log.cacheCreationTokens,
                    reasoning_tokens: log.reasoningTokens
                },
                pricing
            );

            const apiKeyId = requireApiKey ? log.apiKeyId : undefined;
            const apiKeyName = apiKeyId ? keyMap.get(apiKeyId) : undefined;

            return {
                ...log,
                apiKeyId,
                apiKeyName,
                costBreakdown: breakdown
            };
        });

        return {
            data,
            pagination
        };
    }

    public static async getUsageStats(): Promise<UsageStats> {
        const summary = await getUsageSummaryDB();
        const byModel = await getUsageByModelDB();

        return {
            object: "usage",
            ...summary,
            costLabel: formatCost(summary.totalEstimatedCost),
            estimated: true,
            byModel
        };
    }

    public static async getAnalytics(window: AnalyticsWindow): Promise<AnalyticsReport> {
        const Now = Date.now();
        const BucketSizeMs = getBucketSizeMs(window);
        const BucketCount = getBucketCount(window);
        const raw = await getAnalyticsDB(window);

        // Zero-fill missing buckets
        const Since = Now - BucketSizeMs * BucketCount;
        const Buckets: AnalyticsBucket[] = [];
        let Cursor = Math.floor(Since / BucketSizeMs) * BucketSizeMs;
        const End = Now;
        const RawMap = new Map<number, AnalyticsBucket>();
        for (const b of raw.buckets) {
            const bucketKey = num(b.bucket);
            RawMap.set(bucketKey, {
                bucketStart: bucketKey,
                totalRequests: num(b.totalRequests),
                successRequests: num(b.successRequests),
                errorRequests: num(b.errorRequests),
                avgLatencyMs: num(b.avgLatencyMs),
                totalTokens: num(b.totalTokens),
                promptTokens: num(b.promptTokens),
                completionTokens: num(b.completionTokens),
                cachedTokens: num(b.cachedTokens)
            });
        }
        while (Cursor < End) {
            const Existing = RawMap.get(Cursor);
            if (Existing) {
                Buckets.push(Existing);
            } else {
                Buckets.push({
                    bucketStart: Cursor,
                    totalRequests: 0,
                    successRequests: 0,
                    errorRequests: 0,
                    avgLatencyMs: 0,
                    totalTokens: 0,
                    promptTokens: 0,
                    completionTokens: 0,
                    cachedTokens: 0
                });
            }
            Cursor += BucketSizeMs;
        }

        const TotalRequests = Buckets.reduce((acc, b) => acc + b.totalRequests, 0);
        const TotalErrors = Buckets.reduce((acc, b) => acc + b.errorRequests, 0);
        const ErrorRate =
            TotalRequests > 0 ? Math.round((TotalErrors / TotalRequests) * 1000) / 1000 : 0;

        return {
            object: "analytics",
            window,
            bucketSizeMs: BucketSizeMs,
            generatedAt: Now,
            requestsPerSecond: raw.rps,
            totalRequests: TotalRequests,
            errorRate: ErrorRate,
            p95LatencyMs: raw.p95LatencyMs,
            buckets: Buckets,
            topModels: raw.topModels.map((m) => ({
                model: m.model,
                totalRequests: num(m.totalRequests),
                totalTokens: num(m.totalTokens),
                estCost: num(m.estCost)
            })),
            topAgents: (raw.topAgents || []).map((a) => ({
                agent: a.userAgent,
                rawUserAgent: a.userAgent,
                totalRequests: num(a.totalRequests),
                totalTokens: num(a.totalTokens)
            })),
            providers: raw.providers
        };
    }
}
