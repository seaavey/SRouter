import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactNode } from "react";
import {
    ArrowDownToLine,
    ArrowUpFromLine,
    Database,
    RefreshCw,
    TriangleAlert
} from "lucide-react";
import { api, getGatewayBaseUrl } from "@/lib/api";
import { formatCompactNumber } from "@/lib/utils";
import type { UsageStats } from "@srouter/types";
import {
    GatewayTopologyMap,
    AnimatedNumber,
    ModelUsageOverview,
    NetworkStatus,
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
        <article className="flex min-w-0 min-h-32 flex-col justify-between border-border/70 bg-card p-4 transition-colors hover:bg-muted/20 sm:p-5">
            <div>
                <span className="text-[10.5px] font-medium tracking-wider uppercase text-muted-foreground">
                    {label}
                </span>

                <div className="mt-2.5">
                    <div className="min-w-0 overflow-hidden text-2xl font-bold tracking-tight text-foreground cursor-default tabular-nums">
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
                    <div className="mt-1 text-[11px] font-medium text-muted-foreground tabular-nums">
                        {subValue}
                    </div>
                )}
            </div>

            {detailContent ?? (
                <p
                    className="mt-3 truncate border-t border-border/50 pt-2.5 text-[11px] text-muted-foreground"
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
                <div className="mx-auto w-full max-w-7xl font-mono">
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 text-center">
                        <div className="flex size-10 items-center justify-center rounded-md bg-destructive/10 text-destructive mb-3.5">
                            <TriangleAlert className="size-5" strokeWidth={1.75} />
                        </div>
                        <h1 className="text-sm font-bold text-foreground">
                            Unable to load gateway statistics
                        </h1>
                        <p className="mt-1 max-w-lg text-xs text-muted-foreground leading-relaxed">
                            {error instanceof Error
                                ? error.message
                                : "The gateway returned an unknown error."}
                        </p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-4 h-8 text-xs cursor-pointer gap-1.5"
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
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-mono">
            {/* Header */}
            <header className="flex flex-col justify-between gap-5 border-b border-foreground/15 pb-6 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="size-1.5 shrink-0 rounded-full bg-foreground" />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            Gateway / Overview
                        </p>
                    </div>
                    <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-4xl">
                        Operations
                    </h1>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
                        A quiet view of traffic, routing, and connected providers.
                    </p>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 gap-2 border-border/80 px-3 text-xs text-muted-foreground hover:bg-foreground hover:text-background cursor-pointer"
                        onClick={() => void refetch()}
                    >
                        <RefreshCw className="size-3" />
                        <span>Refresh</span>
                    </Button>
                </div>
            </header>

            {/* Summary */}
            <section
                aria-label="Gateway usage summary"
                className="grid grid-cols-1 divide-y divide-border/70 overflow-hidden border-y border-border/80 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4"
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
                            className="mt-2 grid grid-cols-3 gap-1 border-t border-border/50 pt-2 text-[9px] leading-none text-muted-foreground"
                            title={`${formatCompactNumber(uncachedInputTokens)} input, ${formatCompactNumber(stats.totalOutputTokens)} output, ${formatCompactNumber(stats.totalCachedTokens)} cached`}
                            aria-label={`${formatCompactNumber(uncachedInputTokens)} input, ${formatCompactNumber(stats.totalOutputTokens)} output, ${formatCompactNumber(stats.totalCachedTokens)} cached`}
                        >
                            <span className="flex min-w-0 items-center gap-1" aria-label="Input tokens">
                                <ArrowDownToLine className="size-2.5" aria-hidden="true" />
                                <span className="sr-only">Input</span>
                                <ResponsiveNumber value={uncachedInputTokens} />
                            </span>
                            <span className="flex min-w-0 items-center gap-1" aria-label="Output tokens">
                                <ArrowUpFromLine className="size-2.5" aria-hidden="true" />
                                <span className="sr-only">Output</span>
                                <ResponsiveNumber value={stats.totalOutputTokens} />
                            </span>
                            <span className="flex min-w-0 items-center gap-1" aria-label="Cached tokens">
                                <Database className="size-2.5" aria-hidden="true" />
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

            {/* Routing topology */}
            <GatewayTopologyMap />

            {/* Tabular Usage Breakdown */}
            <UsageByModelTable models={stats?.byModel ?? []} />
        </div>
    );
}
