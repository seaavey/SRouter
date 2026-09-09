import { Coins, Sparkles, Tag, DollarSign } from "lucide-react";

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
        {
            label: "Total Models",
            value: String(totalModels),
            icon: Coins,
            sub: "in catalog"
        },
        {
            label: "Free Tier",
            value: String(freeModels),
            icon: Tag,
            sub: "zero token cost"
        },
        {
            label: "Median Input",
            value: medianInputPrice > 0 ? `$${medianInputPrice.toFixed(2)}` : "$0.00",
            icon: DollarSign,
            sub: "per 1M tokens"
        },
        {
            label: "Median Output",
            value: medianOutputPrice > 0 ? `$${medianOutputPrice.toFixed(2)}` : "$0.00",
            icon: Sparkles,
            sub: "per 1M tokens"
        }
    ];

    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono">
            {stats.map(({ label, value, icon: Icon, sub }) => (
                <div
                    key={label}
                    className="rounded-lg border border-border/80 bg-card p-3 shadow-2xs space-y-1"
                >
                    <div className="flex items-center justify-between text-muted-foreground text-[10px] uppercase tracking-wider">
                        <span>{label}</span>
                        <Icon className="size-3.5 text-muted-foreground/70" />
                    </div>
                    <div className="text-lg font-bold tracking-tight text-foreground tabular-nums">
                        {value}
                    </div>
                    <div className="text-[10px] text-muted-foreground/70 truncate">{sub}</div>
                </div>
            ))}
        </div>
    );
}
