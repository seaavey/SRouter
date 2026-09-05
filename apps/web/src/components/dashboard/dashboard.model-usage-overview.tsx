import { useMemo } from "react";
import { ArrowDown, ArrowUp, Cpu, Layers, BarChart2 } from "lucide-react";
import type { UsageStats } from "@srouter/types";
import { ProviderIcon } from "@/components/providers";
import { formatCompactNumber } from "@/lib/utils";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

type ModelUsageOverviewProps = {
    models: UsageStats["byModel"];
};

function parseModelIdentifier(fullModel: string) {
    const parts = fullModel.split("/");
    if (parts.length > 1) {
        return {
            provider: parts[0],
            name: parts.slice(1).join("/"),
            fullName: fullModel
        };
    }
    return {
        provider: "gateway",
        name: fullModel,
        fullName: fullModel
    };
}

export function ModelUsageOverview({ models }: ModelUsageOverviewProps) {
    const topModels = useMemo(() => {
        return [...models]
            .sort(
                (a, b) =>
                    b.totalInputTokens +
                    b.totalOutputTokens -
                    (a.totalInputTokens + a.totalOutputTokens)
            )
            .slice(0, 5);
    }, [models]);

    const maxTokens = useMemo(() => {
        return Math.max(
            ...topModels.map((model) => model.totalInputTokens + model.totalOutputTokens),
            0
        );
    }, [topModels]);

    const totalTopVolume = useMemo(() => {
        return topModels.reduce(
            (acc, model) => acc + model.totalInputTokens + model.totalOutputTokens,
            0
        );
    }, [topModels]);

    return (
        <section
            className="flex h-full min-w-0 flex-col rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5 lg:p-6 shadow-xs"
            aria-labelledby="model-usage-title"
        >
            {/* Header */}
            <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-border/60">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-foreground">
                        <Cpu className="size-3.5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h2
                                id="model-usage-title"
                                className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap"
                            >
                                Model traffic
                            </h2>
                            {topModels.length > 0 && (
                                <span className="inline-flex items-center rounded-full border border-border/60 bg-secondary/40 px-1.5 py-0.2 text-[9px] font-mono text-muted-foreground">
                                    Top {topModels.length}
                                </span>
                            )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            Highest token volume in the current dataset
                        </p>
                    </div>
                </div>

                {/* Legend */}
                {topModels.length > 0 && (
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono shrink-0">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-foreground/45 ring-1 ring-foreground/20" />
                            Input
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-foreground ring-1 ring-foreground/40" />
                            Output
                        </span>
                    </div>
                )}
            </header>

            {topModels.length === 0 ? (
                <Empty className="mt-6">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Layers className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>No model traffic recorded</EmptyTitle>
                        <EmptyDescription>
                            Usage metrics and token distribution will appear here once your gateway
                            processes its first request.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className="mt-3 space-y-2" aria-label="Top models by token volume">
                    {topModels.map((model, index) => {
                        const totalTokens = model.totalInputTokens + model.totalOutputTokens;
                        const width =
                            maxTokens > 0 ? Math.max((totalTokens / maxTokens) * 100, 1.5) : 0;
                        const sharePercent =
                            totalTopVolume > 0
                                ? ((totalTokens / totalTopVolume) * 100).toFixed(1)
                                : "0.0";
                        const { provider, name } = parseModelIdentifier(model.model);
                        const inputRatio = (model.totalInputTokens / (totalTokens || 1)) * 100;
                        const outputRatio = (model.totalOutputTokens / (totalTokens || 1)) * 100;
                        const breakdown = `${model.totalInputTokens.toLocaleString()} input (${inputRatio.toFixed(1)}%), ${model.totalOutputTokens.toLocaleString()} output (${outputRatio.toFixed(1)}%)${model.totalCachedTokens ? `, ${model.totalCachedTokens.toLocaleString()} cached` : ""}`;

                        return (
                            <div
                                key={model.model}
                                className="group relative rounded-xl border border-border/50 bg-background/50 p-3 transition-all duration-200 hover:border-border hover:bg-muted/20 hover:shadow-xs"
                            >
                                <div className="grid min-w-0 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
                                    {/* Left: Rank, Icon, Provider & Model Name */}
                                    <div className="flex min-w-0 items-center gap-2.5">
                                        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted/60 font-mono text-[10px] font-medium text-muted-foreground border border-border/40">
                                            {index + 1}
                                        </span>

                                        <ProviderIcon
                                            providerId={provider}
                                            className="size-4 shrink-0 rounded-xs"
                                        />

                                        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px]">
                                            <span
                                                className="shrink-0 text-muted-foreground/80 font-normal truncate max-w-20 sm:max-w-24"
                                                title={`Provider: ${provider}`}
                                            >
                                                {provider}
                                                <span className="opacity-40 ml-1">/</span>
                                            </span>
                                            <span
                                                className="truncate font-semibold text-foreground tracking-tight"
                                                title={model.model}
                                            >
                                                {name}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Right: Metrics Table */}
                                    <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3.5 font-mono tabular-nums text-[10.5px]">
                                        {/* Requests */}
                                        <span
                                            className="text-left sm:w-16 sm:text-right text-[10.5px] text-muted-foreground"
                                            title={`Requests: ${model.totalRequests.toLocaleString()}`}
                                        >
                                            {formatCompactNumber(model.totalRequests)}{" "}
                                            <span className="text-[9.5px] opacity-70">req</span>
                                        </span>

                                        {/* Input Tokens */}
                                        <span
                                            className="text-right sm:w-20 text-muted-foreground"
                                            title={`Prompt Tokens: ${model.totalInputTokens.toLocaleString()}`}
                                        >
                                            <ArrowDown className="inline size-2.5 opacity-60 mr-0.5" />
                                            <strong className="font-semibold text-foreground">
                                                {formatCompactNumber(model.totalInputTokens)}
                                            </strong>
                                            <span className="text-[9px] opacity-70 ml-0.5">in</span>
                                        </span>

                                        {/* Output Tokens */}
                                        <span
                                            className="text-right sm:w-20 text-muted-foreground"
                                            title={`Completion Tokens: ${model.totalOutputTokens.toLocaleString()}`}
                                        >
                                            <ArrowUp className="inline size-2.5 opacity-60 mr-0.5" />
                                            <strong className="font-semibold text-foreground">
                                                {formatCompactNumber(model.totalOutputTokens)}
                                            </strong>
                                            <span className="text-[9px] opacity-70 ml-0.5">
                                                out
                                            </span>
                                        </span>

                                        {/* Total Tokens & Share */}
                                        <div
                                            className="text-right sm:w-24 flex items-center justify-end gap-1.5"
                                            title={`Total Tokens: ${totalTokens.toLocaleString()} (${sharePercent}% of top models)`}
                                        >
                                            <span className="text-[11.5px] font-semibold text-foreground">
                                                {formatCompactNumber(totalTokens)}
                                            </span>
                                            <span className="text-[9px] text-muted-foreground font-normal">
                                                tok
                                            </span>
                                        </div>
                                    </div>

                                    {/* Bottom: Proportional Distribution Bar */}
                                    <div className="col-span-1 sm:col-span-2 pt-1">
                                        <div
                                            role="progressbar"
                                            aria-valuenow={totalTokens}
                                            aria-valuemin={0}
                                            aria-valuemax={maxTokens}
                                            aria-label={`${model.model}: ${totalTokens.toLocaleString()} total tokens. ${breakdown}`}
                                            title={breakdown}
                                            className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden ring-1 ring-border/20"
                                        >
                                            <div
                                                className="flex h-full transition-all duration-500 ease-out"
                                                style={{ width: `${width}%` }}
                                            >
                                                {/* Input / Prompt Segment */}
                                                <span
                                                    className="h-full bg-foreground/35 transition-colors group-hover:bg-foreground/50"
                                                    style={{ width: `${inputRatio}%` }}
                                                    title={`Input: ${model.totalInputTokens.toLocaleString()}`}
                                                />
                                                {/* Output / Completion Segment */}
                                                <span
                                                    className="h-full bg-foreground transition-colors group-hover:brightness-110"
                                                    style={{ width: `${outputRatio}%` }}
                                                    title={`Output: ${model.totalOutputTokens.toLocaleString()}`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
