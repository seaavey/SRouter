import { Coins, DollarSign, Sparkles, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";

interface PricingSummaryMetricsProps {
    totalModels: number;
    freeModels: number;
    medianInputPrice: number;
    medianOutputPrice: number;
}

const metricIcons = [Coins, Tag, DollarSign, Sparkles] as const;

export function PricingSummaryMetrics({
    totalModels,
    freeModels,
    medianInputPrice,
    medianOutputPrice
}: PricingSummaryMetricsProps) {
    const stats = [
        ["Total Models", String(totalModels), "in catalog"],
        ["Free Tier", String(freeModels), "zero token cost"],
        ["Median Input", `$${medianInputPrice.toFixed(2)}`, "per 1M tokens"],
        ["Median Output", `$${medianOutputPrice.toFixed(2)}`, "per 1M tokens"]
    ] as const;

    return (
        <section aria-label="Pricing summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(([label, value, description], index) => {
                const Icon = metricIcons[index];
                return (
                    <Card key={label} className="gap-1 rounded-lg p-3 shadow-2xs">
                        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <span>{label}</span>
                            <Icon aria-hidden="true" className="size-3.5 text-muted-foreground/70" />
                        </div>
                        <div className="text-lg font-bold tracking-tight text-foreground tabular-nums">
                            {value}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground/70">{description}</div>
                    </Card>
                );
            })}
        </section>
    );
}
