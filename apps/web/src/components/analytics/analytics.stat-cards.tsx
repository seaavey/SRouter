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
        { label: "RPS (60s)", value: requestsPerSecond.toFixed(2), unit: "req/s" },
        { label: "Total Requests", value: totalRequests.toLocaleString(), unit: "" },
        { label: "Error Rate", value: `${(errorRate * 100).toFixed(1)}%`, unit: "" },
        { label: "p95 Latency", value: p95LatencyMs.toFixed(0), unit: "ms" }
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cards.map((card) => (
                <div
                    key={card.label}
                    className="rounded-xl border border-border/60 bg-secondary/10 p-4"
                >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                        {card.label}
                    </p>
                    <p className="mt-1 text-2xl font-bold tracking-tight text-foreground font-mono">
                        {card.value}
                        {card.unit && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                                {card.unit}
                            </span>
                        )}
                    </p>
                </div>
            ))}
        </div>
    );
}
