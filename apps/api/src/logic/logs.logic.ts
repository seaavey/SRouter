import {
    getAnalyticsDB,
    getBucketSizeMs,
    getBucketCount,
    getRecentLogsDB,
    getUsageByModelDB,
    getUsageSummaryDB
} from "@srouter/db";
import type {
    AnalyticsReport,
    AnalyticsBucket,
    AnalyticsWindow,
    RequestLogEntry,
    UsageStats
} from "@srouter/types";
import { formatCost } from "@srouter/pricing";
import { num } from "@srouter/db";

export class LogsLogic {
    public static getRecentLogs(limit: number = 50): RequestLogEntry[] {
        return getRecentLogsDB(limit);
    }

    public static getUsageStats(): UsageStats {
        const summary = getUsageSummaryDB();
        const byModel = getUsageByModelDB();

        return {
            object: "usage",
            ...summary,
            costLabel: formatCost(summary.totalEstimatedCost),
            estimated: true,
            byModel
        };
    }

    public static getAnalytics(window: AnalyticsWindow): AnalyticsReport {
        const Now = Date.now();
        const BucketSizeMs = getBucketSizeMs(window);
        const BucketCount = getBucketCount(window);
        const raw = getAnalyticsDB(window);

        // Zero-fill missing buckets
        const Since = Now - BucketSizeMs * BucketCount;
        const Buckets: AnalyticsBucket[] = [];
        let Cursor = Math.floor(Since / BucketSizeMs) * BucketSizeMs;
        const End = Now;
        const RawMap = new Map<number, AnalyticsBucket>();
        for (const b of raw.buckets) {
            RawMap.set(b.bucket, {
                bucketStart: b.bucket,
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
            providers: raw.providers
        };
    }
}
