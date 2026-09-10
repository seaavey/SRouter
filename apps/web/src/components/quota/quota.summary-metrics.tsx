import { Shield, Gauge, Zap, Activity } from "lucide-react";

export interface QuotaSummaryMetricsProps {
    totalAccounts: number;
    totalLiveQuotas: number;
    exhaustedQuotas: number;
    totalTokens: number;
    totalRequests: number;
}

export function QuotaSummaryMetrics({
    totalAccounts,
    totalLiveQuotas,
    exhaustedQuotas,
    totalTokens,
    totalRequests
}: QuotaSummaryMetricsProps) {
    const cards = [
        {
            label: "Connected Accounts",
            icon: Shield,
            value: totalAccounts.toString(),
            detail: totalAccounts > 0 ? "Active provider credentials" : "No accounts stored"
        },
        {
            label: "Live Model Quotas",
            icon: Gauge,
            value: totalLiveQuotas.toString(),
            detail:
                exhaustedQuotas > 0 ? (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                        {exhaustedQuotas} quota exhausted
                    </span>
                ) : (
                    "All quotas within limits"
                )
        },
        {
            label: "Total Tokens Routed",
            icon: Zap,
            value: totalTokens.toLocaleString(),
            detail: "Combined gateway throughput"
        },
        {
            label: "Requests Handled",
            icon: Activity,
            value: totalRequests.toLocaleString(),
            detail: "Tracked request executions"
        }
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans">
            {cards.map((card) => {
                const Icon = card.icon;
                return (
                    <article
                        key={card.label}
                        className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-text-muted font-sans">
                                {card.label}
                            </span>
                            <Icon className="size-4 text-text-muted" />
                        </div>
                        <div className="mt-3">
                            <div className="text-3xl font-bold tracking-tight text-ink font-mono tabular-nums">
                                {card.value}
                            </div>
                        </div>
                        <div className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                            {card.detail}
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
