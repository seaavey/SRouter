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
            className="grid grid-cols-1 gap-4 sm:grid-cols-3 font-sans"
        >
            <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans">
                <div>
                    <span className="text-xs font-medium text-text-muted font-sans">
                        Active Keys
                    </span>
                    <div className="mt-3 flex items-baseline gap-2">
                        <span className="text-3xl font-bold tracking-tight text-ink font-sans tabular-nums">
                            {activeKeys}
                        </span>
                        <span className="font-mono text-xs text-text-muted">
                            / {totalKeys} total
                        </span>
                    </div>
                </div>
                <p className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                    Authorized virtual bearer tokens
                </p>
            </article>

            <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans">
                <div>
                    <span className="text-xs font-medium text-text-muted font-sans">
                        Throughput
                    </span>
                    <div
                        className="mt-3 flex items-baseline gap-2 cursor-default"
                        title={`Total Token Volume: ${totalUsageTokens.toLocaleString()} tokens`}
                    >
                        <span className="text-3xl font-bold tracking-tight text-ink font-sans tabular-nums">
                            {formatCompactNumber(totalUsageTokens)}
                        </span>
                        <span className="font-mono text-xs text-text-muted">tokens</span>
                    </div>
                </div>
                <p className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                    Cumulative tokens routed via keys
                </p>
            </article>

            <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans">
                <div>
                    <span className="text-xs font-medium text-text-muted font-sans">
                        Recorded Spend
                    </span>
                    <div
                        className="mt-3 flex items-baseline gap-2 cursor-default"
                        title={`Total Recorded Cost: $${totalUsageCost.toFixed(4)}`}
                    >
                        <span className="text-3xl font-bold tracking-tight text-ink font-sans tabular-nums">
                            ${totalUsageCost.toFixed(2)}
                        </span>
                        <span className="font-mono text-xs text-text-muted">USD</span>
                    </div>
                </div>
                <p className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                    Estimated balance and credit consumption
                </p>
            </article>
        </section>
    );
}

export { KeyMetrics };
