import type { ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
    Activity,
    Boxes,
    Coins,
    CircleDollarSign,
    Cpu,
    Radio,
    RefreshCw,
    TriangleAlert,
    Zap
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCompactNumber } from "@/lib/utils";
import type { UsageStats } from "@srouter/types";
import { GatewayTopologyMap, ModelUsageOverview, NetworkStatus, UsageByModelTable } from "@/components/dashboard";
import { Button } from "@/components/ui/button";
import { DashboardSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/")({
    staticData: { title: "Dashboard" },
    component: DashboardPage
});

type StatCardProps = {
    label: string;
    value: string;
    detail: string;
    icon: ComponentType<{ className?: string; strokeWidth?: number }>;
    tooltip?: string;
    subValue?: string;
    badge?: string;
};

function StatCard({ label, value, detail, icon: Icon, tooltip, subValue, badge }: StatCardProps) {
    return (
        <article className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-card/50 p-4.5 transition-all duration-200 hover:border-border hover:bg-card/80 hover:shadow-xs">
            {/* Subtle ambient accent on hover */}
            <div className="pointer-events-none absolute -top-12 -right-12 size-24 rounded-full bg-primary/5 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />

            <div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
                        {label}
                    </span>
                    <div className="flex size-7 items-center justify-center rounded-lg border border-border/60 bg-muted/40 transition-colors group-hover:bg-muted/80">
                        <Icon className="size-3.5 text-foreground/80" strokeWidth={1.75} />
                    </div>
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                    <div
                        className="text-2xl font-semibold tracking-tight text-foreground cursor-default font-mono"
                        title={tooltip ?? value}
                    >
                        {value}
                    </div>
                    {badge && (
                        <span className="inline-flex items-center rounded-md border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {badge}
                        </span>
                    )}
                </div>

                {subValue && (
                    <div className="mt-1 text-[11px] font-medium text-muted-foreground/90 font-mono">
                        {subValue}
                    </div>
                )}
            </div>

            <p
                className="mt-3 truncate text-[11px] text-muted-foreground border-t border-border/40 pt-2.5"
                title={detail}
            >
                {detail}
            </p>
        </article>
    );
}

function DashboardPage() {
    const {
        data: stats,
        isPending,
        error,
        refetch
    } = useQuery({
        queryKey: ["stats"],
        queryFn: () => api.get<UsageStats>("/v1/logs/stats"),
        refetchInterval: 30_000,
        refetchIntervalInBackground: false
    });

    if (isPending || !stats) {
        if (!stats && error) {
            return (
                <div className="mx-auto w-full max-w-7xl font-mono">
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 text-center">
                        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3.5">
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

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 font-mono">
            {/* Header */}
            <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center border-b border-border/70 pb-5">
                <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                            Gateway Operations
                        </h1>
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500 font-mono">
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            LIVE
                        </span>
                    </div>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
                        Real-time inference telemetry, routed model analytics, and active provider nodes.
                    </p>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground border-border/70 cursor-pointer"
                        onClick={() => void refetch()}
                    >
                        <RefreshCw className="size-3" />
                        <span>Refresh</span>
                    </Button>
                </div>
            </header>

            {/* 4 KPI Telemetry Tiles */}
            <section
                aria-label="Gateway usage summary"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5"
            >
                <StatCard
                    label="Total Requests"
                    value={stats ? formatCompactNumber(stats.totalRequests) : "0"}
                    tooltip={
                        stats
                            ? `${stats.totalRequests.toLocaleString()} recorded requests`
                            : undefined
                    }
                    detail="All recorded requests"
                    icon={Activity}
                    badge="Requests"
                />
                <StatCard
                    label="Total Tokens"
                    value={stats ? formatCompactNumber(stats.totalTokens) : "0"}
                    tooltip={
                        stats
                            ? `${stats.totalTokens.toLocaleString()} total tokens (${stats.totalInputTokens.toLocaleString()} in · ${stats.totalOutputTokens.toLocaleString()} out)`
                            : undefined
                    }
                    detail={
                        stats
                            ? `${formatCompactNumber(stats.totalInputTokens)} in · ${formatCompactNumber(stats.totalOutputTokens)} out`
                            : "0 in · 0 out"
                    }
                    icon={Coins}
                    badge="Volume"
                />
                <StatCard
                    label="Estimated Cost"
                    value={stats?.costLabel ?? "$0.00"}
                    detail={
                        stats?.estimated ? "Calculated from pricing catalog" : "Recorded token cost"
                    }
                    icon={CircleDollarSign}
                    badge="Est."
                />
                <StatCard
                    label="Models Routed"
                    value={stats ? stats.byModel.length.toLocaleString() : "0"}
                    detail="Active models with traffic"
                    icon={Boxes}
                    badge="Models"
                />
            </section>

            {/* Overview & Live Network Status */}
            <section
                aria-label="Operational overview"
                className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]"
            >
                <ModelUsageOverview models={stats?.byModel ?? []} />
                <NetworkStatus />
            </section>

            {/* Mesh Routing Topology Map */}
            <GatewayTopologyMap />

            {/* Tabular Usage Breakdown */}
            <UsageByModelTable models={stats?.byModel ?? []} />
        </div>
    );
}
