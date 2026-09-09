interface PricingSummaryMetricsProps {
    totalModels: number;
    freeModels: number;
    medianInputPrice: number;
    medianOutputPrice: number;
}

export function PricingSummaryMetrics({
    totalModels,
    freeModels,
    medianInputPrice,
    medianOutputPrice
}: PricingSummaryMetricsProps) {
    const stats = [
        ["Models", String(totalModels), "in catalog"],
        ["Free", String(freeModels), "zero token cost"],
        ["Input median", `$${medianInputPrice.toFixed(2)}`, "per 1M tokens"],
        ["Output median", `$${medianOutputPrice.toFixed(2)}`, "per 1M tokens"]
    ] as const;

    return (
        <section
            aria-label="Pricing summary"
            className="grid grid-cols-2 divide-x divide-y divide-border/70 border-y border-border/70 sm:grid-cols-4 sm:divide-y-0"
        >
            {stats.map(([label, value, description]) => {
                return (
                    <div key={label} className="min-w-0 px-3 py-2.5 first:pl-0 sm:px-4 sm:first:pl-0">
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                        <div className="mt-0.5 flex items-baseline gap-2">
                            <span className="text-lg font-bold tracking-tight text-foreground tabular-nums">{value}</span>
                            <span className="hidden truncate text-[10px] text-muted-foreground/70 lg:inline">{description}</span>
                        </div>
                    </div>
                );
            })}
        </section>
    );
}
