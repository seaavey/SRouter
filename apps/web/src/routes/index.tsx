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
import { ModelUsageOverview } from "@/components/dashboard/dashboard.model-usage-overview";
import { NetworkStatus } from "@/components/dashboard/dashboard.network-status";
import { GatewayTopologyMap } from "@/components/dashboard/dashboard.gateway-topology-map";
import { UsageByModelTable } from "@/components/dashboard/dashboard.usage-by-model-table";
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
};

function StatCard({ label, value, detail, icon: Icon, tooltip, subValue }: StatCardProps) {
    return (
        <article className="relative flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-4 transition-all duration-150 hover:border-foreground/20 shadow-2xs font-mono">
            <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                    {label}
                </span>
                <div className="flex size-6 items-center justify-center rounded-md border border-border/60 bg-secondary/50">
                    <Icon className="size-3 text-foreground/70" strokeWidth={1.75} />
                </div>
            </div>

            <div className="mt-3">
                <div
                    className="text-2xl font-bold tracking-tight text-foreground cursor-default"
                    title={tooltip ?? value}
                >
                    {value}
                </div>
                {subValue && (
                    <div className="mt-0.5 text-[11px] font-medium text-foreground/70">
                        {subValue}
                    </div>
                )}
            </div>

            <p
                className="mt-2 truncate text-[10.5px] text-muted-foreground border-t border-border/50 pt-2"
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
            <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">
                        Gateway Operations
                    </h1>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
                        Real-time inference telemetry, routed model usage analytics, and active
                        provider node status.
                    </p>
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
                />
                <StatCard
                    label="Estimated Cost"
                    value={stats?.costLabel ?? "$0.00"}
                    detail={
                        stats?.estimated ? "Calculated from pricing catalog" : "Recorded token cost"
                    }
                    icon={CircleDollarSign}
                />
                <StatCard
                    label="Models Routed"
                    value={stats ? stats.byModel.length.toLocaleString() : "0"}
                    detail="Active models with traffic"
                    icon={Boxes}
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
