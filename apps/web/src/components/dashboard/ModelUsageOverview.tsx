import type { UsageStats } from "@/lib/types";

type ModelUsageOverviewProps = {
    models: UsageStats["byModel"];
};

export function ModelUsageOverview({ models }: ModelUsageOverviewProps) {
    const topModels = [...models]
        .sort(
            (a, b) =>
                b.totalInputTokens +
                b.totalOutputTokens -
                (a.totalInputTokens + a.totalOutputTokens),
        )
        .slice(0, 5);
    const maxTokens = Math.max(
        ...topModels.map((model) => model.totalInputTokens + model.totalOutputTokens),
        0,
    );

    return (
        <section className="min-w-0 py-5 pr-0 lg:pr-6" aria-labelledby="model-usage-title">
            <header className="flex items-end justify-between gap-4">
                <div>
                    <h2 id="model-usage-title" className="text-sm font-semibold text-foreground">
                        Model traffic
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Highest token volume in the current dataset
                    </p>
                </div>
                <span className="hidden font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:block">
                    tokens / requests
                </span>
            </header>

            {topModels.length === 0 ? (
                <div className="mt-5 border-l-2 border-border pl-3">
                    <p className="text-xs font-medium text-foreground">No model traffic recorded</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                        Usage will appear after the gateway handles its first request.
                    </p>
                </div>
            ) : (
                <div className="mt-4 space-y-3" aria-label="Top models by token volume">
                    {topModels.map((model) => {
                        const totalTokens = model.totalInputTokens + model.totalOutputTokens;
                        const width =
                            maxTokens > 0 ? Math.max((totalTokens / maxTokens) * 100, 1) : 0;
                        const breakdown = `${model.totalInputTokens.toLocaleString()} input, ${model.totalOutputTokens.toLocaleString()} output`;

                        return (
                            <div
                                key={model.model}
                                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-x-6 gap-y-1.5"
                            >
                                <p
                                    className="truncate font-mono text-[11px] font-medium text-foreground"
                                    title={model.model}
                                >
                                    {model.model}
                                </p>
                                <div className="flex items-baseline gap-4 font-mono tabular-nums">
                                    <span className="text-[10px] text-muted-foreground">
                                        {model.totalRequests.toLocaleString()} req
                                    </span>
                                    <span className="w-20 text-right text-[11px] text-foreground">
                                        {totalTokens.toLocaleString()}
                                        <span className="ml-1 text-[9px] text-muted-foreground">
                                            tok
                                        </span>
                                    </span>
                                </div>
                                <div
                                    role="img"
                                    aria-label={`${model.model}: ${totalTokens.toLocaleString()} total tokens. ${breakdown}`}
                                    title={breakdown}
                                    className="col-span-2 h-px bg-border/60"
                                >
                                    <span
                                        className="block h-px bg-foreground"
                                        style={{ width: `${width}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
