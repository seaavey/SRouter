import {
    getAllAPIKeysDB,
    getAnalyticsDB,
    getBucketSizeMs,
    getBucketCount,
    getLogByIdDB,
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
        const [logs, context] = await Promise.all([
            getRecentLogsDB(limit),
            LogsLogic.getLogEnrichmentContext()
        ]);

        return logs.map((log) => LogsLogic.enrichLog(log, context));
    }

    public static async getLogById(id: string): Promise<RequestLogEntry | undefined> {
        const [log, context] = await Promise.all([
            getLogByIdDB(id),
            LogsLogic.getLogEnrichmentContext()
        ]);
        return log ? LogsLogic.enrichLog(log, context) : undefined;
    }

    public static async getPaginatedLogs(
        page: number = 1,
        limit: number = 50,
        status?: "all" | "success" | "error"
    ): Promise<{
        data: RequestLogEntry[];
        pagination: { page: number; limit: number; total: number; total_pages: number };
    }> {
        const [{ data: rawLogs, pagination }, context] = await Promise.all([
            getPaginatedLogsDB(page, limit, status),
            LogsLogic.getLogEnrichmentContext()
        ]);

        const data = rawLogs.map((log) => LogsLogic.enrichLog(log, context));

        return {
            data,
            pagination
        };
    }

    private static async getLogEnrichmentContext(): Promise<{
        requireApiKey: boolean;
        keyMap: Map<string, string>;
    }> {
        const [requireApiKey, keys] = await Promise.all([
            getRequireApiKeyDB().catch(() => false),
            getAllAPIKeysDB().catch(() => [])
        ]);
        const keyMap = new Map<string, string>();
        for (const key of keys) {
            keyMap.set(key.id, key.name);
        }
        return { requireApiKey, keyMap };
    }

    private static enrichLog(
        log: RequestLogEntry,
        context: { requireApiKey: boolean; keyMap: Map<string, string> }
    ): RequestLogEntry {
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
        const apiKeyId = context.requireApiKey ? log.apiKeyId : undefined;

        return {
            ...log,
            apiKeyId,
            apiKeyName: apiKeyId ? context.keyMap.get(apiKeyId) : undefined,
            costBreakdown: breakdown
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
