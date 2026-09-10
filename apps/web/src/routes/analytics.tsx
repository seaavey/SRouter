import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, TriangleAlert } from "lucide-react";
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
import {
    Empty,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription
} from "@/components/ui/empty";

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
                requestsPerSecond={data.requestsPerSecond}
                totalRequests={data.totalRequests}
                errorRate={data.errorRate}
                p95LatencyMs={data.p95LatencyMs}
            />

            {!hasData ? (
                <Empty className="rounded-3xl border border-hairline-soft bg-canvas p-12">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <BarChart3 className="size-5 text-text-muted" />
                        </EmptyMedia>
                        <EmptyTitle className="text-ink font-bold">No Requests Recorded</EmptyTitle>
                        <EmptyDescription className="text-text-muted text-xs">
                            No requests recorded in the selected {window} timeframe window.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <>
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
                </>
            )}
        </div>
    );
}
