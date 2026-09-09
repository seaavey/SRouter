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
            className="grid grid-cols-1 divide-y divide-border/70 overflow-hidden border-y border-border/80 sm:grid-cols-3 sm:divide-x sm:divide-y-0 font-mono"
        >
            <article className="flex min-h-28 flex-col justify-between bg-card p-4 transition-colors hover:bg-muted/20 sm:p-5">
                <div>
                    <span className="text-[10.5px] font-medium tracking-wider uppercase text-muted-foreground">
                        Active Keys
                    </span>
                    <div className="mt-2.5 flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                            {activeKeys}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            / {totalKeys} total
                        </span>
                    </div>
                </div>
                <p className="mt-3 truncate text-[11px] text-muted-foreground border-t border-border/50 pt-2.5">
                    Authorized virtual bearer tokens
                </p>
            </article>

            <article className="flex min-h-28 flex-col justify-between bg-card p-4 transition-colors hover:bg-muted/20 sm:p-5">
                <div>
                    <span className="text-[10.5px] font-medium tracking-wider uppercase text-muted-foreground">
                        Throughput
                    </span>
                    <div
                        className="mt-2.5 flex items-baseline gap-1.5 cursor-default"
                        title={`Total Token Volume: ${totalUsageTokens.toLocaleString()} tokens`}
                    >
                        <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                            {formatCompactNumber(totalUsageTokens)}
                        </span>
                        <span className="text-xs text-muted-foreground">tok</span>
                    </div>
                </div>
                <p className="mt-3 truncate text-[11px] text-muted-foreground border-t border-border/50 pt-2.5">
                    Cumulative tokens routed via keys
                </p>
            </article>

            <article className="flex min-h-28 flex-col justify-between bg-card p-4 transition-colors hover:bg-muted/20 sm:p-5">
                <div>
                    <span className="text-[10.5px] font-medium tracking-wider uppercase text-muted-foreground">
                        Recorded Spend
                    </span>
                    <div
                        className="mt-2.5 flex items-baseline gap-1.5 cursor-default"
                        title={`Total Recorded Cost: $${totalUsageCost.toFixed(4)}`}
                    >
                        <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                            ${totalUsageCost.toFixed(2)}
                        </span>
                        <span className="text-xs text-muted-foreground">USD</span>
                    </div>
                </div>
                <p className="mt-3 truncate text-[11px] text-muted-foreground border-t border-border/50 pt-2.5">
                    Estimated balance and credit consumption
                </p>
            </article>
        </section>
    );
}

export { KeyMetrics };
