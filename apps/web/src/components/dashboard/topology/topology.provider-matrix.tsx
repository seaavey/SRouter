import { Link } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { ProviderIcon } from "@/components/providers";
import { getGatewayBaseUrl } from "@/lib/api";
import { getConnectedCount } from "@/utils/provider.utils";
import type { ProviderDefinition } from "@srouter/types";

export function ProviderMatrixView({
    displayedProviders,
    activeProviderIds
}: {
    displayedProviders: ProviderDefinition[];
    activeProviderIds: Set<string>;
}) {
    const apiBase = getGatewayBaseUrl();

    return (
        <div className="p-4 font-mono space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-hairline-soft bg-canvas-soft/50 p-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink border border-hairline-soft">
                        <Zap className="size-4" aria-hidden="true" />
                    </div>
                    <div>
                        <div className="text-xs font-bold text-ink font-sans">
                            SRouter Core Gateway
                        </div>
                        <div className="text-[11px] text-text-muted truncate max-w-sm font-mono">
                            {apiBase}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs font-sans">
                    <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-emerald-500" />
                        <span className="text-text-muted">Circuit Breaker:</span>
                        <span className="font-semibold text-ink">Nominal</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-text-muted">Token Saver:</span>
                        <span className="font-semibold text-ink">Active</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {displayedProviders.map((p) => {
                    const conn_count = getConnectedCount(p);
                    const is_receiving = activeProviderIds.has(p.id.toLowerCase());

                    return (
                        <Link
                            key={p.id}
                            to="/providers/$providerId"
                            params={{ providerId: p.id }}
                            className={`group flex flex-col justify-between rounded-2xl border bg-canvas p-4 transition-colors hover:border-hairline cursor-pointer shadow-none ${
                                is_receiving
                                    ? "border-ink ring-1 ring-ink/30"
                                    : "border-hairline-soft"
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="flex size-7 shrink-0 items-center justify-center rounded-[30%] bg-canvas-soft p-1">
                                        <ProviderIcon
                                            providerId={p.id}
                                            baseUrl={p.default_base_url}
                                            fallbackLabel={p.alias ?? p.name}
                                            className="size-3.5"
                                        />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-xs font-bold text-ink truncate font-sans">
                                            {p.name}
                                        </h4>
                                        <span className="text-[9px] text-text-muted uppercase">
                                            {p.alias ?? p.name}
                                        </span>
                                    </div>
                                </div>
                                {is_receiving && (
                                    <span className="rounded-full px-2 py-0.5 text-[8.5px] font-mono font-bold bg-ink text-canvas">
                                        LIVE
                                    </span>
                                )}
                            </div>
                            <div className="mt-3 flex items-center justify-between text-[10px] text-text-muted pt-2 border-t border-hairline-soft font-mono">
                                <span>
                                    {conn_count} key{conn_count !== 1 ? "s" : ""}
                                </span>
                                <span>{p.models?.length ?? 0} models</span>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
