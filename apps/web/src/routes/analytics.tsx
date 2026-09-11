import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AnalyticsSkeleton } from "@/components/skeletons";
import {
    AnalyticsHeader,
    AnalyticsStatCards,
    TrafficChart,
    LatencyChart,
    TokenUsageChart,
    BreakdownTabsCard
} from "@/components/analytics";
import type { AnalyticsWindow } from "@srouter/types";

export const Route = createFileRoute("/analytics")({
    staticData: { title: "Analytics" },
    component: AnalyticsPage
});

function AnalyticsPage() {
    const [window, setWindow] = useState<AnalyticsWindow>("24h");
    const { data, isLoading, isPlaceholderData, error } = useAnalytics(window);

    if (isLoading && !data) {
        return <AnalyticsSkeleton />;
    }

    if (error || !data) {
        return (
            <div className="mx-auto flex w-full max-w-[1360px] flex-col font-sans">
                <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
                    <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3.5">
                        <TriangleAlert className="size-5" strokeWidth={1.75} />
                    </div>
                    <h2 className="text-base font-bold text-ink">
                        Failed to load analytics telemetry
                    </h2>
                    <p className="mt-1.5 max-w-md text-xs text-text-muted leading-relaxed font-mono">
                        {error instanceof Error
                            ? error.message
                            : "The gateway returned an unexpected error."}
                    </p>
                </div>
            </div>
        );
    }

    const hasData = data.totalRequests > 0;

    const totalCachedTokens = data.buckets.reduce((acc, b) => acc + (b.cachedTokens ?? 0), 0);
    const totalPromptTokensRaw = data.buckets.reduce((acc, b) => acc + (b.promptTokens ?? 0), 0);
    const totalPromptTokens = Math.max(0, totalPromptTokensRaw - totalCachedTokens);
    const totalCompletionTokens = data.buckets.reduce(
        (acc, b) => acc + (b.completionTokens ?? 0),
        0
    );
    const totalTokensAll = data.buckets.reduce(
        (acc, b) => acc + (b.totalTokens ?? (b.promptTokens ?? 0) + (b.completionTokens ?? 0)),
        0
    );

    return (
        <div
            className={`mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans transition-opacity duration-200 ${
                isPlaceholderData ? "opacity-60" : "opacity-100"
            }`}
        >
            <AnalyticsHeader
                window={window}
                onWindowChange={setWindow}
                lastUpdated={data.generatedAt}
            />

            <AnalyticsStatCards
                totalRequests={data.totalRequests}
                errorRate={data.errorRate}
                p95LatencyMs={data.p95LatencyMs}
                totalTokens={totalTokensAll}
                promptTokens={totalPromptTokens}
                completionTokens={totalCompletionTokens}
                cachedTokens={totalCachedTokens}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TrafficChart buckets={data.buckets} bucketSizeMs={data.bucketSizeMs} />
                <LatencyChart buckets={data.buckets} />
            </div>
            <TokenUsageChart buckets={data.buckets} bucketSizeMs={data.bucketSizeMs} />
            <BreakdownTabsCard
                models={data.topModels}
                agents={data.topAgents}
                providers={data.providers}
                totalRequests={data.totalRequests}
            />
        </div>
    );
}
