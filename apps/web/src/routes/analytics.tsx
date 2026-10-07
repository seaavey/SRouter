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
import type { AnalyticsWindow } from "@/lib/types";

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
                        <TriangleAlert className="size-5" strokeWidth={1.75} aria-hidden="true" />
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

    const hasData = data.total_requests > 0;

    const totalCachedTokens = data.buckets.reduce((acc, b) => acc + (b.cached_tokens ?? 0), 0);
    const totalPromptTokensRaw = data.buckets.reduce((acc, b) => acc + (b.prompt_tokens ?? 0), 0);
    const totalPromptTokens = Math.max(0, totalPromptTokensRaw - totalCachedTokens);
    const totalCompletionTokens = data.buckets.reduce(
        (acc, b) => acc + (b.completion_tokens ?? 0),
        0
    );
    const totalTokensAll = data.buckets.reduce(
        (acc, b) => acc + (b.total_tokens ?? (b.prompt_tokens ?? 0) + (b.completion_tokens ?? 0)),
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
                lastUpdated={data.generated_at}
            />

            <AnalyticsStatCards
                totalRequests={data.total_requests}
                errorRate={data.error_rate}
                p95LatencyMs={data.p95_latency_ms}
                totalTokens={totalTokensAll}
                promptTokens={totalPromptTokens}
                completionTokens={totalCompletionTokens}
                cachedTokens={totalCachedTokens}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TrafficChart buckets={data.buckets} bucketSizeMs={data.bucket_size_ms} />
                <LatencyChart buckets={data.buckets} bucketSizeMs={data.bucket_size_ms} />
            </div>
            <TokenUsageChart buckets={data.buckets} bucketSizeMs={data.bucket_size_ms} />
            <BreakdownTabsCard
                models={data.top_models}
                agents={data.top_agents}
                providers={data.providers}
                totalRequests={data.total_requests}
            />
        </div>
    );
}
