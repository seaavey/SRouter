import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Layers } from "lucide-react";
import type { ProviderDefinition } from "@srouter/types";
import { ProviderIcon } from "@/components/providers";
import { getConnectedCount } from "@/utils/provider.utils";

export function ProviderCard({ provider }: { provider: ProviderDefinition }) {
    const connectedCount = getConnectedCount(provider);
    const isConnected = connectedCount > 0;
    const modelCount = provider.models?.length ?? 0;

    return (
        <Link
            to="/providers/$providerId"
            params={{ providerId: provider.id }}
            className="group relative flex flex-col justify-between rounded-lg border border-border/80 bg-card p-4 transition-all duration-150 hover:border-foreground/30 hover:bg-card/80 active:scale-[0.99] font-mono cursor-pointer shadow-2xs"
        >
            {/* Top: Icon + Name & Status */}
            <div>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        {/* Machine-bezel Icon Box */}
                        <div className="relative flex size-9 shrink-0 items-center justify-center rounded-md border border-border/80 bg-secondary/40 p-1.5 shadow-2xs group-hover:border-foreground/20 transition-colors">
                            <ProviderIcon providerId={provider.id} className="size-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="truncate text-xs font-semibold text-foreground">
                                {provider.name}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] text-muted-foreground font-mono">
                                    {provider.id}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Status Dot / Clean Status Indicator (Anti-slop) */}
                    <div className="shrink-0 flex items-center">
                        {isConnected ? (
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                <span>{connectedCount} live</span>
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                                <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                                <span>Ready</span>
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom: Action & Model Telemetry */}
            <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    {modelCount > 0 ? (
                        <>
                            <Layers className="size-3 text-muted-foreground/70" />
                            <span>
                                {modelCount} {modelCount === 1 ? "model" : "models"}
                            </span>
                        </>
                    ) : (
                        <span className="text-muted-foreground/60">
                            {isConnected ? "Connected Driver" : "Driver Ready"}
                        </span>
                    )}
                </div>

                {/* Subtle Text Action */}
                <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
                    <span>{isConnected ? "Configure" : "Connect"}</span>
                    <ArrowUpRight className="size-3.5 stroke-[2] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
            </div>
        </Link>
    );
}
