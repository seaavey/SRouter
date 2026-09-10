import { Coins, BadgeDollarSign, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

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
    const cards = [
        {
            label: "Total Models",
            icon: Coins,
            value: totalModels.toString(),
            detail: "Catalog model offerings"
        },
        {
            label: "Free Tier",
            icon: BadgeDollarSign,
            value: freeModels.toString(),
            detail: "Zero token cost models"
        },
        {
            label: "Median Input",
            icon: ArrowDownToLine,
            value: `$${medianInputPrice.toFixed(2)}`,
            detail: "Per 1M prompt tokens"
        },
        {
            label: "Median Output",
            icon: ArrowUpFromLine,
            value: `$${medianOutputPrice.toFixed(2)}`,
            detail: "Per 1M completion tokens"
        }
    ];

    return (
        <section
            aria-label="Pricing summary"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans"
        >
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
        </section>
    );
}
