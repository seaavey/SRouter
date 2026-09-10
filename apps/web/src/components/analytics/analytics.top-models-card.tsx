import { ProviderIcon } from "@/components/providers";
import type { AnalyticsTopModel } from "@srouter/types";

interface Props {
    models: AnalyticsTopModel[];
    totalRequests: number;
}

function parseModelIdentifier(model: string): { provider: string; name: string } {
    const slashIdx = model.indexOf("/");
    if (slashIdx === -1) return { provider: model, name: model };
    return { provider: model.slice(0, slashIdx), name: model.slice(slashIdx + 1) };
}

export function TopModelsCard({ models, totalRequests }: Props) {
    if (models.length === 0) {
        return (
            <article className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none font-sans">
                <h3 className="text-sm font-semibold text-ink font-sans">Top Models.</h3>
                <p className="mt-3 text-xs text-text-muted font-mono">
                    No requests in this window.
                </p>
            </article>
        );
    }

    return (
        <article className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-ink font-sans">Top Models.</h3>
                <p className="text-xs text-text-muted mt-0.5 font-sans">
                    Most requested models across all routes
                </p>
            </div>

            <div className="divide-y divide-hairline-soft">
                {models.map((m) => {
                    const { provider, name } = parseModelIdentifier(m.model);
                    const share = totalRequests > 0 ? (m.totalRequests / totalRequests) * 100 : 0;
                    return (
                        <div key={m.model} className="py-3 flex items-center gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-hairline-soft bg-field p-1.5">
                                <ProviderIcon providerId={provider} className="size-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-ink truncate">
                                        {name}
                                    </span>
                                    <span className="text-xs font-mono text-text-muted tabular-nums whitespace-nowrap">
                                        {m.totalRequests.toLocaleString()} req
                                    </span>
                                </div>
                                <div className="mt-1.5 h-1.5 w-full rounded-full bg-canvas-soft overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-accent transition-all duration-300"
                                        style={{ width: `${Math.max(share, 1.5)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[10.5px] font-mono text-text-muted mt-1">
                                    <span>{share.toFixed(1)}% share</span>
                                    <span>{m.totalTokens.toLocaleString()} tokens</span>
                                    {m.estCost > 0 && <span>${m.estCost.toFixed(4)}</span>}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </article>
    );
}
