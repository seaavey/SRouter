import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Database, RefreshCw, TriangleAlert } from "lucide-react";
import { api, getGatewayBaseUrl } from "@/lib/api";
import { formatCompactNumber } from "@/lib/utils";
import type { UsageStats } from "@srouter/types";
import {
    GatewayTopologyMap,
    AnimatedNumber,
    ModelUsageOverview,
    NetworkStatus,
    RecentRequestsFeed,
    ResponsiveNumber,
    UsageByModelTable
} from "@/components/dashboard";
import { Button } from "@/components/ui/button";
import { DashboardSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/")({
    staticData: { title: "Dashboard" },
    component: DashboardPage
});

type StatCardProps = {
    label: string;
    value: number | string;
    detail: string;
    tooltip?: string;
    subValue?: string;
    detailContent?: ReactNode;
    animatedValue?: number;
    animatedFormat?: (value: number) => string;
};

function StatCard({
    label,
    value,
    detail,
    tooltip,
    subValue,
    detailContent,
    animatedValue,
    animatedFormat
}: StatCardProps) {
    return (
        <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline">
            <div>
                <span className="text-xs font-medium text-text-muted font-sans">{label}</span>

                <div className="mt-3">
                    <div className="min-w-0 overflow-hidden text-3xl font-bold tracking-tight text-ink cursor-default tabular-nums font-sans">
                        {animatedValue !== undefined ? (
                            <AnimatedNumber value={animatedValue} format={animatedFormat} />
                        ) : typeof value === "number" ? (
                            <ResponsiveNumber value={value} title={tooltip} />
                        ) : (
                            <span title={tooltip ?? value}>{value}</span>
                        )}
                    </div>
                </div>

                {subValue && (
                    <div className="mt-1 font-mono text-xs font-medium text-text-muted tabular-nums">
                        {subValue}
                    </div>
                )}
            </div>

            {detailContent ?? (
                <p
                    className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans"
                    title={detail}
                >
                    {detail}
                </p>
            )}
        </article>
    );
}

function DashboardPage() {
    const queryClient = useQueryClient();
    const {
        data: stats,
        isPending,
        error,
        refetch
    } = useQuery({
        queryKey: ["stats"],
        queryFn: () => api.get<UsageStats>("/v1/logs/stats"),
        refetchInterval: false
    });

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return;

        const source = new EventSource(`${getGatewayBaseUrl()}/logs/events`);
        source.onmessage = (event) => {
            try {
                const payload: unknown = JSON.parse(event.data);
                if (
                    typeof payload === "object" &&
                    payload !== null &&
                    "type" in payload &&
                    payload.type === "usage.updated"
                ) {
                    if ("stats" in payload && payload.stats !== null) {
                        queryClient.setQueryData(["stats"], payload.stats);
                    }
                }
            } catch {
                return;
            }
        };

        return () => source.close();
    }, [queryClient]);

    if (isPending || !stats) {
        if (!stats && error) {
            return (
                <div className="mx-auto w-full max-w-7xl font-sans">
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-destructive/20 bg-canvas p-8 text-center shadow-none">
                        <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400 mb-4">
                            <TriangleAlert className="size-5" strokeWidth={1.75} />
                        </div>
                        <h2 className="text-base font-semibold text-ink">
                            Unable to load gateway statistics.
                        </h2>
                        <p className="mt-1.5 max-w-lg text-xs text-text-muted leading-relaxed">
                            {error instanceof Error
                                ? error.message
                                : "The gateway returned an unknown error."}
                        </p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-5 cursor-pointer gap-2 rounded-full"
                            onClick={() => void refetch()}
                        >
                            <RefreshCw className="size-3" />
                            <span>Retry Connection</span>
                        </Button>
                    </div>
                </div>
            );
        }
        return <DashboardSkeleton />;
    }

    const uncachedInputTokens = Math.max(0, stats.totalInputTokens - stats.totalCachedTokens);

    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8">
            {/* Header */}
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                        <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                            Gateway / Overview
                        </p>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                        Gateway is active.
                    </h1>
                    <p className="mt-1 text-base font-light text-text-muted font-sans">
                        A quiet view of traffic, routing, and connected providers.
                    </p>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 gap-2 px-4 cursor-pointer rounded-full font-medium"
                        onClick={() => void refetch()}
                    >
                        <RefreshCw className="size-3 text-text-muted" />
                        <span>Refresh</span>
                    </Button>
                </div>
            </header>

            {/* 4 KPI Cards */}
            <section
                aria-label="Gateway usage summary"
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
                <StatCard
                    label="Total Requests"
                    value={stats.totalRequests}
                    animatedValue={stats.totalRequests}
                    tooltip={
                        stats
                            ? `${stats.totalRequests.toLocaleString()} recorded requests`
                            : undefined
                    }
                    detail="All recorded requests"
                />
                <StatCard
                    label="Total Tokens"
                    value={stats.totalTokens}
                    animatedValue={stats.totalTokens}
                    tooltip={
                        stats
                            ? `${stats.totalTokens.toLocaleString()} total tokens (${uncachedInputTokens.toLocaleString()} input, ${stats.totalOutputTokens.toLocaleString()} output, ${stats.totalCachedTokens.toLocaleString()} cached)`
                            : undefined
                    }
                    detail={
                        stats
                            ? `${formatCompactNumber(uncachedInputTokens)} input, ${formatCompactNumber(stats.totalOutputTokens)} output, ${formatCompactNumber(stats.totalCachedTokens)} cached`
                            : "0 input, 0 output, 0 cached"
                    }
                    detailContent={
                        <div
                            className="mt-4 grid grid-cols-3 gap-1 border-t border-hairline-soft pt-3 font-mono text-[11px] text-text-muted"
                            title={`${formatCompactNumber(uncachedInputTokens)} input, ${formatCompactNumber(stats.totalOutputTokens)} output, ${formatCompactNumber(stats.totalCachedTokens)} cached`}
                            aria-label={`${formatCompactNumber(uncachedInputTokens)} input, ${formatCompactNumber(stats.totalOutputTokens)} output, ${formatCompactNumber(stats.totalCachedTokens)} cached`}
                        >
                            <span
                                className="flex min-w-0 items-center gap-1"
                                aria-label="Input tokens"
                            >
                                <ArrowDownToLine className="size-3 shrink-0" aria-hidden="true" />
                                <span className="sr-only">Input</span>
                                <ResponsiveNumber value={uncachedInputTokens} />
                            </span>
                            <span
                                className="flex min-w-0 items-center gap-1"
                                aria-label="Output tokens"
                            >
                                <ArrowUpFromLine className="size-3 shrink-0" aria-hidden="true" />
                                <span className="sr-only">Output</span>
                                <ResponsiveNumber value={stats.totalOutputTokens} />
                            </span>
                            <span
                                className="flex min-w-0 items-center gap-1"
                                aria-label="Cached tokens"
                            >
                                <Database className="size-3 shrink-0" aria-hidden="true" />
                                <span className="sr-only">Cached</span>
                                <ResponsiveNumber value={stats.totalCachedTokens} />
                            </span>
                        </div>
                    }
                />
                <StatCard
                    label="Estimated Cost"
                    value={stats?.costLabel ?? "$0.00"}
                    animatedValue={stats.totalEstimatedCost}
                    animatedFormat={(value) => `$${value.toFixed(2)}`}
                    detail={
                        stats?.estimated ? "Calculated from pricing catalog" : "Recorded token cost"
                    }
                />
                <StatCard
                    label="Models Routed"
                    value={stats.byModel.length}
                    detail="Active models with traffic"
                />
            </section>

            {/* Traffic & Access */}
            <section
                aria-label="Operational overview"
                className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(19rem,0.6fr)]"
            >
                <ModelUsageOverview models={stats?.byModel ?? []} />
                <NetworkStatus />
            </section>

            {/* Gateway Topology & Recent Requests */}
            <section
                aria-label="Topology and recent activity"
                className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(19rem,0.6fr)]"
            >
                <div className="min-w-0 rounded-3xl border border-hairline-soft bg-canvas-soft overflow-hidden p-0">
                    <GatewayTopologyMap />
                </div>
                <RecentRequestsFeed />
            </section>

            {/* Tabular Usage Breakdown */}
            <UsageByModelTable models={stats?.byModel ?? []} />
        </div>
    );
}
