import { ArrowDown, ArrowUp, Database } from "lucide-react";
import { formatCompactNumber, formatNumber } from "@/lib/utils";

interface Props {
    totalRequests: number;
    errorRate: number;
    p95LatencyMs: number;
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
}

export function AnalyticsStatCards({
    totalRequests,
    errorRate,
    p95LatencyMs,
    totalTokens = 0,
    promptTokens = 0,
    completionTokens = 0,
    cachedTokens = 0
}: Props) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans">
            <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline">
                <div>
                    <span className="text-xs font-medium text-text-muted font-sans">
                        Total Tokens
                    </span>
                    <div className="mt-3">
                        <div
                            className="text-2xl xl:text-3xl font-bold tracking-tight text-ink font-mono tabular-nums"
                            title={formatNumber(totalTokens)}
                        >
                            <span className="hidden sm:inline 2xl:hidden">
                                {formatCompactNumber(totalTokens)}
                            </span>
                            <span className="inline sm:hidden 2xl:inline">
                                {formatNumber(totalTokens)}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-3.5 border-t border-hairline-soft pt-3 text-xs text-text-muted font-mono tabular-nums">
                    <span
                        className="inline-flex items-center gap-1"
                        title={`Prompt Tokens: ${formatNumber(promptTokens)}`}
                    >
                        <ArrowDown className="size-3 text-text-muted shrink-0" strokeWidth={1.75} />
                        <span>{formatCompactNumber(promptTokens)}</span>
                    </span>
                    <span
                        className="inline-flex items-center gap-1"
                        title={`Completion Tokens: ${formatNumber(completionTokens)}`}
                    >
                        <ArrowUp className="size-3 text-text-muted shrink-0" strokeWidth={1.75} />
                        <span>{formatCompactNumber(completionTokens)}</span>
                    </span>
                    <span
                        className="inline-flex items-center gap-1"
                        title={`Cached Tokens: ${formatNumber(cachedTokens)}`}
                    >
                        <Database className="size-3 text-text-muted shrink-0" strokeWidth={1.75} />
                        <span>{formatCompactNumber(cachedTokens)}</span>
                    </span>
                </div>
            </article>

            <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline">
                <div>
                    <span className="text-xs font-medium text-text-muted font-sans">
                        Total Requests
                    </span>
                    <div className="mt-3">
                        <div className="text-3xl font-bold tracking-tight text-ink font-mono tabular-nums">
                            {totalRequests.toLocaleString()}
                        </div>
                    </div>
                </div>
                <div className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                    Recorded executions in window
                </div>
            </article>

            <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline">
                <div>
                    <span className="text-xs font-medium text-text-muted font-sans">
                        Error Rate
                    </span>
                    <div className="mt-3">
                        <div className="text-3xl font-bold tracking-tight text-ink font-mono tabular-nums">
                            {(errorRate * 100).toFixed(1)}%
                        </div>
                    </div>
                </div>
                <div className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                    {errorRate > 0.05 ? (
                        <span className="font-semibold text-rose-600 dark:text-rose-400">
                            Elevated error response rate
                        </span>
                    ) : (
                        "Optimal operational health"
                    )}
                </div>
            </article>

            <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline">
                <div>
                    <span className="text-xs font-medium text-text-muted font-sans">
                        p95 Latency
                    </span>
                    <div className="mt-3">
                        <div className="text-3xl font-bold tracking-tight text-ink font-mono tabular-nums">
                            {p95LatencyMs.toFixed(0)}
                            <span className="ml-1.5 text-xs font-normal text-text-muted font-sans">
                                ms
                            </span>
                        </div>
                    </div>
                </div>
                <div className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                    95th percentile response duration
                </div>
            </article>
        </div>
    );
}
