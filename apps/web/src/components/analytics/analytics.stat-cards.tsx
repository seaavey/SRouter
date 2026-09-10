interface Props {
    requestsPerSecond: number;
    totalRequests: number;
    errorRate: number;
    p95LatencyMs: number;
}

export function AnalyticsStatCards({
    requestsPerSecond,
    totalRequests,
    errorRate,
    p95LatencyMs
}: Props) {
    const cards = [
        {
            label: "RPS (60s)",
            value: requestsPerSecond.toFixed(2),
            unit: "req/s",
            detail: "Current request throughput"
        },
        {
            label: "Total Requests",
            value: totalRequests.toLocaleString(),
            unit: "",
            detail: "Recorded executions in window"
        },
        {
            label: "Error Rate",
            value: `${(errorRate * 100).toFixed(1)}%`,
            unit: "",
            detail:
                errorRate > 0.05 ? (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                        Elevated error response rate
                    </span>
                ) : (
                    "Optimal operational health"
                )
        },
        {
            label: "p95 Latency",
            value: p95LatencyMs.toFixed(0),
            unit: "ms",
            detail: "95th percentile response duration"
        }
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans">
            {cards.map((card) => (
                <article
                    key={card.label}
                    className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline"
                >
                    <div>
                        <span className="text-xs font-medium text-text-muted font-sans">
                            {card.label}
                        </span>
                        <div className="mt-3">
                            <div className="text-3xl font-bold tracking-tight text-ink font-mono tabular-nums">
                                {card.value}
                                {card.unit && (
                                    <span className="ml-1.5 text-xs font-normal text-text-muted font-sans">
                                        {card.unit}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                        {card.detail}
                    </div>
                </article>
            ))}
        </div>
    );
}
