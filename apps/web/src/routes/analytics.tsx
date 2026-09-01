import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AnalyticsSkeleton } from "@/components/skeletons";
import {
    AnalyticsHeader,
    AnalyticsStatCards,
    TrafficChart,
    LatencyChart,
    TopModelsCard,
    ProviderSplitCard
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
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive font-mono">
                Failed to load analytics: {error instanceof Error ? error.message : "Unknown error"}
            </div>
        );
    }

    const hasData = data.totalRequests > 0;

    return (
        <div className={`flex flex-col gap-6 font-mono transition-opacity duration-200 ${isPlaceholderData ? "opacity-60" : "opacity-100"}`}>
            <AnalyticsHeader
                window={window}
                onWindowChange={setWindow}
                lastUpdated={data.generatedAt}
            />

            <AnalyticsStatCards
                requestsPerSecond={data.requestsPerSecond}
                totalRequests={data.totalRequests}
                errorRate={data.errorRate}
                p95LatencyMs={data.p95LatencyMs}
            />

            {!hasData ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-secondary/10 p-12 text-center text-xs text-muted-foreground">
                    No requests in this window.
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <TrafficChart buckets={data.buckets} bucketSizeMs={data.bucketSizeMs} />
                        <LatencyChart buckets={data.buckets} />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <TopModelsCard models={data.topModels} totalRequests={data.totalRequests} />
                        <ProviderSplitCard
                            providers={data.providers}
                            totalRequests={data.totalRequests}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
