import { useMemo } from "react";
import { Cpu, Layers } from "lucide-react";
import type { UsageStats } from "@srouter/types";
import { ProviderIcon } from "@/components/providers";
import {
    Empty,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription
} from "@/components/ui/empty";
import { ResponsiveNumber } from "./dashboard.responsive-number";

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
            className="flex h-full min-w-0 flex-col rounded-3xl border border-hairline-soft bg-canvas p-4 shadow-none sm:p-5 lg:p-6"
            aria-labelledby="model-usage-title"
        >
            <header className="flex flex-col gap-3 pb-4 border-b border-hairline-soft sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-ink">
                        <Cpu className="size-4" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h2
                                id="model-usage-title"
                                className="font-heading text-base font-semibold text-ink whitespace-nowrap"
                            >
                                Model Traffic.
                            </h2>
                            {topModels.length > 0 && (
                                <span className="text-xs font-mono text-text-muted">
                                    (Top {topModels.length})
                                </span>
                            )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-text-muted">
                            Highest token volume in the current telemetry window
                        </p>
                    </div>
                </div>
                {topModels.length > 0 && (
                    <div className="flex items-center gap-3 text-xs text-text-muted font-mono shrink-0">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-ink/30" />
                            Input
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-ink" />
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
                <div className="mt-4 space-y-2.5" aria-label="Top models by token volume">
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
                                className="group border-b border-hairline-soft py-3 last:border-b-0 sm:py-3.5"
                            >
                                <div className="grid min-w-0 grid-cols-1 items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                        <span className="w-5 shrink-0 text-center font-mono text-[10px] text-text-muted">
                                            {index + 1}
                                        </span>

                                        <ProviderIcon
                                            providerId={provider}
                                            className="size-4 shrink-0 rounded-[30%]"
                                        />

                                        <div className="flex min-w-0 items-center gap-1.5 text-xs">
                                            <span
                                                className="shrink-0 text-text-muted font-normal font-mono truncate max-w-20 sm:max-w-24"
                                                title={`Provider: ${provider}`}
                                            >
                                                {provider}
                                                <span className="opacity-40 ml-1">/</span>
                                            </span>
                                            <span
                                                className="truncate font-semibold text-ink tracking-tight font-sans text-sm"
                                                title={model.model}
                                            >
                                                {name}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between sm:justify-end gap-3 font-mono tabular-nums text-xs">
                                        <span
                                            className="text-left sm:w-16 sm:text-right text-text-muted"
                                            title={`Requests: ${model.totalRequests.toLocaleString()}`}
                                        >
                                            <ResponsiveNumber value={model.totalRequests} />{" "}
                                            <span className="text-[10px] opacity-70">req</span>
                                        </span>
                                        <span
                                            className="text-right sm:w-20 text-text-muted"
                                            title={`Prompt Tokens: ${model.totalInputTokens.toLocaleString()}`}
                                        >
                                            <strong className="font-semibold text-ink">
                                                <ResponsiveNumber value={model.totalInputTokens} />
                                            </strong>
                                            <span className="text-[10px] opacity-70 ml-0.5">
                                                in
                                            </span>
                                        </span>
                                        <span
                                            className="text-right sm:w-20 text-text-muted"
                                            title={`Completion Tokens: ${model.totalOutputTokens.toLocaleString()}`}
                                        >
                                            <strong className="font-semibold text-ink">
                                                <ResponsiveNumber value={model.totalOutputTokens} />
                                            </strong>
                                            <span className="text-[10px] opacity-70 ml-0.5">
                                                out
                                            </span>
                                        </span>
                                        <div
                                            className="text-right sm:w-24 flex items-center justify-end gap-1.5"
                                            title={`Total Tokens: ${totalTokens.toLocaleString()} (${sharePercent}% of top models)`}
                                        >
                                            <span className="text-xs font-semibold text-ink">
                                                <ResponsiveNumber value={totalTokens} />
                                            </span>
                                            <span className="text-[10px] text-text-muted font-normal">
                                                tok
                                            </span>
                                        </div>
                                    </div>
                                    <div className="col-span-1 sm:col-span-2 pt-1">
                                        <div
                                            role="progressbar"
                                            aria-valuenow={totalTokens}
                                            aria-valuemin={0}
                                            aria-valuemax={maxTokens}
                                            aria-label={`${model.model}: ${totalTokens.toLocaleString()} total tokens. ${breakdown}`}
                                            title={breakdown}
                                            className="h-1.5 w-full rounded-full bg-field overflow-hidden"
                                        >
                                            <div
                                                className="flex h-full transition-all duration-300 ease-out"
                                                style={{ width: `${width}%` }}
                                            >
                                                <span
                                                    className="h-full bg-ink/30"
                                                    style={{ width: `${inputRatio}%` }}
                                                    title={`Input: ${model.totalInputTokens.toLocaleString()}`}
                                                />
                                                <span
                                                    className="h-full bg-ink"
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
