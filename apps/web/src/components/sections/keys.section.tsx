import { CircleDollarSign, KeyRound, Zap } from "lucide-react";
import { formatCompactNumber } from "@/lib/utils";

type KeyMetricsProps = {
    totalKeys: number;
    activeKeys: number;
    totalUsageTokens: number;
    totalUsageCost?: number;
};

export default function KeyMetrics({
    totalKeys,
    activeKeys,
    totalUsageTokens,
    totalUsageCost = 0
}: KeyMetricsProps) {
    return (
        <section
            aria-label="API Keys Summary"
            className="grid grid-cols-1 rounded-xl border border-border/70 bg-card/60 divide-y sm:divide-y-0 sm:divide-x sm:grid-cols-3 divide-border/60 shadow-2xs font-mono"
        >
            {/* 1. Active Keys */}
            <article className="relative min-w-0 p-4 sm:p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="flex size-6 items-center justify-center rounded-md bg-secondary/60 text-foreground">
                        <KeyRound className="size-3.5" strokeWidth={1.75} />
                    </div>
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em]">
                        Active Keys
                    </span>
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                        {activeKeys}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                        / {totalKeys} total
                    </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    Authorized virtual bearer tokens
                </p>
            </article>

            {/* 2. Token Throughput */}
            <article className="relative min-w-0 p-4 sm:p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="flex size-6 items-center justify-center rounded-md bg-secondary/60 text-amber-500">
                        <Zap className="size-3.5" strokeWidth={1.75} />
                    </div>
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em]">
                        Throughput
                    </span>
                </div>
                <div
                    className="mt-3 flex items-baseline gap-1.5 cursor-default"
                    title={`Total Token Volume: ${totalUsageTokens.toLocaleString()} tokens`}
                >
                    <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                        {formatCompactNumber(totalUsageTokens)}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">tok</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    Cumulative tokens routed via keys
                </p>
            </article>

            {/* 3. Usage Spend */}
            <article className="relative min-w-0 p-4 sm:p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="flex size-6 items-center justify-center rounded-md bg-secondary/60 text-emerald-500">
                        <CircleDollarSign className="size-3.5" strokeWidth={1.75} />
                    </div>
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em]">
                        Recorded Spend
                    </span>
                </div>
                <div
                    className="mt-3 flex items-baseline gap-1.5 cursor-default"
                    title={`Total Recorded Cost: $${totalUsageCost.toFixed(4)}`}
                >
                    <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                        ${totalUsageCost.toFixed(2)}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">USD</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    Estimated balance & credit consumption
                </p>
            </article>
        </section>
    );
}
