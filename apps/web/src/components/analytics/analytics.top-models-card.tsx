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
            <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                    Top Models
                </h3>
                <p className="text-xs text-muted-foreground">No requests in this window.</p>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                Top Models
            </h3>
            <div className="space-y-2">
                {models.map((m) => {
                    const { provider, name } = parseModelIdentifier(m.model);
                    const share = totalRequests > 0 ? (m.totalRequests / totalRequests) * 100 : 0;
                    return (
                        <div key={m.model} className="flex items-center gap-2.5">
                            <ProviderIcon providerId={provider} className="size-5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-foreground truncate">
                                        {name}
                                    </span>
                                    <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                                        {m.totalRequests} req
                                    </span>
                                </div>
                                <div className="mt-1 h-1.5 w-full rounded-full bg-secondary/30 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-primary/60"
                                        style={{ width: `${Math.max(share, 1)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[9px] text-muted-foreground/70 mt-0.5">
                                    <span>{share.toFixed(1)}%</span>
                                    <span>{m.totalTokens.toLocaleString()} tokens</span>
                                    {m.estCost > 0 && <span>${m.estCost.toFixed(4)}</span>}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
