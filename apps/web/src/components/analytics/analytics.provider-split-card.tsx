import { ProviderIcon } from "@/components/providers";
import type { AnalyticsProviderSlice } from "@srouter/types";

interface Props {
    providers: AnalyticsProviderSlice[];
    totalRequests: number;
}

export function ProviderSplitCard({ providers, totalRequests }: Props) {
    if (providers.length === 0) {
        return (
            <article className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none font-sans">
                <h3 className="text-sm font-semibold text-ink font-sans">Provider Split.</h3>
                <p className="mt-3 text-xs text-text-muted font-mono">
                    No requests in this window.
                </p>
            </article>
        );
    }

    const data = providers.map((p) => ({
        name: p.providerId,
        requests: p.totalRequests,
        share: totalRequests > 0 ? Math.round((p.totalRequests / totalRequests) * 100) : 0
    }));

    return (
        <article className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-ink font-sans">Provider Split.</h3>
                <p className="text-xs text-text-muted mt-0.5 font-sans">
                    Traffic volume distribution across upstream targets
                </p>
            </div>

            <div className="divide-y divide-hairline-soft">
                {data.map((d) => (
                    <div key={d.name} className="py-3 flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-hairline-soft bg-field p-1.5">
                            <ProviderIcon providerId={d.name} className="size-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-ink capitalize truncate">
                                    {d.name}
                                </span>
                                <span className="text-xs font-mono text-text-muted tabular-nums whitespace-nowrap">
                                    {d.requests.toLocaleString()} req
                                </span>
                            </div>
                            <div className="mt-1.5 h-1.5 w-full rounded-full bg-canvas-soft overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-accent transition-all duration-300"
                                    style={{ width: `${Math.max(d.share, 1.5)}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-[10.5px] font-mono text-text-muted mt-1">
                                <span>{d.share}% share</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </article>
    );
}
