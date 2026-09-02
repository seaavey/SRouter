import { ProviderIcon } from "@/components/providers";
import type { AnalyticsProviderSlice } from "@srouter/types";

interface Props {
    providers: AnalyticsProviderSlice[];
    totalRequests: number;
}

export function ProviderSplitCard({ providers, totalRequests }: Props) {
    if (providers.length === 0) {
        return (
            <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                    Provider Split
                </h3>
                <p className="text-xs text-muted-foreground">No requests in this window.</p>
            </div>
        );
    }

    const data = providers.map((p) => ({
        name: p.providerId,
        requests: p.totalRequests,
        share: totalRequests > 0 ? Math.round((p.totalRequests / totalRequests) * 100) : 0
    }));

    return (
        <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                Provider Split
            </h3>
            <div className="space-y-2">
                {data.map((d) => (
                    <div key={d.name} className="flex items-center gap-2.5">
                        <ProviderIcon providerId={d.name} className="size-5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-foreground capitalize">
                                    {d.name}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                                    {d.requests} req
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 w-full rounded-full bg-secondary/30 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-primary/60"
                                    style={{ width: `${Math.max(d.share, 1)}%` }}
                                />
                            </div>
                            <span className="text-[9px] text-muted-foreground/70">{d.share}%</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
